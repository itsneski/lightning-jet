const {statSync} = require('fs');
const {execSync} = require('child_process');
const {withCommas} = require('../lnd-api/utils');
const constants = require('./constants');
const config = require('./config');
const path = require('path');

const priority = constants.channeldb.sizeThreshold;

global.channelDbFile = global.channelDbFile || config.channelDbPath;

// channel.db size
if (!global.channelDbFile) {
  const conf = config.macaroonPath;
  if (!conf) return console.error('macaroonPath is not defined in the config.json');
  const base = path.normalize(path.dirname(conf) + '/../../../');
  let cmd = 'find ' + base + ' -name channel.db';
  try {
    global.channelDbFile = execSync(cmd).toString().trim();
  } catch(error) {
    console.error('error locating channel.db:', error.toString());
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
      let msg = 'channel.db (BOLT database) was not found. It is likely that Jet does not have read acccess to the file, or that the file is located in a different directory. Consider locating the file manually and checking its size. For more info: https://plebnet.wiki/wiki/Compacting_Channel_DB';
      return { msg: msg, priority: priority.warning };
    }

    try {
      let stats = statSync(global.channelDbFile);
      let size = global.testChannelDbSize || Math.round(stats.size / Math.pow(10, 6));  // in mbs
      let str = (size >= 1000) ? withCommas(size) + ' gb' : size + ' mb';

      let msg;
      if (size > priority.urgent * 1000) {
        msg  = 'channel.db size ' + str + ' exceeds ' + priority.urgent + ' gb';
        msg += '\nyou must prune & compact ASAP: https://plebnet.wiki/wiki/Compacting_Channel_DB';
        return { msg: msg, priority: priority.urgent }
      } else if (size > priority.serious * 1000) {
        msg  = 'channel.db size ' + str + ' exceeds ' + priority.serious + ' gb';
        msg += '\nconsider pruning & compacting: https://plebnet.wiki/wiki/Compacting_Channel_DB';
        return { msg: msg, priority: priority.serious }
      } else if (size > priority.warning * 1000) {
        msg  = 'channel.db size ' + str + ' exceeds ' + priority.warning + ' gb';
        msg += '\nfamiliarize yourself with compacting & pruning procedure: https://plebnet.wiki/wiki/Compacting_Channel_DB';
        return { msg: msg, priority: priority.warning }
      } else {
        msg  = 'channel.db size ' + str + ' is within normal limits';
        return { msg: msg, priority: priority.normal }
      }
    } catch(error) {
      console.error('checkChannelDb:', error.toString());
    }
  }
}
