
const fs = require('fs');
const tmp = require('tmp');
const logger = require('winston');

// Three distinct ways to handle a file.
const MODE_READ = 0;
const MODE_WRITE = 1;
const MODE_ALLOWED = 2;

// Map mode strings to file handling methods.
const MODES = {
  // Read modes:
  'r': MODE_READ,       // READ

  // Write modes:
  'w': MODE_WRITE,      // WRITE
  'wx': MODE_WRITE,     // TRUNC, CREAT, WRITE, EXCL
  'xw': MODE_WRITE,     // TRUNC, CREAT, WRITE, EXCL

  // Allowed modes:
  'r+': MODE_ALLOWED,   // READ, WRITE
  'w+': MODE_ALLOWED,   // TRUNC, CREAT, READ, WRITE
  'wx+': MODE_ALLOWED,  // TRUNC, CREAT, READ, WRITE, EXCL
  'xw+': MODE_ALLOWED,  // TRUNC, CREAT, READ, WRITE, EXCL
  'a': MODE_ALLOWED,    // APPEND, CREAT, WRITE
  'ax': MODE_ALLOWED,   // APPEND, CREAT, WRITE, EXCL
  'xa': MODE_ALLOWED,   // APPEND, CREAT, WRITE, EXCL
  'a+': MODE_ALLOWED,   // APPEND, CREAT, READ, WRITE
  'ax+': MODE_ALLOWED,  // APPEND, CREAT, READ, WRITE, EXCL
  'xa+': MODE_ALLOWED,  // APPEND, CREAT, READ, WRITE, EXCL
};


// Internals proxy class for random access reads / writes. Enables the
// FileSystem block API. Not for external consumption.
class FileProxy {
  // An inefficient way to support all operations in any order by using a local
  // file. This class first downloads the remote file before allowing any
  // operations. Then when closed the file is uploaded (with modifications).

  constructor(sffs, path, mode, modeType, callback) {
    const self = this;

    this.sffs = sffs;
    this.path = path;
    this.mode = mode;
    this.modeType = modeType;
    this.cursor = 0;

    // Open a temp file, and download the remote file into it. As reads are
    // requested, we will satisfy them from that file. If the file is still
    // downloading, and too small to satisfy the read, we will retry via
    // setTimeout() a number of times before failing out.
    this.fd = null;
    this.tmpPath = null;
    this.error = null;
    this.downloaded = false;

    function openFd() {
      const fd = self.sffs.fds.length;
      self.sffs.fds[fd] = self;
      callback(null, fd);
    }

    tmp.file({ detachDescriptor: true }, (e, path, fd) => {
      if (e) {
        return callback(e);
      }

      this.fd = fd;
      this.tmpPath = path;

      if (this.modeType === MODE_WRITE) {
        // In write mode, we don't need to fetch the old file, it will be
        // created or replaced.
        return openFd();
      }

      const tmp = fs.createWriteStream(path);

      // Try to download the file, this will allow reading and modification.
      this.sffs.rest.download(this.path)
        .on('end', () => {
          return openFd();
        })
        .pipe(tmp);
    });
  }

  read(len, callback, offs) {
    const buffer = new Buffer(len);

    fs.read(this.fd, buffer, 0, len, offs, (e, read, buffer) => {
      if (e) {
        return callback(e);
      }

      // TODO: read (the number of bytes read) may differ from the requested
      // bytes. I am not sure when this might happen and how to handle it right
      // now. For now, let's fail.
      if (read != len) {
        const smallerBuffer = Buffer.concat([buffer], read);
        return callback(null, smallerBuffer);
      }

      callback(null, buffer);
    })

  }

  write(buffer, callback, offs) {
    fs.write(this.fd, buffer, 0, buffer.length, offs, (e, written, buffer) => {
      if (e) {
        return callback(e);
      }

      // TODO: written (the number of bytes written) may differ from the
      // requested bytes. I am not sure when this might happen and how to
      // handle it right now. For now, let's fail.
      if (written != buffer.length) {
        callback(new Error(
          `could not write all the bytes ${written} < ${buffer.length}`));
      }

      callback(null, buffer);
    });
  }

  close(callback) {
    const self = this;

    function closeTemp() {
        fs.close(self.fd, (e) => {
          if (e) {
            // An error closing the temp file is non-fatal, but should be
            // logged.
            logger.error(e);
          }
        });
    };

    // TODO: (optimization) Only upload if file was mutated.
    if (this.modeType !== MODE_READ) {
      // mode is write, so flush back to SmartFile.
      const rs = fs.createReadStream(this.tmpPath);

      rs.pipe(
        this.sffs.rest.upload(this.path, (e, r) => {
          if (e) {
            return callback(e);
          }

          rs.close();

          // We successfully flushed, free the temp file.
          closeTemp();
          callback(null);
        })
      );

    } else {
      // mode is read, so just free the temp file.
      closeTemp();
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
    return this.stat.apply(this, arguments);
  }

  unlink(path, callback) {
    this.rest.delete(path, callback);
  }

  mkdir(path, callback) {
    this.rest.mkdir(path, callback);
  }

  rmdir(path, callback) {
    this.rest.delete(path, callback);
  }

  copy(src, dst, callback) {
    this.rest.copy(src, dst, callback);
  }

  copyFile() {
    return this.copy.apply(this, arguments);
  }

  copyDir() {
    return this.copy.apply(this, arguments);
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
    // TODO: options is optional.
    // https://nodejs.org/api/fs.html#fs_fs_createwritestream_path_options
    return this.rest.upload(path);
  }

  open(path, flags, mode, callback) {
    // TODO: mode is optional.
    // https://nodejs.org/api/fs.html#fs_fs_open_path_flags_mode_callback
    let file, modeType;

    mode = mode || 'r';
    modeType = MODES[mode];

    try {
      switch(modeType) {
        /*
        Not currently any special handling for read or write.

        case MODE_READ:
        file = new FileReader(this, path, mode, callback);
        break;

        case MODE_WRITE:
        file = new FileWriter(this, path, mode, callback);
        break;
        */

        case MODE_READ:
        case MODE_WRITE:
        case MODE_ALLOWED:
        file = new FileProxy(this, path, mode, modeType, callback);
        break;

        default:
        throw new Error(`invalid mode type: ${mode} (${modeType})`);
        break;
      }
    } catch (e) {
      callback(e);
    }
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

    return file.read(length, callback, position);
  }

  readFile(path, options, callback) {
    // TODO: options is optional.
    // https://nodejs.org/api/fs.html#fs_fs_readfile_path_options_callback
  }

  write(fd, buffer, offset, length, position, callback) {
    // TODO: position
    // https://nodejs.org/api/fs.html#fs_fs_write_fd_buffer_offset_length_position_callback
    // https://nodejs.org/api/fs.html#fs_fs_write_fd_string_position_encoding_callback
    const file = this.fds[fd];

    if (!file) {
      return callback(new Error(`invalid fd ${fd}`));
    }

    file.write(buffer, callback, position);
  }

  writeFile(path, data, options, callback) {
    // TODO: options is optional.
    // https://nodejs.org/api/fs.html#fs_fs_writefile_file_data_options_callback
  }

  readdir(path, callback) {
    // https://nodejs.org/api/fs.html#fs_fs_readdir_path_options_callback
    // API arguments.
    const args = {
      children: true,
    };
    // What we yield via callbac,.
    const names = [];

    // Clear cache, only meant to be used for stat() calls following a
    // readdir().
    this.statCache = {};

    this.rest.info(path, (e, page) => {
      if (e) {
        return callback(e);
      }

      // Last page, call callback.
      if (page === null) {
        return callback(null, names);
      }

      // Buffer page of results.
      for (let i = 0; i < page.length; i++) {
        names.push(page[i].name);

        // cache stat information, most times stat() calls for everything we
        // list are imminent.
        this.statsCache[page[i].path] = page[i];
      }
    }, args);
  }

  readdirstats(path, callback) {
    // Like readdir() but yields full stat information.
    // API arguments.
    const args = {
      children: true,
    };
    // What we yield via callback.
    const infos = []

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
        return callback(null, infos);
      }

      // Buffer page of results.
      for (let i = 0; i < page.length; i++) {
        infos.push(page[i]);

        // Cache stat information, most times stat() calls for everything we
        // list are imminent.
        this.statsCache[page[i].path] = page[i];
      }
    }, args);
  }
}

module.exports = {
  FileSystem,
};
