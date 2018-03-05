const request = require('request');


class Client {
  constructor(options) {
    options = options || {};

    this.url = options.url || process.env.SMARTFILE_URL;

    this.request = request.defaults({
      baseUrl: this.url,
    });
  }

  requestJSON(options, callback) {
    return this.request(options, (e, r, body) => {
      if (e) {
        return callback(e);
      }

      if (199 > r.statusCode > 300) {
        let e = Error(`HTTP status non 2XX: ${r.statusCode}`);
        return callback(e);
      }

      let json = null;
      try {
        json = JSON.parse(body);
      } catch (e) {
        return callback(e);
      }

      callback(null, json);
    });
  }

  requestOper(options, callback) {
    this.requestJSON(options, (e, json) => {
      if (e) {
        return callback(e);
      }

      let pollInterval = 0;
      let pollOptions = {
        uri: `/api/2/task/${json.task_id}/`,
      };

      function poll() {
        this.requestJSON(pollOptions, (e, json) => {
          if (e) {
            return callback(e);
          }

          if (json.result.status == 'PENDING' || json.result.status == 'PROGRESS') {
            // Increment poll interval by one second for each check up to
            // thirty seconds.
            // TODO: the max interval could be an option.
            if ((pollInterval += 1000) > 30000) {
              pollInterval = 30000;
            } 
            setTimeout(poll.bind(this), pollInterval);
          } else if (json.result.status == 'FAILURE') {
            let e = new Error(`task failed: ${json.result.result.errors}`);
            return callback(e);
          } else if (json.result.status == 'SUCCESS') {
            return callback(null, json);
          }
        });
      }

      setTimeout(poll.bind(this), pollInterval);
    });
  }

  ping(callback) {
    let options = {
      method: 'GET',
      uri: '/api/2/ping/',
    };

    this.requestJSON(options, callback);

    return this;
  }

  whoami(callback) {
    let options = {
      method: 'GET',
      uri: '/api/2/whoami/',
    };

    this.requestJSON(options, callback);

    return this;
  }

  info(path, callback, args) {
    let options = {
      method: 'GET',
      uri: `/api/2/path/info${path}`,
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
        if (callback(e, json.results) === true) {
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
      options.qs = { children: 'true' }
      getInfoPage(this, options, callback);
    } else {
      // Handle single-item info as a simpler case.
      this.requestJSON(options, callback);
    }

    return this;
  }

  download(path, callback, stream) {
    let options = {
      method: 'GET',
      uri: `/api/2/path/data${path}`,
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

  upload(path, callback, stream) {
    let data = {
      file: stream,
    };

    let options = {
      method: 'POST',
      uri: `/api/2/path/data${path}`,
      formData: data,
    };

    this.requestJSON(options, callback);

    return this;
  }

  mkdir(path, callback) {
    let options = {
      method: 'PUT',
      uri: `/api/2/path/oper/mkdir${path}`,
    };

    this.requestJSON(options, callback);

    return this;
  }

  delete(path, callback) {
    let options = {
      method: 'POST',
      uri: `/api/2/path/oper/remove/`,
      form: {
        path
      },
    };

    this.requestOper(options, callback);

    return this;
  }

  copy(src, dst, callback) {
    let options = {
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
    let options = {
      method: 'POST',
      uri: '/api/2/path/oper/move/',
      form: {
        src, dst
      }
    };

    this.requestOper(options, callback);

    return this;
  }
}

class BasicClient extends Client {
  constructor(options) {
    options = options || {};

    super(options);

    this.username = options.username || process.env.SMARTFILE_USER;
    this.password = options.password || process.env.SMARTFILE_PASS;

    this.request = this.request.defaults({
      auth: {
        user: this.username,
        pass: this.password,
        sendImmediately: true,
      },
    });
  }
}

module.exports = {
  Client,
  BasicClient,
};
