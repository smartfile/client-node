const { Client } = require('./client');

class BasicClient extends Client {
  constructor(opts) {
    const options = { ...opts };

    if (!options.auth) {
      const username = options.username || process.env.SMARTFILE_USER;
      const password = options.password || process.env.SMARTFILE_PASS;

      delete options.username;
      delete options.password;

      if (!username || !password) {
        throw new Error('username and password require for basic auth');
      }

      options.auth = {
        user: username,
        pass: password,
        sendImmediately: true,
      };
    }

    super(options);
  }
}

module.exports = {
  BasicClient,
};
