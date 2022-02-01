// new auto rebalancer (prev is in autorebalance.js)
// start: jet start rebalancer
// stop: jet stop rebalancer
// log: /tmp/rebalancer.log

const testModeOn = global.testModeOn;
if (testModeOn) console.log('test mode on');

// make sure only one instance is running
// only one instance allowed
if (!testModeOn) {
  const {isRunningSync} = require('../api/utils');
  const fileName = require('path').basename(__filename);
  if (isRunningSync(fileName, true)) {
    return console.error('service is already running, only one instance is allowed');
  }
}

const importLazy = require('import-lazy')(require);
const config = importLazy('../api/config');
const constants = require('../api/constants');
const date = require('date-and-time');
const lndClient = importLazy('../api/connect');
const {htlcHistorySync} = require('../lnd-api/utils');
const {classifyPeersSync} = require('../api/utils');
const {listActiveRebalancesSync} = require('../api/utils');
const {listRebalancesSync} = require('../db/utils');
const {listFeesSync} = require('../lnd-api/utils');
const {analyzeFees} = require('../api/analyze-fees');
const {removeEmojis} = require('../lnd-api/utils');
const {stuckHtlcsSync} = require('../lnd-api/utils');
const {exec} = require('child_process');
const serviceUtils = require('./utils');
const RebalanceQueue = require('./queue');

const maxCount = config.rebalancer.maxInstances || constants.rebalancer.maxInstances;
const defaultMaxPpm = config.rebalancer.maxAutoPpm || constants.rebalancer.maxAutoPpm;
const maxPendingHtlcs = config.rebalancer.maxPendingHtlcs || constants.rebalancer.maxPendingHtlcs;
const historyDepth = 2 * 60 * 60; // secs
const minToRebalance = 50000; // min liquidity to rebalance
const minLocal = 1000000; // min local liquidity for balanced peers
const tickDuration = 60;  // rebalancing tick duration in sec

const colorRed = constants.colorRed;
const colorGreen = constants.colorGreen;
const colorYellow = constants.colorYellow;

const backoff = x => 2 * Math.pow(2, x);

var queue = new RebalanceQueue();

// build exclude map
let exclude = {};
if (config.rebalancer.exclude) {
  config.rebalancer.exclude.forEach(n => {
    let id = n;
    let type = 'outbound';  // default
    let ind = n.indexOf(':');
    if (n.indexOf(':') >= 0) {
      id = n.substring(0, ind);
      type = n.substring(ind + 1);
    }
    if (['all', 'inbound', 'outbound'].includes(type)) {
      exclude[id] = type;
    } else {
      console.error(colorRed, 'unknow exclude for ' + id + ': ' + type + ', skipping');
    }
  })
  console.log('exclude:', exclude);
}

// main loop, build rebalancing queue

function runLoop() {
  try {
    runLoopImpl();
  } catch(err) {
    console.error('runLoop error:', err.message);
  }
}

function runLoopImpl() {
  console.log('\n' + date.format(new Date, 'MM/DD hh:mm A'), 'run rebalancing loop');
  serviceUtils.Rebalancer.recordHeartbeat();
  // build liquidity table: how much liquidity is available on the local side
  // for inbound nodes, how much liquidity outbound nodes need, do balanced
  // peers have at least the min local liquidity
  // note that classified peers are already sorted by p%
  let classified = classifyPeersSync(lndClient, 1);
  console.log('build liquidity table:');
  let liquidityTable = {};
  liquidityTable.inbound = [];
  classified.inbound.forEach(n => {
    // check if excluded
    let type = exclude[n.peer];
    if (type && ['all', 'inbound'].includes(type)) {
      return console.log(colorYellow, '[inbound]', n.peer, n.name, 'excluded based on settings');
    }

    const split = n.split/100 || 1;
    const max = Math.round(Math.min(split * n.capacity, n.sum));
    const min = n.capacity - max;
    const has = n.local - min;
    //console.log(n, max, min, has);
    if (has < minToRebalance) return console.log('[inbound]', n.peer, n.name, 'insufficient sats', has);
    console.log('[inbound]', n.peer, n.name, 'has', has, 'sats');
    liquidityTable.inbound.push({id: n.id, peer: n.peer, name: n.name, has});
  })
  liquidityTable.outbound = [];
  classified.outbound.forEach(n => {
    let type = exclude[n.peer];
    if (type && ['all', 'outbound'].includes(type)) {
      return console.log(colorYellow, '[outbound]', n.peer, n.name, 'excluded based on settings');
    }

    const split = n.split/100 || 1;
    const min = Math.round(Math.min(split * n.capacity, n.sum));
    const needs = min - n.local;
    //console.log(n, min, needs);
    if (needs < minToRebalance) return console.log('[outbound]', n.peer, n.name, 'insufficient sats');
    console.log('[outbound]', n.peer, n.name, 'needs', needs, 'sats');
    liquidityTable.outbound.push({id: n.id, peer: n.peer, name: n.name, needs});
  })
  liquidityTable.balancedHas = [];
  liquidityTable.balancedNeeds = [];
  classified.balanced.forEach(n => {
    const min = Math.min(minLocal, Math.round(n.capacity / 2));
    const needs = min - n.local;
    //console.log(n, min, needs);
    if (needs < 0) {
      // there is extra liquidity; dont overcommit liquidity, max it at 50% of capacity
      const extra = Math.min(n.local, Math.round(n.capacity / 2)) - minLocal;
      if (extra < minToRebalance) return console.log('[balanced]', n.peer, n.name, 'has sats below threshold', extra);
      else {
        // check if excluded
        let type = exclude[n.peer];
        if (type && ['all', 'inbound'].includes(type)) {
          return console.log(colorYellow, '[balanced]', n.peer, n.name, 'excluded based on settings');
        }

        liquidityTable.balancedHas.push({id: n.id, peer: n.peer, name: n.name, has: extra});
        return console.log('[balanced]', n.peer, n.name, 'has', extra, 'sats');
      }
    }
    if (needs < minToRebalance) return console.log('[balanced]', n.peer, n.name, 'needs sats below threshold', needs);
    // check if excluded
    let type = exclude[n.peer];
    if (type && ['all', 'outbound'].includes(type)) {
      return console.log(colorYellow, '[balanced]', n.peer, n.name, 'excluded based on settings');
    }
    console.log('[balanced]', n.peer, n.name, 'needs', needs, 'sats');
    liquidityTable.balancedNeeds.push({id: n.id, peer: n.peer, name: n.name, needs});
  })

  // initialize rebalances already in-flight
  initRunning();
  let currCount = countInFlight();
  if (currCount >= maxCount) return console.log('already at max count');

  // build history table for exp backoff
  let history = {};
  let list = listRebalancesSync(historyDepth);
  if (list) {
    list.forEach(h => {
      const key = h.from + ':' + h.to;
      let entry = history[key];
      if (!entry) {
        entry = [];
        history[key] = entry;
      }
      entry.push({ date:h.date, status:h.status });
    })
    Object.keys(history).forEach(key => {
      let list = history[key];
      list.sort((a, b) => {return b.date - a.date});
      let countFailed = 0;
      for(i = 0; i < list.length; i++) {
        if (list[i].status) break;
        countFailed++;
      }
      history[key] = { count:countFailed, last:list[0].date };
    })
  }

  // build fee map
  let feeMap = {};
  let fees = listFeesSync(lndClient);
  fees.forEach(f => feeMap[f.id] = f);

  // get pending htlcs
  let pendingHtlcs = stuckHtlcsSync(lndClient);

  // build rebalancing queue
  console.log('\nbuild rebalancing queue:');
  const len = liquidityTable.outbound.length;
  for(i = 0; i < len; i++) {
    const to = liquidityTable.outbound[i];
    console.log('[outbound]', to.name, to.peer, 'needs', to.needs, 'sats');
    const delta = tickDuration * i; // time delta between rebalances
    const p = (len - i)/len;  // % of liquidity to allocate based on position (revisit)
    let remaining = to.needs; // tracks remaining sats needed
    liquidityTable.inbound.forEach(from => {
      if (currCount >= maxCount) return;
      console.log(' evaluating', from.name, from.peer, 'remaining sats', remaining);
      if (remaining === 0) return;
      const pref = '   ';

      let maxPpm = checkPeers(from, to, pref);
      if (maxPpm === undefined) return;

      const amount = Math.min(Math.round(p * from.has), remaining);
      if (amount < minToRebalance) return console.log(pref, 'insufficient amount', amount);

      console.log(pref + 'adding to queue for', amount, 'sats, max ppm of', maxPpm, 'to run in', delta, 'sec');
      queue.add(from.peer, to.peer, from.name, to.name, amount, maxPpm, Date.now() + delta * 1000);
      remaining -= amount;
      currCount++;
    })
  }

  if (currCount >= maxCount) return console.log('reached max rebalance count');

  // now process balanced peers; for now, rebalance between each other
  // how should the peers be prioritized?
  const blen = liquidityTable.balancedNeeds.length;
  for(i = 0; i < blen; i++) {
    if (currCount >= maxCount) return;
    const to = liquidityTable.balancedNeeds[i];
    console.log('[balanced]', to.name, to.peer, 'needs', to.needs, 'sats');
    let remaining = to.needs;
    liquidityTable.balancedHas.forEach(from => {
      const has = (from.remaining === undefined) ? from.has : from.remaining;
      console.log(' needs', remaining, 'sats');
      console.log(' evaluating', from.name, from.peer, 'has', has, 'sats');
      if (has < minToRebalance || remaining < minToRebalance) return;
      const pref = '   ';

      let maxPpm = checkPeers(from, to, pref);
      if (maxPpm === undefined) return;

      const amount = Math.min(has, remaining);
      console.log(pref + 'adding to queue for', amount, 'sats, max ppm of', maxPpm);
      queue.add(from.peer, to.peer, from.name, to.name, amount, maxPpm, Date.now());
      from.remaining = has - amount;
      remaining -= amount;
      currCount++;
    })
  }

  if (currCount >= maxCount) return console.log('reached max rebalance count');

  // pref - prefix for log messages
  // returns maxPpm if ok to proceed, undefined otherwise
  function checkPeers(from, to, pref) {
    if (isInFlight(from.peer, to.peer)) {
      // one rebalance at a time per pair
      return console.log(pref + 'already in flight');
    }

    // exp backoff based on rebalance history
    const key = from.peer + ':' + to.peer;
    if (history[key] && history[key].count > 0) {
      const tplus = backoff(history[key].count);  // mins
      console.log(pref + 'EXP backoff:', history[key], 'backoff:', tplus, 'mins');
      const left = history[key].last + tplus * 60 * 1000 - Date.now();
      if (left > 0) {
        return console.log(pref + 'wait for backoff, remaining', (left/(60 * 1000)).toFixed(1), 'mins');
      }
    }

    // check for pending htlcs
    let fromHtlcs = 0;
    let toHtlcs = 0;
    pendingHtlcs.forEach(h => {
      if (h.peer === from.peer) fromHtlcs = h.htlcs.length;
      if (h.peer === to.peer) toHtlcs = h.htlcs.length;
    })
    console.log(`${pref}pending htlcs for ${from.name}:`, fromHtlcs);
    console.log(`${pref}pending htlcs for ${to.name}:`, toHtlcs);
    if (Math.max(fromHtlcs, toHtlcs) >= maxPendingHtlcs) {
      return console.log(colorRed, pref + 'too many stuck htlcs, skip rebalance');
    }

    // determine max ppm
    let maxPpm = defaultMaxPpm;
    let fee = feeMap[to.peer];
    let analysis = analyzeFees(to.name, to.peer, fee.local, fee.remote);
    if (analysis) {
      const action = constants.feeAnalysis.action;
      let status = analysis[0];
      if (status.action === action.pause) {
        let msg = pref + 'rebalancing is paused';
        if (status.range) msg += ', suggested local ppm range: ' + status.range;
        if (status.summary) msg += ', ' + status.summary;
        return console.log(colorRed, msg);  // skip
      } else if (status.maxPpm) {
        let msg = pref + 'setting max ppm to: ' + status.maxPpm;
        if (status.range) msg += ', suggested local ppm range: ' + status.range;
        if (status.summary) msg += ', ' + status.summary;
        console.log(msg);
        maxPpm = status.maxPpm;
      } else {
        console.error(colorRed, pref + 'fee analysis did not return max ppm, assuming default');
      }
    }
    return maxPpm;
  } // checkPeers
} // runLoopImpl

// process rebalancing queue
// restart the service to reset the queue (jet restart rebalancer)

const jetExecPath = __dirname + '/../jet';

function processQueue() {
  try {
    processQueueImpl();
  } catch(err) {
    console.log('processQueue error:', err.message);
  }
}

function processQueueImpl() {
  const normalizeName = name => {
    return removeEmojis(name).replace(constants.logNameRegEx, "").substring(0, 15); // hardcoded???
  }

  while(true) {
    let item = queue.pop();
    if (!item) break;
    console.log('\n' + date.format(new Date, 'MM/DD hh:mm A'), 'rebalancing queue: processing', item);
    let cmd = 'nohup ' + jetExecPath + ' rebalance ' + item.from + ' ' + item.to + ' ' + item.amount + ' --ppm ' + item.maxPpm + ' >> /tmp/rebalance_' + normalizeName(item.fromName) + '_' + normalizeName(item.toName) + '.log 2>&1 & disown';
    console.log('rebalancing queue:', cmd);
    if (!testModeOn) exec(cmd);
  }
}

// determine if a rebalance is already in-flight based on
// peer pair. in-flight is either already running or in the
// queue.

var running = {};

// is rebalance already running or in the queue
function isInFlight(from, to) {
  if (queue.includes(from, to)) return true;
  return !!running && !!running[from] && !!running[from][to];
}

function countInFlight() {
  return countRunning() + queue.count();
}

function initRunning() {
  running = {};
  let list = listActiveRebalancesSync();
  if (!list) return;
  let map = {};
  list.forEach(l => {
    let entry = map[l.from];
    if (!entry) { 
      entry = {};
      map[l.from] = entry;
    }
    entry[l.to] = true;
  })
  running = map;
}

function countRunning() {
  if (!running) return 0;
  let count = 0;
  Object.keys(running).forEach(k => count += Object.keys(running[k]).length);
  return count;
}

function countForPeer(peer) {
  return (running && running[peer] && Object.keys(running[peer]).length) || 0;
}

// kick off the loops

const runLoopInterval = constants.services.rebalancer.loopInterval;
const processQueueInterval = 10; // sec

setInterval(runLoop, runLoopInterval * 1000);
setInterval(processQueue, processQueueInterval * 1000);

runLoop();
