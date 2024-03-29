/* eslint no-underscore-dangle: ["error", { "allowAfterThis": true }] */
const pathlib = require('path');
const prom = require('prom-client');
const moment = require('moment');
const {
  FileProxy, ACCESS_READ, ACCESS_WRITE, ACCESS_ALLOWED, ACCESS_FLAGS,
} = require('./fileproxy');


const metrics = new prom.Registry();

const OPERATION = new prom.Summary({
  name: 'sf_fs_operation',
  help: 'SmartFile FS Operation',
  labelNames: ['opName', 'status'],
  registers: [metrics],
});

const CACHE_HIT = new prom.Counter({
  name: 'sf_fs_cache_hit',
  help: 'SmartFile FS Cache',
  registers: [metrics],
});

const CACHE_MISS = new prom.Counter({
  name: 'sf_fs_cache_miss',
  help: 'SmartFile FS Cache',
  registers: [metrics],
});


function operationWrapper(self, opName, opArgs, callback, options) {
  const end = OPERATION.startTimer({ opName });

  return self[opName].apply(self, [...opArgs, (e, ...args) => {
    end({ status: (e) ? 'error' : 'success' });
    if (callback) {
      callback(e, ...args);
    }
  }, options]);
}

// nodejs fs module work-alike.
class FileSystem {
  constructor(rest, options) {
    this.rest = rest;
    // User can set cache level, defaults to 1.
    this.cacheLevel = (options && typeof options.cacheLevel === 'number') ? options.cacheLevel : 1;
    this.fds = [];
    this.statCache = {};
  }

  _delCache(path, ...levels) {
    if (levels.indexOf(this.cacheLevel) === -1) {
      return [];
    }

    let recurse = true;
    const obj = this.statCache[path];
    const removed = [obj];

    if (obj && obj.isfile) {
      recurse = false;
    }

    this.rest.logger.silly(`Removing path "${path}" from cache.`);
    delete this.statCache[path];

    if (recurse) {
      this.rest.logger.debug(`Recursively removing path "${path}" from cache.`);
      // eslint-disable-next-line no-param-reassign
      path = (path.endsWith('/')) ? path : `${path}/`;

      Object.keys(this.statCache).forEach((key) => {
        if (key.startsWith(path)) {
          removed.push(this.statCache[key]);
          delete this.statCache[key];
        }
      });
    }

    return removed;
  }

  _addCache(path, obj, ...levels) {
    if (levels.indexOf(this.cacheLevel) === -1) {
      return;
    }
    if (!obj) {
      return;
    }

    this.rest.logger.silly(`Adding "${path}" to cache.`);
    this.statCache[path] = obj;
  }

  _clearCache(...levels) {
    if (levels.indexOf(this.cacheLevel) === -1) {
      return;
    }
    this.rest.logger.debug('Clearing cache');
    this.statCache = {};
  }

  stat(path, callback, options) {
    // Listing a directory fills this cache to speed up the all but certain
    // stat() calls to follow.
    const info = this.statCache[path];
    if (info) {
      this.rest.logger.debug(`Cache HIT for "${path}"`);
      CACHE_HIT.inc();
      this._delCache(path, 0, 1);

      if (info instanceof Error) {
        // Negative cache
        callback(info);
      } else {
        callback(null, info);
      }
      return;
    }
    this.rest.logger.debug(`Cache MISS for "${path}"`);
    CACHE_MISS.inc();

    operationWrapper(this.rest, 'info', [path], (e, json) => {
      if (e) {
        if (e.statusCode === 404) {
          // Negative cache, don't use the original (heavyweight) error instance.
          const newError = new Error('File not found');
          newError.statusCode = e.statusCode;
          newError.message = e.message;
          newError.path = e.path;
          this._addCache(path, newError, 2);
        }
        callback(e);
        return;
      }

      this._addCache(json.path, json, 2);
      callback(null, json);
    }, options);
  }

  lstat(...args) {
    return this.stat(...args);
  }

  rmdir(path, callback, options) {
    return operationWrapper(this.rest, 'delete', [path], (e, json) => {
      if (e && e.statusCode === 404
        && e.path === '/api/2/path/oper/remove/') {
        this._delCache(path, 0, 1, 2);
        // Mask out the error, and forge a fake response.
        callback(null, {
          result: {
            status: 'SUCCESS',
          },
        });
      } else {
        if (!e) {
          this._delCache(path, 0, 1, 2);
        }
        callback(e, json);
      }
    }, options);
  }

  unlink(path, callback, options) {
    return operationWrapper(this.rest, 'deleteFile', [path], (e, json) => {
      if (e && e.statusCode === 404) {
        this._delCache(path, 0, 1, 2);
        // Mask out the error, and forge a fake response.
        callback(null, {
          result: {
            status: 'SUCCESS',
          },
        });
      } else {
        if (!e) {
          this._delCache(path, 0, 1, 2);
        }
        callback(e, json);
      }
    }, options);
  }

  mkdir(path, callback, options) {
    return operationWrapper(this.rest, 'mkdir', [path], (e, json) => {
      if (!e) {
        this._addCache(json.path, json, 2);
      }

      callback(e, json);
    }, options);
  }

  copy(src, dst, callback, options) {
    // Because this is an operation, the JSON indicates the status of
    // the operation, but does not return the dst object. Therefore
    // we cannot "prime" the cache.
    // However, we can evict the destination. I think it is safe to assume
    // that dst is a directory (not the full path including file name).
    const dstPath = pathlib.join(dst, pathlib.basename(src));
    this._delCache(dstPath, 0, 1, 2);
    return operationWrapper(this.rest, 'copy', [src, dst], callback, options);
  }

  copyFile(...args) {
    return this.copy(...args);
  }

  copyDir(...args) {
    return this.copy(...args);
  }

  move(src, dst, callback, options) {
    // Because this is an operation, the JSON indicates the status of
    // the operation, but does not return the dst object. Therefore
    // we cannot "prime" the cache.
    // However, we can evict the destination. I think it is safe to assume
    // that dst is a directory (not the full path including file name).
    const dstPath = pathlib.join(dst, pathlib.basename(src));
    this._delCache(dstPath, 0, 1, 2);
    return operationWrapper(this.rest, 'move', [src, dst], callback, options);
  }

  rename(src, dst, callback, options) {
    return operationWrapper(this.rest, 'rename', [src, dst], (e, json) => {
      if (e) {
        callback(e);
        return;
      }

      // Cache the item at cache level 2.
      this._addCache(json.path, json, 2);
      this._delCache(src, 0, 1, 2);
      callback(null, json);
    }, options);
  }

  exists(path, callback, options) {
    this.stat(path, (e) => {
      if (e && e.statusCode === 404) {
        // Does not exist.
        callback(null, false);
      } else if (e) {
        // Some other error.
        callback(e);
      } else {
        // Does exist.
        callback(null, true);
      }
    }, options);
  }

  createReadStream(path, _options, _callback) {
    // https://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options
    // NOTE: I have to deviate from the fs module here and use a callback.
    let options;
    let callback;

    if (typeof _options === 'function') {
      // options omitted, shift.
      callback = _options;
      options = { headers: {} };
    } else {
      callback = _callback;
      options = { ..._options };
    }

    if (typeof callback !== 'function') {
      throw new Error('Return value of createReadStream() is not a stream, use callback!');
    }

    if (options && options.offset) {
      // transform fs-style options to HTTP options.
      if (!options.headers) {
        options.headers = {};
      }
      options.headers.Range = `bytes=${options.offset}-`;
      delete options.offset;
    }

    const end = OPERATION.startTimer({ opName: 'createReadStream' });
    return this.rest.download(path, (e, res) => {
      if (e) {
        end({ status: 'error' });
      } else {
        res.once('end', () => end({ status: 'success' }));
      }

      callback(e, res);
    }, options);
  }

  createWriteStream(path, _options, _callback) {
    // https://nodejs.org/api/fs.html#fs_fs_createwritestream_path_options
    let options;
    let callback;

    if (typeof _options === 'function') {
      callback = _options;
      options = { headers: {} };
    } else {
      callback = _callback;
      options = { ..._options };
    }

    if (options && options.offset) {
      if (!options.headers) {
        options.headers = {};
      }
      options.headers.Range = `bytes=${options.offset}-`;
      delete options.offset;

      if (options.timestamp) {
        const ts = moment.unix(options.timestamp);
        options.headers['If-Unmodified-Since'] = ts.format('ddd, d M YYYY HH:mm:ss GMT');
        delete options.timestamp;
      }
    }

    const end = OPERATION.startTimer({ opName: 'createWriteStream' });

    return this.rest.upload(path, (e, json) => {
      end({ status: (e) ? 'error' : 'success' });

      if (!e && json) {
        this._addCache(json.path, json, 2);
      }

      if (callback) {
        callback(e, json);
      }
    }, options);
  }

  open(path, _flags, _mode, _callback, _options) {
    // https://nodejs.org/api/fs.html#fs_fs_open_path_flags_mode_callback
    let file = null;
    let callback;
    let options;
    const end = OPERATION.startTimer({ opName: 'open' });

    // Shift arguments.
    if (typeof _mode === 'function') {
      callback = _mode;
      options = _callback;
    } else {
      callback = _callback;
      options = _options;
    }

    const flags = _flags || 'r';
    const accessType = ACCESS_FLAGS[flags];

    try {
      switch (accessType) {
        /*
        Not currently any special handling for read or write.

        case ACCESS_READ:
        file = new FileReader(this, path, flags, callback);
        break;

        case ACCESS_WRITE:
        file = new FileWriter(this, path, flags, callback);
        break;
        */

        case ACCESS_READ:
        case ACCESS_WRITE:
        case ACCESS_ALLOWED:
          file = new FileProxy(this, path, flags, accessType, callback, options);
          break;

        default:
          throw new Error(`invalid flags: ${flags} (${accessType})`);
      }
    } catch (e) {
      callback(e);
      end({ status: 'error' });
      return null;
    }

    end({ status: 'success' });
    return file;
  }

  close(fd, callback, options) {
    const file = this.fds[fd];
    const end = OPERATION.startTimer({ opName: 'close' });

    if (!file) {
      callback(new Error(`invalid fd ${fd}`));
      end({ status: 'error' });
      return;
    }

    file.close((e, json) => {
      if (!e) {
        this._addCache(json.path, json, 2);
      }

      callback(e, json);
    }, options);
    end({ status: 'success' });
  }

  fstat(fd, callback, options) {
    const file = this.fds[fd];

    if (!file) {
      callback(new Error(`invalid fd ${fd}`));
      return;
    }

    this.stat(file.path, callback, options);
  }

  read(fd, buffer, offset, length, position, callback) {
    // https://nodejs.org/api/fs.html#fs_fs_read_fd_buffer_offset_length_position_callback
    const file = this.fds[fd];
    const end = OPERATION.startTimer({ opName: 'read' });

    if (!file) {
      callback(new Error(`invalid fd ${fd}`));
      end({ status: 'error' });
      return;
    }

    file.read(buffer, offset, length, position, callback);
    end({ status: 'success' });
  }

  readFile(path, _options, _callback) {
    // https://nodejs.org/api/fs.html#fs_fs_readfile_path_options_callback
    let buffer = Buffer.alloc(0);
    let pos = 0;
    let callback;
    let options;
    const end = OPERATION.startTimer({ opName: 'readFile' });

    // Shift arguments.
    if (typeof _options === 'function') {
      callback = _options;
    } else {
      callback = _callback;
      options = _options;
    }

    this.open(path, 'r', options, (openError, fd) => {
      if (openError) {
        callback(openError);
        end({ status: 'error' });
        return;
      }

      const readChunk = () => {
        const chunk = Buffer.alloc(16384);

        this.read(fd, chunk, 0, 16384, pos, (readError, bytesRead) => {
          if (readError) {
            end({ status: 'error' });
            callback(readError);
            return;
          }
          if (bytesRead === 0) {
            end({ status: 'success' });
            callback(null, buffer.subarray(0, pos));
            return;
          }

          pos += bytesRead;
          buffer = Buffer.concat([buffer, chunk]);

          process.nextTick(readChunk);
        });
      };

      process.nextTick(readChunk);
    });
  }

  write(fd, buffer, offset, length, position, callback) {
    // https://nodejs.org/api/fs.html#fs_fs_write_fd_buffer_offset_length_position_callback
    // https://nodejs.org/api/fs.html#fs_fs_write_fd_string_position_encoding_callback
    const file = this.fds[fd];
    const end = OPERATION.startTimer({ opName: 'write' });

    if (!file) {
      callback(new Error(`invalid fd ${fd}`));
      end({ status: 'error' });
      return;
    }

    file.write(buffer, offset, length, position, callback);
    end({ status: 'success' });
  }

  writeFile(path, buffer, _options, _callback) {
    // https://nodejs.org/api/fs.html#fs_fs_writefile_file_data_options_callback
    let pos = 0;
    let callback;
    let options;
    const end = OPERATION.startTimer({ opName: 'writeFile' });

    // Shift arguments.
    if (typeof _options === 'function') {
      callback = _options;
    } else {
      callback = _callback;
      options = _options;
    }

    this.open(path, 'w', options, (openError, fd) => {
      if (openError) {
        callback(openError);
        end({ status: 'error' });
        return;
      }

      const writeChunk = () => {
        this.write(fd, buffer, pos, buffer.byteLength, pos, (writeError, bytesWritten) => {
          if (writeError) {
            callback(writeError);
            end({ status: 'error' });
            return;
          }

          pos += bytesWritten;
          if (pos === buffer.byteLength) {
            this.close(fd, (closeError, json) => {
              end({ status: 'success' });
              this._addCache(json.path, json, 2);
              callback(closeError, json);
            });
            return;
          }

          process.nextTick(writeChunk);
        });
      };

      process.nextTick(writeChunk);
    });
  }

  readdir(path, callback, options) {
    const reqOptions = {
      incremental: false,
      qs: {
        children: true,
        limit: (options && options.limit) || 100,
      },
      headers: (options && options.headers),
    };

    // https://nodejs.org/api/fs.html#fs_fs_readdir_path_options_callback
    this.readdirstats(path, (e, infos) => {
      if (e) {
        callback(e);
        return;
      }

      const names = [];

      if (infos) {
        for (let i = 0; i < infos.length; i++) {
          names[i] = infos[i].name;
        }
      }

      callback(null, names);
    }, reqOptions);
  }

  readdirstats(path, callback, options) {
    const end = OPERATION.startTimer({ opName: 'readdirstats' });

    const reqOptions = {
      incremental: (options && options.incremental) || false,
      qs: {
        children: true,
        limit: (options && options.limit) || 100,
        ...(options.fields && { fields: options.fields }),
      },
      headers: (options && options.headers),
    };

    // Buffer when not incremental.
    const infos = reqOptions.incremental ? null : [];

    this._clearCache(0, 1);

    // Make API call.
    this.rest.info(path, (e, page, json) => {
      if (e) {
        callback(e);
        end({ status: 'error' });
        return;
      }
      let jsonClone = null;

      if (json) {
        // Don't modify the original.
        jsonClone = JSON.parse(JSON.stringify(json));
        // Remove some stuff that we don't want in cache.
        ['children', 'total', 'pages', 'page', 'per_page'].forEach((key) => {
          // eslint-disable-next-line no-param-reassign
          delete jsonClone[key];
        });
        this._addCache(jsonClone.path, jsonClone, 1, 2);
      }

      // Last page, call callback.
      if (page === null) {
        // Note that infos is null when incremental.
        end({ status: 'success' });
        callback(null, infos, jsonClone);
        return;
      }

      // Cache page of results.
      for (let i = 0; i < page.length; i++) {
        if (!reqOptions.incremental) {
          infos.push(page[i]);
        }

        this._addCache(page[i].path, page[i], 1, 2);
      }

      if (reqOptions.incremental) {
        callback(null, page, jsonClone);
      }
    }, reqOptions);
  }
}

module.exports = {
  FileSystem,
  metrics,
  CACHE_HIT,
  CACHE_MISS,
  OPERATION,
};
