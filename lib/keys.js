const { logger } = require('./rest/client');


class Keys {
  constructor(rest, username) {
    this.rest = rest;
    this.username = username;
    this.keyCache = null;
  }

  get(name, callback) {
    if (this.keyCache && this.keyCache[name]) {
      // Satisfy from cache.
      callback(null, this.keyCache[name]);
      return;
    }

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

      // Update the cache.
      if (this.keyCache === null) this.keyCache = {};
      this.keyCache[json.name] = json;

      if (callback) callback(e, json);
    });
  }

  list(callback) {
    // Satisfy from cache.
    if (this.keyCache !== null) {
      callback(null, Object.values(this.keyCache));
      return;
    }

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

      // Refill the cache.
      this.keyCache = {};
      json.forEach((key) => {
        this.keyCache[key.name] = key;
      });

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

      // Update the cache
      if (this.keyCache !== null) delete this.keyCache[name];

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

      // Update the cache
      if (this.keyCache === null) this.keyCache = {};
      this.keyCache[json.name] = json;

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

      // Update the cache
      if (this.keyCache === null) this.keyCache = {};
      this.keyCache[json.name] = json;

      if (callback) callback(e, json);
    });
  }
}


module.exports = {
  Keys,
};
