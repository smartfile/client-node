
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


class FileSystem {
  constructor(rest) {
    this.rest = rest;
  }

  stat(path, callback) {
    this.rest.info(path, callback);
  }

  delete(path, callback) {
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

  move(src, dst, callback) {
    this.rest.move(src, dst, callback);
  }

  rename(src, dst, callback) {
    this.rest.rename(src, dst, callback);
  }

  open(path, mode, callback) {
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

  listdir(path, callback) {
    const args = {
      children: true,
    };

    this.rest.info(path, callback, args);
  }
}

class FileProxy {
  // An inefficient way to support all operations in any order by using a local
  // file. This class first downloads the remote file before allowing any
  // operations. Then when closed the file is uploaded.

  // Below are alternate classes optimized for uploading & downloading.

  constructor(sffs, path, mode, modeType, callback) {
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

    tmp.file({ detachDescriptor: true }, (e, path, fd) => {
      if (e) {
        return callback(e);
      }

      this.fd = fd;
      this.tmpPath = path;

      if (this.modeType === MODE_WRITE) {
        // In write mode, we don't need to fetch the old file, it will be
        // created or replaced.
        return callback(null, this);
      }

      const s = fs.createWriteStream(path);

      // Try to download the file, this will allow reading and modification.
      this.sffs.rest.download(this.path, (e, r) => {
        if (e) {
          return callback(e);
        }

        s.close();

        callback(null, this);
      }, s);
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

    if (this.modeType !== MODE_READ) {
      // mode is write, so flush back to SmartFile.
      const s = fs.createReadStream(this.tmpPath);

      this.sffs.rest.upload(this.path, (e, r) => {
        if (e) {
          return callback(e);
        }

        s.close();

        // We successfully flushed, free the temp file.
        closeTemp();

        callback(null);
      }, s);

    } else {
      // mode is read, so just free the temp file.
      closeTemp();
      callback(null);
    }
  }
}

module.exports = {
  FileSystem,
};
