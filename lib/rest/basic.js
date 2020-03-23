const { Client } = require('./client');


class BasicClient extends Client {
  constructor(opts) {
    const options = { ...opts };
    let username;
    let password;

    if (!options.auth) {
      username = options.username || options.user || process.env.SMARTFILE_USER;
      password = options.password || options.pass || process.env.SMARTFILE_PASS;

      delete options.username;
      delete options.password;

      if (!username || !password) {
        throw new Error('username and password required for basic auth');
      }
    } else {
      username = options.auth.user || options.auth.username;
      password = options.auth.pass || options.auth.password;
    }

    options.auth = `${username}:${password}`;

    super(options);
  }
}

module.exports = {
  BasicClient,
};
