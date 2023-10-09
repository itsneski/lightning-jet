// worker daemon; populates db tables, periodic bos reconnect, etc.

const importLazy = require('import-lazy')(require);
const date = require('date-and-time');
const config = importLazy('../api/config');
const constants = require('../api/constants');
const logger = require('../api/logger');
const lndClient = importLazy('../api/connect');
const deasync = require('deasync');
const {setPropSync} = require('../db/utils');
const {getPropWithErrSync} = require('../db/utils');
const {recordTxn} = require('../db/utils');
const {reconnect} = require('../bos/reconnect');
const {isLndAlive} = importLazy('../lnd-api/utils');
const {sendTelegramMessageTimed} = require('../api/utils');
const {isRunningPidSync} = require('../api/utils');
const {inactiveChannels} = require('../api/list-channels');
const {listForwardsSync} = require('../lnd-api/utils');
const {listPaymentsSync} = require('../lnd-api/utils');
const {getInfoSync} = require('../lnd-api/utils');
const {listPeersSync} = require('../lnd-api/utils');
const serviceUtils = require('./utils');
const {sendMessage} = require('../api/telegram');

const loopInterval = constants.services.worker.loopInterval;  // mins
const bosReconnectInterval = 60;  // mins
const lndPingInterval = 60; // seconds
const cleanDbRebalancesInterval = 1;  // mins
const txnInterval = constants.services.launcher.txnInterval; // mins

const stringify = obj => JSON.stringify(obj, null, 2);

var lndOffline;

function bosReconnect() {
  if (lndOffline) {
    logger.log('lnd is offline, skipping peer reconnect');
    return;
  }

  const apiLogger = {
    debug: (msg) => {
      logger.log(msg);
    },
    info: (msg) => {
      logger.log(msg);
    },
    warn: (msg) => {
      logger.warn(msg);
    },
    error: (msg) => {
      logger.error(msg);
    }
  }

  try {
    logger.log('reconnecting peers');
    const res = reconnect(apiLogger);
    res.catch((err) => {
      logger.error('error during peer reconnect:', err);
    })
  } catch (error) {
    logger.error('error launching peer reconnect:', error);
  }
}

function runLoop() {
  try {
    runLoopExec();
  } catch(error) {
    logger.error(error.toString());
  }
}

function runLoopExec() {
  const pref = 'runLoopExec:';
  logger.log('running the loop');

  serviceUtils.Worker.recordHeartbeat(); // indicates that Worker isn't stuck

  if (lndOffline) {
    logger.warn('lnd is offline, skipping the loop');
    return;
  }

  // check channel db size
  const {checkSize} = require('../api/channeldb');
  const priority = constants.channeldb.sizeThreshold;
  const telegramNotify = constants.channeldb.telegramNotify;

  let res = checkSize();
  if (res.priority === priority.urgent) {
    logger.error(res.msg);
    sendTelegramMessageTimed(res.msg, telegramNotify.category, telegramNotify.urgent);
  } else if (res.priority === priority.serious) {
    logger.error(res.msg);
    sendTelegramMessageTimed(res.msg, telegramNotify.category, telegramNotify.serious);
  } else if (res.priority === priority.warning) {
    logger.error(res.msg);
    sendTelegramMessageTimed(res.msg, telegramNotify.category, telegramNotify.warning);
  }

  // check for inactive channels
  const inactive = inactiveChannels();
  logger.debug(stringify(inactive));
  if (inactive) {
    inactive.forEach(c => {
      // typical node maintenance shouldn't take longer than 60 minutes; notify if a node
      // is inactive for longer.
      let msg;
      if (!c.mins) {
        // warn about inactive channels without determined duration
        msg = 'channel ' + c.chan + ' with ' + (c.name || c.peer) + ' has been inactive (undermined duration)'

      } else if (c.mins >= 60) {   // mins
        msg = 'channel ' + c.chan + ' with ' + (c.name || c.peer) + ' has been inactive for ';
        if (c.mins > 60) msg += Math.floor(c.mins/60) + ' hours ' + c.mins % 60 + ' mins';
        else msg += c.mins + ' mins';
      }
      if (msg) {
        const cat = 'telegram.notify.channel.inactive.' + c.chan;
        const int = 60 * 60;  // an hour
        logger.log(msg);
        sendTelegramMessageTimed(msg, cat, int);
      }
    })
  }
}

function lndPingLoop() {
  try {
    lndPingLoopExec();
  } catch(err) {
    logger.error(err.message);
  }
}

function lndPingLoopExec() {
  const prop = 'lndOfflineTelegramNotify';
  const frequency = constants.services.launcher.lndTelegramNotify;
  let prev = lndOffline;
  try {
    lndOffline = !isLndAlive(lndClient);
  } catch(err) {
    logger.error('error pinging lnd:', err.message, 'assuming lnd is offline');
    lndOffline = true;
  }
  if (lndOffline) {
    logger.error('lnd is offline');
    sendTelegramMessageTimed('lnd is offline', prop, frequency);
  } else if (prev) {
    logger.log('lnd is back online');
  } else if (prev === undefined) {
    logger.log('lnd is online');
  }
}

function cleanDbRebalances() {
  try {
    cleanDbRebalancesExec();
  } catch(err) {
    logger.error(err.message);
  }
}

// remove db records for rebalance processes that no longer exist
function cleanDbRebalancesExec() {
  const pref = 'cleanDbRebalances:';
  const dbUtils = require('../db/utils');
  let list = dbUtils.listActiveRebalancesSync();
  if (!list || list.length === 0) return;

  let toKill = [];
  let first = true;
  list.forEach(l => {
    if (!isRunningPidSync(l.pid)) {
      if (first) {
        logger.log('cleaning db rebalances');
        first = false;
      }
      logger.log('removing db record for process that no longer exist', l.pid);
      dbUtils.deleteActiveRebalanceSync(l.pid);
    } else {
      const delta = (Date.now() - l.date) / 60 / 1000;  // mins
      // see if the process exceeds 2x of max runtime
      if (delta > 2 * l.mins) toKill.push({
        pid: l.pid,
        from: l.from_node,
        to: l.to_node,
        delta: delta
      })
    }
  })

  if (toKill.length > 0) {
    let peerMap = {};
    try {
      const peers = listPeersSync(lndClient);
      peers.forEach(p => {
        peerMap[p.id] = p.name;
      })
    } catch(err) {
      // could not get peer list, perhaps lnd is down
      // proceed with node id(s) instead of names
    }
    toKill.forEach(p => {
      const msg = 'rebalance process ' + p.pid + ' from ' + (peerMap[p.from] || p.from) + ' to ' + (peerMap[p.to] || p.to) + ' has been running for ' + Math.round(p.delta) + ' mins, it is likely stuck, terminating';
      logger.error(msg);
      sendMessage(msg);
      process.kill(p.pid);
      dbUtils.deleteActiveRebalanceSync(p.pid);
    })
  }
}

var dbCleanupInProgress;  // only one instance of dbCleanup is allowed

// removes old records from the database
function dbCleanup() {
  // todo: atomic test & set
  if (dbCleanupInProgress) {
    logger.log('already running, skip');
    return;
  }
  dbCleanupInProgress = true;

  try {
    dbCleanupImpl();
  } catch(err) {
    logger.error(err);
  } finally {
    dbCleanupInProgress = false;
  }
}

function dbCleanupImpl() {
  logger.log('running db cleanup');

  const dbUtils = require('../db/utils');

  let done;
  let tablesCleaned = 0;

  try {
    // rebalance avoid table
    if (isTimeToCleanup('rebalanceAvoid')) {
      const maxRuntime = 5 * (config.rebalancer.maxTime || constants.rebalancer.maxTime);
      const maxDepth = Math.max(60, maxRuntime) * 60 * 1000; // in msec
      logger.log('rebalance avoid:', 'depth:', maxRuntime, 'mins');
      done = false;
      dbUtils.deleteRebalanceAvoid({to: Date.now() - maxDepth}, (err) => {
        if (err) {
          logger.error('rebalance avoid:', err);
        } else {
          logger.log('rebalance avoid:', 'done');
          recordCleanup('rebalanceAvoid');
          tablesCleaned++;
        }
        done = true;
      })
      deasync.loopWhile(() => !done);
    } else {
      logger.info('rebalance avoid:', 'skip');
    }

    // liquidity table
    if (isTimeToCleanup('liquidity')) {
      const maxProbeDepth = (config.db && config.db.maxProbeDepth) || constants.db.maxProbeDepth; // days
      logger.log('probe liquidity:', 'depth:', maxProbeDepth, 'days');
      done = false;
      dbUtils.deleteLiquidity({to: Date.now() - maxProbeDepth * 24 * 60 * 60 * 1000}, (err) => {
        if (err) {
          logger.error('probe liquidity:', err);
        } else {
          logger.log('probe liquidity:', 'done');
          recordCleanup('liquidity');
          tablesCleaned++;
        }
        done = true;
      })
      deasync.loopWhile(() => !done);
    } else {
      logger.info('liquidity:', 'skip');
    }

    // failed htlc table
    if (isTimeToCleanup('failedHtlc')) {
      const maxFailedHtlcDepth = (config.db && config.db.maxFailedHtlcDepth) || constants.db.maxFailedHtlcDepth; // days
      logger.log('htlc:', 'depth:', maxFailedHtlcDepth, 'days');
      done = false;
      dbUtils.deleteFailedHtlc({to: Date.now() - maxFailedHtlcDepth * 24 * 60 * 60 * 1000}, (err) => {
        if (err) {
          logger.error('htlc:', err);
        } else {
          logger.log('htlc:', 'done');
          recordCleanup('failedHtlc');
          tablesCleaned++;
        }
        done = true;
      })
      deasync.loopWhile(() => !done);
    } else {
      logger.info('htlc:', 'skip');
    }

    // txn table
    if (isTimeToCleanup('txn')) {
      const maxTxnDepth = constants.db.maxTxnDepth;
      logger.log('txn:', 'depth:', maxTxnDepth, 'days');
      done = false;
      dbUtils.deleteTxn({to: Date.now() - maxTxnDepth * 24 * 60 * 60 * 1000}, (err) => {
        if (err) {
          logger.error('txn:', err);
        } else {
          logger.log('txn:', 'done');
          recordCleanup('txn');
          tablesCleaned++;
        }
        done = true;
      })
      deasync.loopWhile(() => !done);
    } else {
      logger.info('txn:', 'skip');
    }

    // rebalance history table
    const maxRebalanceHistoryDepth = config.db && config.db.maxRebalanceHistoryDepth;
    if (maxRebalanceHistoryDepth) {
      if (isTimeToCleanup('rebalanceHistory')) {
        logger.log('rebalance history:', 'depth:', maxRebalanceHistoryDepth, 'days');
        done = false;
        dbUtils.deleteRebalanceHistory({to: Date.now() - maxRebalanceHistoryDepth * 24 * 60 * 60 * 1000}, (err) => {
          if (err) {
            logger.error('rebalance history:', err);
          } else {
            logger.log('rebalance history:', 'done');
            recordCleanup('rebalanceHistory');
            tablesCleaned++;
          }
          done = true;
        })
        deasync.loopWhile(() => !done);
      } else {
        logger.log('rebalance history: skip');
      }
    } else {
      logger.log('rebalance history: depth is not configured, skip');
    }

    // channel events table
    const maxChanEventsDepth = config.db && config.db.maxChannelEventsDepth;
    if (maxChanEventsDepth) {
      if (isTimeToCleanup('channelEvents')) {
        logger.log('channel events:', 'depth:', maxChanEventsDepth, 'days');
        done = false;
        dbUtils.deleteChannelEvents({to: Date.now() - maxChanEventsDepth * 24 * 60 * 60 * 1000}, (err) => {
          if (err) {
            logger.error('channel events:', err);
          } else {
            logger.log('channel events:', 'done');
            recordCleanup('channelEvents');
            tablesCleaned++;
          }
          done = true;
        })
        deasync.loopWhile(() => !done);
      } else {
        logger.log('channel events: skip');
      }
    } else {
      logger.log('channel events: depth is not configured, skip');
    }
  } catch(err) {
    logger.error(err);
  } finally {
    // vacuum
    if (tablesCleaned > 0) {
      logger.log('vacuum,', tablesCleaned, 'table(s) were cleaned');
      done = false;
      dbUtils.vacuum((err) => {
        if (err) logger.error('vacuum:', err.message);
        else logger.log('vacuum:', 'done');
        done = true;
      })
      deasync.loopWhile(() => !done);
    } else {
      logger.log('no tables changed, skip vacuum');
    }
  }

  // returns
  function isTimeToCleanup(table) {
    logger.debug(table);
    const prop = 'dbCleanup.' + table;
    const ret = getPropWithErrSync(prop);
    logger.debug(prop, stringify(ret));

    // can't cleanup if on db error
    if (ret.error) {
      logger.error(ret.error);
      return false;
    }

    if (!ret.val) return true;  // hasn't been set yet

    // is it time to cleanup
    const interval = constants.db.cleanupInterval;
    if (ret.val && ((Date.now() - ret.val) < interval * 24 * 60 * 60 * 1000)) return false;

    return true;
  }

  function recordCleanup(table) {
    // store the current date
    // todo: what if there is a db error on set
    const prop = 'dbCleanup.' + table;
    setPropSync(prop, Date.now());
  }
}

var txnLoopRunning = false; // just a precaution in case the initial loop runs too long
function txnLoop() {
  if (txnLoopRunning) return logger.warn('already running, skip');
  try {
    txnLoopRunning = true;
    txnLoopImpl();
  } catch(err) {
    logger.error(err);
  } finally {
    txnLoopRunning = false; // assumes that txnLoopImpl is sync
  }
}

// populate channel txn table with rebalances and forwards
// the tnx table is used to produce profitability metrics
// the history depth is limited to a month
//
// https://api.lightning.community/#listpayments
// https://api.lightning.community/#forwardinghistory
function txnLoopImpl() {
  const propPref = 'txn';

  if (lndOffline) {
    return logger.warn('lnd is offline, skipping the loop');
  }

  // default start date is unix timestamp from 2x of max interval
  // 2x to generate historical delta
  // note: lnd records are in utc, not a big deal though
  const defStart = Math.floor(+new Date() / 1000) - (constants.db.maxTxnDepth * 24 * 60 * 60);

  // get timestamp and offset
  const timestampProp = propPref + '.forwards.timestamp';
  const offsetProp = propPref + '.forwards.offset';
  let ret = getPropWithErrSync(timestampProp);
  if (ret.error) return logger.warn('error getting timestamp prop, skip', ret.error);
  let timestamp = ret.val;
  ret = getPropWithErrSync(offsetProp);
  if (ret.error) return logger.warn('error getting offset prop, skip', ret.error);
  let offset = ret.val || 0;
  if (timestamp) {
    if (timestamp < defStart) {
      logger.log('reset timestamp since its older than default');
      timestamp = defStart;
    }
  } else {
    timestamp = defStart;
  }
  const initialTimestamp = timestamp;
  const initialOffset = offset;
  logger.log('featching forwards, timestamp:', timestamp, 'offset:', offset);

  let count = 0;
  while(true) {
    const ret = listForwardsSync(lndClient, initialTimestamp, offset);
    if (ret.error) {
      logger.error(ret.error);
      break;
    }

    const list = ret.response.forwarding_events;
    const len = list.length;
    if (len === 0) {
      logger.log('no new forwards found');
      break;
    }

    // record in the db
    logger.log('found', len, 'new forwards');
    let error;
    list.forEach(e => {
      if (error) return;  // break from forEach
      // record in the db; ok sync write since its a local db and
      // one month worth of txns shouldn't be a big deal
      const err = recordTxn({
        txDateNs: parseInt(e.timestamp_ns),
        type: 'forward',
        fromChan: e.chan_id_in,
        toChan: e.chan_id_out,
        amount: e.amt_in,
        fee: e.fee
      })
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
          // trying to record a record that already exists, just a warning
          logger.warn('forward record already exists in db, skip', e);
          offset++;
        } else {
          logger.error('db error:', err);
          error = err;
        }
      } else {
        timestamp = parseInt(e.timestamp);
        offset++;
        count++;
      }
    })
    if (error) break; // terminal error, telegram notify?
  }
  if (count > 0 && initialTimestamp === defStart) {
    // remember the timestamp of the latest record
    // offset is set to one so that the latest record isn't read twice
    offset = 1;
    logger.log('saving the latest valid timestamp:', timestamp);
    setPropSync(timestampProp, timestamp);
  }
  if (offset !== initialOffset) {
    logger.log('saving the latest offset:', offset);
    setPropSync(offsetProp, offset);
  }

  // loop through payments
  // first, get node id
  let nodeId;
  try {
    const nodeData = getInfoSync(lndClient);
    nodeId = nodeData && nodeData.identity_pubkey;
  } catch(err) {
    logger.error(err);
  }
  if (!nodeId) return logger.error('error getting node id');

  const paymentsOffsetProp = propPref + '.payments.offset';
  ret = getPropWithErrSync(paymentsOffsetProp);
  if (ret.error) return logger.error('error getting payments offset, skip', ret.error);
  offset = ret.val || 0;
  logger.log('fetching payments, offset:', offset);
  const paymentsOffset = offset;

  while(true) {
    const ret = listPaymentsSync(lndClient, offset);
    if (ret.error) {
      logger.error(ret.error);
      break;
    }

    const list = ret.response.payments;
    if (list.length === 0) {
      logger.log('no new payments found');
      break;
    }

    logger.log('found', list.length, 'new payments');
    let skipped = 0;
    let error;  // terminal error, will cause an exit from the loop
    list.forEach(e => {
      if (error) return;  // skip, terminal error
      if (parseInt(e.creation_date) < defStart) {
        offset = e.payment_index;
        return skipped++; // skip
      }
      // find successful route
      let route;
      e.htlcs.forEach(h => {
        if (h.status === 'SUCCEEDED') route = h.route;
      })
      if (!route) {
        error = 'failed to identify route';
        return logger.error(error, e);
      }

      // confirm that it's a rebalance, the last hop has to be this node
      const lastId = route.hops[route.hops.length - 1].pub_key;
      if (lastId !== nodeId) {
        offset = e.payment_index;
        return logger.log('not a rebalance, skip');
      }

      const fromChan = route.hops[0].chan_id;
      const toChan = route.hops[route.hops.length - 1].chan_id;

      // store in the db
      const err = recordTxn({
        txDateNs: parseInt(e.creation_time_ns), // should it be commit time?
        type: 'rebalance',
        fromChan: fromChan,
        toChan: toChan,
        amount: e.value_sat,
        fee: e.fee_sat
      })
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
          // trying to record a record that already exists, just a warning
          logger.warn('payment record already exists in db, skip', e);
          offset = e.payment_index;
        } else {
          logger.error('db error:', err);
          error = err;
        }
      } else {
        timestamp = parseInt(e.timestamp);
        offset = e.payment_index;
      }
    })
    if (skipped > 0) logger.log('skipping', skipped, 'old payments');
    if (offset != paymentsOffset) setPropSync(paymentsOffsetProp, offset);

    if (error) break; // terminal error, exit the loop
  }
}

function osStatsLoop() {
  try {
    // check os stats
    const issues = require('../api/os-stats').checkStats();
    if (issues) {
      issues.forEach(issue => {
        // log
        if (issue.pri === constants.osStats.issues.pri.warning) {
          logger.warn(issue.msg);
        } else if (issue.pri === constants.osStats.issues.pri.serious) {
          logger.error(issue.msg);
        } else if (issue.pri === constants.osStats.issues.pri.critical) {
          logger.error(issue.msg);
        } else {
          logger.error('unknown priority for ' + issue);
        }
        // telegram
        const label = constants.osStats.issues.label + '.' + issue.cat + '.' + issue.pri.label;
        sendTelegramMessageTimed(issue.msg, label, issue.pri.notify);
      })
    }
  } catch(err) {
    logger.error(err.message);
  }
}

lndPingLoop();  // detect if lnd is online, run it first

setInterval(runLoop, loopInterval * 60 * 1000);
setInterval(bosReconnect, bosReconnectInterval * 60 * 1000);
setInterval(lndPingLoop, lndPingInterval * 1000);
setInterval(cleanDbRebalances, cleanDbRebalancesInterval * 60 * 1000);
setInterval(txnLoop, txnInterval * 60 * 1000);
setInterval(dbCleanup, constants.db.loopInterval * 60 * 60 * 1000);
setInterval(osStatsLoop, constants.osStats.issues.loopInterval * 1000);

// early kick off
txnLoop();
runLoop();
