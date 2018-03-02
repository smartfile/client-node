const rest = require('../lib/rest');
const nock = require('nock');
const assert = require('assert');
const morph = require('mock-env').morph;


API_URL = 'http://fakeapi.foo/'


function assertHttpOK(e) {
  if (e) {
    console.log(e);
  }
  assert(e === undefined);
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

  it('reads config from env', (done) => {
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
    server
      .get('/api/2/ping/')
      .reply(200, '{ "pong": "pong" }');

    client.ping((e, json) => {
      assertHttpOK(e);
      assert(json.pong === 'pong');

      done();
    });
  });

});
