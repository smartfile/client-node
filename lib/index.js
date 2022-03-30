const prom = require('prom-client');
const {
  Client, BasicClient, metrics: restMetrics,
} = require('./rest');
const { FileSystem, metrics: fsMetrics } = require('./fs');
const { Keys } = require('./keys');


const metrics = prom.Registry.merge([restMetrics, fsMetrics]);

module.exports = {
  Client,
  BasicClient,
  FileSystem,
  Keys,
  metrics,
};
