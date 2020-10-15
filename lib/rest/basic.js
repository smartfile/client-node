const { Client } = require('./client');
const { CookieJar, CookieAccessInfo } = require('cookiejar');


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
    // We need URL details for handling cookies.
    const reqUrl = new URL(this.baseUrl);
    reqUrl.pathname = (options.path) ? pathlib.join(options.uri, options.path) : options.uri;

    // Any cookies for this request?
    const cookies = this.cookies.getCookies(
      new CookieAccessInfo(reqUrl.host, reqUrl.pathname, (reqUrl.protocol === 'https:'), false)
    );
    // Inject cookies from jar into request headers.
    if (cookies) {
      let cookieStrings = [];
      for (let i = 0; i < cookies.length; i++) {
        cookieStrings.push(cookies[i].toValueString());
      }
      options.headers['Cookie'] = cookieStrings.join('; ');
    }

    const req = super.request(options, callback);

    req.on('response', (res) => {
      // Store cookies from server into cookie jar.
      const cookies = res.headers['set-cookie'];
      if (cookies) {
        // Will update existing cookies.
        this.cookies.setCookies(cookies, reqUrl.host, reqUrl.pathname);
      }
    })
  }

  login(callback, _options) {
    let options = {
      method: 'POST',
      uri: '/api/2/session/',
      qs: {
        'session': 'true',
      },
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.requestJson(options, (e, r, json) => {
      this.cookies.add(r.headers['']);
      callback(e, json);
    });

    return this;
  }
}

module.exports = {
  BasicClient,
};
