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

    this.username = username;
    this.password = password;
    this.cookies = new CookieJar();
  }

  request(options, callback) {
    const reqOptions = {
      ...options,
    };

    // We need URL details for handling cookies.
    const reqUrl = new URL(this.baseUrl);
    reqUrl.pathname = (options.path) ? pathlib.join(options.uri, options.path) : options.uri;
    const cai = new CookieAccessInfo(reqUrl.host, reqUrl.pathname, (reqUrl.protocol === 'https:'), false);

    // Any cookies for this request?
    const reqCookies = this.cookies.getCookies(cai);
    // Inject cookies from jar into request headers.
    if (reqCookies) {
      const cookieStrings = [];
      for (let i = 0; i < reqCookies.length; i++) {
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

    const req = super.request(reqOptions, callback);

    req.on('response', (res) => {
      // Store cookies from server into cookie jar.
      const resCookies = res.headers['set-cookie'];
      if (resCookies) {
        // Will update existing cookies.
        this.cookies.setCookies(resCookies, reqUrl.host);
        delete this.options.auth;
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

  logout(callback) {
    const options = {
      method: 'DELETE',
      uri: '/api/2/session/',
    };

    this.requestJson(options, (e, r, json) => {
      this.cookies = new CookieJar();
      this.options.auth = `${this.username}:${this.password}`;
      callback(e);
    });
  }
}

module.exports = {
  BasicClient,
};
