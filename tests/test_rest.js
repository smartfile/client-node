const nock = require('nock');
const assert = require('assert');
const streams = require('memory-streams');
const { logger, Client } = require('../lib');
const { normPath, encodePath } = require('../lib/rest/client');
const { assertNoError } = require('./utils');


const API_URL = 'http://fakeapi.foo/';

logger.silent = true;


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

  it('sends a custom header', (done) => {
    const client = new Client({
      baseUrl: API_URL,
      headers: {
        'X-Custom-Header': 'foobar',
      },
    });

    const api = nock(API_URL, {
      reqheaders: {
        'X-Custom-Header': 'foobar',
      },
    })
      .get('/api/2/path/info/foobar')
      .reply(200, '{ "name": "foobar", "isdir": true, "isfile": false }');

    client.info('/foobar', (e) => {
      assertNoError(e);
      assert(api.isDone());
      done();
    });
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

  afterEach('', (done) => {
    nock.cleanAll();
    done();
  });

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

    client.download('/foobar', (e, res) => {
      res
        .pipe(ws)
        .on('finish', () => {
          assert(ws.toString() === 'BODY');
          done();
        });
    });
  });

  it('can upload a stream as multipart/form', (done) => {
    /* This test passes a stream to upload()

    This results in a regular multi-part POST.
    */
    const rs = new streams.ReadableStream('BODY');
    rs.append(null);

    const api = server
      .post('/api/2/path/data/')
      .reply(200, '{"size": 4, "name": "foobar", "path": "/foobar"}');

    client.upload('/foobar', rs, (e, json) => {
      assertNoError(e);
      assert(json.name === 'foobar');
      assert(api.isDone());
      done();
    });
  });

  it('can upload a stream via pipe', (done) => {
    /* This test pipes a stream to upload().

    By omitting a readableStream parameter, a writableStream is returned.
    This results in a Transfer-Encoding: chunked streaming upload.
    */
    const rs = new streams.ReadableStream('BODY');
    rs.append(null);

    const api = server
      .put('/api/2/path/data/')
      .reply(200, '{"size": 4, "name": "foobar", "path": "/foobar"}');

    rs.pipe(client.upload('/foobar', (e, json) => {
      assertNoError(e);
      assert(json.name === 'foobar');
      assert(api.isDone());
      done();
    }));
  });

  it('can upload non-ascii filename via pipe', (done) => {
    /* This test pipes a stream to upload().

    Streaming uploads include a header: X-File-Name as a hint to
    the API for the file name. Because of implementation details of
    the API, we cannot simply put the file name into the URL. Another
    option would be to use the querystring. In any case, the filename
    header is invalid if it contains non-ascii chars, so we must
    encode it.
    */
    const rs = new streams.ReadableStream('BODY');
    rs.append(null);

    const api = server
      .put('/api/2/path/data/')
      .reply(200, '{"size": 4, "name": "f©®βàr¡", "path": "/foobar"}');

    rs.pipe(client.upload('/f©®βàr¡', (e, json) => {
      assertNoError(e);
      assert(json.name === 'f©®βàr¡');
      assert(api.isDone());
      done();
    }));
  });

  it('can retrieve information about a path', (done) => {
    const api = server
      .get('/api/2/path/info/foobar')
      .reply(200, '{ "name": "foobar" }');

    client.info('/foobar', (e, json) => {
      assertNoError(e);
      assert(json.name === 'foobar');
      assert(api.isDone());
      done();
    });
  });

  it('can retrieve information about a non-ascii path', (done) => {
    const api = server
      .get('/api/2/path/info/f%C2%A9%C2%AE%CE%B2%C3%A0r%C2%A1')
      .reply(200, '{ "name": "f©®βàr¡" }');

    client.info('/f©®βàr¡', (e, json) => {
      assertNoError(e);
      assert(json.name === 'f©®βàr¡');
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
      .reply(200, ' { "result": { "status": "PENDING", "result": {} }}');

    const api2 = server
      .get('/api/2/task/12345/')
      .reply(200, ' { "result": { "status": "SUCCESS", "result": {} }}');

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
      .reply(200, ' { "result": { "status": "SUCCESS", "result": {} }}');

    client.copy('/foobar', '/baz', (e) => {
      assertNoError(e);
      assert(api0.isDone());
      assert(api1.isDone());
      done();
    });
  });

  it('can detect a partial failure', (done) => {
    const api0 = server
      .post('/api/2/path/oper/copy/', { src: '/foobar', dst: '/baz' })
      .reply(200, '{ "uuid": "12345" }');

    const api1 = server
      .get('/api/2/task/12345/')
      .reply(200, ' { "result": { "status": "SUCCESS", "result": { "errors": { "/foobar": "failed" }}}}');

    client.copy('/foobar', '/baz', (e) => {
      assert(e);
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
      .reply(200, ' { "result": { "status": "SUCCESS", "result": {}}}');

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
