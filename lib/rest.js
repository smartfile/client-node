const stream = require('stream');
const request = require('request');
const logger = require('winston');
const path = require('path');


// x-throttle-wait-seconds=7,
const MIN_POLL_INTERVAL = 128;
const MAX_POLL_INTERVAL = 30720;


function normPath(path) {
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  return path;
}

function encodePath(path) {
  path = normPath(path);

  let parts = path.split('/');

  for (let i = 0; i < parts.length; i++) {
    parts[i] = encodeURIComponent(parts[i]);
  }

  return parts.join('/');
}


class Client {
  constructor(options) {
    options = options || {};

    options.baseUrl = options.baseUrl || process.env.SMARTFILE_URL;
    options.timeout = options.timeout || 30000;
    options.pool = options.pool || { maxSockets: 4 };

    this.options = options;
    this.request = request.defaults(options);
  }

  requestJSON(options, callback) {
    logger.debug(`${options.method}: ${options.uri}`);

    return this.request(options, (e, r, body) => {
      if (e) {
        return callback(e);
      }

      logger.debug(`${options.method}: ${options.uri}, ` +
                   `${r.statusCode}: ${r.statusMessage}`);
      if (429 == r.statusCode) {
        // Throttled.
        let time = 1000;
        const header = r.headers['x-throttle-wait-seconds'];
        if (header) {
          time = parseInt(header) * 1000;
        }
        logger.warn(`API throttled retry in: ${time}ms`);
        setTimeout(this.requestJSON.bind(this), time, options, callback);
        return;

      } else if (199 > r.statusCode || r.statusCode > 300) {
        const e = Error(
          `request: ${JSON.stringify(options)} returned non 2XX: ` +
          `${r.statusCode}`);
        e.statusCode = r.statusCode;
        e.statusMessage = r.statusMessage;
        e.options = options;
        return callback(e, r, body);
      }

      try {
        return callback(null, r, JSON.parse(body));
      } catch (e) {
        return callback(e, r, body);
      }
    });
  }

  requestOper(options, callback) {
    return this.requestJSON(options, (e, r, json) => {
      const self = this;

      if (e) {
        return callback(e);
      }

      const self = this;
      const pollOptions = {
        method: 'GET',
        uri: `/api/2/task/${json.uuid}/`,
      };
      let pollInterval = MIN_POLL_INTERVAL;

      function poll() {
        self.requestJSON(pollOptions, (e, r, json) => {
          if (e) {
            return callback(e);
          }

          if (!json.result) {
            let e = new Error(`Invalid response: ${JSON.stringify(json)}`);
            return callback(e);

          } else if (json.result.status == 'PENDING' ||
                     json.result.status == 'PROGRESS') {
            // Increase interval for each check up to max interval.
            // TODO: the min and max interval could be option.
            pollInterval = Math.min(pollInterval + 128, MAX_POLL_INTERVAL);
            logger.warn(`Operation incomplete, re-polling in ${pollInterval}ms`);
            setTimeout(poll, pollInterval);

          } else if (json.result.status == 'FAILURE') {
            let e = new Error(`task failed: ${json.result.result.errors}`);
            return callback(e);

          } else if (json.result.status == 'SUCCESS') {
            return callback(null, r, json);
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
    let options = {
      method: 'GET',
      uri: `/api/2/path/info${encodePath(p)}`,
    };

    function getInfoPage(client, options, callback, page) {
      if (page) {
        options.qs['page'] = page;
        options.qs['limit'] = 1024;
      }

      // Use an intermediary callback to handle paging.
      client.requestJSON(options, (e, r, json) => {
        if (e) {
          return callback(e);
        }

        // Call callback with a single page of data. If callback returns true,
        // cancel the listing.
        if (callback(e, json.children) === true) {
          return;
        }

        // If more pages are available, Call the function recursively to fetch
        // them. Use setImmediate so as not to block the event loop.
        if (json.page < json.pages) {
          logger.debug('getting next page of results');
          setImmediate(getInfoPage, client, options, callback, json.page + 1);

        } else if (json.page == json.pages) {
          logger.debug('final page of results reached');
          // Send a final callback with null JSON to indicate completion.
          callback(e, null);
        }
      });
    }

    if (args && args.children) {
      // Directory listings may return more than a single item.
      options['qs'] = {
        children: 'true',
        limit: 1024,
      }
      options['timeout'] = 30000;

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
          return callback(e);
        }
      });
  }

  upload(p, stream, callback) {
    const dirname = path.dirname(p);
    const basename = path.basename(p);

    const data = {
      file: {
        value: stream,
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
      uri: `/api/2/path/oper/mkdir/`,
      form: {
        path: normPath(p),
      }
    };

    this.requestJSON(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }

  delete(p, callback) {
    const options = {
      method: 'POST',
      uri: `/api/2/path/oper/remove/`,
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
      }
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
      }
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
      }
    };

    this.requestJSON(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }
}

class BasicClient extends Client {
  constructor(options) {
    options = options || {};

    if (!options.auth) {
      const username = options.username || process.env.SMARTFILE_USER;
      const password = options.password || process.env.SMARTFILE_PASS;

      delete options.username;
      delete options.password;

      if (!username || !password) {
        throw new Error('username and password require for basic auth');
      }

      options.auth = {
        user: username,
        pass: password,
        sendImmediately: true,
      };
    }

    super(options);
  }
}

module.exports = {
  Client,
  BasicClient,
  encodePath,
  normPath,
};
