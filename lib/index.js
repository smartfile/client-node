const {
  Client, logger, normPath, encodePath,
} = require('./rest/client');
const { BasicClient } = require('./rest/basic');
const { FileSystem } = require('./fs/filesystem');

module.exports = {
  Client,
  BasicClient,
  FileSystem,
  normPath,
  encodePath,
  logger,
};
