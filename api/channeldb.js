const {statSync} = require('fs');
const {execSync} = require('child_process');
const {withCommas} = require('../lnd-api/utils');
const constants = require('./constants');
const config = require('./config');

const priority = constants.channeldb.sizeThreshold;

// channel.db size
if (!global.channelDbFile) {
  const conf = config.macaroonPath;
  if (!conf) return console.error('macaroonPath is not defined in the config.json');
  let i = conf.indexOf('lnd');
  if (i <= 0) return console.error('couldnt local lnd in the macaroonPath');
  let base = conf.substring(0, i + 3);
  let cmd = 'find ' + base + ' -name channel.db';
  try {
    global.channelDbFile = execSync(cmd).toString().trim();
  } catch(error) {
    console.error('error locating channel.db:', error.toString());
  }
}

module.exports = {
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
    if (!global.channelDbFile) throw new Error('channel.db not found');

    try {
      let stats = statSync(global.channelDbFile);
      let size = Math.round(stats.size / Math.pow(10, 6));  // in mbs
      let str = (size >= 1000) ? withCommas(size) + ' gb' : size + ' mb';

      let msg;
      if (size > priority.urgent * 1000) {
        msg = 'channel.db size ' + str + ' exceeds ' + priority.urgent + ' gb';
        msg += '\nyou must prune & compact ASAP: https://plebnet.wiki/wiki/Compacting_Channel_DB';
        return { msg: msg, priority: priority.urgent }
      } else if (size > priority.serious * 1000) {
        msg = 'channel.db size ' + str + ' exceeds ' + priority.serious + ' gb';
        msg += '\nconsider pruning & compacting: https://plebnet.wiki/wiki/Compacting_Channel_DB';
        return { msg: msg, priority: priority.serious }
      } else if (size > priority.warning * 1000) {
        msg = 'channel.db size ' + str + ' exceeds ' + priority.serious + ' gb';
        msg += '\nfamiliarize yourself with compacting & pruning procedure: https://plebnet.wiki/wiki/Compacting_Channel_DB';
        return { msg: msg, priority: priority.warning }
      } else {
        msg = 'channel.db size ' + str + ' is within normal limits';
        return { msg: msg, priority: priority.normal }
      }
    } catch(error) {
      console.error('checkChannelDb:', error.toString());
    }
  }
}
