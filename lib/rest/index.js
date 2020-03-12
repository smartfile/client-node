const {
  Client, normPath, encodePath, logger,
} = require('./client');
const { BasicClient } = require('./basic');

module.exports = {
  Client,
  BasicClient,
  normPath,
  encodePath,
  logger,
};
