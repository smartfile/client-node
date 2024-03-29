const moment = require('moment');
const nock = require('nock');
const assert = require('assert');
const smartfile = require('../lib');
const { CACHE_HIT } = require('../lib/fs/filesystem');


const API_URL = 'http://fakeapi.foo/';


async function assertMetric(metric, value) {
  // Asserts that a paritcular metric has the desired value.
  // This function assumes only one instance of the metrics (unique label set).
  // Also, value === 0 is a special case, it allows the metric to be missing.
  const { values } = await metric.get();

  if (values.length === 0 && value === 0) {
    return;
  }
  assert(values.length);
  assert.strictEqual(values[0].value, value);
}

// NOTE: We only test the open function as all the other actions are trivial
// wrappers around the rest client functions (which are already)

describe('File System Abstraction', () => {
  let server;
  let sffs;

  beforeEach('', (done) => {
    const rest = new smartfile.Client({ baseUrl: API_URL });
    rest.logger.silent = true;
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
        assert.ifError(readError);
        assert.strictEqual(bytesRead, 4);
        assert.strictEqual(data.toString(), 'BODY');
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
      assert.ifError(e);
      assert.strictEqual(buffer.toString(), 'BODY');
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
          assert.ifError(closeError);
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
      assert.ifError(e);
      done();
    });
  });

  it('can delete a missing directory', (done) => {
    const api = server
      .post('/api/2/path/oper/remove/', { path: '/foobar' })
      .reply(404, 'NOT FOUND');

    sffs.rmdir('/foobar', (e, json) => {
      assert(!sffs.statCache['/foobar']);
      assert.ifError(e);
      assert.strictEqual(json.result.status, 'SUCCESS');
      assert(api.isDone());
      done();
    });
  });

  it('can delete a missing file', (done) => {
    const api = server
      .delete('/api/3/path/data/foobar')
      .reply(404, 'NOT FOUND');

    sffs.unlink('/foobar', (e, json) => {
      assert.ifError(e);
      assert.strictEqual(json.result.status, 'SUCCESS');
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
      assert.ifError(e);
      assert.deepStrictEqual(json.sort(), ['bar', 'foo']);
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
      assert.ifError(readdirError);
      assert.deepStrictEqual(readDirJson.sort(), ['bar', 'foo']);
      assert(api.isDone());

      // Ensure a follow-on stat() call succeeds (from cache)
      sffs.stat('/foobar/foo', (statError, statJson) => {
        assert.ifError(statError);
        assertMetric(CACHE_HIT, 1);
        assert.strictEqual(statJson.name, 'foo');
        done();
      });
    });
  });

  it('can readdirstats() incrementally', (done) => {
    const api0 = server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', limit: 2 })
      .reply(200, '{ "page": 1, "pages": 2, "name": "foobar", "path": "/foobar", "children": [{"name": "foo", "path": "/foobar/foo", "size": 10 }, {"name": "bar", "path": "/foobar/bar", "size": 10}]}');

    const api1 = server
      .get('/api/2/path/info/foobar')
      .query({ children: 'true', limit: 2, page: 2 })
      .reply(200, '{ "page": 2, "pages": 2, "name": "foobar", "path": "/foobar", "children": [{"name": "baz", "path": "/foobar/baz", "size": 10 }, {"name": "quux", "path": "/foobar/quux", "size": 10}]}');

    let calls = 0;
    sffs.readdirstats('/foobar', (e, json) => {
      // eslint-disable-next-line no-plusplus
      switch (++calls) {
        case 1:
          assert.ifError(e);
          assert(sffs.statCache['/foobar']);
          assert(sffs.statCache['/foobar/foo']);
          assert(sffs.statCache['/foobar/bar']);
          assert.strictEqual(json[0].name, 'foo');
          assert.strictEqual(json[1].name, 'bar');
          break;

        case 2:
          assert.ifError(e);
          assert(sffs.statCache['/foobar']);
          assert(sffs.statCache['/foobar/baz']);
          assert(sffs.statCache['/foobar/quux']);
          assert.strictEqual(json[0].name, 'baz');
          assert.strictEqual(json[1].name, 'quux');
          assert(api0.isDone());
          break;

        case 3:
          assert.ifError(e);
          assert.strictEqual(json, null);
          assert(api1.isDone());
          done();
          break;

        default:
          assert.fail('too many callbacks');
          break;
      }
    }, {
      incremental: true,
      limit: 2,
    });
  });

  it('can readdirstats() incrementally with limited fields', (done) => {
    const api0 = server
      .get('/api/2/path/info/foobar')
      .query({
        children: 'true', limit: 2, fields: ['name', 'path'],
      })
      .reply(200, '{ "page": 1, "pages": 2, "name": "foobar", "path": "/foobar", "children": [{"name": "foo", "path": "/foobar/foo"}, {"name": "bar", "path": "/foobar/bar"}]}');

    const api1 = server
      .get('/api/2/path/info/foobar')
      .query({
        children: 'true', limit: 2, page: 2, fields: ['name', 'path'],
      })
      .reply(200, '{ "page": 2, "pages": 2, "name": "foobar", "path": "/foobar", "children": [{"name": "baz", "path": "/foobar/baz"}, {"name": "quux", "path": "/foobar/quux"}]}');

    let calls = 0;
    sffs.readdirstats('/foobar', (e, json) => {
      // eslint-disable-next-line no-plusplus
      switch (++calls) {
        case 1:
          assert.ifError(e);
          assert(sffs.statCache['/foobar']);
          assert(sffs.statCache['/foobar/foo']);
          assert(sffs.statCache['/foobar/bar']);
          assert.strictEqual(json[0].name, 'foo');
          assert.strictEqual(json[1].name, 'bar');
          break;

        case 2:
          assert.ifError(e);
          assert(sffs.statCache['/foobar']);
          assert(sffs.statCache['/foobar/baz']);
          assert(sffs.statCache['/foobar/quux']);
          assert.strictEqual(json[0].name, 'baz');
          assert.strictEqual(json[1].name, 'quux');
          assert(api0.isDone());
          break;

        case 3:
          assert.ifError(e);
          assert.strictEqual(json, null);
          assert(api1.isDone());
          done();
          break;

        default:
          assert.fail('too many callbacks');
          break;
      }
    }, {
      incremental: true,
      limit: 2,
      fields: ['name', 'path'],
    });
  });

  it('can open a write stream', (done) => {
    const api = server
      .put('/api/3/path/data/foobar')
      .reply(200, '{ "name": "foobar", "path": "/foobar" }');

    const s = sffs.createWriteStream('/foobar', (e, json) => {
      assert(!sffs.statCache['/foobar']);
      assert.ifError(e);
      assert.strictEqual(json.name, 'foobar');
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
      assert.ifError(e);
      assert.strictEqual(json.name, 'foobar');
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
      assert.ifError(e);
      assert.strictEqual(json.name, 'foobar');
      assert(api.isDone());
      done();
    });
    s.write('BODY');
    s.end();
  });

  it('reports errors correctly before starting upload', (done) => {
    const api = server
      .put('/api/3/path/data/foobar')
      .reply(402, '{ "detail": "Some error happened" }');

    const s = sffs.createWriteStream('/foobar', (e) => {
      assert.strictEqual(e.statusCode, 402);
      assert.strictEqual(e.message, 'Some error happened');
      assert(api.isDone());
      done();
    });
    s.write('BODY');
    s.end();
  });

  it('reports errors correctly during upload', (done) => {
    const api = server
      .put('/api/3/path/data/foobar')
      .reply(200, '{ "status": 400, "detail": "Some error happened" }');

    const s = sffs.createWriteStream('/foobar', (e) => {
      assert.strictEqual(e.statusCode, 400);
      assert.strictEqual(e.message, 'Some error happened');
      assert(api.isDone());
      done();
    });
    s.write('BODY');
    s.end();
  });

  it('reports errors correctly before starting download', (done) => {
    const api = server
      .get('/api/2/path/data/foobar')
      .reply(402, { detail: 'Some error happened' });

    sffs.createReadStream('/foobar', (e) => {
      assert.strictEqual(e.statusCode, 402);
      assert.strictEqual(e.message, 'Some error happened');
      assert(api.isDone());
      done();
    });
  });

  it('can open a read stream', (done) => {
    const api = server
      .get('/api/2/path/data/foobar')
      .reply(200, 'BODY');

    sffs.createReadStream('/foobar', (e, s) => {
      let buffer = '';
      assert.ifError(e);
      s
        .on('data', (chunk) => {
          buffer += chunk.toString();
        })
        .on('end', () => {
          assert.strictEqual(buffer, 'BODY');
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
      assert.ifError(e);
      s
        .on('data', (chunk) => {
          buffer += chunk.toString();
        })
        .on('end', () => {
          assert.strictEqual(buffer, 'BODY');
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
      assert.ifError(e);
      s
        .on('data', (chunk) => {
          buffer += chunk.toString();
        })
        .on('end', () => {
          assert.strictEqual(buffer, 'BODY');
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
      assert.strictEqual(e0.statusCode, 404);
      assert.strictEqual(json0, undefined);
      assert.strictEqual(count, 1);

      sffs.stat('/foobar', (e1, json1) => {
        assert.strictEqual(e1.statusCode, 404);
        assert.strictEqual(json1, undefined);
        assert.strictEqual(count, 1);
        done();
      });
    });
  });
});
