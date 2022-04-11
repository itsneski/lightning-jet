const importLazy = require('import-lazy')(require);
const date = require('date-and-time');
const config = importLazy('../api/config');
const constants = require('../api/constants');
const lndClient = importLazy('../api/connect');
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
const {getPropAndDateSync} = require('../db/utils');
const {deleteProp} = require('../db/utils');
const {reconnect} = require('../bos/reconnect');
const {isLndAlive} = require('../lnd-api/utils');
const {inactiveChannels} = require('../api/list-channels');

const loopInterval = 5;  // mins
const bosReconnectInterval = 60;  // mins
const cleanDbInterval = 24; // hours
const lndPingInterval = 60; // seconds

var lndOffline;

function bosReconnect() {
  if (lndOffline) {
    console.log('lnd is offline, skipping peer reconnect');
    return;
  }

  const logger = {
    debug: (msg) => {
      console.log(msg);
    },
    info: (msg) => {
      console.log(msg);
    },
    warn: (msg) => {
      console.warn(msg);
    },
    error: (msg) => {
      console.error(msg);
    }
  }

  try {
    console.log('\n' + date.format(new Date, 'MM/DD hh:mm:ss A'), 'reconnecting peers');
    const res = reconnect(logger);
    res.catch((err) => {
      console.error('error during peer reconnect:', err);
    })
  } catch (error) {
    console.error('error launching peer reconnect:', error);
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

  // htlc logger & rebalancer need lnd, so it does not make
  // sense to attempt to start em
  if (lndOffline) {
    console.log('lnd is offline, skipping the loop');
    return;
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

  // check for inactive channels
  const inactive = inactiveChannels();
  if (inactive) {
    inactive.forEach(c => {
      // typical node maintenance shouldn't take longer than 60 minutes; notify if a node
      // is inactive for longer.
      if (c.mins >= 60) {   // mins
        const msg = 'channel ' + c.chan + ' with ' + (c.name || c.peer) + ' has been inactive for ' + c.mins + ' minutes';
        const cat = 'telegram.notify.channel.inactive';
        const int = 60 * 60;  // an hour
        console.log(msg);
        sendTelegramMessageTimed(msg, cat, int);
      }
    })
  }
}

function lndPingLoop() {
  try {
    lndPingLoopExec();
  } catch(err) {
    console.error('lndPingLoop:', err.message);
  }
}

function lndPingLoopExec() {
  const prop = 'lndOfflineTelegramNotify';
  const frequency = constants.services.launcher.lndTelegramNotify;
  let prev = lndOffline;
  try {
    lndOffline = !isLndAlive(lndClient);
  } catch(err) {
    console.error('error pinging lnd:', err.message, 'assuming lnd is offline');
    lndOffline = true;
  }
  if (lndOffline) {
    console.error(constants.colorRed, 'lnd is offline');
    sendTelegramMessageTimed('lnd is offline', prop, frequency);
  } else if (prev) {
    console.log(constants.colorGreen, 'lnd is back online');
  }
}

lndPingLoop();  // detect if lnd is offline
runLoop();
setInterval(runLoop, loopInterval * 60 * 1000);
setInterval(bosReconnect, bosReconnectInterval * 60 * 1000);
setInterval(cleanDb, cleanDbInterval * 60 * 60 * 1000);
setInterval(lndPingLoop, lndPingInterval * 1000);
