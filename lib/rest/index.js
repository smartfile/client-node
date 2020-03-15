const {
  Client, logger, metrics,
} = require('./client');
const { BasicClient } = require('./basic');

module.exports = {
  Client,
  BasicClient,
  logger,
  metrics,
};
