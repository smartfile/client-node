const request = require('request');
const winston = require('winston');
const pathlib = require('path');
const prom = require('prom-client');


const logger = winston.createLogger({
  format: winston.format.simple(),
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
const MIN_POLL_INTERVAL = 128;
const MAX_POLL_INTERVAL = 30720;


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
    const options = { ...opts };

    options.baseUrl = options.baseUrl || process.env.SMARTFILE_URL;
    options.timeout = options.timeout || 30000;
    options.pool = options.pool || { maxSockets: 4 };

    this.options = options;
    this.request = request.defaults(options);
  }

  requestJSON(options, callback) {
    logger.debug(`${options.method}: ${options.uri}`);

    const end = HTTP_REQUEST.startTimer({
      method: options.method,
      endpoint: options.uri,
    });

    return this.request(options, (e, r, body) => {
      if (r) {
        end({ statusCode: r.statusCode })
      }

      if (e) {
        callback(e);
        return;
      }

      logger.debug(`${options.method}: ${options.uri}, `
                   + `${r.statusCode}: ${r.statusMessage}`);

      if (r.statusCode === 429) {
        // Throttled.
        let time = 1000;
        const header = r.headers['x-throttle-wait-seconds'];
        if (header) {
          time = parseInt(header, 10) * 1000;
        }
        logger.warn(`API throttled retry in: ${time}ms`);
        THROTTLE.inc({
          method: options.method,
          endpoint: options.uri,
        });
        setTimeout(this.requestJSON.bind(this), time, options, callback);
      } else if (r.statusCode <= 199 || r.statusCode > 300) {
        const resError = Error(
          `request: ${JSON.stringify(options)} returned non 2XX: `
          + `${r.statusCode}`
        );
        resError.statusCode = r.statusCode;
        resError.statusMessage = r.statusMessage;
        resError.options = options;

        callback(resError, r, body);
      } else {
        try {
          callback(null, r, JSON.parse(body));
        } catch (jsonError) {
          callback(jsonError, r, body);
        }
      }
    });
  }

  requestOper(options, callback) {
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
              pollInterval = Math.min(pollInterval + 128, MAX_POLL_INTERVAL);
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
        if (callback(e, children) === true) {
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

      getInfoPage(this, options, callback);
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

    // Return the stream to caller.
    return this.request(options)
      .on('end', (e) => {
        if (typeof callback === 'function') {
          callback(e);
        }
      });
  }

  upload(p, s, callback) {
    const dirname = pathlib.dirname(p);
    const basename = pathlib.basename(p);

    const data = {
      file: {
        value: s,
        options: {
          filename: basename,
        },
      },
    };

    const options = {
      method: 'POST',
      uri: `/api/2/path/data${encodePath(dirname)}`,
      formData: data,
      // Eliminate timeout for uploads.
      timeout: null,
    };

    this.requestJSON(options, (e, r, json) => {
      callback(e, json);
    });
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
