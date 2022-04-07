const fs = require('fs');
const tmp = require('tmp');


// Three distinct ways to handle a file.
const ACCESS_READ = 0;
const ACCESS_WRITE = 1;
const ACCESS_ALLOWED = 2;

/* eslint-disable no-multi-spaces, quote-props */
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
/* eslint-enable no-multi-spaces, quote-props */


// Internal proxy class for random access reads / writes. Enables the
// FileSystem block API. Not for external consumption.
class FileProxy {
  // An inefficient way to support all operations in any order by using a local
  // file. This class first downloads the remote file before allowing any
  // operations. Then when closed the file is uploaded (with modifications).

  constructor(sffs, path, flags, accessType, callback, options) {
    this.sffs = sffs;
    this.path = path;
    this.flags = flags;
    this.accessType = accessType;
    this.options = options;
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
    };

    // Open a temp file to back the remote file.
    tmp.file({ detachDescriptor: true }, (tmpError, tmpPath, tmpFd) => {
      if (tmpError) {
        callback(tmpError);
        return;
      }

      this.tmpFd = tmpFd;
      this.tmpPath = tmpPath;

      // When reading, we fetch the existing file from API.
      if (this.accessType !== ACCESS_WRITE) {
        // open the path as a stream for downloading.
        const ws = fs.createWriteStream(this.tmpPath, {
          fd: this.tmpFd,
          start: 0,
          autoClose: false,
        });

        // Try to download the file, this will allow reading and modification.
        this.sffs.rest.download(this.path, (e, res) => {
          res
            // Download complete, because of autoClose (default: true), the
            // stream is closed, we can reopen the path for reading.
            .on('error', (downloadError) => {
              callback(downloadError);
            })
            .pipe(ws)
            .on('finish', () => openFd());
        }, this.options);
      // When writing, we don't need to fetch.
      } else {
        openFd();
      }
    });
  }

  read(buffer, offset, length, position, callback) {
    fs.read(this.tmpFd, buffer, offset, length, position, (e, bytesRead) => {
      if (e) {
        callback(e);
        return;
      }

      if (bytesRead !== length) {
        const smallerBuffer = Buffer.concat([buffer], bytesRead);
        callback(null, bytesRead, smallerBuffer);
        return;
      }

      callback(null, bytesRead, buffer);
    });
  }

  write(buffer, offset, length, position, callback) {
    fs.write(this.tmpFd, buffer, offset, length, position, (e, bytesWritten) => {
      if (e) {
        callback(e);
        return;
      }

      // TODO: bytesWritten may differ from the requested bytes. I am not sure
      // when this might happen and how to handle it right now. For now, let's
      // fail.
      if (bytesWritten !== buffer.length) {
        callback(new Error(
          `could not write all the bytes ${bytesWritten} < ${length}`
        ));
        return;
      }

      callback(null, bytesWritten, buffer);
    });
  }

  close(callback, abort) {
    const cleanup = () => {
      fs.close(this.tmpFd, (closeError) => {
        if (closeError) {
          this.sffs.rest.logger.error(closeError);
        }

        fs.unlink(this.tmpPath, (unlinkError) => {
          if (unlinkError) {
            this.sffs.rest.logger.error(unlinkError);
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

      this.sffs.rest.upload(this.path, rs, (e, json) => {
        cleanup();
        callback(e, json);
      }, this.options);
    } else {
      cleanup();
      callback(null);
    }
  }
}

module.exports = {
  FileProxy,
  ACCESS_READ,
  ACCESS_WRITE,
  ACCESS_ALLOWED,
  ACCESS_FLAGS,
};
