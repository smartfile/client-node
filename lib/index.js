const {
  Client, BasicClient, logger, normPath, encodePath,
} = require('./rest');
const { FileSystem } = require('./fs');

module.exports = {
  Client,
  BasicClient,
  FileSystem,
  normPath,
  encodePath,
  logger,
};
