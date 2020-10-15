const nock = require('nock');
const assert = require('assert');
const { morph } = require('mock-env');
const { CookieAccessInfo } = require('cookiejar');
const { logger, BasicClient } = require('../lib');
const { assertNoError } = require('./utils');


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

    assert(client.baseUrl === API_URL);
    assert(client.options.auth === 'foobar:baz');
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
      assertNoError(e);
      assert(api.isDone());
      done();
    });
  });

  it('can start a session', (done) => {
    const api0 = nock(API_URL)
      .post('/api/2/session/')
      .basicAuth({
        user: 'username',
        pass: 'password',
      })
      .reply(200, '', { 'Set-Cookie': 'foo=bar' });

    const api1 = nock(API_URL, {
      reqheaders: {
        Cookie: 'foo=bar',
      },
    })
      .get('/api/2/path/info/foobar')
      .basicAuth({
        user: 'username',
        pass: 'password',
      })
      .reply(200);

    const client = new BasicClient({
      username: 'username',
      password: 'password',
      baseUrl: API_URL,
    });

    // Ensure we can handle Set-Cookie.
    client.login((loginError) => {
      assert(!!loginError);
      assert.strictEqual(1, client.cookies.getCookies(new CookieAccessInfo('fakeapi.foo', '/', false, false)).length);
      assert(api0.isDone());

      // Ensure we can handle Cookie.
      client.info('/foobar', (infoError) => {
        assert(!!infoError);
        assert(api1.isDone());
        done();
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
      assert(client.options.auth === 'username:password');
    });
  });
});
