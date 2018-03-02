"use strict";

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
        // TODO: validate mode and ensure file / directory exist using API.
        try {
            let file = new File(this, path, mode);
            callback(null, file);
        } catch (e) {
            callback(e);
        }
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

    write(data, callback, pos) {
        if (pos === undefined) {
            pos = this.cursor;
        }

        // TODO: not sure if API even supports this.
        options = {
            headers: {
                'Range': pos
            }
        }

        this.api.upload(this.path, data, callback, options);
    }

    read(size, callback, pos) {
        if (pos === undefined) {
            pos = this.cursor;
        }

        // TODO: not sure if API even supports this.
        options = {
            headers: {
                'Range': pos
            }
        }

        this.api.download(this.path, callback, options);
    }

    close() {
        // Release any resources for the open file.
        callback(null);
    }
}
