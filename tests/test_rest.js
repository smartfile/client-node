const rest = require('../lib/rest');
const nock = require('nock');
const assert = require('assert');
const morph = require('mock-env').morph;
const streams = require('memory-streams');
const fs = require('fs');


API_URL = 'http://fakeapi.foo/'


function assertHttpOK(e) {
  // Assertion to ensure that error is omitted inside a callback.
  if (e) {
    console.log(e);
  }
  assert(e === null);
}


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

  it('can read config from env', (done) => {
    /*
    This test instantiates a client without any options.

    It then ensures the client has picked up configuration options from the
    environment. However, we use mock-env.morph to only temporarily set
    "environment" variables for this test.
    */

    let alternate;

    morph(() => {
      alternate = new rest.BasicClient();
    }, {
      SMARTFILE_URL: API_URL,
      SMARTFILE_USER: 'foobar',
      SMARTFILE_PASS: 'baz',
    });

    assert(alternate.url === API_URL)
    assert(alternate.username === 'foobar')
    assert(alternate.password === 'baz')

    done();
  });

  it('can ping api', (done) => {
    /*
    This test calls the ping API endpoint.

    The JSON returned by the API is parsed and returned to callback as the
    second parameter.
    */

    server
      .get('/api/2/ping/')
      .reply(200, '{ "pong": "pong" }');

    client.ping((e, json) => {
      assertHttpOK(e);
      assert(json.pong === 'pong');

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
      .get('/api/2/data/foobar')
      .reply(200, 'BODY');

    client.download('/foobar', (e) => {
      assertHttpOK(e);
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
      .get('/api/2/data/foobar')
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
      .post('/api/2/data/foobar')
      .reply(200, '{"size": 4, "name": "foobar", "path": "/foobar"}');

    client.upload('/foobar', (e, json) => {
      assertHttpOK(e);
      assert(json.name === 'foobar');
      done();
    }, rs);

  });
});
