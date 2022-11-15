// automatically rebalances channels based on on routing volume,
// missed routing opportunities (htlcs), and other variables.
//
// start: jet start rebalancer
// stop: jet stop rebalancer
// restart: jet restart rebalancer
// log: /tmp/jet-rebalancer.log

const stringify = obj => JSON.stringify(obj, null, 2);
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
const {forwardHistorySync} = require('../lnd-api/utils');
const {cumulativeHtlcs} = require('../api/htlc-analyzer');
const serviceUtils = require('./utils');
const RebalanceQueue = require('./queue');
const {spawnDetached} = require('../api/utils');
const {isLndAlive} = importLazy('../lnd-api/utils');

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

var pendingHtlcs;
var queue = new RebalanceQueue();

// build exclude map
let exclude = {};
if (config.rebalancer.exclude && config.rebalancer.exclude.length > 0) {
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
      console.error(colorRed, 'unknown exclude for ' + id + ': ' + type + ', skipping');
    }
  })
  console.log('exclude:', exclude);
}

// main loop, build rebalancing queue

function runLoop() {
  try {
    runLoopImpl();
  } catch(err) {
    console.error('runLoop error:', err);
  }
}

function runLoopImpl() {
  console.log('\n' + date.format(new Date, 'MM/DD hh:mm:ss A'));

  serviceUtils.Rebalancer.recordHeartbeat();

  if (!isLndAlive(lndClient)) {
    return console.log(colorYellow, 'lnd is offline, skipping the loop');
  }

  console.log('run rebalancing loop');

  // refresh pending htlcs
  pendingHtlcs = stuckHtlcsSync(lndClient);

  // build liquidity table: how much liquidity is available on the local side
  // for inbound nodes, how much liquidity outbound nodes need, do balanced
  // peers have at least the min local liquidity
  // note that classified peers are already sorted by p%
  initRunning();    // rebalances already in-flight
  initInFlight();

  let classified = classifyPeersSync(lndClient, 1);

  console.log('build liquidity table:');
  if (!classified.inbound || classified.inbound.length === 0) console.log('no inbound peers found');
  if (!classified.outbound || classified.outbound.length === 0) console.log('no outbound peers found');
  if (!classified.balanced || classified.balanced.length === 0) console.log('no low volume peers found');
  if (classified.skipped && classified.skipped.length > 0) console.log('skipping', classified.skipped.length, 'peers (likely due to channel capacity below threshold)');

  let channelMap = {};
  let peerMap = {};
  let liquidityTable = {};
  liquidityTable.inbound = [];
  classified.inbound.forEach(n => {
    channelMap[n.id] = n;

    if (!n.active) {
      return console.log(colorYellow, '[inbound]', n.peer, n.name, 'is inactive, skip');
    }

    // check if excluded
    let type = exclude[n.peer];
    if (type && ['all', 'inbound'].includes(type)) {
      return console.log(colorYellow, '[inbound]', n.peer, n.name, 'excluded based on settings');
    }

    const split = n.split/100 || 1;
    const max = Math.round(Math.min(split * n.capacity, n.sum));
    const min = n.capacity - max;
    const has = n.local - min;
    console.log('[inbound]', n.peer, n.name, 'local:', n.local, 'max:', max, 'min:', min, 'has:', has);
    if (has < minToRebalance) return console.log('  insufficient local sats to rebalance');
    console.log('  sufficient local sats to rebalance');
    liquidityTable.inbound.push({id: n.id, peer: n.peer, name: n.name, has});
  })
  liquidityTable.outbound = [];
  classified.outbound.forEach(n => {
    channelMap[n.id] = n;

    if (!n.active) {
      return console.log(colorYellow, '[outbound]', n.peer, n.name, 'is inactive, skip');
    }

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
  // low-volume peers
  liquidityTable.balancedHas = [];
  liquidityTable.balancedNeeds = [];
  classified.balanced.forEach(n => {
    channelMap[n.id] = n;

    console.log('[low volume]', n.peer, n.name, 'capacity:', n.capacity);
    if (!n.active) {
      return console.log(colorYellow, '  inactive, skip');
    }

    const inflight = satsInFlight(n.peer);
    console.log('  sats inflight:', inflight);

    // calculate sats that peers need and sats they have
    // take into account inflight sats
    // needs - min sats that a peer needs to be revived, max it at 20% of capacity
    // subtract sats it already has plus whatever is in-flight (outbound plus inbound)
    // has - sats available to rebalance, the goal is not to overcommit liquidity
    // max it at 50% of capacity, subtract the min the peer needs
    // note: its somewhat a concervative approach when it comes to rebalancing,
    // but justified since its for the revival of low-volume peers,
    // as opposed to supplying liquidity to high-volume channels
    const min = Math.min(minLocal, Math.round(.2 * n.capacity));
    const needs = min - (n.local + inflight.outbound + inflight.inbound);
    const has = Math.min(n.local, Math.round(n.capacity / 2)) - minLocal;
    console.log('  sats local:,', n.local, 'min:', min, 'has:', has, 'needs:', needs);

    if (has > 0) {
      if (has < minToRebalance) return console.log('  has sats below threshold');
      else {
        // check if excluded
        let type = exclude[n.peer];
        if (type && ['all', 'inbound'].includes(type)) {
          return console.log(colorYellow, '  excluded based on settings');
        }

        liquidityTable.balancedHas.push({id: n.id, peer: n.peer, name: n.name, has: has});
        return console.log('  has', has, 'sats');
      }
    } else if (needs > 0) {
      if (needs < minToRebalance) return console.log('  needs sats below threshold', needs);
      // check if excluded
      let type = exclude[n.peer];
      if (type && ['all', 'outbound'].includes(type)) {
        return console.log(colorYellow, '  excluded based on settings');
      }
      console.log('  needs', needs, 'sats');
      liquidityTable.balancedNeeds.push({id: n.id, peer: n.peer, name: n.name, needs});
    } else {
      // neither has nor needs sats
      return console.log('  neither has nor needs sats');
    }
  })

  // check peers with missed htlcs; limit the number of peers
  // to those that missed more than chan capacity & up to
  // a quarter of max instances
  liquidityTable.missed = [];
  let missed = cumulativeHtlcs(1);
  if (missed) {
    let maxMissed = Math.floor(.25 * maxCount);
    missed.forEach(m => {
      if (maxMissed === 0) return;
      let chan = channelMap[m.chan];
      if (!chan) return console.error(colorRed, 'couldnt locate channel data for', m.chan);

      console.log('[missed]', chan.peer, chan.name, 'capacity:', chan.capacity, 'missed:', m.total);
      if (!chan.active) return console.log(colorYellow, '  inactive, skip');
      let type = exclude[chan.peer];
      if (type && ['all', 'outbound'].includes(type)) {
        return console.log(colorYellow, '  excluded based on settings');
      }
      if (m.total < chan.capacity) {
        return console.log('  insufficient missed sats, skip');
      }

      // take into account in-flight sats, don't overcommit liquidity
      const inflight = satsInFlight(chan.peer);
      console.log('  sats inflight:', inflight);

      // being more aggressive with liquidity than usual, base it at 50% of capacity,
      // minus sats inflight. p.s. this should be based on the actual sats missing,
      // calculation for missing sats is imprecise atm 
      const needs = Math.round(chan.capacity/2) - (inflight.outbound + inflight.inbound);
      if (needs < minToRebalance) return console.log('  needs sats below threshold', needs);
      console.log('  needs', needs, 'sats');
      liquidityTable.missed.push({id:chan.id, peer:chan.peer, name:chan.name, needs});

      maxMissed--;
    })
  }

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

  // build rebalancing queue
  // first process outbound peers that need liquidity
  console.log('\nbuild rebalancing queue:');
  const len = liquidityTable.outbound.length;
  for(i = 0; i < len; i++) {
    if (currCount >= maxCount) break; // reached max
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
      queue.add(from.peer, to.peer, from.name, to.name, amount, maxPpm, Date.now() + delta * 1000, 'regular');
      remaining -= amount;
      currCount++;
    })
  }

  if (currCount >= maxCount) return console.log('reached max rebalance count');

  // process peers with missed sats
  const mlen = liquidityTable.missed.length;
  for(i = 0; i < mlen; i++) {
    if (currCount >= maxCount) break; // reached max
    const to = liquidityTable.missed[i];
    console.log('[missed]', to.name, to.peer, 'needs', to.needs, 'sats');
    const delta = tickDuration * i; // time delta between rebalances
    let remaining = to.needs;   // tracks remaining sats needed (already adjusted for inflight sats)
    if (remaining < minToRebalance) {
      console.log(' remaining sats below threshold', remaining);
      continue;
    }
    liquidityTable.inbound.forEach(from => {
      if (currCount >= maxCount) return;
      console.log(' evaluating', from.name, from.peer, 'remaining sats', remaining);
      if (remaining === 0) return;
      const pref = '   ';

      let maxPpm = checkPeers(from, to, pref);
      if (maxPpm === undefined) return;

      const amount = Math.min(from.has, remaining);
      if (amount < minToRebalance) return console.log(pref, 'insufficient amount', amount);

      console.log(pref + 'adding to queue for', amount, 'sats, max ppm of', maxPpm, 'to run in', delta, 'sec');
      queue.add(from.peer, to.peer, from.name, to.name, amount, maxPpm, Date.now() + delta * 1000, 'missed');
      remaining -= amount;
      currCount++;
    })
  }

  if (currCount >= maxCount) return console.log('reached max rebalance count');

  // check if there are any forwards; use the same interval as the
  // rebalance loop. this will ensure that we catch the latest forwards
  // without duplicates
  let forwards = forwardHistorySync(lndClient, constants.services.rebalancer.loopInterval);
  if (forwards.error) {
    console.error('error reading forward history:', forwards.error);
  } else if (!forwards.events || forwards.events.length === 0) {
    console.log('no forwards detected');
  } else {
    // sort based on the sats routed
    forwards.events.forEach(e => { e.sats = parseInt(e.amt_out) });
    forwards.events.sort((a, b) => { return b.sats - a.sats });
    // limit the number of forwards to 25% of the total max
    // revisit this, perhaps make it configurable?
    let maxForwards = Math.floor(.25 * maxCount);
    forwards.events.forEach(e => {
      if (maxForwards === 0) return;
      if (currCount >= maxCount) return;
      const from = channelMap[e.chan_id_in];
      const to = channelMap[e.chan_id_out];

      // attempt a rebalance
      console.log('[forward]', 'from:', from.name, from.peer, 'to:', to.name, to.peer, 'sats:', e.sats);
      const pref = '  ';

      if (e.sats < minToRebalance) return console.log(pref, 'forwarded sats are below threshold', minToRebalance);

      let maxPpm = checkPeers(from, to, pref);
      if (maxPpm === undefined) return;
      const amount = e.sats;
      console.log(pref + 'adding to queue for', amount, 'sats, max ppm of', maxPpm);
      queue.add(from.peer, to.peer, from.name, to.name, amount, maxPpm, Date.now(), 'forward');

      maxForwards--;
      currCount++;
    })
    if (maxForwards === 0) console.log('reached max of forwards');
  }

  if (currCount >= maxCount) return console.log('reached max rebalance count');

  // now process low volume peers; for now, rebalance between each other
  // sort peers by those that need the most sats
  liquidityTable.balancedNeeds.sort((a, b) => {return b.needs - a.needs});
  const blen = liquidityTable.balancedNeeds.length;
  for(i = 0; i < blen; i++) {
    if (currCount >= maxCount) break;
    const to = liquidityTable.balancedNeeds[i];
    console.log('[low volume]', to.name, to.peer, 'needs', to.needs, 'sats');
    if (liquidityTable.balancedHas.length === 0) {
      console.log(' found no peers that have sats for rebalance, skip');
      continue;
    }
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
      queue.add(from.peer, to.peer, from.name, to.name, amount, maxPpm, Date.now(), 'low volume');
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
      return console.log(colorRed, pref + 'too many pending htlcs, skip rebalance');
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

const jetExecPath = __dirname + '/utils/rebalance-proc';

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
    
    // spawn the process
    const sarg = {
      cmd: jetExecPath,
      arg: ['--from', item.from, '--to', item.to, '--amount', item.amount, '--ppm', item.maxPpm, '--type', '"' + item.type + '"'],
      log: '/tmp/rebalance_' + normalizeName(item.fromName) + '_' + normalizeName(item.toName) + '.log'
    }
    console.log('rebalancing queue: launching rebalance:', sarg);
    if (!testModeOn) spawnDetached(sarg);
  }
}

// determine if a rebalance is already in-flight based on
// peer pair. in-flight is either already running or in the
// queue.

var running;
var inFlightMap;

// is rebalance already running or in the queue
function isInFlight(from, to) {
  return queue.includes(from, to) || isRunning(from, to);
}

// count sats for peers in active rebalances or in the queue
function satsInFlight(peer) {
  return inFlightMap[peer] || { inbound:0, outbound: 0 };
}

function countInFlight() {
  return countRunning() + queue.count();
}

function initRunning() {
  running = listActiveRebalancesSync();
}

function initInFlight() {
  // sats in flight per peer, inbound and outbound
  // consists of rebalances in-flight plus pending htlcs on forwards
  // sats for rebalances in-flight are based on jet's rebalances,
  // as opposed to htlcs, as jet loops until the target amount is met
  // inbound - sats flowing into a channel, boosting local
  // outbout - sats flowing out of a channel, reducing local
  // build a list of all htlcs
  let list = [];
  pendingHtlcs.forEach(item => {
    // build a list of all htlcs in the from/to form
    if (!item.htlcs) return;
    item.htlcs.forEach(h => {
      let entry = {
        peer: item.peer,
        sats: parseInt(h.amount)
      }
      let include = true;
      if (h.forwarding_peer) {
        entry.forwarding_peer = h.forwarding_peer;
        // skip if an ongoing rebalance
        include = !isInFlight(h.forwarding_peer, entry.peer);
      }
      if (include) list.push(entry);
      else console.log('excluding', h.forwarding_peer, '->', entry.peer);
    })
  })
  // build a map of inbound & outbound sats
  let map = {};
  list.forEach(item => {
    let entry = map[item.peer];
    if (!entry) {
      entry = { outbound: 0, inbound: 0 };
      map[item.peer] = entry;
    }
    if (item.forwarding_peer) {
      let forward = map[item.forwarding_peer];
      if (!forward) {
        forward = { outbound: 0, inbound: 0 };
        map[item.forwarding_peer] = forward;
      }
      entry.inbound += item.sats;
      forward.outbound += item.sats;
    } else {
      entry.outbound += item.sats;
    }
  })
  // populate the map with rebalance sats
  if (running) {
    running.forEach(entry => {
      let from = map[entry.from];
      if (!from) {
        from = { outbound: 0, inbound: 0};
        map[entry.from] = from;
      }
      from.outbound += entry.amount;
      let to = map[entry.to];
      if (!to) {
        to = { outbound: 0, inbound: 0 };
        map[entry.to] = to;
      }
      to.inbound += entry.amount;
    })
  }
  
  inFlightMap = map;
}

function countRunning() {
  if (!running) return 0;
  return running.length;
}

function isRunning(from, to) {
  if (!running) return false;
  let found = false;
  running.forEach(r => {
    if (r.from === from && r.to === to) found = true;
  })
  return found;
}

// kick off the loops

const runLoopInterval = constants.services.rebalancer.loopInterval;
const processQueueInterval = 10; // sec

setInterval(runLoop, runLoopInterval * 1000);
setInterval(processQueue, processQueueInterval * 1000);

runLoop();
