const nock = require('nock');
const assert = require('assert');
const { morph } = require('mock-env');
const streams = require('memory-streams');

const {
  logger, Client, BasicClient,
} = require('../lib');
const {
  normPath, encodePath,
} = require('../lib/rest/client');

const API_URL = 'http://fakeapi.foo/';

logger.silent = true;


function assertNoError(e) {
  // Assertion to ensure that error is omitted inside a callback.
  if (e) {
    throw e;
  }
}


describe('REST API client', () => {
  it('can properly normalize / encode paths', (done) => {
    assert(normPath('foobar') === '/foobar');
    assert(encodePath('/foo%bar') === '/foo%25bar');
    assert(encodePath('/foo?bar') === '/foo%3Fbar');
    assert(encodePath('/foo&bar') === '/foo%26bar');
    assert(encodePath('/foo#bar') === '/foo%23bar');
    assert(encodePath('/foo%23bar') === '/foo%2523bar');
    done();
  });

  it('can read config from env', (done) => {
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
      SMARTFILE_URL: API_URL,
      SMARTFILE_USER: 'foobar',
      SMARTFILE_PASS: 'baz',
    });

    assert(client.options.baseUrl === API_URL);
    assert(client.options.auth.user === 'foobar');
    assert(client.options.auth.pass === 'baz');

    done();
  });
});

describe('REST API client', () => {
  let client;
  let server;

  beforeEach('', (done) => {
    client = new Client({ baseUrl: API_URL });
    server = nock(API_URL);

    done();
  });

  /*
  afterEach('', function(done) {
    done();
  });
  */

  it('can ping api', (done) => {
    /*
    This test calls the ping API endpoint.

    The JSON returned by the API is parsed and returned to callback as the
    second parameter.
    */
    const api = server
      .get('/api/2/ping/')
      .reply(200, '{ "ping": "pong" }');

    client.ping((e, json) => {
      assertNoError(e);
      assert(json.ping === 'pong');
      assert(api.isDone());
      done();
    });
  });

  it('can request information about current user', (done) => {
    /*
    This test calls the whoami API endpoint.

    The JSON returned by the API is parsed and returned to callback as the
    second parameter.
    */
    const api = server
      .get('/api/2/whoami/')
      .reply(200, '{ "username": "user" }');

    client.whoami((e, json) => {
      assertNoError(e);
      assert(json.username === 'user');
      assert(api.isDone());
      done();
    });
  });

  it('can pipe download to stream', (done) => {
    /*
    This test passes a stream to download().

    When download() receives a stream, it pipes the downloaded file to that
    stream. It calls callback when piping is complete, or if an error occurs.
    */
    const ws = new streams.WritableStream();

    server
      .get('/api/2/path/data/foobar')
      .reply(200, 'BODY');

    client.download('/foobar', () => {
      assert(ws.toString() === 'BODY');
      done();
    })
      .pipe(ws);
  });

  it('can upload a stream', (done) => {
    // TODO: figure out why this is busted, works with a file!
    const rs = new streams.ReadableStream('BODY');
    rs.append(null);
    // const rs = new fs.createReadStream('/tmp/foo.txt');

    const api = server
      .post('/api/2/path/data/')
      .reply(200, '{"size": 4, "name": "foobar", "path": "/foobar"}');

    client.upload('/foobar', rs, (e, json) => {
      assert(json.name === 'foobar');
      assert(api.isDone());
      done();
    });
  });

  it('can retrieve information about a path', (done) => {
    const api = server
      .get('/api/2/path/info/foobar')
      .reply(200, '{ "name": "foo" }');

    client.info('/foobar', (e, json) => {
      assertNoError(e);
      assert(json.name === 'foo');
      assert(api.isDone());
      done();
    });
  });

  it('can retrieve a directory listing', (done) => {
    const api = server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', limit: 1024 })
      .reply(200, '{ "page": 1, "pages": 1, "children": [{ "name": "foo" }, { "name": "bar" }]}');

    let calls = 0;
    client.info('/foobar', (e, json) => {
      assertNoError(e);

      // Should receive 2 calls, a page of results plus null.
      switch (calls += 1) {
        case 1:
          assert(json[0].name === 'foo');
          assert(json[1].name === 'bar');
          break;

        case 2:
          assert(json === null);
          assert(api.isDone());
          done();
          break;

        default:
          assert.fail('too many callbacks');
          break;
      }
    }, { children: true });
  });

  it('can retrieve a multi-page directory listing', (done) => {
    const api0 = server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', limit: 1024 })
      .reply(200, '{ "page": 1, "pages": 2, "children": [{ "name": "foo" }, { "name": "bar" }]}');

    const api1 = server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', limit: 1024, page: 2 })
      .reply(200, '{ "page": 2, "pages": 2, "children": [{ "name": "baz" }, { "name": "quux" }]}');

    let calls = 0;
    client.info('/foobar', (e, json) => {
      assertNoError(e);

      // Should receive 3 calls, 2 pages plus null.
      switch (calls += 1) {
        case 1:
          assert(json[0].name === 'foo');
          assert(json[1].name === 'bar');
          break;

        case 2:
          assert(json[0].name === 'baz');
          assert(json[1].name === 'quux');
          assert(api0.isDone());
          break;

        case 3:
          assert(json === null);
          assert(api1.isDone());
          done();
          break;

        default:
          assert.fail('too many callbacks');
          break;
      }
    }, { children: true });
  });

  it('can create a directory', (done) => {
    const api = server
      .post('/api/2/path/oper/mkdir/', { path: '/foobar' })
      .reply(200, '{ "name": "foobar", "isdir": true, "isfile": false }');

    client.mkdir('/foobar', (e, json) => {
      assertNoError(e);
      assert(json.name === 'foobar');
      assert(json.isdir === true);
      assert(api.isDone());
      done();
    });
  });

  it('can delete a file or directory', (done) => {
    const api0 = server
      .post('/api/2/path/oper/remove/', { path: '/foobar' })
      .reply(200, '{ "uuid": "12345" }');

    const api1 = server
      .get('/api/2/task/12345/')
      .reply(200, ' { "result": { "status": "PENDING" }}');

    const api2 = server
      .get('/api/2/task/12345/')
      .reply(200, ' { "result": { "status": "SUCCESS" }}');

    client.delete('/foobar', (e, json) => {
      assertNoError(e);
      assert(json.result.status === 'SUCCESS');
      assert(api0.isDone());
      assert(api1.isDone());
      assert(api2.isDone());
      done();
    });
  });

  it('can copy a file or directory', (done) => {
    const api0 = server
      .post('/api/2/path/oper/copy/', { src: '/foobar', dst: '/baz' })
      .reply(200, '{ "uuid": "12345" }');

    const api1 = server
      .get('/api/2/task/12345/')
      .reply(200, ' { "result": { "status": "SUCCESS" }}');

    client.copy('/foobar', '/baz', (e) => {
      assertNoError(e);
      assert(api0.isDone());
      assert(api1.isDone());
      done();
    });
  });

  it('can move a file or directory', (done) => {
    const api0 = server
      .post('/api/2/path/oper/move/', { src: '/foobar', dst: '/baz' })
      .reply(200, '{ "uuid": "12345" }');

    const api1 = server
      .get('/api/2/task/12345/')
      .reply(200, ' { "result": { "status": "SUCCESS" }}');

    client.move('/foobar', '/baz', (e) => {
      assertNoError(e);
      assert(api0.isDone());
      assert(api1.isDone());
      done();
    });
  });

  it('can rename a file or directory', (done) => {
    const api = server
      .post('/api/2/path/oper/rename/', { src: '/foobar', dst: '/baz' })
      .reply(200, '{ }');

    client.rename('/foobar', '/baz', (e) => {
      assertNoError(e);
      assert(api.isDone());
      done();
    });
  });

  it('can handle API throttling', (done) => {
    const api0 = server
      .get('/api/2/path/info/foobar')
      .reply(429, 'THROTTLED', { 'X-Throttle': '400; next=0.1 sec' });

    const api1 = server
      .get('/api/2/path/info/foobar')
      .reply(200, '{ "name": "foobar", "isdir": true, "isfile": false }');

    client.info('/foobar', (e) => {
      assertNoError(e);
      assert(api0.isDone());
      assert(api1.isDone());
      done();
    });
  });

  it('properly encodes special chars', (done) => {
    const api = server
      .get('/api/2/path/info/foo%26bar')
      .reply(200, '{ "name": "foobar", "isdir": true, "isfile": false }');

    client.info('foo&bar', (e) => {
      assertNoError(e);
      assert(api.isDone());
      done();
    });
  });
});
