const nock = require('nock');
const assert = require('assert');
const { morph } = require('mock-env');
const { CookieAccessInfo } = require('cookiejar');
const { logger, BasicClient } = require('../lib');


const API_URL = 'http://fakeapi.foo/';

logger.silent = true;


describe('SmartFile Basic API client', () => {
  it('can read config from env', () => {
    /*
    This test instantiates a client without any options.

    It then ensures the client has picked up configuration options from the
    environment. However, we use mock-env.morph to only temporarily set
    "environment" variables for this test.
    */

    let client;

    morph(() => {
      client = new BasicClient();
    }, {
      SMARTFILE_API_URL: API_URL,
      SMARTFILE_USER: 'foobar',
      SMARTFILE_PASS: 'baz',
    });

    assert.strictEqual(client.baseUrl, API_URL);
    assert.strictEqual(client.username, 'foobar');
    assert.strictEqual(client.password, 'baz');
  });

  it('can authenticate', (done) => {
    const api = nock(API_URL)
      .get('/api/2/path/info/foobar')
      .basicAuth({
        user: 'username',
        pass: 'password',
      })
      .reply(200, '{ "name": "foobar", "isdir": true, "isfile": false }');

    const client = new BasicClient({
      username: 'username',
      password: 'password',
      baseUrl: API_URL,
    });

    client.info('/foobar', (e) => {
      assert.ifError(e);
      assert(api.isDone());
      done();
    });
  });

  it('can start a session and handle csrftoken', (done) => {
    const api0 = nock(API_URL)
      .post('/api/2/session/')
      .basicAuth({
        user: 'username',
        pass: 'password',
      })
      .reply(201, '{}', { 'Set-Cookie': ['sessionid=bar', 'csrftoken=ABCD'] });

    const api1 = nock(API_URL, {
      reqheaders: {
        cookie: 'sessionid=bar; csrftoken=ABCD',
        'x-csrftoken': 'ABCD',
        'Referer': 'http://fakeapi.foo/api/2/session/',
      },
    })
      .post('/api/2/session/')
      .reply(201, '{}');

    const api2 = nock(API_URL, {
      reqheaders: {
        cookie: 'sessionid=bar; csrftoken=ABCD',
      },
    })
      .get('/api/2/whoami/')
      .twice()
      .reply(200, '{ "username": "user" }');

    const api3 = nock(API_URL, {
      reqheaders: {
        cookie: 'sessionid=bar; csrftoken=ABCD',
        'x-csrftoken': 'ABCD',
        'Referer': 'http://fakeapi.foo/api/2/session/',
      },
    })
      .delete('/api/2/session/')
      .reply(204, '');

    const client = new BasicClient({
      username: 'username',
      password: 'password',
      baseUrl: API_URL,
    });

    // Ensure we can handle Set-Cookie.
    client.startSession((start0Error) => {
      assert(!start0Error);
      assert.strictEqual(2, client.cookies.getCookies(new CookieAccessInfo('fakeapi.foo', '/', false, false)).length);
      // Credentials removed (using session key (JWT) now)
      assert(api0.isDone());

      // Ensure we can handle Cookie and CSRF Token.
      client.startSession((start1Error) => {
        assert(!start1Error);
        assert(api1.isDone());
        assert(api2.isDone());

        // Ensure we can handle logout().
        client.endSession((endError) => {
          // Credentials restored.
          assert(!endError);
          assert(api3.isDone());
          assert.strictEqual(0, client.cookies.getCookies(new CookieAccessInfo('fakeapi.foo', '/', false, false)).length);
          done();
        });
      });
    });
  });

  it('can handle authentication failure', (done) => {
    const api = nock(API_URL)
      .get('/api/2/path/info/foobar')
      .basicAuth({
        user: 'username',
        pass: 'password',
      })
      .reply(401);

    const client = new BasicClient({
      username: 'username',
      password: 'password',
      baseUrl: API_URL,
    });

    client.info('/foobar', (e) => {
      assert(e);
      assert(api.isDone());
      done();
    });
  });

  it('accepts credentials in multiple forms', () => {
    const credentials = [
      {
        username: 'username',
        password: 'password',
        baseUrl: API_URL,
      },
      {
        user: 'username',
        pass: 'password',
        baseUrl: API_URL,
      },
      {
        auth: {
          username: 'username',
          password: 'password',
        },
        baseUrl: API_URL,
      },
      {
        auth: {
          user: 'username',
          pass: 'password',
        },
        baseUrl: API_URL,
      },
    ];

    let client;
    credentials.forEach((opts) => {
      client = new BasicClient(opts);
      assert.strictEqual(client.username, 'username');
      assert.strictEqual(client.password, 'password');
    });
  });
});
