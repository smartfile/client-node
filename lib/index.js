const prom = require('prom-client');
const {
  Client, BasicClient, logger, metrics: restMetrics,
} = require('./rest');
const { FileSystem, metrics: fsMetrics } = require('./fs');


const metrics = prom.Registry.merge([restMetrics, fsMetrics]);

module.exports = {
  Client,
  BasicClient,
  FileSystem,
  logger,
  metrics,
};
