
const fs = require('fs');
const tmp = require('tmp');
const logger = require('winston');


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

  open(path, mode, callback) {
    let file;

    // TODO: There are lots of modes we should probably support. For example
    // any mixed modes such as appending are not possible. SFTP can represent
    // the following modes:
    //
    try {
      if (mode === 'r' || mode === 'w') {
        file = new File(this, path, mode, callback);

      } else {
        throw new Error(`invalid mode: ${mode}`);
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

class File {
  constructor(sffs, path, mode, callback) {
    this.sffs = sffs;
    this.path = path;
    this.mode = mode;
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

      const s = fs.createWriteStream(path);

      // Try to download the file, this will allow reading and modiciation.
      this.sffs.rest.download(this.path, (e, r) => {
        if (e) {
          // If we can't download the file, as long as we are in write mode, go
          // ahead. In this case, we will simply create a blank temp file.
          if (mode !== 'w' || r.statusCode !== 404) {
            return callback(e);
          }
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
        const e = new Error('could not read all the bytes');
        callback(e);
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
        const e = new Error('could not write all the bytes');
        callback(e);
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

    if (this.mode === 'w') {
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
    }
  }
}

module.exports = {
  FileSystem,
};
