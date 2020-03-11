const { Client } = require('./lib/rest/client');
const { BasicClient } = require('./lib/rest/basic');
const fs = require('./lib/fs/filesystem');

module.exports = {
  Client,
  BasicClient,
  fs,
};
