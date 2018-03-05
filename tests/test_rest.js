const nock = require('nock');
const assert = require('assert');
const morph = require('mock-env').morph;
const streams = require('memory-streams');
const fs = require('fs');

const rest = require('../lib/rest');

const API_URL = 'http://fakeapi.foo/'


function assertHttpOK(e) {
  // Assertion to ensure that error is omitted inside a callback.
  if (e) {
    console.log(e);
  }
  assert(e === null);
}


describe('REST API client', () => {
  it('can read config from env', (done) => {
    /*
    This test instantiates a client without any options.

    It then ensures the client has picked up configuration options from the
    environment. However, we use mock-env.morph to only temporarily set
    "environment" variables for this test.
    */

    let client;

    morph(() => {
      client = new rest.BasicClient();
    }, {
      SMARTFILE_URL: API_URL,
      SMARTFILE_USER: 'foobar',
      SMARTFILE_PASS: 'baz',
    });

    assert(client.url === API_URL)
    assert(client.username === 'foobar')
    assert(client.password === 'baz')

    done();
  });
});

describe('REST API client', () => {
  let client, server;

  beforeEach('', function(done) {
    client = new rest.Client({ url: API_URL });
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
    server
      .get('/api/2/ping/')
      .reply(200, '{ "ping": "pong" }');

    client.ping((e, json) => {
      assertHttpOK(e);
      assert(json.ping === 'pong');

      done();
    });
  });

  it('can request information about current user', (done) => {
    /*
    This test calls the whoami API endpoint.

    The JSON returned by the API is parsed and returned to callback as the
    second parameter.
    */
    server
      .get(`/api/2/whoami/`)
      .reply(200, '{ "username": "user" }');
    
      client.whoami((e, json) => {
        assertHttpOK(e);
        assert(json.username === 'user');

        done();
      });
  });

  it('can pipe download to stream', (done) => {
    /*
    This test passes a stream to download().

    When download() receives a stream, it pipes the downloaded file to that
    stream. It calls callback when piping is complete, or if an error occurs.
    */
    let ws = new streams.WritableStream();

    server
      .get('/api/2/path/data/foobar')
      .reply(200, 'BODY');

    client.download('/foobar', (e) => {
      assertHttpOK(e);
      console.log(ws.toString());
      assert(ws.toString() === 'BODY');
      done();
    }, ws);
  });

  it('can pass download response to callback', (done) => {
    /*
    This test calls download with a callback only.

    Without a stream, download() will invoke the callback for an error, or will
    pass a second parameter (response). That response can be used to read the
    downloaded file data.
    */

    server
      .get('/api/2/path/data/foobar')
      .reply(200, 'BODY');

    client.download('/foobar', (e, r) => {
      assertHttpOK(e);

      r.on('data', (data) => {
        assert(data.toString() === 'BODY');
        done();
      });
    });
  });

  it('can upload a stream', (done) => {
    // TODO: figure out why this is busted, works with a file!
    //let rs = new streams.ReadableStream('BODY');
    let rs = fs.createReadStream('/tmp/foo.txt');

    server
      .post('/api/2/path/data/foobar')
      .reply(200, '{"size": 4, "name": "foobar", "path": "/foobar"}');

    client.upload('/foobar', (e, json) => {
      assertHttpOK(e);
      assert(json.name === 'foobar');
      done();
    }, rs);
  });

  it('can retrieve information about a path', (done) => {
    server
      .get('/api/2/path/info/foobar')
      .reply(200, '{ "name": "foo" }');

    client.info('/foobar', (e, json) => {
      assertHttpOK(e);
      assert(json.name === 'foo');
      done();
    });
  });

  it('can retrieve a directory listing', (done) => {
    server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true' })
      .reply(200, '{ "page": 1, "pages": 1, "results": [{ "name": "foo" }, { "name": "bar" }]}');

    let calls = 0;
    client.info('/foobar', (e, json) => {
      assertHttpOK(e);

      // Should receive 2 calls, a page of results plus null.
      switch (++calls) {
        case 1:
          assert(json[0].name === 'foo');
          assert(json[1].name === 'bar');
          break;

        case 2:
          assert(json === null);
          done();
          break;

        default:
          assert.fail('too many callback');
          break;
      }
    }, { children: true });
  });

  it('can retrieve a multi-page directory listing', (done) => {
    server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true' })
      .reply(200, '{ "page": 1, "pages": 2, "results": [{ "name": "foo" }, { "name": "bar" }]}');

    server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', 'page': 2 })
      .reply(200, '{ "page": 2, "pages": 2, "results": [{ "name": "baz" }, { "name": "quux" }]}');

    let calls = 0;
    client.info('/foobar', (e, json) => {
      assertHttpOK(e);

      // Should receive 3 calls, 2 pages plus null.
      switch (++calls) {
        case 1:
          assert(json[0].name === 'foo');
          assert(json[1].name === 'bar');
          break;

        case 2:
          assert(json[0].name === 'baz');
          assert(json[1].name === 'quux');
          break;

        case 3:
          assert(json === null);
          done();
          break;

        default:
          assert.fail('too many callbacks');
          break;
      }
    }, { children: true });
  });

  it('can create a directory', (done) => {
    server
      .put('/api/2/path/oper/mkdir/foobar')
      .reply(200, '{ "name": "foobar", "isdir": true, "isfile": false }');

    client.mkdir('/foobar', (e, json) => {
      assertHttpOK(e);
      assert(json.name === 'foobar');
      assert(json.isdir === true);

      done();
    });
  });

  it('can delete a file or directory', (done) => {
    server
      .post('/api/2/path/oper/remove/', 'path=%2Ffoobar')
      .reply(200, '{ "task_id": "12345" }');

    server
      .get('/api/2/task/12345/')
      .reply(200, ' { "result": { "status": "PENDING" }}');

    server
      .get('/api/2/task/12345/')
      .reply(200, ' { "result": { "status": "SUCCESS" }}');

    client.delete('/foobar', (e, json) => {
      assertHttpOK(e);
      assert(json.result.status == 'SUCCESS');

      done();
    });
  });

  it('can copy a file or directory', (done) => {
    server
      .post('/api/2/path/oper/copy/', 'src=%2Ffoobar&dst=%2Fbaz')
      .reply(200, '{ "task_id": "12345" }');

    server
      .get('/api/2/task/12345/')
      .reply(200, ' { "result": { "status": "SUCCESS" }}');

    client.copy('/foobar', '/baz', (e, json) => {
      assertHttpOK(e);

      done();
    })
  });

  it('can move a file or directory', (done) => {
    server
      .post('/api/2/path/oper/move/', 'src=%2Ffoobar&dst=%2Fbaz')
      .reply(200, '{ "task_id": "12345" }');

    server
      .get('/api/2/task/12345/')
      .reply(200, ' { "result": { "status": "SUCCESS" }}');

    client.move('/foobar', '/baz', (e, json) => {
      assertHttpOK(e);

      done();
    })
  });
});
