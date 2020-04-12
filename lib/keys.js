const { logger } = require('./rest/client');


class Keys {
  constructor(rest, username) {
    this.rest = rest;
    this.username = username;
  }

  get(name, callback) {
    const options = {
      method: 'get',
      uri: `/api/3/sshkeys/${this.username}/${name}`,
    };

    this.rest.requestJson(options, (e, r, json) => {
      if (e) {
        logger.error(e);
        callback(e);
        return;
      }

      callback(e, json);
    });
  }

  list(callback) {
    const options = {
      method: 'get',
      uri: `/api/3/sshkeys/${this.username}/`,
    };

    this.rest.requestJson(options, (e, r, json) => {
      if (e) {
        logger.error(e);
        callback(e);
        return;
      }

      callback(e, json);
    });
  }

  delete(name, callback) {
    const options = {
      method: 'delete',
      uri: `/api/3/sshkeys/${this.username}/${name}`,
    };

    this.rest.request(options, (e) => {
      if (e) {
        callback(e);
        return;
      }

      callback();
    }).end();
  }

  add(obj, callback) {
    const options = {
      method: 'post',
      uri: `/api/3/sshkeys/${this.username}/`,
      json: obj,
    };

    this.rest.requestJson(options, (e, r, json) => {
      if (e) {
        logger.error(e);
        callback(e);
        return;
      }

      callback(e, json);
    });
  }

  update(name, obj, callback) {
    const options = {
      method: 'patch',
      uri: `/api/3/sshkeys/${this.username}/${name}`,
      json: obj,
    };

    this.rest.requestJson(options, (e, r, json) => {
      if (e) {
        logger.error(e);
        callback(e);
        return;
      }

      callback(e, json);
    });
  }
}


module.exports = {
  Keys,
};
