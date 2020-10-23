/* eslint no-underscore-dangle: ["error", { "allowAfterThis": true }] */
const http = require('http');
const https = require('https');
const moment = require('moment-timezone');
const FormData = require('form-data');
const winston = require('winston');
const pathlib = require('path');
const prom = require('prom-client');
const utf8 = require('utf8');
const { CookieJar, Cookie, CookieAccessInfo } = require('cookiejar');


const TZ = moment().tz('America/Indiana/Indianapolis').format('Z');
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


function toUtcTs(dt) {
  // Convert timestamps: 2020-04-16T09:57:00 -> milliseconds UTC
  if (!dt) return null;

  return moment.parseZone(dt + TZ)
    .utc()
    .valueOf();
}

function normPath(_path, _leadingSlash) {
  const leadingSlash = (_leadingSlash === undefined) ? true : _leadingSlash;
  let path = _path;

  if (leadingSlash && path[0] !== '/') {
    path = `/${path}`;
  }

  while (!leadingSlash && path[0] === '/') {
    path = path.slice(1);
  }

  return path;
}

function encodePath(_path, _leadingSlash) {
  const parts = normPath(_path, _leadingSlash).split('/');

  for (let i = 0; i < parts.length; i++) {
    parts[i] = encodeURIComponent(parts[i]);
  }

  const path = parts.join('/');

  return path;
}

function parseJson(req, res, callback) {
  const buffer = [];

  res
    .on('data', (chunk) => {
      buffer.push(chunk);
    })
    .on('end', () => {
      if (res.statusCode <= 199 || res.statusCode > 300) {
        const resError = new Error(`${req.path} replied with: ${res.statusCode}`);
        resError.statusCode = res.statusCode;
        resError.statusMessage = res.statusMessage;
        resError.request = req;

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
          callback(jsonError, res, json);
        }
      }
    });
}

class Client {
  constructor(opts) {
    // We accept:
    // - baseUri
    // - auth
    this.baseUrl = opts.baseUrl || process.env.SMARTFILE_API_URL || BASE_URL;

    this.options = {
      auth: opts.auth,
      timeout: opts.timeout || 30000,
      headers: opts.headers,
    };
    this.cookies = new CookieJar();
  }

  request(options, callback) {
    let multipart = null;
    let body = null;
    const reqUrl = new URL(this.baseUrl);
    reqUrl.pathname = (options.path) ? pathlib.join(options.uri, options.path) : options.uri;

    if (options.qs) {
      Object.keys(options.qs).forEach((key) => {
        reqUrl.searchParams.set(key, options.qs[key]);
      });
    }

    // Deep copy global options so our local options don't pollute them.
    const reqOptions = JSON.parse(JSON.stringify(this.options));
    reqOptions.method = options.method;

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

    // We need URL details for handling cookies.
    const cai = new CookieAccessInfo(reqUrl.host, reqUrl.pathname, (reqUrl.protocol === 'https:'), false);

    // Any cookies for this request?
    const reqCookies = this.cookies.getCookies(cai);
    let usingSession = false;

    // Inject cookies from jar into request headers.
    if (reqCookies) {
      const cookieStrings = [];
      for (let i = 0; i < reqCookies.length; i++) {
        if (reqCookies[i].name === 'sessionid') {
          usingSession = true;
        }
        cookieStrings.push(reqCookies[i].toValueString());
      }
      reqOptions.headers = {
        ...reqOptions.headers,
        Cookie: cookieStrings.join('; '),
      };
    }

    // Handle CSRF token for some requests.
    if (['GET', 'HEAD', 'OPTIONS', 'TRACE'].indexOf(reqOptions.method.toUpperCase()) === -1) {
      const csrfCookie = this.cookies.getCookie('csrftoken', cai);
      if (csrfCookie) {
        reqOptions.headers = {
          ...reqOptions.headers,
          // Add CSRF token to headers.
          'X-CSRFToken': csrfCookie.value,
        };
      }
    }

    if (!usingSession) {
      this.authenticate(reqOptions);
    }

    const end = HTTP_REQUEST.startTimer({
      method: reqOptions.method,
      endpoint: options.uri,
    });

    let req;
    const request = (reqUrl.protocol === 'http:') ? http.request : https.request;

    const cb = (res) => {
      logger.debug(`${req.method}: ${req.path}, `
                   + `${res.statusCode}: ${res.statusMessage}`);

      if (res.statusCode === 429) {
        // Throttled, set a default retry interval.
        let time = 1000;
        // https://github.com/encode/django-rest-framework/blob/f0dbf0a264677f2a53faab402ff49f442fc4383a/docs/community/3.0-announcement.md#throttle-headers-using-retry-after
        // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
        const header = res.headers['retry-after'];
        // Retry-After can be a date or number of seconds. We will assume seconds (because DRF).
        if (header) {
          time = parseInt(header, 10) * 1000;
        }
        logger.warn(`API throttled, retry in: ${time}ms`);
        THROTTLE.inc({
          method: reqOptions.method,
          endpoint: reqUrl.pathname,
        });

        // We can only handle throttling under certain conditions.
        // If the request needs to provide the request body over a stream, we cannot retry
        // automatically.
        if (reqOptions.method === 'GET' // Always OK.
            || reqOptions.method === 'DELETE') { // Always OK.
          setTimeout(() => {
            // The .end() is key, we can only end() a _complete_ request. Otherwise we must throw.
            request(reqUrl, reqOptions, cb).end();
          }, time);
        } else {
          // We cannot automatically handle this request. Throw an error.
          const e = new Error(`'Request was throttled, try again in ${time}ms`);
          // Let caller know when they can retry.
          e.time = time;
          throw e;
        }
      } else if (res.statusCode <= 199 || res.statusCode > 300) {
        end({ statusCode: res.statusCode });

        const resError = new Error(`${options.uri} replied with: ${res.statusCode}`);
        resError.statusCode = res.statusCode;
        resError.request = req;

        if (callback) callback(resError, res);
      } else {
        end({ statusCode: res.statusCode });
        if (callback) callback(null, res);
      }
    };

    req = request(reqUrl, reqOptions, cb);

    req.on('response', (res) => {
      // Store cookies from server into cookie jar.
      const resCookies = res.headers['set-cookie'];
      if (resCookies) {
        // Will update existing cookies.
        this.cookies.setCookies(resCookies, reqUrl.host);
      }
    });

    req.on('error', (e) => {
      if (callback) callback(e);
    });

    if (body) {
      req.write(body);
    }

    if (multipart) {
      multipart.pipe(req);
    }

    return req;
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  authenticate(options) {
    // NOOP
  }

  requestJson(options, callback) {
    logger.debug(`${options.method}: ${options.uri}`);

    const req = this.request(options, (e, res) => {
      if (e) {
        callback(e);
        return;
      }

      parseJson(req, res, callback);
    })
      .end();

    return req;
  }

  requestOper(options, callback) {
    const startTimeMs = Date.now();

    const req = this.requestJson(options, (req0Error, r0, json0) => {
      if (req0Error) {
        // eslint-disable-next-line no-param-reassign
        req0Error.request = req;
        callback(req0Error, r0, json0);
        return;
      }

      let pollCount = 0;
      const self = this;
      const pollOptions = {
        method: 'GET',
        uri: '/api/2/task/',
        path: `${json0.uuid}/`,
      };
      let pollInterval = MIN_POLL_INTERVAL;

      function poll() {
        pollCount += 1;
        self.requestJson(pollOptions, (req1Error, r1, json1) => {
          if (req1Error) {
            // eslint-disable-next-line no-param-reassign
            req1Error.request = req;
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

          // Safely retrieve any errors that occurred during the operation.
          const errors = (json1.result.result) ? json1.result.result.errors : undefined;

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
              // The operation failed outright (500, 400 etc.)
              OPERATION.observe({
                status: 'error',
                endpoint: pollOptions.uri,
              }, pollCount);

              resError = new Error(`Task failed: result.result.errors=${errors}`);
              resError.statusCode = r1.statusCode;
              resError.request = req;
              callback(resError, r1, json1);
              break;

            case 'SUCCESS':
              // Sometimes an error occurs during the operation (partial failure).
              if (errors) {
                resError = new Error(`Partial failure: result.result.errors=${errors}`);
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
              resError.request = req;
              callback(resError, r1, json1);
              break;
          }
        });
      }

      setTimeout(poll, pollInterval);
    });

    return req;
  }

  ping(callback, _options) {
    let options = {
      method: 'GET',
      uri: '/api/2/ping/',
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.requestJson(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  whoami(callback, _options) {
    let options = {
      method: 'GET',
      uri: '/api/2/whoami/',
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.requestJson(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  right(callback, _options) {
    let options = {
      method: 'GET',
      uri: '/api/2/right/',
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.requestJson(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  info(p, callback, _options) {
    let pollCount = 0;
    let options = {
      method: 'GET',
      uri: '/api/2/path/info/',
      path: encodePath(p, false),
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    function getInfoPage(client, opts, page) {
      pollCount += 1;
      const pageOptions = { ...opts };
      if (page) {
        pageOptions.qs.page = page;
        pageOptions.qs.limit = 1024;
      }

      // Use an intermediary callback to handle paging.
      client.requestJson(pageOptions, (e, r, json) => {
        if (e) {
          callback(e);
          return;
        }

        // Call callback with a single page of data. If callback returns true,
        // cancel the listing.
        const children = json.children || [];

        // eslint-disable-next-line no-param-reassign
        json.time = toUtcTs(json.time);

        for (let i = 0; i < children.length; i++) {
          children[i].time = toUtcTs(children[i].time);
        }

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

    if (options.qs && options.qs.children) {
      // Directory listings may return more than a single item.
      getInfoPage(this, options);
    } else {
      // Handle single-item info as a simpler case.
      this.requestJson(options, (e, r, json) => {
        callback(e, json);
      });
    }

    return this;
  }

  download(p, callback, _options) {
    // We don't need to worry about the timeout for downloads since the timeout
    // only applies until the server starts sending the response.
    let options = {
      method: 'GET',
      uri: '/api/2/path/data/',
      path: encodePath(p, false),
    };

    if (_options) {
      options = { ..._options, ...options };
    }

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

  upload(p, _s, _callback, _options) {
    const dirname = pathlib.dirname(p);
    const basename = pathlib.basename(p);
    let options;

    // Helper function for put() and patch().
    const toJson = (req, callback) => {
      req
        .on('response', (res) => {
          parseJson(req, res, (e, r, json) => {
            callback(e, json);
          });
        })
        .on('error', (reqError) => {
          if (callback) {
            callback(reqError);
          }
        });
      return req;
    };

    // POST request is fairly simple, sends the file as multipart/form-data.
    const post = (callback) => {
      options = {
        ...options,
        method: 'POST',
        uri: '/api/2/path/data/',
        path: encodePath(dirname, false),
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

      this.requestJson(options, (e, r, json) => {
        if (callback) {
          callback(e, json);
        }
      });
    };

    // PATCH request includes a range header.
    const patch = (callback) => {
      options = {
        ...options,
        method: 'PATCH',
        uri: '/api/3/path/data/',
        path: encodePath(p, false),
        // Eliminate timeout for uploads.
        timeout: null,
      };

      if (!options.headers['If-Unmodified-Since']) {
        logger.warn('Performing an append without a timestamp. A timestamp provides additional safety.');
      }

      return toJson(this.request(options), callback);
    };

    // PUT request stores the entire file.
    const put = (callback) => {
      options = {
        ...options,
        method: 'PUT',
        uri: '/api/3/path/data/',
        path: encodePath(p, false),
        // Eliminate timeout for uploads.
        timeout: null,
      };

      return toJson(this.request(options), callback);
    };

    if (typeof _s === 'function') {
      // _s is our callback shift.
      if (_callback) {
        options = _callback;
      }

      if (options && options.headers && options.headers.Range) {
        // If a range header is provided, then we must perform a PATCH request.
        return patch(_s);
      }
      // Otherwise, we are PUTing an entire file.
      return put(_s);
    }
    options = _options;
    // If neither, then we can do a regular POST.
    return post(_callback);
  }

  mkdir(p, callback, _options) {
    let options = {
      method: 'POST',
      uri: '/api/2/path/oper/mkdir/',
      form: {
        path: normPath(p),
      },
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.requestJson(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  delete(p, callback, _options) {
    let options = {
      method: 'POST',
      uri: '/api/2/path/oper/remove/',
      form: {
        path: normPath(p),
      },
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.requestOper(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  deleteFile(p, callback, _options) {
    let options = {
      method: 'DELETE',
      uri: '/api/3/path/data/',
      path: encodePath(p, false),
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.request(options, (e, r, json) => {
      callback(e, json);
    }).end();

    return this;
  }

  copy(src, dst, callback, _options) {
    let options = {
      method: 'POST',
      uri: '/api/2/path/oper/copy/',
      form: {
        src: normPath(src),
        dst: normPath(dst),
      },
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.requestOper(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  move(src, dst, callback, _options) {
    let options = {
      method: 'POST',
      uri: '/api/2/path/oper/move/',
      form: {
        src: normPath(src),
        dst: normPath(dst),
      },
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.requestOper(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  rename(src, dst, callback, _options) {
    let options = {
      method: 'POST',
      uri: '/api/2/path/oper/rename/',
      form: {
        src: normPath(src),
        dst: normPath(dst),
      },
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.requestJson(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  login(callback, _options) {
    let options = {
      method: 'POST',
      uri: '/api/2/session/',
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    // Attempt login, creating a session...
    this.requestJson(options, (e) => {
      if (e) {
        callback(e);
        return;
      }

      // NOTE: success, call whoami, logins often need user info.
      this.whoami(callback);
    });

    return this;
  }

  logout(callback) {
    const options = {
      method: 'DELETE',
      uri: '/api/2/session/',
    };

    const reqUrl = new URL(this.baseUrl);

    this.requestJson(options, (e) => {
      // Remove session & csrf cookies.
      const sessionCookie = new Cookie('sessionid=null', reqUrl.host, '/');
      const csrfCookie = new Cookie('csrftoken=null', reqUrl.host, '/');
      csrfCookie.expiration_date = new Date(-8640000000000000);
      sessionCookie.expiration_date = new Date(-8640000000000000);
      this.cookies.setCookie(sessionCookie, reqUrl.host, '/');
      this.cookies.setCookie(csrfCookie, reqUrl.host, '/');

      callback(e);
    });
  }
}

module.exports = {
  Client,
  encodePath,
  normPath,
  logger,
  metrics,
};
