const nock = require('nock');
const assert = require('assert');
const morph = require('mock-env').morph;
const streams = require('memory-streams');

const smartfile = require('../lib/rest');
const smartfile_fs = require('../lib/fs');

const API_URL = 'http://fakeapi.foo/'


function assertNoError(e) {
  // Assertion to ensure that error is omitted inside a callback.
  if (e) {
    console.log(e);
  }
  assert(e === null);
}

// NOTE: We only test the open function as all the other actions are trivial
// wrappers around the rest client functions (which are already)

describe('File System Abstraction', () => {
  let server, sffs;

  beforeEach('', function(done) {
    const rest = new smartfile.Client({ baseUrl: API_URL });
    sffs = new smartfile_fs.FileSystem(rest);
    server = nock(API_URL);

    done();
  });

  it('can open a file for reading', (done) => {
    server
      .get('/api/2/path/data/foobar')
      .reply(200, 'BODY');

    sffs.open('/foobar', 'r', (e, f) => {
      if (e) {
        return console.log(e);
      }

      f.read(4, (e, data) => {
        assertNoError(e);
        assert(data.toString() === 'BODY');
        done();
      });
    });
  });

  it('can open a file for writing', (done) => {
    uploader = server
      .post('/api/2/path/data/')
      .reply(200, '{ "name": "foobar" }');

    sffs.open('/foobar', 'w', (e, f) => {
      if (e) {
        return console.log(e);
      }

      const buffer = new Buffer('BODY');
      f.write(buffer, (e, r) => {
        if (e) {
          return console.log(e);
        }

        f.close((e) => {
          assertNoError(e);
          assert(uploader.isDone());

          done();
        });
      });
    });
  });
});
