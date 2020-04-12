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
        if (callback) callback(e);
        return;
      }

      if (callback) callback(e, json);
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
        if (callback) callback(e);
        return;
      }

      if (callback) callback(e, json);
    });
  }

  delete(name, callback) {
    const options = {
      method: 'delete',
      uri: `/api/3/sshkeys/${this.username}/${name}`,
    };

    this.rest.request(options, (e) => {
      if (e) {
        if (callback) callback(e);
        return;
      }

      if (callback) callback();
    }).end();
  }

  save(obj, callback) {
    const options = {
      method: 'put',
      uri: `/api/3/sshkeys/${this.username}/${obj.name}`,
      json: obj,
    };

    this.rest.requestJson(options, (e, r, json) => {
      if (e) {
        logger.error(e);
        if (callback) callback(e);
        return;
      }

      if (callback) callback(e, json);
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
        if (callback) callback(e);
        return;
      }

      if (callback) callback(e, json);
    });
  }
}


module.exports = {
  Keys,
};
