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
    throw e;
  }
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

      const buffer = Buffer.alloc(4);
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

      const buffer = Buffer.from('BODY');

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
      .post('/api/2/path/oper/remove/', { path: '/foobar' })
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
      .post('/api/2/path/oper/remove/', { path: '/foobar' })
      .reply(404, 'NOT FOUND');

    sffs.unlink('/foobar', (e, json) => {
      assertNoError(e);
      assert(json.result.status == 'SUCCESS');
      assert(api.isDone());
      done();
    });
  });

  it('can readdir()', (done) => {
    const api = server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', limit: 1024 })
      .reply(200, '{ "children": [{"name": "foo", "size": 10 }, {"name": "bar", "size": 10}]}');

    sffs.readdir('/foobar', (e, json) => {
      assertNoError(e);
      assert(json.sort().toString() === ['bar', 'foo'].sort().toString());
      assert(api.isDone());
      done();
    });
  });

  it('can readdirstats() -- incrementally', (done) => {
    const api0 = server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', limit: 1024 })
      .reply(200, '{ "page": 1, "pages": 2, "children": [{"name": "foo", "size": 10 }, {"name": "bar", "size": 10}]}');

    const api1 = server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', limit: 1024, page: 2 })
      .reply(200, '{ "page": 2, "pages": 2, "children": [{"name": "baz", "size": 10 }, {"name": "quux", "size": 10}]}');

    let calls = 0;
    sffs.readdirstats('/foobar', (e, json) => {
      switch (++calls) {
        case 1:
          assertNoError(e);
          assert(json[0].name == 'foo');
          assert(json[1].name == 'bar');
          break;

        case 2:
          assertNoError(e);
          assert(json[0].name == 'baz');
          assert(json[1].name == 'quux');
          assert(api0.isDone());
          break;

        case 3:
          assertNoError(e);
          assert(json === null);
          assert(api1.isDone());
          done();
          break;

        default:
          assert.fail('too many callbacks');
          break;
      }
    }, { incremental: true });
  });
});
