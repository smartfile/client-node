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

      try {
        if (199 > r.statusCode > 300) {
          throw new Error(`HTTP status non 2XX: ${r.statusCode}`);
        }

        return callback(null, JSON.parse(body));
      } catch (e) {
        return callback(e);
      }
    });
  }

  ping(callback) {
    let options = {
      uri: '/api/2/ping/',
    };

    this.requestJSON(options, callback);

    return this;
  }

  whoami(callback) {
    let options = {
      uri: '/api/2/whoami/',
    };

    this.requestJSON(options, callback);

    return this;
  }

  info(path, callback, args) {
    let options = {
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

        // If more pages are available, Call the function recursively to fetch
        // them.
        if (json.page < json.pages) {
          getInfoPage(client, options, callback, json.page + 1);
        }

        // Call callback with a single page of data.
        callback(e, json.results);

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

      return;
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
