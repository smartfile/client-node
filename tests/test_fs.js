const nock = require('nock');
const assert = require('assert');
const morph = require('mock-env').morph;
const streams = require('memory-streams');

const smartfile = require('../lib/rest');
const smartfile_fs = require('../lib/fs');

const API_URL = 'http://fakeapi.foo/'


describe('File System Abstraction', () => {
  let server, sffs;

  beforeEach('', function(done) {
    const rest = new smartfile.Client({ url: API_URL });
    sffs = new smartfile_fs.FileSystem(rest);
    server = nock(API_URL);

    done();
  });

  it('can open a file for reading', (done) => {
    server
      .get('/api/2/path/data/foobar')
      .reply(200, 'This is the file\'s contents');

    sffs.open('/foobar', 'r', (e, f) => {
      if (e) {
        console.log(e);
        return;
      }
      done();
    });
  });
});
