const config = require('./config');
const constants = require('./constants');
const {recordTelegramMessageSync} = require('../db/utils');

module.exports = {
  sendMessage(msg) {
    recordTelegramMessageSync(msg);
  }
}
