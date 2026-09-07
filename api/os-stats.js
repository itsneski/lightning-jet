const logger = require('./logger');
const constants = require('./constants');
const deasync = require('deasync');

module.exports = {
  getStats() {
    try {
      const stats = osStats();
      return stats;
    } catch(err) {
      logger.error(err.message);
    }
  },
  checkStats() {
    const stats = module.exports.getStats();
    if (!stats) return;
    let issues = [];
    if (stats.mem >= 95) issues.push({
      cat: constants.osStats.issues.cat.mem,
      pri: constants.osStats.issues.pri.critical,
      msg: '[CRITICAL] memory utilization exceeds ' + stats.mem + ' %' })
    else if (stats.mem >= 90) issues.push({
      cat: constants.osStats.issues.cat.mem,
      pri: constants.osStats.issues.pri.serious,
      msg: '[SERIOUS] memory utilization exceeds ' + stats.mem + ' %' })
    else if (stats.mem >= 85) issues.push({
      cat: constants.osStats.issues.cat.mem,
      pri: constants.osStats.issues.pri.warning,
      msg: '[WARNING] memory utilization exceeds ' + stats.mem + ' %' })
    if (issues.length > 0) return issues;
  }
}

// resolve a promise synchronously, rethrowing a rejection on this stack.
// the rejection handler is not optional: without it a failing stat call (drive
// .free() shells out to df and can fail on unusual mounts or in a container)
// escapes as an unhandled rejection and takes the worker service down. it never
// reaches osStatsLoop's try/catch, because that catch only sees synchronous
// throws.
function awaitSync(promise) {
  let done = false;
  let value, error;
  promise.then(v => { value = v }, e => { error = e }).finally(() => { done = true });
  deasync.loopWhile(() => !done);
  if (error) throw error;
  return value;
}

function osStats() {
  const osu = require('node-os-utils');
  let stats = {};

  const cpuInfo = awaitSync(osu.cpu.free());
  stats.cpu = Math.round(cpuInfo);

  const memInfo = awaitSync(osu.mem.info());
  stats.mem = 100 - Math.round(memInfo.freeMemPercentage);
  stats.memGb = Number((memInfo.freeMemMb) > 1000 ? (memInfo.freeMemMb / 1000).toFixed(1) : memInfo.freeMemMb);

  const driveInfo = awaitSync(osu.drive.free());
  stats.diskGb = Number(driveInfo.totalGb);
  stats.freeGb = Number(driveInfo.freeGb);

  return stats;
}
