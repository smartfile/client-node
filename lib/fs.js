
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
        file = FileReader(this, path, mode);
      } else if (mode === 'w') {
        file = FileWriter(this, path, mode);
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
    this.api.upload(this.path, data, callback, options);
  }

  read(size, callback, pos) {
    throw new Error('not implemented');
  }
}


class FileReader extends File {
  constructor(rest, path, mode) {
    super(rest, path, mode);

    // We need to download the file from the API to a temporary file. Then we
    // can satisfy reads() from that.
    this.downloadError = null;
    this.downloadDone = false;
    this.downloadSize = 0;

    this.startDownload();
  }

  startDownload() {
    this.rest.download(this.path, callback, options);
  }

  close(callback) {
  }
}


class FileWriter extends File {
  constructor(rest, path, mode) {
    super(rest, path, mode);

    // Open a temp file for reading. On close, flush it to the API.
  }
}

module.exports = {
  FileSystem,
};
