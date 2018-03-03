
class FileSystem {
  constructor(rest) {
    this.rest = rest;
  }

  touch(path, callback) {

  }

  stat(path, callback) {

  }

  delete(path, callback) {

  }

  mkdir(path, callback) {

  }

  rmdir(path, callback) {

  }

  open(path, mode, callback) {
    let file;

    try {
      if (mode === 'r') {
        file = new FileReader(this, path, mode);
      } else if (mode === 'w') {
        file = new FileWriter(this, path, mode);
      } else {
        throw new Error(`invalid mode: ${mode}`);
      }
    } catch (e) {
      callback(e);
    }

    callback(null, file);
  }

  listdir(path, callback) {
    // TODO: get names, use paging, invoke callback for each page of
    // results. Last page should pass third parameter (done == true);
    callback(null, names_page_one, false);
    callback(null, names_page_two, false);
    callback(null, names_page_three, true);
  }

  listdirinfo(path, callback) {
    // TODO: same as listdir (but provides full stat information.)
  }
}

class File {
  constructor(rest, path, mode) {
    this.rest = rest;
    this.path = path;
    this.mode = mode;
    this.cursor = 0;
  }

  seek(pos, whence) {
    if (whence === undefined) {
      whence = 0;
    }

    switch (whence) {
      case 0:
        this.cursor = pos;
        break;

      case 1:
        this.cursor += pos;
        break;

      case -1:
        this.cursor = this.size - pos;
        break;

      default:
        throw new Error(`invalid whence ${whence}`);
        break;
    }
  }

  write() {
    throw new Error('not implemented');
  }

  read() {
    throw new Error('not implemented');
  }
}


class FileReader extends File {
  constructor(rest, path, mode) {
    super(rest, path, mode);

    // Open a temp file, and download the remote file into it. As reads are
    // requested, we will satisfy them from that file. If the file is still
    // downloading, and too small to satisfy the read, we will retry via
    // setTimeout() a number of times before failing out.
    this.tempFile = null;
    this.tempDone = false;

    this.rest.download(this.path, (e, r) => {
      // Even in case of an error, we just mark the temp file as being done
      // downloading. Reads that the partial file can't satisfy will fail.
      this.tempDone = true;
    }, this.tempFile);
  }

  read(len, callback, offs) {
    let size = this.tempFile.getSize();

  }

  close(callback) {
    // TODO: close / remove temp file.
    callback();
  }
}


class FileWriter extends File {
  constructor(rest, path, mode) {
    super(rest, path, mode);

    // Open a temp file for reading. On close, flush it to the API.
    this.tempFile = null;
  }

  write(data, callback, offs) {

  }

  close(callback) {
    this.rest.upload(this.path, callback, this.tempFile);
  }
}

module.exports = {
  FileSystem,
};
