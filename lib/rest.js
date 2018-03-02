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
    this.requestJSON({
      uri: '/api/2/ping/',
    }, callback);
  }

  whoami(callback) {
    this.requestJSON({
      uri: '/api/2/whoami/',
    }, callback);
  }

  info(path, callback) {
    this.requestJSON({
      uri: `/api/2/info${path}`,
    }, callback);
  }

  download(path, callback, stream) {
    // If caller passed a stream, just pipe the file.
    if (stream !== undefined) {
      this.request({
        uri: `/api/2/data${path}`,
      })
        .pipe(stream)
        .on('error', callback)
        .on('finish', () => {
          callback(null, null)
        });

      return;
    }

    // otherwise, pass the response to the callback.
    this.request({
      uri: `/api/2/data${path}`,
    })
      .on('response', (r) => {
        callback(null, r);
      });
  }

  upload(path, callback, stream) {
    let data = {
      file: stream,
    };

    this.requestJSON({
      method: 'POST',
      uri: `/api/2/data${path}`,
      formData: data,
    }, callback);
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
