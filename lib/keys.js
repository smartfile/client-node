const crypto = require('crypto');


class Keys {
  constructor(rest, username) {
    this.rest = rest;
    this.username = username;
    this.keyCache = {};
  }

  get(name, callback, _options) {
    if (this.keyCache[name]) {
      // Satisfy from cache.
      callback(null, this.keyCache[name]);
      delete this.keyCache[name];
      return;
    }

    let options = {
      method: 'get',
      uri: `/api/3/sshkeys/${this.username}/${name}`,
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.rest.requestJson(options, (e, r, json) => {
      if (e) {
        this.rest.logger.error(e);
      }

      if (callback) {
        callback(e, json);
      }
    });
  }

  list(callback, _options) {
    let options = {
      method: 'get',
      uri: `/api/3/sshkeys/${this.username}/`,
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.rest.requestJson(options, (e, r, json) => {
      if (e) {
        this.rest.logger.error(e);
      } else {
        // Refill the cache.
        json.forEach((key) => {
          this.keyCache[key.name] = key;
        });
      }

      if (callback) {
        callback(e, json);
      }
    });
  }

  delete(name, callback, _options) {
    let options = {
      method: 'delete',
      uri: `/api/3/sshkeys/${this.username}/${name}`,
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.rest.request(options, (e) => {
      delete this.keyCache[name];

      if (callback) {
        callback(e);
      }
    }).end();
  }

  save(obj, callback, _options) {
    let options = {
      method: 'put',
      uri: `/api/3/sshkeys/${this.username}/${obj.name}`,
      json: obj,
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.rest.requestJson(options, (e, r, json) => {
      if (e) {
        this.rest.logger.error(e);
      } else {
        // Update the cache
        this.keyCache[json.name] = json;
      }

      if (callback) {
        callback(e, json);
      }
    });
  }

  update(name, obj, callback, _options) {
    let options = {
      method: 'patch',
      uri: `/api/3/sshkeys/${this.username}/${name}`,
      json: obj,
    };

    if (_options) {
      options = { ..._options, ...options };
    }

    this.rest.requestJson(options, (e, r, json) => {
      if (e) {
        this.rest.logger.error(e);
        delete this.keyCache[name];
      } else {
        // Update the cache
        this.keyCache[json.name] = json;
      }

      if (callback) {
        callback(e, json);
      }
    });
  }

  find(givenKey, callback, _options) {
    this.list((e, keys) => {
      if (e) {
        if (callback) callback(e);
        return;
      }

      for (let i = 0; i < keys.length; i++) {
        const [algo, b64Key] = keys[i].key.split(' ');
        const currKey = Buffer.from(b64Key, 'base64');

        if (givenKey.algo === algo
            && givenKey.data.length === currKey.length
            && crypto.timingSafeEqual(currKey, givenKey.data)) {
          callback(null, keys[i]);
          return;
        }
      }

      callback(null, null);
    }, _options);
  }
}


module.exports = {
  Keys,
};
