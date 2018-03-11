const request = require('request');
const logger = require('winston');
const path = require('path');


class Client {
  constructor(options) {
    options = options || {};

    if (!options.baseUrl) {
      options.baseUrl = process.env.SMARTFILE_URL;
    }

    this.options = options;
    this.request = request.defaults(options);
  }

  requestJSON(options, callback) {
    return this.request(options, (e, r, body) => {
      if (e) {
        return callback(e);
      }

      if (199 > r.statusCode || r.statusCode > 300) {
        const e = Error(`HTTP status non 2XX: ${r.statusCode}`);
        return callback(e, r);
      }

      let json = null;
      try {
        json = JSON.parse(body);
      } catch (e) {
        return callback(e, r);
      }

      callback(null, json);
    });
  }

  requestOper(options, callback) {
    this.requestJSON(options, (e, json) => {
      const self = this;

      if (e) {
        return callback(e);
      }

      let pollInterval = 0;
      let pollOptions = {
        uri: `/api/2/task/${json.uuid}/`,
      };

      function poll() {
        self.requestJSON(pollOptions, (e, json) => {
          if (e) {
            return callback(e);
          }

          if (json.result.status == 'PENDING' ||
              json.result.status == 'PROGRESS') {
            // Increase interval for each check up to max interval.
            // TODO: the max interval could be an option.
            pollInterval = Math.min(pollInterval + 0.1, 30);
            setTimeout(poll, pollInterval * 1000);

          } else if (json.result.status == 'FAILURE') {
            let e = new Error(`task failed: ${json.result.result.errors}`);
            return callback(e);

          } else if (json.result.status == 'SUCCESS') {
            return callback(null, json);
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

    this.requestJSON(options, callback);

    return this;
  }

  whoami(callback) {
    const options = {
      method: 'GET',
      uri: '/api/2/whoami/',
    };

    this.requestJSON(options, callback);

    return this;
  }

  info(p, callback, args) {
    let options = {
      method: 'GET',
      uri: `/api/2/path/info${p}`,
    };

    function getInfoPage(client, options, callback, page) {
      if (page) {
        options.qs['page'] = page;
      }

      // Use an intermediary callback to handle paging.
      client.requestJSON(options, (e, json) => {
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
          setImmediate(getInfoPage, client, options, callback, json.page + 1);
        }

        if (json.page == json.pages) {
          // Send a final callback with null JSON to indicate completion.
          callback(e, null);
        }
      });
    }

    if (args && args.children) {
      // Directory listings may return more than a single item.
      options.qs = {
        children: 'true'
      }

      getInfoPage(this, options, callback);
    } else {
      // Handle single-item info as a simpler case.
      this.requestJSON(options, callback);
    }

    return this;
  }

  download(p, callback, stream) {
    const options = {
      method: 'GET',
      uri: `/api/2/path/data${p}`,
    };

    // If caller passed a stream, just pipe the file.
    if (stream !== undefined) {
      this.request(options)
        .pipe(stream)
        .on('error', callback)
        .on('finish', () => {
          callback(null, null);
        });

      return this;
    }

    // otherwise, pass the response to the callback.
    this.request(options)
      .on('response', (r) => {
        callback(null, r);
      });

    return this;
  }

  upload(p, callback, stream) {
    const dirname = path.dirname(p);
    const basename = path.basename(p);
    const data = {
      file: {
        value: stream,
        options: {
          filename: basename,
        }
      },
    };
    const options = {
      method: 'POST',
      uri: `/api/2/path/data${dirname}`,
      formData: data,
    };

    this.requestJSON(options, callback);

    return this;
  }

  mkdir(p, callback) {
    const options = {
      method: 'PUT',
      uri: `/api/2/path/oper/mkdir${p}`,
    };

    this.requestJSON(options, callback);

    return this;
  }

  delete(p, callback) {
    const options = {
      method: 'POST',
      uri: `/api/2/path/oper/remove/`,
      form: {
        path: p
      },
    };

    this.requestOper(options, callback);

    return this;
  }

  copy(src, dst, callback) {
    const options = {
      method: 'POST',
      uri: '/api/2/path/oper/copy/',
      form: {
        src, dst
      }
    };

    this.requestOper(options, callback);

    return this;
  }

  move(src, dst, callback) {
    const options = {
      method: 'POST',
      uri: '/api/2/path/oper/move/',
      form: {
        src, dst
      }
    };

    this.requestOper(options, callback);

    return this;
  }

  rename(src, dst, callback) {
    const options = {
      method: 'POST',
      uri: '/api/2/path/oper/rename/',
      form: {
        src, dst
      }
    };

    this.requestJSON(options, callback);

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
};
