const pathlib = require('path');
const { CookieJar, CookieAccessInfo } = require('cookiejar');
const { Client } = require('./client');


class BasicClient extends Client {
  constructor(opts) {
    const options = { ...opts };
    let username;
    let password;

    if (!options.auth) {
      username = options.username || options.user || process.env.SMARTFILE_USER;
      password = options.password || options.pass || process.env.SMARTFILE_PASS;

      delete options.username;
      delete options.password;

      if (!username || !password) {
        throw new Error('username and password required for basic auth');
      }
    } else {
      username = options.auth.user || options.auth.username;
      password = options.auth.pass || options.auth.password;
    }

    options.auth = `${username}:${password}`;
    super(options);

    this.cookies = new CookieJar();
  }

  request(options, callback) {
    const reqOptions = {
      ...options,
    };

    // We need URL details for handling cookies.
    const reqUrl = new URL(this.baseUrl);
    reqUrl.pathname = (options.path) ? pathlib.join(options.uri, options.path) : options.uri;

    // Any cookies for this request?
    const reqCookies = this.cookies.getCookies(
      new CookieAccessInfo(reqUrl.host, reqUrl.pathname, (reqUrl.protocol === 'https:'), false)
    );
    // Inject cookies from jar into request headers.
    if (reqCookies) {
      const cookieStrings = [];
      for (let i = 0; i < reqCookies.length; i++) {
        cookieStrings.push(reqCookies[i].toValueString());
      }
      reqOptions.headers.Cookie = cookieStrings.join('; ');
    }

    const req = super.request(reqOptions, callback);

    req.on('response', (res) => {
      // Store cookies from server into cookie jar.
      const resCookies = res.headers['set-cookie'];
      if (resCookies) {
        // Will update existing cookies.
        this.cookies.setCookies(resCookies, reqUrl.host, reqUrl.pathname);
      }
    });

    return req;
  }

  login(callback, _options) {
    let options = {
      method: 'POST',
      uri: '/api/2/session/',
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.requestJson(options, (e, r, json) => {
      callback(e, json);
    });

    return this;
  }
}

module.exports = {
  BasicClient,
};
