const nock = require('nock');
const assert = require('assert');
const { logger, Client, Keys } = require('../lib');


const API_URL = 'http://fakeapi.foo/';
const KEY0 = {
  name: 'foo',
  key: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDEr+alRxi2a88M15P07UFt9qdAqo4SA1gtKpego6rtStemdK1bkM'
       + 'FVQOF8o/HI3xU2WRjsHkp+7I8eGspDiTMbfWhGJWRCjODz7if1jw2EC9S871FAmZGTMncyK2qXLCmQj+wv9gRP7k'
       + 'RM6YCKM4DAOPQuZnc6j/0hMCeXo/rBJ9lM2m3FA8dYE79folvzPP9n5Z9dsD96iOtB2s1K+40zX9Wy5oHZKjgAK6'
       + '/1X+4qpGQwUiLxHQmnsVxHGvm/ixiaEfwouQ6lYAOVIZiOYtx6qvqYbNcEnDlykwWe1VnGIq15nHkTgKpvw4EQt0'
       + 'zLe9D8Sc6io7H5sAAdM6aUAhqf foobar@localhost',
};
const KEY1 = {
  name: 'bar',
  key: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDC/lMNFkQ+2E37blqq/QetgSEtEA090YGPJ62f6vTjKmmV0ApB+z'
       + 'LCwLHMCxvG65rQeW0z30fhOyF1noBtiXgPSRwj7SkUV8vqYkyGAJA4pXv+BxF2XkSj3wevEbrqmcG6pVemGXMsZ1'
       + 'D4jXria+XcEAdUT1w6ldNmKehBap66enk/VE3v2JpS/e5RYeyeEYs0Dw9UN0x5RjRbEJNU/jUC4f+rRdRJvD1iUR'
       + 'T1UnBDpqRCKwpvO4V8q3NCoe/Dl9W2h03pYfSiGFHpUt8qdlUTH4+2/bTLqbC0qB+1F/VRib37IV8K331GNpKI3K'
       + 'se6N2qVUAEOXRmYgtZ2oaQ2zxz foobar@localhost',
};
const KEYS = [KEY0, KEY1];


logger.silent = true;


describe('SSH Key Management', () => {
  let server;
  let keys;

  beforeEach('', (done) => {
    nock.cleanAll();
    const rest = new Client({ baseUrl: API_URL });
    keys = new Keys(rest, 'foobar');
    server = nock(API_URL);
    done();
  });

  it('can fetch list of keys', (done) => {
    const api0 = server
      .get('/api/3/sshkeys/foobar/')
      .reply(200, JSON.stringify(KEYS));

    keys.list((e, json) => {
      assert.ifError(e);
      assert(api0.isDone());
      assert(json.length === 2);
      done();
    });
  });

  it('can get a key', (done) => {
    const api0 = server
      .get('/api/3/sshkeys/foobar/foo')
      .reply(200, JSON.stringify(KEY0));

    keys.get(KEY0.name, (e, json) => {
      assert.ifError(e);
      assert(api0.isDone());
      assert(json.name === KEY0.name);
      done();
    });
  });

  it('can save a key', (done) => {
    const api0 = server
      .put('/api/3/sshkeys/foobar/foo', KEY0)
      .reply(200, JSON.stringify(KEY0));

    keys.save(KEY0, (e, json) => {
      assert.ifError(e);
      assert(api0.isDone());
      assert(json.name === KEY0.name);
      done();
    });
  });

  it('can update a key', (done) => {
    const api0 = server
      .patch('/api/3/sshkeys/foobar/foo', KEY1)
      .reply(200, JSON.stringify(KEY1));

    keys.update('foo', KEY1, (e, json) => {
      assert.ifError(e);
      assert(api0.isDone());
      assert(json.name === KEY1.name);
      done();
    });
  });

  it('can delete a key', (done) => {
    const api0 = server
      .delete('/api/3/sshkeys/foobar/foo')
      .reply(204);

    keys.delete('foo', (e) => {
      assert.ifError(e);
      assert(api0.isDone());
      done();
    });
  });
});
