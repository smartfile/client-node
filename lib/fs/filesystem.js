/* eslint no-underscore-dangle: ["error", { "allowAfterThis": true }] */
const prom = require('prom-client');
const {
  FileProxy, ACCESS_READ, ACCESS_WRITE, ACCESS_ALLOWED, ACCESS_FLAGS,
} = require('./fileproxy');
const { logger } = require('../rest/client');


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


function operationWrapper(self, opName, opArgs, callback) {
  const end = OPERATION.startTimer({ opName });
  return self[opName].apply(self, [...opArgs, (e, ...args) => {
    end({ status: (e) ? 'error' : 'success' });
    if (callback) {
      callback(e, ...args);
    }
  }]);
}

// nodejs fs module work-alike.
class FileSystem {
  constructor(rest, opts) {
    this.rest = rest;
    // User can set cache level, defaults to 1.
    this.cacheLevel = (opts && typeof opts.cacheLevel === 'number') ? opts.cacheLevel : 1;
    this.fds = [];
    this.statCache = {};
  }

  _removeCache(path) {
    let recurse = true;
    const obj = this.statCache[path];

    if (obj && obj.isfile) {
      recurse = false;
    }

    logger.debug(`Removing path "${path}" from cache.`);
    delete this.statCache[path];

    if (recurse) {
      // eslint-disable-next-line no-param-reassign
      path = (path.endsWith('/')) ? path : `${path}/`;

      Object.keys(this.statCache).forEach((key) => {
        if (key.startsWith(path)) {
          logger.debug(`Recursively removing path "${key}" from cache.`);
          delete this.statsCache[key];
        }
      });
    }
  }

  stat(path, callback) {
    // Listing a directory fills this cache to speed up the all but certain
    // stat() calls to follow.
    const info = this.statCache[path];
    if (info) {
      logger.debug(`Cache HIT for "${path}"`);
      CACHE_HIT.inc();
      if (this.cacheLevel < 2) {
        this._removeCache(path);
      }
      callback(null, info);
      return;
    }
    logger.debug(`Cache MISS for "${path}"`);
    CACHE_MISS.inc();

    operationWrapper(this.rest, 'info', [path], (e, json) => {
      if (e) {
        callback(e);
        return;
      }

      if (this.cacheLevel > 1) {
        logger.debug(`Adding "${path}" to cache.`);
        this.statCache[path] = json;
      }
      callback(null, json);
    });
  }

  lstat(...args) {
    return this.stat(...args);
  }

  unlink(path, callback) {
    return operationWrapper(this.rest, 'delete', [path], (e, json) => {
      if (e && e.statusCode === 404
        && e.options.uri === '/api/2/path/oper/remove/') {
        this._removeCache(path);
        // Mask out the error, and forge a fake response.
        callback(null, {
          result: {
            status: 'SUCCESS',
          },
        });
      } else {
        if (!e) {
          this._removeCache(path);
        }
        callback(e, json);
      }
    });
  }

  rmdir(...args) {
    return this.unlink(...args);
  }

  mkdir(path, callback) {
    return operationWrapper(this.rest, 'mkdir', [path], callback);
  }

  copy(src, dst, callback) {
    return operationWrapper(this.rest, 'copy', [src, dst], callback);
  }

  copyFile(...args) {
    return this.copy(...args);
  }

  copyDir(...args) {
    return this.copy(...args);
  }

  move(src, dst, callback) {
    return operationWrapper(this.rest, 'move', [src, dst], (e, json) => {
      if (e) {
        callback(e);
        return;
      }

      this._removeCache(src);
      callback(null, json);
    });
  }

  rename(src, dst, callback) {
    return operationWrapper(this.rest, 'rename', [src, dst], (e, json) => {
      if (e) {
        callback(e);
        return;
      }

      this._removeCache(src);
      callback(null, json);
    });
  }

  exists(path, callback) {
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
    });
  }

  createReadStream(path, _options, _callback) {
    // https://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options
    // NOTE: I have to deviate from the fs module here and use a callback.
    const callback = (typeof _options === 'function') ? _options : _callback;
    if (!callback) {
      logger.warn('Return value of createReadStream() is not a stream, use callback!');
    }
    operationWrapper(this.rest, 'download', [path], callback);
  }

  createWriteStream(path, _options, _callback) {
    // https://nodejs.org/api/fs.html#fs_fs_createwritestream_path_options
    const callback = (typeof _options === 'function') ? _options : _callback;
    return operationWrapper(this.rest, 'upload', [path], (e, json) => {
      if (callback) {
        callback(e, json);
      }
    });
  }

  open(path, _flags, _mode, _callback) {
    // https://nodejs.org/api/fs.html#fs_fs_open_path_flags_mode_callback
    let file = null;
    let callback;
    const end = OPERATION.startTimer({ opName: 'read' });

    // Shift arguments.
    if (typeof _mode === 'function') {
      callback = _mode;
    } else {
      callback = _callback;
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
          file = new FileProxy(this, path, flags, accessType, callback);
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

  close(fd, callback) {
    const file = this.fds[fd];
    const end = OPERATION.startTimer({ opName: 'read' });

    if (!file) {
      callback(new Error(`invalid fd ${fd}`));
      end({ status: 'error' });
      return;
    }

    file.close(callback);
    end({ status: 'success' });
  }

  fstat(fd, callback) {
    const file = this.fds[fd];

    if (!file) {
      callback(new Error(`invalid fd ${fd}`));
      return;
    }

    this.stat(file.path, callback);
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
    const end = OPERATION.startTimer({ opName: 'readFile' });

    // Shift arguments.
    if (typeof _options === 'function') {
      callback = _options;
    } else {
      callback = _callback;
    }

    this.open(path, 'r', null, (openError, fd) => {
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
    const end = OPERATION.startTimer({ opName: 'read' });

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
    const end = OPERATION.startTimer({ opName: 'writeFile' });

    // Shift arguments.
    if (typeof _options === 'function') {
      callback = _options;
    } else {
      callback = _callback;
    }

    this.open(path, 'w', null, (openError, fd) => {
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
            this.close(fd, (closeError) => {
              end({ status: 'success' });
              callback(closeError);
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
    }, options);
  }

  readdirstats(path, callback, opts) {
    const end = OPERATION.startTimer({ opName: 'readdirstats' });

    const options = {
      incremental: false,
      ...opts,
    };

    // API arguments.
    const args = {
      children: true,
    };

    // Buffer when not incremental.
    const infos = options.incremental ? null : [];

    // Clear cache, only meant to be used for stat() calls following a
    // readdir().
    if (this.cacheLevel < 2) {
      logger.debug('Clearing cache');
      this.statCache = {};
    }

    // Make API call.
    this.rest.info(path, (e, page, json) => {
      if (e) {
        callback(e);
        end({ status: 'error' });
        return;
      }

      if (json && this.cacheLevel > 1) {
        // Remove some stuff that we don't want in cache.
        ['children', 'total', 'pages', 'page', 'per_page'].forEach((key) => {
          // eslint-disable-next-line no-param-reassign
          delete json[key];
        });
        logger.debug(`Adding "${path}" to cache.`);
        this.statCache[path] = json;
      }

      // Last page, call callback.
      if (page === null) {
        // Note that infos is null when incremental.
        end({ status: 'success' });
        callback(null, infos);
        return;
      }

      if (options.incremental) {
        callback(null, page);
      }

      // Buffer page of results.
      for (let i = 0; i < page.length; i++) {
        if (!options.incremental) {
          infos.push(page[i]);
        }

        // Cache stat information, most times stat() calls for everything we
        // list are imminent.
        if (this.cacheLevel > 0) {
          logger.debug(`Adding "${page[i].path}" to cache.`);
          this.statCache[page[i].path] = page[i];
        }
      }
    }, args);
  }
}

module.exports = {
  FileSystem,
  logger,
  metrics,
  CACHE_HIT,
  CACHE_MISS,
  OPERATION,
};
