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
    else if (stats.mem >= 80) issues.push({
      cat: constants.osStats.issues.cat.mem,
      pri: constants.osStats.issues.pri.serious,
      msg: '[WARNING] memory utilization exceeds ' + stats.mem + ' %' })
    if (issues.length > 0) return issues;
  }
}

function osStats() {
  const osu = require('node-os-utils');
  const cpu = osu.cpu;
  const mem = osu.mem;
  const drive = osu.drive;
  let stats = {};
  let done = false;
  cpu.free().then(info => {
    stats.cpu = Math.round(info);
    done = true;
  })
  deasync.loopWhile(() => !done);
  done = false;
  mem.info().then(info => {
    stats.mem = 100 - Math.round(info.freeMemPercentage);
    stats.memGb = Number((info.freeMemMb) > 1000 ? (info.freeMemMb / 1000).toFixed(1) : info.freeMemMb);
    done = true;
  })
  deasync.loopWhile(() => !done);
  done = false;
  drive.free().then(info => {
    stats.diskGb = Number(info.totalGb);
    stats.freeGb = Number(info.freeGb);
    done = true;
  })
  deasync.loopWhile(() => !done);
  return stats;
}
