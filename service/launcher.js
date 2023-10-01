// watchdog daemon; responsible for keeping rest
// of the services alive

const date = require('date-and-time');
const config = require('../api/config');
const constants = require('../api/constants');
const logger = require('../api/logger')
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

const loopInterval = constants.services.launcher.loopInterval;  // mins

var loopRunning = false;
function runLoop() {
  const pref = 'runLoop:';
  if (loopRunning) return logger.warn('already running, skip');
  try {
    loopRunning = true;
    runLoopExec();
  } catch(error) {
    logger.error(error.toString());
  } finally {
    loopRunning = false;  // assumes that runLoopExec is sync
  }
}

function runLoopExec() {
  const pref = 'runLoopExec:';

  // telegram
  let startedTelegram;
  if (isRunning(TelegramBot.name)) {
    // already running
  } else {
    if (isConfigured(TelegramBot.name)) {
      logger.log(`starting ${TelegramBot.name}`);
      startService(TelegramBot.name);
      startedTelegram = true;
    } else {
      logger.error('the telegram bot is not yet configured, cant start the service.', constants.telegramBotHelpPage);
    }
  }

  // htlc logger
  let startedLogger;
  if (isRunning(HtlcLogger.name)) {
    // already running
  } else {
    logger.log(`starting ${HtlcLogger.name}`);
    startService(HtlcLogger.name);
    startedLogger = true;
  }

  // rebalancer
  let startedRebalancer;
  if (isRunning(Rebalancer.name)) {
    // already running
  } else if (isDisabled(Rebalancer.name)) {
    logger.log(`${Rebalancer.name} is disabled`)
  } else {
    logger.log(`starting ${Rebalancer.name}`);
    startService(Rebalancer.name);
    startedRebalancer = true;
  }

  // check that the rebalancer isnt stuck
  if (!startedRebalancer && isRunning(Rebalancer.name)) {
    let hb = Rebalancer.lastHeartbeat();
    const rbInterval = constants.services.rebalancer.loopInterval;
    let msg = Rebalancer.name + ':';
    if (!hb) {
      msg += ' heartbeat hasnt yet been generated, skipping the check';
      logger.log(msg);
    } else if (Date.now() - hb > 2 * rbInterval * 1000) {
      msg += ' detected a big time gap since last heartbeat, its likely that the service is down. attempting to restart';
      logger.error(msg);

      // notify via telegram
      const {sendMessage} = require('../api/telegram');
      sendMessage(msg);

      // restarting rebalancer
      logger.log(`restarting ${Rebalancer.name}`);
      restartService(Rebalancer.name);
    }
  }

  // check that the telegram service isnt stuck
  if (!startedTelegram && isRunning(TelegramBot.name)) {
    let hbFees = TelegramBot.lastHeartbeat('fees');
    let hbPoll = TelegramBot.lastHeartbeat('poll');
    const feeInterval = constants.services.telegram.feeInterval;
    const pollInterval = constants.services.telegram.pollInterval;

    let msg = TelegramBot.name + ':';
    if (!hbFees || !hbPoll) {
      msg += ' heartbeat has not yet been generated, skipping the check';
      logger.log(msg);
    } else if (Date.now() - hbFees > 2 * feeInterval * 1000) {
      msg += ' detected a big time gap since the last fees heartbeat, its likely that the service is down. attempting to restart';
      logger.error(msg);

      // notify via telegram
      const {sendMessage} = require('../api/telegram');
      sendMessage(msg);

      // restarting telegram
      logger.log(`restarting ${TelegramBot.name}`);
      restartService(TelegramBot.name);
    } else if (Date.now() - hbPoll > 2 * pollInterval * 1000) {
      msg += ' detected a big time gap since the last poll heartbeat, its likely that the service is down. attempting to restart';
      logger.error(msg);

      // notify via telegram
      const {sendMessage} = require('../api/telegram');
      sendMessage(msg);

      // restarting telegram
      logger.log(`restarting ${TelegramBot.name}`);
      restartService(TelegramBot.name);
    }
  }

  // check that the logger service isn't stuck
  if (!startedLogger) {
    let prop = getPropAndDateSync(constants.services.logger.errorProp);
    if (prop) {
      logger.error('detected an error in the logger service:', prop.val);
      logger.log('attempting to restart');
      restartService(HtlcLogger.name);
      deleteProp(constants.services.logger.errorProp);
    }
  }

  // worker
  let startedWorker;
  if (isRunning(Worker.name)) {
    // already running
  } else {
    logger.log(`starting ${Worker.name}`);
    startService(Worker.name);
    startedWorker = true;
  }

  // check that the worker isn't stuck
  if (!startedWorker && isRunning(Worker.name)) {
    let hb = Worker.lastHeartbeat();
    const wkInterval = constants.services.worker.loopInterval;
    let msg = Worker.name + ':';
    if (!hb) {
      msg += ' heartbeat hasnt yet been generated, skipping the check';
      logger.log(msg);
    } else if (Date.now() - hb > 2 * wkInterval * 60 * 1000) {
      msg += ' detected a big time gap since last heartbeat, its likely that the service is down. attempting to restart';
      logger.error(msg);

      // notify via telegram
      const {sendMessage} = require('../api/telegram');
      sendMessage(msg);

      // restarting worker
      logger.log(`restarting ${Worker.name}`);
      restartService(Worker.name);
    }
  }
}

setInterval(runLoop, loopInterval * 60 * 1000);
runLoop();
