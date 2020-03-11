
const fs = require('fs');
const tmp = require('tmp');

const logger = require('./rest').logger;

// Three distinct ways to handle a file.
const ACCESS_READ = 0;
const ACCESS_WRITE = 1;
const ACCESS_ALLOWED = 2;

// Map flags strings to file handling methods.
const ACCESS_FLAGS = {
  // Read access:
  'r': ACCESS_READ,       // READ

  // Write access:
  'w': ACCESS_WRITE,      // WRITE
  'wx': ACCESS_WRITE,     // TRUNC, CREAT, WRITE, EXCL
  'xw': ACCESS_WRITE,     // TRUNC, CREAT, WRITE, EXCL

  // Allowed access:
  'r+': ACCESS_ALLOWED,   // READ, WRITE
  'w+': ACCESS_ALLOWED,   // TRUNC, CREAT, READ, WRITE
  'wx+': ACCESS_ALLOWED,  // TRUNC, CREAT, READ, WRITE, EXCL
  'xw+': ACCESS_ALLOWED,  // TRUNC, CREAT, READ, WRITE, EXCL
  'a': ACCESS_ALLOWED,    // APPEND, CREAT, WRITE
  'ax': ACCESS_ALLOWED,   // APPEND, CREAT, WRITE, EXCL
  'xa': ACCESS_ALLOWED,   // APPEND, CREAT, WRITE, EXCL
  'a+': ACCESS_ALLOWED,   // APPEND, CREAT, READ, WRITE
  'ax+': ACCESS_ALLOWED,  // APPEND, CREAT, READ, WRITE, EXCL
  'xa+': ACCESS_ALLOWED,  // APPEND, CREAT, READ, WRITE, EXCL
};


// Internals proxy class for random access reads / writes. Enables the
// FileSystem block API. Not for external consumption.
class FileProxy {
  // An inefficient way to support all operations in any order by using a local
  // file. This class first downloads the remote file before allowing any
  // operations. Then when closed the file is uploaded (with modifications).

  constructor(sffs, path, flags, accessType, callback) {
    this.sffs = sffs;
    this.path = path;
    this.flags = flags;
    this.accessType = accessType;
    this.cursor = 0;

    // Open a temp file, and download the remote file into it. As reads are
    // requested, we will satisfy them from that file. If the file is still
    // downloading, and too small to satisfy the read, we will retry via
    // setTimeout() a number of times before failing out.
    this.fd = null;
    this.tmpPath = null;
    this.error = null;
    this.downloaded = false;

    const openFd = () => {
      const fd = this.sffs.fds.length;
      this.sffs.fds[fd] = this;
      callback(null, fd);
    }

    // Open a temp file to back the remote file.
    tmp.file({ detachDescriptor: true }, (e, path, fd) => {
      if (e) {
        return callback(e);
      }

      this.tmpFd = fd;
      this.tmpPath = path;

      // When reading, we fetch the existing file from API.
      if (this.accessType !== ACCESS_WRITE) {
        // open the path as a stream for downloading.
        const ws = fs.createWriteStream(this.tmpPath, {
          fd: this.tmpFd,
          start: 0,
          autoClose: false
        });

        // Try to download the file, this will allow reading and modification.
        this.sffs.rest.download(this.path)
          .on('end', () => {
            // Download complete, because of autoClose (default: true), the
            // stream is closed, we can reopen the path for reading.
            return openFd();
          })
          .on('error', (e) => {
            return callback(e);
          })
          .pipe(ws);

      // When writing, we don't need to fetch.
      } else {
        return openFd();
      }
    });
  }

  read(buffer, offset, length, position, callback) {
    fs.read(this.tmpFd, buffer, offset, length, position, (e, bytesRead, buffer) => {
      if (e) {
        return callback(e);
      }

      if (bytesRead != length) {
        const smallerBuffer = Buffer.concat([buffer], bytesRead);
        return callback(null, bytesRead, smallerBuffer);
      }

      callback(null, bytesRead, buffer);
    })
  }

  write(buffer, offset, length, position, callback) {
    fs.write(this.tmpFd, buffer, offset, length, position, (e, bytesWritten, buffer) => {
      if (e) {
        return callback(e);
      }

      // TODO: bytesWritten may differ from the requested bytes. I am not sure
      // when this might happen and how to handle it right now. For now, let's
      // fail.
      if (bytesWritten != buffer.length) {
        callback(new Error(
          `could not write all the bytes ${bytesWritten} < ${length}`));
        return;
      }

      callback(null, buffer);
    });
  }

  close(callback, abort) {
    const cleanup = () => {
      fs.close(this.tmpFd, (e) => {
        if (e) {
          logger.error(e);
        }

        fs.unlink(this.tmpPath, (e) => {
          if (e) {
            logger.error(e);
          }
        });
      });
    };

    // TODO: (optimization) Only upload if file was mutated.
    if (!abort && this.accessType !== ACCESS_READ) {
      // access type is write, so flush back to SmartFile.
      const rs = fs.createReadStream(this.tmpPath, {
        fd: this.tmpFd,
        start: 0,
        autoClose: false,
      });

      this.sffs.rest.upload(this.path, rs, (e, r) => {
        cleanup();

        if (e) {
          return callback(e);
        }

        callback(null);
      });

    } else {
      cleanup();
      callback(null);
    }
  }
}

// nodejs fs module work-alike.
class FileSystem {
  constructor(rest) {
    this.rest = rest;

    this.fds = [];
    this.statCache = {};
  }

  stat(path, callback) {
    // Listing a directory fills this cache to speed up the all but certain
    // stat() calls to follow.
    const info = this.statCache[path];
    if (info) {
      delete this.statCache[path];
      return callback(null, info);
    }

    this.rest.info(path, callback);
  }

  lstat() {
    return this.stat(...arguments);
  }

  unlink(path, callback) {
    this.rest.delete(path, (e, json) => {
      // Ignore a 404 when deleting, if path does not exist, then delete was
      // a "success".
      if (e && e.statusCode == 404 &&
        e.options.uri === '/api/2/path/oper/remove/') {
        // Mask out the error, and forge a fake response.
        e = null;
        json = {
          result: {
            status: 'SUCCESS',
          }
        }
      }

      callback(e, json);
    });
  }

  rmdir(path, callback) {
    return this.unlink(...arguments);
  }

  mkdir(path, callback) {
    this.rest.mkdir(path, callback);
  }

  copy(src, dst, callback) {
    this.rest.copy(src, dst, callback);
  }

  copyFile() {
    return this.copy(...arguments);
  }

  copyDir() {
    return this.copy(...arguments);
  }

  move(src, dst, callback) {
    this.rest.move(src, dst, callback);
  }

  rename(src, dst, callback) {
    this.rest.rename(src, dst, callback);
  }

  exists(path, callback) {
    this.stat(path, (e, info) => {
      // TODO: check for 404.
      if (e) {
        return callback(null, false);
      }

      callback(null, true);
    })
  }

  createReadStream(path, options) {
    // TODO: options is optional.
    // https://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options
    return this.rest.download(path);
  }

  createWriteStream(path, options) {
    throw new Error('Not yet supported by API');
    // TODO: options is optional.
    // https://nodejs.org/api/fs.html#fs_fs_createwritestream_path_options
    return this.rest.upload(path);
  }

  open(path, flags, mode, callback) {
    // https://nodejs.org/api/fs.html#fs_fs_open_path_flags_mode_callback
    let file = null, accessType;

    if (typeof mode === 'function') {
      callback = node;
      mode = null;
    }

    flags = flags || 'r';
    accessType = ACCESS_FLAGS[flags];

    try {
      switch(accessType) {
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
        break;
      }
    } catch (e) {
      return callback(e);
    }
    return file;
  }

  close(fd, callback) {
    const file = this.fds[fd];

    if (!file) {
      return callback(new Error(`invalid fd ${fd}`));
    }

    file.close(callback);
  }

  fstat(fd, callback) {
    const file = this.fds[fd];

    if (!file) {
      return callback(new Error(`invalid fd ${fd}`));
    }

    this.stat(file.path, callback);
  }

  read(fd, buffer, offset, length, position, callback) {
    // https://nodejs.org/api/fs.html#fs_fs_read_fd_buffer_offset_length_position_callback
    const file = this.fds[fd];

    if (!file) {
      return callback(new Error(`invalid fd ${fd}`));
    }

    file.read(buffer, offset, length, position, callback);
  }

  readFile(path, options, callback) {
    // https://nodejs.org/api/fs.html#fs_fs_readfile_path_options_callback
    let buffer = Buffer.alloc();
    let pos = 0

    if (typeof options === 'function') {
      callback = options;
      options = null;
    }

    this.open(path, 'r', null, (e, fd) => {
      if (e) {
        callback(e);
      }

      function readChunk() {
        const chunk = Buffer.alloc(16384);

        this.read(fd, chunk, 0, 16384, pos, (e, bytesRead, chunk) => {
          if (e) {
            return callback(e);
          }
          if (bytesRead === 0) {
            return callback(null, buffer);
          }

          pos += bytesRead;
          buffer = Buffer.concat(buffer, chunk)

          setInterval(readChunk, 0);
        });
      }

      setInterval(readChunk, 0);
    });
  }

  write(fd, buffer, offset, length, position, callback) {
    // https://nodejs.org/api/fs.html#fs_fs_write_fd_buffer_offset_length_position_callback
    // https://nodejs.org/api/fs.html#fs_fs_write_fd_string_position_encoding_callback
    const file = this.fds[fd];

    if (!file) {
      return callback(new Error(`invalid fd ${fd}`));
    }

    file.write(buffer, offset, length, position, callback);
  }

  writeFile(path, data, options, callback) {
    // https://nodejs.org/api/fs.html#fs_fs_writefile_file_data_options_callback
    let pos = 0;

    if (typeof options === 'function') {
      callback = options;
      options = null;
    }

    this.open(path, 'w', null, (e, fd) => {
      if (e) {
        return callback(e);
      }

      function writeChunk() {
        this.write(fd, buffer, pos, 16384, pos, (e, bytesWritten, chunk) => {
          if (e) {
            return callback(e);
          }

          pos += bytesWritten;
          if (bytesWritten == buffer.byteLength) {
            return callback(null);
          }

          setInterval(writeChunk, 0);
        });
      }

      setInterval(writeChunk, 0);
    });
  }

  // TODO: make this call readdirstats() and strip out just the names (while
  // allowing it to populate statCache).
  // TODO: add incremental option to call callback multiple times instead of
  // buffering.
  readdir(path, callback, options) {
    // https://nodejs.org/api/fs.html#fs_fs_readdir_path_options_callback
    this.readdirstats(path, (e, infos) => {
      if (e) {
        return callback(e);
      }

      let names = null;

      if (infos) {
        names = [];

        for (let i = 0; i < infos.length; i++) {
          names[i] = infos[i].name;
        }
      }

      callback(e, names);
    }, options);
  }

  readdirstats(path, callback, options) {
    options = Object.assign({
      incremental: false,
    }, options);

    // API arguments.
    const args = {
      children: true,
    };

    // Buffer when not incremental.
    const infos = options.incremental ? null : [];

    // Clear cache, only meant to be used for stat() calls following a
    // readdir().
    this.statCache = {};

    // Make API call.
    this.rest.info(path, (e, page) => {
      if (e) {
        return callback(e);
      }

      // Last page, call callback.
      if (page === null) {
        // Not that infos is null when incremental.
        return callback(null, infos);
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
        this.statCache[page[i].path] = page[i];
      }
    }, args);
  }
}

module.exports = {
  FileSystem,
  logger,
};
