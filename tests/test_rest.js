const rest = require('../lib/rest');
const nock = require('nock');
const assert = require('assert');


function assertHttpOK(e) {
  if (e) {
    console.log(e);
  }
  assert(e === undefined);
}

describe('REST API client', () => {
  /*
  beforeEach('', function(done) {
    done();
  });
  */

  /*
  afterEach('', function(done) {
    done();
  });
  */

  it('can ping api', (done) => {
    nock('http://fakeapi.foo')
      .get('/api/2/ping/')
      .reply(200, '{ pong: "pong" }');

    const client = new rest.Client({ url: 'http://fakeapi.foo/' });

    client.ping((e, json) => {
      assertHttpOK(e);
      assert(json.pong === 'pong');

      done();
    });
  });
});
