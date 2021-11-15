const date = require('date-and-time');
const config = require('../api/config');
const constants = require('../api/constants');
const {exec} = require('child_process');
const {isRunning} = require('./utils');
const {startService} = require('./utils');
const {Rebalancer} = require('./utils');
const {HtlcLogger} = require('./utils');
const {TelegramBot} = require('./utils');

const loopInterval = 5;  // mins
const bosReconnectInterval = 60;  // mins
const cleanDbInterval = 24; // hours

function bosReconnect() {
  try {
    console.log('bos reconnect...');
    exec('bos reconnect');
  } catch (error) {
    console.error('error running bos reconnect:', error.toString());
  }
}

// get rid of useless records from the db
function cleanDb() {

}

function runLoop() {
  console.log();
  console.log(date.format(new Date, 'MM/DD hh:mm'));

  // htlc logger
  if (isRunning(HtlcLogger.name)) {
    console.log(`${HtlcLogger.name} is already running`)
  } else {
    console.log(`starting ${HtlcLogger.name} ...`);
    startService(HtlcLogger.name);
  }

  // rebalancer
  if (isRunning(Rebalancer.name)) {
    console.log(`${Rebalancer.name} is already running`)
  } else {
    console.log(`starting ${Rebalancer.name} ...`);
    startService(Rebalancer.name);
  }

  // telegram
  if (isRunning(TelegramBot.name)) {
    console.log(`${TelegramBot.name} is already running`)
  } else {
    if (config.telegramToken) {
      console.log(`starting ${TelegramBot.name} ...`);
      startService(TelegramBot.name);
    } else {
      console.error('the telegram bot is not yet configured, can\'t start the service.', constants.telegramBotHelpPage);
    }
  }
}

runLoop();
setInterval(runLoop, loopInterval * 60 * 1000);
setInterval(bosReconnect, bosReconnectInterval * 60 * 1000);
setInterval(cleanDb, cleanDbInterval * 60 * 60 * 1000);
