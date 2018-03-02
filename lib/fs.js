"use strict";

class SmartFileFS {
    constructor(rest) {
        this.rest = rest;
    }

    stat(path, callback) {

    }

    delete(path, callback) {

    }

    mkdir(path, callback) {

    }

    open(path, mode, callback) {
        // TODO: validate mode and ensure file / directory exist using API.
        try {
            let file = SmartFileFile(this, path, mode);
            callback(null, file);
        } catch (e) {
            callback(e);
        }
    }
}

class SmartFileFile {
    constructor(rest, path, mode) {
        this.rest = rest;
        this.path = path;
        this.mode = mode;
        this.cursor = 0;
    }

    seek(pos, whence) {
        if (whence == undefined) {
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
        }
    }

    write(data, pos) {
        if (pos === undefined) {
            pos = this.cursor;
        }

        this.api.upload(this.path, data);
    }

    read(size) {
        this.api.download(this.path);
    }

    close() {
        // Release any resources for the open file.
    }
}
