const nock = require('nock');
const assert = require('assert');
const morph = require('mock-env').morph;
const streams = require('memory-streams');
const logger = require('winston');

const smartfile = require('../lib/rest');
const smartfile_fs = require('../lib/fs');

const API_URL = 'http://fakeapi.foo/'


logger.level = 'error';


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
    const api = server
      .get('/api/2/path/data/foobar')
      .reply(200, 'BODY');

    sffs.open('/foobar', null, 'r', (e, fd) => {
      if (e) {
        return console.log(e);
      }

      const buffer = new Buffer(4);
      sffs.read(fd, buffer, 0, 4, 0, (e, bytesRead, data) => {
        assertNoError(e);
        assert(bytesRead == 4);
        assert(data.toString() === 'BODY');
        assert(api.isDone());
        done();
      });
    });
  });

  it('can open a file for writing', (done) => {
    const api = server
      .post('/api/2/path/data/')
      .reply(200, '{ "name": "foobar" }');

    sffs.open('/foobar', 'w', null, (e, fd) => {
      if (e) {
        return console.log(e);
      }

      const buffer = new Buffer('BODY');

      sffs.write(fd, buffer, 0, 4, 0, (e, r) => {
        if (e) {
          return console.log(e);
        }

        sffs.close(fd, (e) => {
          assertNoError(e);
          assert(api.isDone());
          done();
        });
      });
    });
  });

  it('can delete a missing directory', (done) => {
    const api = server
      .post('/api/2/path/oper/remove/', 'path=%2Ffoobar')
      .reply(404, 'NOT FOUND');

    sffs.rmdir('/foobar', (e, json) => {
      assertNoError(e);
      assert(json.result.status == 'SUCCESS');
      assert(api.isDone());
      done();
    });
  });

  it('can delete a missing file', (done) => {
    const api = server
      .post('/api/2/path/oper/remove/', 'path=%2Ffoobar')
      .reply(404, 'NOT FOUND');

    sffs.unlink('/foobar', (e, json) => {
      assertNoError(e);
      assert(json.result.status == 'SUCCESS');
      assert(api.isDone());
      done();
    });
  });
});
