// worker daemon; populates db tables, periodic bos reconnect, etc.

const importLazy = require('import-lazy')(require);
const date = require('date-and-time');
const config = importLazy('../api/config');
const constants = require('../api/constants');
const lndClient = importLazy('../api/connect');
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

  serviceUtils.Worker.recordHeartbeat(); // indicates that Worker isn't stuck

  if (lndOffline) {
    console.warn(constants.colorYellow, 'lnd is offline, skipping the loop');
    return;
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
        let msg = 'channel ' + c.chan + ' with ' + (c.name || c.peer) + ' has been inactive for ';
        if (c.mins > 60) msg += Math.floor(c.mins/60) + ' hours ' + c.mins % 60 + ' mins';
        else msg += c.mins + ' mins';
        const cat = 'telegram.notify.channel.inactive.' + c.chan;
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
    console.log('\n' + date.format(new Date, 'MM/DD hh:mm:ss A'));
    console.error(constants.colorRed, 'lnd is offline');
    sendTelegramMessageTimed('lnd is offline', prop, frequency);
  } else if (prev) {
    console.log('\n' + date.format(new Date, 'MM/DD hh:mm:ss A'));
    console.log(constants.colorGreen, 'lnd is back online');
  } else if (prev === undefined) {
    console.log('\n' + date.format(new Date, 'MM/DD hh:mm:ss A'));
    console.log(constants.colorGreen, 'lnd is online');
  }
}

function cleanDbRebalances() {
  try {
    cleanDbRebalancesExec();
  } catch(err) {
    console.error('cleanDbRebalances:', err.message);
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
        console.log('\n' + date.format(new Date, 'MM/DD hh:mm:ss A'));
        first = false;
      }
      console.log(pref, 'removing db record for process that no longer exist', l.pid);
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
      console.error(constants.colorRed, pref + ' ' + msg);
      sendMessage(msg);
      process.kill(p.pid);
      dbUtils.deleteActiveRebalanceSync(p.pid);
    })
  }
}

var txnLoopRunning = false; // just a precaution in case the initial loop runs too long
function txnLoop() {
  const pref = 'txnLoop:';
  if (txnLoopRunning) return console.warn(pref, 'already running, skip');
  try {
    txnLoopRunning = true;
    txnLoopImpl();
  } catch(err) {
    console.error('txnLoop:', err);
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
  const pref = 'txnLoopImpl:';
  const propPref = 'txn';

  if (lndOffline) {
    console.log('\n' + date.format(new Date, 'MM/DD hh:mm:ss A'));
    return console.warn(constants.colorYellow, pref + ' lnd is offline, skipping the loop');
  }

  // default start date is unix timestamp from 2x of max interval
  // 2x to generate historical delta
  // note: lnd records are in utc, not a big deal though
  const defStart = Math.floor(+new Date() / 1000) - (2 * constants.maxTxnInterval * 60 * 60);

  // get timestamp and offset
  const timestampProp = propPref + '.forwards.timestamp';
  const offsetProp = propPref + '.forwards.offset';
  let ret = getPropWithErrSync(timestampProp);
  if (ret.error) return console.warn(pref, 'error getting timestamp prop, skip', ret.error);
  let timestamp = ret.val;
  ret = getPropWithErrSync(offsetProp);
  if (ret.error) return console.warn(pref, 'error getting offset prop, skip', ret.error);
  let offset = ret.val || 0;
  if (timestamp) {
    if (timestamp < defStart) {
      console.log(pref, 'reset timestamp since its older than default');
      timestamp = defStart;
    }
  } else {
    timestamp = defStart;
  }
  const initialTimestamp = timestamp;
  const initialOffset = offset;
  console.log(pref, 'featching forwards, timestamp:', timestamp, 'offset:', offset);

  let count = 0;
  while(true) {
    const ret = listForwardsSync(lndClient, initialTimestamp, offset);
    if (ret.error) {
      console.error(pref, ret.error);
      break;
    }

    const list = ret.response.forwarding_events;
    const len = list.length;
    if (len === 0) {
      console.log(pref, 'no new forwards found');
      break;
    }

    // record in the db
    console.log(pref, 'found', len, 'new forwards');
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
          console.warn(pref, 'forward record already exists in db, skip', e);
          offset++;
        } else {
          console.error(pref, 'db error:', err);
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
    console.log(pref, 'saving the latest valid timestamp:', timestamp);
    setPropSync(timestampProp, timestamp);
  }
  if (offset !== initialOffset) {
    console.log(pref, 'saving the latest offset:', offset);
    setPropSync(offsetProp, offset);
  }

  // loop through payments
  // first, get node id
  let nodeId;
  try {
    const nodeData = getInfoSync(lndClient);
    nodeId = nodeData && nodeData.identity_pubkey;
  } catch(err) {
    console.error(pref, err);
  }
  if (!nodeId) return console.error(pref, 'error getting node id');

  const paymentsOffsetProp = propPref + '.payments.offset';
  ret = getPropWithErrSync(paymentsOffsetProp);
  if (ret.error) return console.error(pref, 'error getting payments offset, skip', ret.error);
  offset = ret.val || 0;
  console.log(pref, 'fetching payments, offset:', offset);
  const paymentsOffset = offset;

  while(true) {
    const ret = listPaymentsSync(lndClient, offset);
    if (ret.error) {
      console.error(pref, ret.error);
      break;
    }

    const list = ret.response.payments;
    if (list.length === 0) {
      console.log(pref, 'no new payments found');
      break;
    }

    console.log(pref, 'found', list.length, 'new payments');
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
        return console.error(pref, error, e);
      }

      // confirm that it's a rebalance, the last hop has to be this node
      const lastId = route.hops[route.hops.length - 1].pub_key;
      if (lastId !== nodeId) {
        offset = e.payment_index;
        return console.log(pref, 'not a rebalance, skip');
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
          console.warn(pref, 'payment record already exists in db, skip', e);
          offset = e.payment_index;
        } else {
          console.error(pref, 'db error:', err);
          error = err;
        }
      } else {
        timestamp = parseInt(e.timestamp);
        offset = e.payment_index;
      }
    })
    if (skipped > 0) console.log(pref, 'skipping', skipped, 'old payments');
    if (offset != paymentsOffset) setPropSync(paymentsOffsetProp, offset);

    if (error) break; // terminal error, exit the loop
  }
}

lndPingLoop();  // detect if lnd is online, run it first

setInterval(runLoop, loopInterval * 60 * 1000);
setInterval(bosReconnect, bosReconnectInterval * 60 * 1000);
setInterval(lndPingLoop, lndPingInterval * 1000);
setInterval(cleanDbRebalances, cleanDbRebalancesInterval * 60 * 1000);
setInterval(txnLoop, txnInterval * 60 * 1000);

// early kick off
txnLoop();
runLoop();
