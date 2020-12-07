const moment = require('moment');
const nock = require('nock');
const assert = require('assert');
const smartfile = require('../lib');
const { CACHE_HIT } = require('../lib/fs/filesystem');
const { assertNoError, assertError } = require('./utils');


const API_URL = 'http://fakeapi.foo/';


function assertMetric(metric, value) {
  // Asserts that a paritcular metric has the desired value.
  // This function assumes only one instance of the metrics (unique label set).
  // Also, value === 0 is a special case, it allows the metric to be missing.
  const { values } = metric.get();

  if (values.length === 0 && value === 0) {
    return;
  }
  assert(values.length);
  assert(values[0].value === value);
}

// NOTE: We only test the open function as all the other actions are trivial
// wrappers around the rest client functions (which are already)

describe('File System Abstraction', () => {
  let server;
  let sffs;

  beforeEach('', (done) => {
    const rest = new smartfile.Client({ baseUrl: API_URL });
    sffs = new smartfile.FileSystem(rest);
    server = nock(API_URL);

    done();
  });

  afterEach('', (done) => {
    nock.cleanAll();
    // eslint-disable-next-line no-underscore-dangle
    sffs._clearCache(0, 1, 2);
    done();
  });

  it('can open a file for reading', (done) => {
    const api = server
      .get('/api/2/path/data/foobar')
      .reply(200, 'BODY');

    sffs.open('/foobar', null, 'r', (openError, fd) => {
      if (openError) {
        console.log(openError);
        return;
      }

      const buffer = Buffer.alloc(4);
      sffs.read(fd, buffer, 0, 4, 0, (readError, bytesRead, data) => {
        assertNoError(readError);
        assert(bytesRead === 4);
        assert(data.toString() === 'BODY');
        assert(api.isDone());
        done();
      });
    });
  });

  it('can readFile', (done) => {
    const api = server
      .get('/api/2/path/data/foobar')
      .reply(200, 'BODY');

    sffs.readFile('/foobar', (e, buffer) => {
      assert(api.isDone());
      assertNoError(e);
      assert(buffer.toString() === 'BODY');
      done();
    });
  });

  it('can open a file for writing', (done) => {
    const api = server
      .post('/api/2/path/data/')
      .reply(200, '{ "name": "foobar", "path": "/foobar" }');

    sffs.open('/foobar', 'w', null, (openError, fd) => {
      if (openError) {
        console.log(openError);
        return;
      }

      const buffer = Buffer.from('BODY');

      sffs.write(fd, buffer, 0, 4, 0, (writeError) => {
        if (writeError) {
          console.log(writeError);
          return;
        }

        sffs.close(fd, (closeError) => {
          assert(!sffs.statCache['/foobar']);
          assertNoError(closeError);
          assert(api.isDone());
          done();
        });
      });
    });
  });

  it('can writeFile', (done) => {
    const api = server
      .post('/api/2/path/data/')
      .reply(200, '{ "name": "foobar", "path": "/foobar" }');

    const buff = Buffer.from('BODY');

    sffs.writeFile('/foobar', buff, (e) => {
      assert(!sffs.statCache['/foobar']);
      assert(api.isDone());
      assertNoError(e);
      done();
    });
  });

  it('can delete a missing directory', (done) => {
    const api = server
      .post('/api/2/path/oper/remove/', { path: '/foobar' })
      .reply(404, 'NOT FOUND');

    sffs.rmdir('/foobar', (e, json) => {
      assert(!sffs.statCache['/foobar']);
      assertNoError(e);
      assert(json.result.status === 'SUCCESS');
      assert(api.isDone());
      done();
    });
  });

  it('can delete a missing file', (done) => {
    const api = server
      .delete('/api/3/path/data/foobar')
      .reply(404, 'NOT FOUND');

    sffs.unlink('/foobar', (e, json) => {
      assertNoError(e);
      assert(json.result.status === 'SUCCESS');
      assert(api.isDone());
      done();
    });
  });

  it('can readdir()', (done) => {
    const api = server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', limit: 100 })
      .reply(200, '{ "name": "foobar", "path": "/foobar", "children": [{"name": "foo", "path": "/foobar/foo", "size": 10 }, {"name": "bar", "path": "/foobar/bar", "size": 10}]}');

    sffs.readdir('/foobar', (e, json) => {
      assert(sffs.statCache['/foobar']);
      assert(sffs.statCache['/foobar/foo']);
      assert(sffs.statCache['/foobar/bar']);
      assertNoError(e);
      assert(json.sort().toString() === ['bar', 'foo'].sort().toString());
      assert(api.isDone());
      done();
    });
  });

  it('can stat() from cache', (done) => {
    const api = server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', limit: 100 })
      .reply(200, '{ "children": [{"name": "foo", "path": "/foobar/foo", "size": 10 }, {"name": "bar", "path": "/foobar/bar", "size": 10}]}');

    sffs.readdir('/foobar', (readdirError, readDirJson) => {
      assertNoError(readdirError);
      assert(readDirJson.sort().toString() === ['bar', 'foo'].sort().toString());
      assert(api.isDone());

      // Ensure a follow-on stat() call succeeds (from cache)
      sffs.stat('/foobar/foo', (statError, statJson) => {
        assertNoError(statError);
        assertMetric(CACHE_HIT, 1);
        assert(statJson.name === 'foo');
        done();
      });
    });
  });

  it('can readdirstats() incrementally', (done) => {
    const api0 = server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', limit: 100 })
      .reply(200, '{ "page": 1, "pages": 2, "name": "foobar", "path": "/foobar", "children": [{"name": "foo", "path": "/foobar/foo", "size": 10 }, {"name": "bar", "path": "/foobar/bar", "size": 10}]}');

    const api1 = server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', limit: 100, page: 2 })
      .reply(200, '{ "page": 2, "pages": 2, "name": "foobar", "path": "/foobar", "children": [{"name": "baz", "path": "/foobar/baz", "size": 10 }, {"name": "quux", "path": "/foobar/quux", "size": 10}]}');

    let calls = 0;
    sffs.readdirstats('/foobar', (e, json) => {
      // eslint-disable-next-line no-plusplus
      switch (++calls) {
        case 1:
          assertNoError(e);
          assert(sffs.statCache['/foobar']);
          assert(sffs.statCache['/foobar/foo']);
          assert(sffs.statCache['/foobar/bar']);
          assert(json[0].name === 'foo');
          assert(json[1].name === 'bar');
          break;

        case 2:
          assertNoError(e);
          assert(sffs.statCache['/foobar']);
          assert(sffs.statCache['/foobar/baz']);
          assert(sffs.statCache['/foobar/quux']);
          assert(json[0].name === 'baz');
          assert(json[1].name === 'quux');
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

  it('can open a write stream', (done) => {
    const api = server
      .put('/api/3/path/data/foobar')
      .reply(200, '{ "name": "foobar", "path": "/foobar" }');

    const s = sffs.createWriteStream('/foobar', (e, json) => {
      assert(!sffs.statCache['/foobar']);
      assertNoError(e);
      assert(json.name === 'foobar');
      assert(api.isDone());
      done();
    });
    s.write('BODY');
    s.end();
  });

  it('can open a write stream with null options', (done) => {
    const api = server
      .put('/api/3/path/data/foobar')
      .reply(200, '{ "name": "foobar", "path": "/foobar" }');

    const s = sffs.createWriteStream('/foobar', null, (e, json) => {
      assert(!sffs.statCache['/foobar']);
      assertNoError(e);
      assert(json.name === 'foobar');
      assert(api.isDone());
      done();
    });
    s.write('BODY');
    s.end();
  });

  it('can open a write stream at an offset', (done) => {
    const ts = moment();
    const api = nock(API_URL, {
      reqheaders: {
        Range: 'bytes=100-',
        'If-Unmodified-since': ts.format('ddd, d M YYYY HH:mm:ss GMT'),
      },
    })
      .patch('/api/3/path/data/foobar')
      .reply(200, '{ "name": "foobar", "path": "/foobar" }');

    const s = sffs.createWriteStream('/foobar', { offset: 100, timestamp: ts.unix() }, (e, json) => {
      assert(!sffs.statCache['/foobar']);
      assertNoError(e);
      assert(json.name === 'foobar');
      assert(api.isDone());
      done();
    });
    s.write('BODY');
    s.end();
  });

  it('reports errors correctly during upload', (done) => {
    const api = server
      .put('/api/3/path/data/foobar')
      .reply(500, 'Internal server error');

    const s = sffs.createWriteStream('/foobar', (e) => {
      assertError(e, 500);
      assert(api.isDone());
      done();
    });
    s.write('BODY');
    s.end();
  });

  it('can open a read stream', (done) => {
    const api = server
      .get('/api/2/path/data/foobar')
      .reply(200, 'BODY');

    sffs.createReadStream('/foobar', (e, s) => {
      let buffer = '';
      assertNoError(e);
      s
        .on('data', (chunk) => {
          buffer += chunk.toString();
        })
        .on('end', () => {
          assert(buffer === 'BODY');
          assert(api.isDone());
          done();
        });
    });
  });

  it('can open a read stream with null options', (done) => {
    const api = server
      .get('/api/2/path/data/foobar')
      .reply(200, 'BODY');

    sffs.createReadStream('/foobar', null, (e, s) => {
      let buffer = '';
      assertNoError(e);
      s
        .on('data', (chunk) => {
          buffer += chunk.toString();
        })
        .on('end', () => {
          assert(buffer === 'BODY');
          assert(api.isDone());
          done();
        });
    });
  });

  it('can open a read stream at an offset', (done) => {
    const api = nock(API_URL, {
      reqheaders: {
        Range: 'bytes=100-',
      },
    })
      .get('/api/2/path/data/foobar')
      .reply(200, 'BODY');

    sffs.createReadStream('/foobar', { offset: 100 }, (e, s) => {
      let buffer = '';
      assertNoError(e);
      s
        .on('data', (chunk) => {
          buffer += chunk.toString();
        })
        .on('end', () => {
          assert(buffer === 'BODY');
          assert(api.isDone());
          done();
        });
    });
  });

  it('can cache a missing item', (done) => {
    let count = 0;
    nock(API_URL)
      .get('/api/2/path/info/foobar')
      .reply(() => {
        count += 1;
        return [404, 'File not found'];
      })
      .persist();

    sffs.cacheLevel = 2;

    sffs.stat('/foobar', (e0, json0) => {
      assert(e0.statusCode === 404);
      assert(json0 === undefined);
      assert(count === 1);

      sffs.stat('/foobar', (e1, json1) => {
        assert(e1.statusCode === 404);
        assert(json1 === undefined);
        assert(count === 1);
        done();
      });
    });
  });
});
