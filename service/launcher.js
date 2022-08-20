// watchdog daemon; responsible for keeping rest
// of the services alive

const date = require('date-and-time');
const config = require('../api/config');
const constants = require('../api/constants');
const {isRunning} = require('./utils');
const {isConfigured} = require('./utils');
const {isDisabled} = require('./utils');
const {startService} = require('./utils');
const {restartService} = require('./utils');
const {Rebalancer} = require('./utils');
const {HtlcLogger} = require('./utils');
const {TelegramBot} = require('./utils');
const {Worker} = require('./utils');
const {getPropAndDateSync} = require('../db/utils');
const {deleteProp} = require('../db/utils');

const loopInterval = 1;  // mins


function runLoop() {
  try {
    runLoopExec();
  } catch(error) {
    console.error('runLoop:', error.toString());
  }
}

function runLoopExec() {
  const pref = 'runLoopExec:';
  console.log('\n' + date.format(new Date, 'MM/DD hh:mm:ss A'));

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
  } else if (isDisabled(Rebalancer.name)) {
    console.log(`${Rebalancer.name} is disabled`)
  } else {
    console.log(`starting ${Rebalancer.name} ...`);
    startService(Rebalancer.name);
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

  // check that the logger service isn't stuck
  let prop = getPropAndDateSync(constants.services.logger.errorProp);
  if (prop) {
    console.error('detected an error in the logger service:', prop.val);
    console.log('attempting to restart');
    restartService(HtlcLogger.name);
    deleteProp(constants.services.logger.errorProp);
  }

  // worker
  if (isRunning(Worker.name)) {
    console.log(`${Worker.name} is already running`);
  } else {
    console.log(`starting ${Worker.name} ...`);
    startService(Worker.name);
  }
}

setInterval(runLoop, loopInterval * 60 * 1000);
runLoop();
