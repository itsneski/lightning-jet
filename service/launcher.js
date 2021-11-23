const date = require('date-and-time');
const config = require('../api/config');
const constants = require('../api/constants');
const {exec} = require('child_process');
const {isRunning} = require('./utils');
const {isConfigured} = require('./utils');
const {startService} = require('./utils');
const {restartService} = require('./utils');
const {Rebalancer} = require('./utils');
const {HtlcLogger} = require('./utils');
const {TelegramBot} = require('./utils');
const {readLastLineSync} = require('../api/utils');

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
  try {
    runLoopExec();
  } catch(error) {
    console.error('runLoop:', error.toString());
  }
}

function runLoopExec() {
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
    if (isConfigured(TelegramBot.name)) {
      console.log(`starting ${TelegramBot.name} ...`);
      startService(TelegramBot.name);
    } else {
      console.error('the telegram bot is not yet configured, can\'t start the service.', constants.telegramBotHelpPage);
    }
  }

  // check that the auto rebalancer isnt stuck
  let last = readLastLineSync(Rebalancer.log);
  if (last && last.toLowerCase().indexOf('error') >= 0) {
    console.error(constants.colorRed, '\ndetected an error in the rebalancer log file:', last);
    console.log('it is likely that the rebalancer is stuck, restarting.');

    // notify via telegram
    const {sendMessage} = require('../api/telegram');
    const msg = 'detected an error in the rebalancer log file. the rebalancer may be stuck. attempted to restart';
    sendMessage(msg);

    // restarting rebalancer
    console.log(`restarting ${Rebalancer.name} ...`);
    restartService(Rebalancer.name);
  }

  // check that the telegram service isnt stuck
  let last = readLastLineSync(TelegramBot.log);
  if (last && last.toLowerCase().indexOf('error') >= 0) {
    console.error(constants.colorRed, '\ndetected an error in the telegram service log file:', last);
    console.log('it is likely that the telegram service is stuck, restarting.');

    // notify via telegram even though the service may be down
    // this way the user will know what happened once the telegram is up
    const {sendMessage} = require('../api/telegram');
    const msg = 'detected an error in the telegram service log file. the rebalancer may be stuck. attempted to restart';
    sendMessage(msg);

    // restarting rebalancer
    console.log(`restarting ${TelegramBot.name} ...`);
    restartService(TelegramBot.name);
  }
}

runLoop();
setInterval(runLoop, loopInterval * 60 * 1000);
setInterval(bosReconnect, bosReconnectInterval * 60 * 1000);
setInterval(cleanDb, cleanDbInterval * 60 * 60 * 1000);
