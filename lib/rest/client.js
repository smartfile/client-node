/* eslint no-underscore-dangle: ["error", { "allowAfterThis": true }] */
const http = require('http');
const https = require('https');
const FormData = require('form-data');
const winston = require('winston');
const pathlib = require('path');
const prom = require('prom-client');
const utf8 = require('utf8');


const BASE_URL = 'https://app.smartfile.com/';


const fmt = winston.format.printf(({
  level, message, label, timestamp,
}) => `${timestamp} [${label}] ${level}: ${message}`);

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.label({ label: 'smartfile' }),
    winston.format.timestamp(),
    fmt,
  ),
  transports: [
    new winston.transports.Console(),
  ],
});
const metrics = new prom.Registry();

const HTTP_REQUEST = new prom.Summary({
  name: 'sf_rest_http_request',
  help: 'Request to SmartFile API',
  labelNames: ['method', 'statusCode', 'endpoint'],
  registers: [metrics],
});

const OPERATION = new prom.Summary({
  name: 'sf_rest_operation_polling',
  help: 'Number of polls until completion',
  labelNames: ['endpoint', 'status'],
  registers: [metrics],
});

const CHILDREN = new prom.Summary({
  name: 'sf_rest_children_pages',
  help: 'Number of pages returned from info',
  registers: [metrics],
});

const THROTTLE = new prom.Counter({
  name: 'sf_rest_throttle',
  help: 'Number of times requests were throttled',
  labelNames: ['method', 'endpoint'],
  registers: [metrics],
});

// x-throttle-wait-seconds=7,
const MIN_POLL_INTERVAL = 192;
const MAX_POLL_INTERVAL = 6144; //  About 6 seconds
const MAX_POLL_TIMEOUT = 393216; // About 6.5 minutes


function normPath(path) {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  return path;
}

function encodePath(path) {
  const parts = normPath(path).split('/');

  for (let i = 0; i < parts.length; i++) {
    parts[i] = encodeURIComponent(parts[i]);
  }

  return parts.join('/');
}


class Client {
  constructor(opts) {
    // We accept:
    // - baseUri
    // - auth
    this.baseUrl = opts.baseUrl || process.env.SMARTFILE_API_URL || BASE_URL;

    const options = {
      auth: opts.auth,
      timeout: opts.timeout || 30000,
      headers: opts.headers,
    };

    this.options = options;
  }

  request(options, callback) {
    let multipart = null;
    let body = null;
    const reqUrl = new URL(this.baseUrl);
    reqUrl.pathname = options.uri;

    if (options.qs) {
      Object.keys(options.qs).forEach((key) => {
        reqUrl.searchParams.set(key, options.qs[key]);
      });
    }

    const reqOptions = {
      ...this.options,
      method: options.method,
    };

    if (!reqOptions.headers) {
      reqOptions.headers = {};
    }

    if (options.headers) {
      // Merge in any request-specific headers.
      Object.keys(options.headers).forEach((name) => {
        reqOptions.headers[name] = utf8.encode(options.headers[name]);
      });
    }

    if (options.json) {
      reqOptions.headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }

    if (options.form) {
      reqOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const urlSearch = new URLSearchParams();
      Object.keys(options.form).forEach((key) => {
        urlSearch.append(key, options.form[key]);
      });
      body = urlSearch.toString();
    }

    if (options.multipart) {
      multipart = new FormData();

      Object.keys(options.multipart).forEach((name) => {
        let value = options.multipart[name];
        let opts = null;

        if (value.options) {
          opts = value.options;
        }
        if (value.value) {
          value = value.value;
        }

        multipart.append(name, value, opts);
      });

      const multipartHeaders = multipart.getHeaders();
      Object.keys(multipartHeaders).forEach((name) => {
        reqOptions.headers[name] = multipartHeaders[name];
      });
    }

    let req;
    if (reqUrl.protocol === 'http:') {
      req = http.request(reqUrl, reqOptions, callback);
    } else {
      req = https.request(reqUrl, reqOptions, callback);
    }

    if (body) {
      req.write(body);
    }

    if (multipart) {
      multipart.pipe(req);
    }

    return req;
  }

  requestJSON(options, callback) {
    logger.debug(`${options.method}: ${options.uri}`);

    const end = HTTP_REQUEST.startTimer({
      method: options.method,
      endpoint: options.uri,
    });

    return this.request(options)
      .on('response', (res) => {
        logger.debug(`${options.method}: ${options.uri}, `
                     + `${res.statusCode}: ${res.statusMessage}`);

        if (res.statusCode === 429) {
          end({ statusCode: res.statusCode });

          // Throttled.
          let time = 1000;
          const header = res.headers['x-throttle-wait-seconds'];
          if (header) {
            time = parseInt(header, 10) * 1000;
          }
          logger.warn(`API throttled retry in: ${time}ms`);
          THROTTLE.inc({
            method: options.method,
            endpoint: options.uri,
          });

          setTimeout(this.requestJSON.bind(this), time, options, callback);
        } else if (res.statusCode <= 199 || res.statusCode > 300) {
          end({ statusCode: res.statusCode });

          const resError = new Error(`${options.uri} replied with: ${res.statusCode}`);
          resError.statusCode = res.statusCode;
          resError.statusMessage = res.statusMessage;
          resError.options = options;

          callback(resError, res);
        } else {
          const buffer = [];
          res
            .on('data', (chunk) => {
              buffer.push(chunk);
            })
            .on('end', () => {
              end({ statusCode: res.statusCode });

              let resError = null;
              let json = null;
              try {
                json = JSON.parse(Buffer.concat(buffer));
              } catch (e) {
                resError = e;
              }
              callback(resError, res, json);
            });
        }
      })
      .on('error', (e) => {
        callback(e);
      })
      .end();
  }

  requestOper(options, callback) {
    const startTimeMs = Date.now();

    return this.requestJSON(options, (req0Error, r0, json0) => {
      if (req0Error) {
        callback(req0Error);
        return;
      }

      let pollCount = 0;
      const self = this;
      const pollOptions = {
        method: 'GET',
        uri: `/api/2/task/${json0.uuid}/`,
      };
      let pollInterval = MIN_POLL_INTERVAL;

      function poll() {
        pollCount += 1;
        self.requestJSON(pollOptions, (req1Error, r1, json1) => {
          if (req1Error) {
            callback(req1Error, r1, json1);
            return;
          }

          let resError = null;
          if (!json1.result) {
            resError = new Error(`Invalid response: ${JSON.stringify(json1)}`);
            resError.statusCode = r1.statusCode;
            callback(resError, r1, json1);
            return;
          }

          switch (json1.result.status) {
            case 'PENDING':
            case 'PROGRESS':
              if (Date.now() - startTimeMs > MAX_POLL_TIMEOUT) {
                // It's time to give up. Our client has probably moved on.
                callback(new Error('Maximum polling interval exceeded.'));
                return;
              }
              pollInterval = Math.min(pollInterval *= 2, MAX_POLL_INTERVAL);
              logger.warn(`Operation incomplete, re-polling in ${pollInterval}ms`);

              setTimeout(poll, pollInterval);
              break;

            case 'FAILURE':
              OPERATION.observe({
                status: 'error',
                endpoint: pollOptions.uri,
              }, pollCount);

              resError = new Error(`Task failed: ${json1.result.result.errors}`);
              resError.statusCode = r1.statusCode;
              callback(resError, r1, json1);
              break;

            case 'SUCCESS':
              if (json1.result.result.errors) {
                // In this case some error occurred during the operation.
                resError = new Error('Operation reported errors');
                resError.statusCode = r1.statusCode;

                OPERATION.observe({
                  status: 'error',
                  endpoint: pollOptions.uri,
                }, pollCount);

                callback(resError, r1, json1);
              } else {
                OPERATION.observe({
                  status: 'success',
                  endpoint: pollOptions.uri,
                }, pollCount);

                callback(null, r1, json1);
              }
              break;

            default:
              resError = new Error(`Unexpected status: "${json1.result.status}"`);
              resError.statusCode = r1.statusCode;
              callback(resError, r1, json1);
              break;
          }
        });
      }

      setTimeout(poll, pollInterval);
    });
  }

  ping(callback) {
    const options = {
      method: 'GET',
      uri: '/api/2/ping/',
    };

    this.requestJSON(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  whoami(callback) {
    const options = {
      method: 'GET',
      uri: '/api/2/whoami/',
    };

    this.requestJSON(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  info(p, callback, args) {
    let pollCount = 0;
    const options = {
      method: 'GET',
      uri: `/api/2/path/info${encodePath(p)}`,
    };

    function getInfoPage(client, opts, page) {
      pollCount += 1;
      const pageOptions = { ...opts };
      if (page) {
        pageOptions.qs.page = page;
        pageOptions.qs.limit = 1024;
      }

      // Use an intermediary callback to handle paging.
      client.requestJSON(pageOptions, (e, r, json) => {
        if (e) {
          callback(e);
          return;
        }

        // Call callback with a single page of data. If callback returns true,
        // cancel the listing.
        const children = json.children || [];
        if (callback(e, children, json) === true) {
          return;
        }

        // If more pages are available, Call the function recursively to fetch
        // them. Use setImmediate so as not to block the event loop.
        if (json.page < json.pages) {
          logger.debug('getting next page of results');
          setImmediate(getInfoPage, client, pageOptions, json.page + 1);
        } else if (json.page === json.pages) {
          logger.debug('final page of results reached');
          // Send a final callback with null JSON to indicate completion.
          CHILDREN.observe(pollCount);
          callback(e, null);
        }
      });
    }

    if (args && args.children) {
      // Directory listings may return more than a single item.
      options.qs = {
        children: 'true',
        limit: 1024,
      };
      options.timeout = 30000;

      getInfoPage(this, options);
    } else {
      // Handle single-item info as a simpler case.
      this.requestJSON(options, (e, r, json) => {
        callback(e, json);
      });
    }

    return this;
  }

  download(p, callback) {
    // We don't need to worry about the timeout for downloads since the timeout
    // only applies until the server starts sending the response.
    const options = {
      method: 'GET',
      uri: `/api/2/path/data${encodePath(p)}`,
    };

    const req = this.request(options)
      .on('response', (res) => {
        if (res.statusCode <= 199 || res.statusCode > 300) {
          const resError = new Error(`${options.uri} replied with: ${res.statusCode}`);
          resError.statusCode = res.statusCode;
          resError.statusMessage = res.statusMessage;
          resError.options = options;

          if (callback) {
            callback(resError, res);
          }
        } else if (callback) {
          callback(null, res);
        }
      })
      .on('error', (e) => {
        if (callback) {
          callback(e);
        }
      });
    req.end();
    return req;
  }

  upload(p, _s, _callback) {
    const dirname = pathlib.dirname(p);
    const basename = pathlib.basename(p);

    const post = (callback) => {
      const options = {
        method: 'POST',
        uri: `/api/2/path/data${encodePath(dirname)}`,
        multipart: {
          file: {
            value: _s,
            options: {
              filename: basename,
            },
          },
        },
        // Eliminate timeout for uploads.
        timeout: null,
      };

      this.requestJSON(options, (e, r, json) => {
        if (callback) {
          callback(e, json);
        }
      });
    };

    const put = (callback) => {
      const options = {
        method: 'PUT',
        uri: `/api/2/path/data${encodePath(dirname)}`,
        headers: {
          'X-File-Name': basename,
          // TODO: lua requires this for now, fix that!
          'Content-Type': 'application/octet-stream',
        },
        // Eliminate timeout for uploads.
        timeout: null,
      };

      return this.request(options)
        .on('response', (res) => {
          const buffer = [];

          res
            .on('data', (chunk) => {
              buffer.push(chunk);
            })
            .on('end', () => {
              if (res.statusCode <= 199 || res.statusCode > 300) {
                const resError = new Error(`${options.uri} replied with: ${res.statusCode}`);
                resError.statusCode = res.statusCode;
                resError.statusMessage = res.statusMessage;
                resError.options = options;

                if (callback) {
                  callback(resError, res);
                }
              } else {
                let jsonError = null;
                let json = null;

                try {
                  json = JSON.parse(Buffer.concat(buffer));
                } catch (e) {
                  jsonError = e;
                }

                if (callback) {
                  callback(jsonError, json);
                }
              }
            });
        })
        .on('error', (reqError) => {
          if (callback) {
            callback(reqError);
          }
        });
    };

    if (typeof _s === 'function') {
      return put(_s);
    }
    return post(_callback);
  }

  mkdir(p, callback) {
    const options = {
      method: 'POST',
      uri: '/api/2/path/oper/mkdir/',
      form: {
        path: normPath(p),
      },
    };

    this.requestJSON(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  delete(p, callback) {
    const options = {
      method: 'POST',
      uri: '/api/2/path/oper/remove/',
      form: {
        path: normPath(p),
      },
    };

    this.requestOper(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  copy(src, dst, callback) {
    const options = {
      method: 'POST',
      uri: '/api/2/path/oper/copy/',
      form: {
        src: normPath(src),
        dst: normPath(dst),
      },
    };

    this.requestOper(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  move(src, dst, callback) {
    const options = {
      method: 'POST',
      uri: '/api/2/path/oper/move/',
      form: {
        src: normPath(src),
        dst: normPath(dst),
      },
    };

    this.requestOper(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  rename(src, dst, callback) {
    const options = {
      method: 'POST',
      uri: '/api/2/path/oper/rename/',
      form: {
        src: normPath(src),
        dst: normPath(dst),
      },
    };

    this.requestJSON(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }
}

module.exports = {
  Client,
  encodePath,
  normPath,
  logger,
  metrics,
};
