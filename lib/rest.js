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

      const json = JSON.parse(body);
      return callback(undefined, json);
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
      uri: `/api/2/path/info/${path}`,
    }, callback);
  }

  download(path, callback, stream) {
    this.request({
      uri: `/api/2/path/data/${path}`,
    }).pipe(stream);
  }

  upload(path, callback, stream) {
    stream.pipe(
      this.requestJSON({
        method: 'POST',
        uri: `/api/2/path/data/${path}`,
      })
    );
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
