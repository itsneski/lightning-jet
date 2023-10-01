const {statSync} = require('fs');
const {execSync} = require('child_process');
const {withCommas} = require('../lnd-api/utils');
const constants = require('./constants');
const config = require('./config');
const path = require('path');
const logger = require('./logger');

const priority = constants.channeldb.sizeThreshold;

global.channelDbFile = global.channelDbFile || config.channelDbPath;

// channel.db size
if (!global.channelDbFile) {
  const conf = config.macaroonPath;
  if (!conf) return logger.error('macaroonPath is not defined in the config.json');
  const base = path.normalize(path.dirname(conf) + '/../../../');
  let cmd = 'find ' + base + ' -name channel.db 2> /dev/null';
  try {
    global.channelDbFile = execSync(cmd).toString().trim();
  } catch(error) {
    logger.error('error locating channel.db:', error.toString());
  }
}

module.exports = {
  getPath() {
    return global.channelDbFile;
  },
  printCheckSize() {
    let res = module.exports.checkSize();
    if (res.priority === priority.urgent) {
      console.error(constants.colorRed, res.msg);
    } else if (res.priority === priority.serious) {
      console.error(constants.colorYellow, res.msg);
    } else if (res.priority === priority.warning) {
      console.error(res.msg);
    } else {
      console.log(res.msg);
    }
  },
  checkSize() {
    if (!global.channelDbFile) {
      let msg = 'channel.db (BOLT database) was not found. It\'s likely Jet does not have read access to the channel.db file, or the file is located elsewhere (perhaps remotely). Consider locating the file manually to monitor its size. For more info: https://plebnet.wiki/wiki/Compacting_Channel_DB';
      return { msg: msg, priority: priority.warning, error: 'not found' };
    }

    try {
      const stats = statSync(global.channelDbFile);
      const size = global.testChannelDbSize || Math.round(stats.size / Math.pow(10, 6));  // in mbs
      const str = (size >= 1000) ? withCommas(size) + ' gb' : size + ' mb';

      let msg;
      if (size > priority.urgent * 1000) {
        msg  = 'channel.db size ' + str + ' exceeds ' + priority.urgent + ' gb';
        msg += '\nyou must prune & compact ASAP: https://plebnet.wiki/wiki/Compacting_Channel_DB';
        return { msg: msg, priority: priority.urgent, size: size }
      } else if (size > priority.serious * 1000) {
        msg  = 'channel.db size ' + str + ' exceeds ' + priority.serious + ' gb';
        msg += '\nconsider pruning & compacting: https://plebnet.wiki/wiki/Compacting_Channel_DB';
        return { msg: msg, priority: priority.serious, size: size }
      } else if (size > priority.warning * 1000) {
        msg  = 'channel.db size ' + str + ' exceeds ' + priority.warning + ' gb';
        msg += '\nfamiliarize yourself with compacting & pruning procedure: https://plebnet.wiki/wiki/Compacting_Channel_DB';
        return { msg: msg, priority: priority.warning, size: size }
      } else {
        msg  = 'channel.db size ' + str + ' is within normal limits';
        return { msg: msg, priority: priority.normal, size: size }
      }
    } catch(error) {
      logger.error(error.toString());
    }
  }
}
