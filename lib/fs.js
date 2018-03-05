
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
    let args = {
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

      this.sffs.rest.download(this.path, (e, r) => {
        if (e) {
          // When writing (possibly creating) if the file is missing, continue
          // with a new empty temp file.
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

      callback(null, buffer);
    })

  }

  write(buffer, callback, offs) {
    fs.write(this.fd, buffer, 0, buffer.length, offs, (e, written, buffer) => {
      if (e) {
        return callback(e);
      }

      callback(null, buffer);
    });
  }

  close(callback) {
    const self = this;

    function closeTemp() {
        // We ignore this error, the operation from the caller's point of view
        // was a success. This error means we will be leaking temp files. We
        // should log this error and move on.
        fs.close(self.fd, (e) => {
          if (e) {
            logger.error(e);
          }
        });
    };

    if (this.mode === 'w') {
      const s = fs.createReadStream(this.tmpPath);

      this.sffs.rest.upload(this.path, (e, r) => {
        if (e) {
          return callback(e);
        }

        s.close();

        closeTemp();

        callback(null);
      }, s);

    } else {
      closeTemp();
    }
  }
}

module.exports = {
  FileSystem,
};
