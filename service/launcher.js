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
const {sendTelegramMessageTimed} = require('../api/utils');

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
  console.log(date.format(new Date, 'MM/DD hh:mm A'));

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
      console.error('the telegram bot is not yet configured, cant start the service.', constants.telegramBotHelpPage);
    }
  }

  // check that the auto rebalancer isnt stuck
  if (isRunning(Rebalancer.name)) {
    let hb = Rebalancer.lastHeartbeat();
    const rbInterval = constants.services.rebalancer.loopInterval;
    let msg = Rebalancer.name + ':';
    if (!hb) {
      msg += ' heartbeat hasnt yet been generated, skipping the check';
      console.log(constants.colorYellow, msg);
    } else if (Date.now() - hb > 2 * rbInterval * 1000) {
      msg += ' detected a big time gap since last heartbeat, its likely that the service is down. attempting to restart';
      console.error(constants.colorRed, '\n' + msg);

      // notify via telegram
      const {sendMessage} = require('../api/telegram');
      sendMessage(msg);

      // restarting rebalancer
      console.log(`restarting ${Rebalancer.name} ...`);
      restartService(Rebalancer.name);
    }
  }

  // check that the telegram service isnt stuck
  if (isRunning(TelegramBot.name)) {
    let hbFees = TelegramBot.lastHeartbeat('fees');
    let hbPoll = TelegramBot.lastHeartbeat('poll');
    const feeInterval = constants.services.telegram.feeInterval;
    const pollInterval = constants.services.telegram.pollInterval;

    let msg = TelegramBot.name + ':';
    if (!hbFees || !hbPoll) {
      msg += ' heartbeat has not yet been generated, skipping the check';
      console.log(constants.colorYellow, msg);
    } else if (Date.now() - hbFees > 2 * feeInterval * 1000) {
      msg += ' detected a big time gap since the last fees heartbeat, its likely that the service is down. attempting to restart';
      console.error(constants.colorRed, msg);

      // notify via telegram
      const {sendMessage} = require('../api/telegram');
      sendMessage(msg);

      // restarting telegram
      console.log(`restarting ${TelegramBot.name} ...`);
      restartService(TelegramBot.name);
    } else if (Date.now() - hbPoll > 2 * pollInterval * 1000) {
      msg += ' detected a big time gap since the last poll heartbeat, its likely that the service is down. attempting to restart';
      console.error(constants.colorRed, msg);

      // notify via telegram
      const {sendMessage} = require('../api/telegram');
      sendMessage(msg);

      // restarting telegram
      console.log(`restarting ${TelegramBot.name} ...`);
      restartService(TelegramBot.name);
    }
  }

  // check channel db size
  const {checkSize} = require('../api/channeldb');
  const priority = constants.channeldb.sizeThreshold;
  const telegramNotify = constants.channeldb.telegramNotify;

  let res = checkSize();
  if (res.priority === priority.urgent) {
    console.error(constants.colorRed, res.msg);
    sendTelegramMessageTimed(res.msg, telegramNotify.category, telegramNotify.urgent);
  } else if (res.priority === priority.serious) {
    console.error(constants.colorYellow, res.msg);
    sendTelegramMessageTimed(res.msg, telegramNotify.category, telegramNotify.serious);
  } else if (res.priority === priority.warning) {
    console.error(res.msg);
    sendTelegramMessageTimed(res.msg, telegramNotify.category, telegramNotify.warning);
  }
}

runLoop();
setInterval(runLoop, loopInterval * 60 * 1000);
setInterval(bosReconnect, bosReconnectInterval * 60 * 1000);
setInterval(cleanDb, cleanDbInterval * 60 * 60 * 1000);
