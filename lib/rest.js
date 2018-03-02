const request = require('request');


class Client {
  constructor(options) {
    this.request = request.defaults({
      baseUri: options.url || process.env.SMARTFILE_URL,
    });
  }

  requestJSON(options, callback) {
    return this.request(options, (e, r, body) => {
      if (e) {
        return callback(e);
      }

      const json = JSON.parse(body);
      return callback(null, json);
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
    super(options);

    this.request = this.request.defaults({
      auth: {
        user: options.username || process.env.SMARTFILE_USERNAME,
        pass: options.password || process.env.SMARTFILE_PASSWORD,
        sendImmediately: true,
      },
    });
  }
}

module.exports = {
  Client,
  BasicClient,
};
