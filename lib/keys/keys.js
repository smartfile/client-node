const { logger } = require('../rest/client');


class Keys {
  constructor(rest, username) {
    this.rest = rest;
    this.username = username;
  }

  get(callback) {
    const options = {
      method: 'get',
      uri: `/api/3/sshkeys/${this.username}/`,
    };

    this.rest.requestJSON(options, (e, r, json) => {
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
      uri: `/api/3/sshkeys/${this.username}/${name}/`,
    };

    this.rest.request(options, (res) => {
      if (res.statusCode !== 204) {
        callback(new Error(res.statusMessage));
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

    this.rest.requestJSON(options, (e, r, json) => {
      if (e) {
        logger.error(e);
        callback(e);
        return;
      }

      callback(e, json);
    });
  }

  update(obj, callback) {
    const options = {
      method: 'post',
      uri: `/api/3/sshkeys/${this.username}/${obj.name}/`,
      json: obj,
    };

    this.rest.requestJSON(options, (e, r, json) => {
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
