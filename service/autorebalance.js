// jet start rebalancer

const date = require('date-and-time');
const {execSync} = require('child_process');
const {listActiveRebalancesSync} = require('../api/utils');
const {listRebalancesSync} = require('../db/utils');

const lndClient = require('../api/connect');
const config = require('../api/config');
const {exec} = require('child_process');
const {listChannelsMapSync} = require('../lnd-api/utils');
const {classifyPeersSync} = require('../lnd-api/utils');
const {listFeesSync} = require('../lnd-api/utils');
const {listPeersMapSync} = require('../lnd-api/utils');
const {stuckHtlcsSync} = require('../lnd-api/utils');
const {removeEmojis} = require('../lnd-api/utils');
const {isRunningSync} = require('../api/utils');
const {withCommas} = require('../lnd-api/utils');
const tags = require('../api/tags');

const constants = require('../api/constants');
const colorRed = constants.colorRed;
const colorGreen = constants.colorGreen;
const colorYellow = constants.colorYellow;

var max_commands = config.rebalancer.maxInstances || constants.rebalancer.maxInstances;

// process arguments; this is only applicable when the rebalancer is
// invoked directly via 'node service/autorebalance.js'. this is done
// when testing changes prior to git push, so make sure to specify
// --dryrun. 
if (process.argv && process.argv.length > 2) {
  let args = process.argv.slice(2);
  for(i = 0; i < args.length; i++) {
    if (args[i].indexOf('--dryrun') >= 0) {
      var dryRunOn = true;
      console.log('dry run enabled');
    } else if (args[i].indexOf('--max') >= 0) {
      max_commands = parseInt(args[i + 1]);
      i++;
    }
  }
}
console.log('max commands:', max_commands);

// only one instance allowed
if (!dryRunOn) {
  const fileName = require('path').basename(__filename);
  if (isRunningSync(fileName, true)) {
    return console.error(`${fileName} is already running, only one instance is allowed`);
  }
}

var tagsMap = {};
Object.keys(tags).forEach(tag => tagsMap[tags[tag]] = tag);

const round = n => Math.round(n);

const rebalanceHistoryDepth = 120; // mins
const loopInterval = 5; // mins

const max_per_peer = 5;
const min_to_rebalance = 50000; // sats
const max_ppm = config.rebalancer.maxAutoPpm || constants.rebalancer.maxAutoPpm;
const maxPendingHtlcs = config.rebalancer.maxPendingHtlcs || constants.rebalancer.maxPendingHtlcs;

console.log('max ppm:', max_ppm);
console.log('max pending htlcs:', maxPendingHtlcs);

var channels;
var classified;


classify();
if (!dryRunOn) {
  setInterval(classify, 2 * 60 * 60 * 1000);  // every 2h
  printHtlcHistory();
  setInterval(printHtlcHistory, 60 * 60 * 1000);  // every hour
}
runLoop();
if (!dryRunOn) {
  setInterval(runLoop, loopInterval * 60 * 1000);
}

function printHtlcHistory() {
  try {
    console.log(date.format(new Date, 'MM/DD hh:mm'));
    console.log('generating htlc history...');
    execSync('date +"%m/%d %H:%M" >> /tmp/htlchistory.log');
    exec('node htlc-history.js --d 7 >> /tmp/htlchistory.log & disown');
  } catch(error) {
    console.error('error running htlc history:', error.toString());
  }
}

function classify() {
  console.log('classifying peers...');
  classified = classifyPeersSync(lndClient);
}

var commands;
var peers;

function runLoop() {
  try {
    console.log('\n--------------------------------');
    channels = listChannelsMapSync(lndClient);
    commands = [];    // reset
    commandMap = {};  // reset
    peers = listPeersMapSync(lndClient);
    classified.inbound.forEach(c => { // first round
      autoRebalance(c.peer, false, true);
    })
    classified.inbound.forEach(c => { // second round
      autoRebalance(c.peer, false, false);
    })
    // sort balanced channels by available capacity
    classified.balanced.forEach(entry => {
      let ch = channels[entry.peer];
      entry.availableCapacity = ch.local_balance - Math.round(.5 * ch.capacity);
    })
    let balanced = classified.balanced.filter(entry => entry.availableCapacity > 0);
    balanced.sort(function(a, b) {
      return b.availableCapacity - a.availableCapacity;
    })
    balanced.forEach(c => {
      autoRebalance(c.peer, true);
    })
    executeCommands();
  } catch(error) {
    console.error(colorRed, 'error running the loop:', error.toString());
  }
}

function autoRebalance(inboundId, balanced, firstRound) {
  let inboundName = getNodeName(inboundId);
  if (!inboundName) throw new Error('couldnt identify node name');

  console.log(`\n${((balanced) ? '[balanced]' : '[inbound]')} ${inboundName}, id: ${inboundId}`);

  // check balances
  let remoteChannel = channels[inboundId];
  if (!remoteChannel) return console.error('couldnt find channel, skipping');
  console.log(inboundName, 'local balance:', withCommas(remoteChannel.local_balance), '(' + round(100*remoteChannel.local_balance/remoteChannel.capacity) + '%)');

  if (!channels[inboundId].active) {
    return console.log(colorYellow, 'the peer is inactive, skipping');
  }

  // min capacity to rebalance, 30% seems reasonable???
  if (remoteChannel.local_balance < .3 * remoteChannel.capacity) {
    return console.log(colorYellow, 'insufficient local balance');
  }

  // base amount to rebalance
  let base = round(.1 * remoteChannel.capacity);  // base - 10% of channel capacity
  if (balanced) {
    // take it easy on a balanced channel, at least 60% capacity
    if (remoteChannel.local_balance < .6 * remoteChannel.capacity) {
      return console.log(colorYellow, 'insufficient local balance');
    }
    // recalculate the base, take it a bit easy on a balanced channel
    let delta = Math.round(remoteChannel.local_balance - .5 * remoteChannel.capacity);
    base = Math.min(base, Math.round(.25 * delta)); // is quarter enough???
  } else if (remoteChannel.local_balance > .75 * remoteChannel.capacity) {
    base = round(.25 * remoteChannel.capacity); // plenty of liquidity, increase the base
  }

  if (balanced || firstRound) {
    classified.outbound.forEach(c => {
      if (c.peer === inboundId) return;
      let ch = channels[c.peer];
      if (c.name.indexOf('LNBIG.com') === 0) {  // special case???
        if (ch.local_balance < 2500000) {
          commands.push({from: inboundId, to: c.peer, amount: base});
        } else {
          console.log(colorYellow, `${c.name} has sufficient local capacity, skipping`);
        }
      } else {
        // maintain at least 50% of capacity on outbound channels
        // ok to be more aggressive on outbound channels and with
        // the max available liquidity
        if (ch.local_balance < .5 * ch.capacity) {
          commands.push({from: inboundId, to: c.peer, amount: base});
        } else {
          console.log(colorYellow, `${c.name} has sufficient local capacity, skipping`);
        }
      }
    })
  }

  // balanced channels, ensure local has at least 40% capacity
  if (balanced || !firstRound) {
    classified.balanced.forEach(c => {
      if (c.peer === inboundId) return;

      let ch = channels[c.peer];
      let name = getNodeName(c.peer);

      if (ch.local_balance >= .5 * ch.capacity) {
        console.log(colorYellow, `${c.name} is already balanced, skipping`);
        return;  // already balanced
      }

      // calculate amount to rebalance; take it more gradually on outbound channels
      let delta = Math.round(.5 * ch.capacity - ch.local_balance);
      let rebalanceAmount = Math.round(Math.min(base, .25 * delta));  // is quarter sufficient????
      //console.log('name:', name, 'delta:', delta, 'base:', base, 'amount:', rebalanceAmount);

      commands.push({from: inboundId, to: c.peer, amount: rebalanceAmount});
    })
  }
}

function executeCommands() {
  console.log('\nexecuting commands...');
  let history = listRebalancesSync(rebalanceHistoryDepth * 60);
  let htlcs = stuckHtlcsSync(lndClient);
  var running = initRunning();
  if (commands.length === 0) return console.log(colorRed, 'no new commands to run');

  if (countRunning() >= max_commands) {
    return console.log(colorYellow, 'already at max commands:', max_commands);
  }

  let count = 0;
  for(i = 0; i < commands.length && countRunning() <= max_commands; i++) {
    console.log();
    let c = commands[i];
    // exceeds the max count?
    //console.log(`currently running commands: ${countRunning()}`);
    if (countRunning() >= max_commands) {
      console.log(colorYellow, 'reached max commands:', max_commands);
      break;
    }

    try {
      printCommand(c);
      if (isRunning(c)) {
        console.log(colorYellow, 'already running');
        continue;
      }
      if (c.amount < min_to_rebalance) {
        console.log(colorYellow, 'too small of an amount to rebalance');
        continue;
      }

      let fromName = getNodeName(c.from);
      let toName = getNodeName(c.from);

      // determine max commands for the node based on rebalance history
      // and stuck htlcs
      let peerMax = max_per_peer;
      let fromId = tags[c.from] || c.from;
      let toId = tags[c.to] || c.to;

      // count stuck htlcs
      let countHtlcs = 0;
      htlcs.forEach(h => {
        if (h.peer === fromId) countHtlcs = h.htlcs.length;
      })
      console.log(`stuck htlcs for ${fromName}:`, countHtlcs);
      if (countHtlcs >= maxPendingHtlcs) {
        console.log(colorRed, 'too many stuck htlcs, skip rebalance');
        continue;
      }

      let countSuccessful = 0;
      let countFailed = 0;
      history.forEach(h => {
        if (h.from === fromId && h.status) countSuccessful++;
        if (h.from === fromId && !h.status) countFailed++;
      })
      if (countFailed > 0) {
        peerMax = Math.ceil(peerMax * countSuccessful / (countSuccessful + countFailed));
      } else if (countSuccessful === 0) {
        peerMax = Math.ceil(peerMax * .25);  // don't be too aggressive if there is lack of history
      }
      peerMax = Math.max(peerMax, 1); // ensure at least one rebalance, otherwise too long to recover
      console.log('max commands for ' + fromName + ':', peerMax);

      if (countForPeer(c.from) >= peerMax) {
        console.log(colorYellow, 'reached max commands for', fromName, peerMax);
        continue;
      }

      // execute
      let e = 'nohup jet rebalance ' + c.from + ' ' + c.to + ' ' + c.amount + ' --ppm ' + max_ppm + ' >> /tmp/rebalance_' + normalizeName(c.from) + '_' + normalizeName(c.to) + '.log 2>&1 & disown';
      //console.log(e);
      if (!dryRunOn) exec(e);
      count++;
      addRunning(c);
      console.log(colorGreen, 'successfully launched command, total running:', countRunning());
    } catch(error) {
      console.error(colorRed, error.toString());
    }
  }
  if (count === 0) {
    console.log(colorGreen, 'no new commands to run');
  }

  function printCommand(c) {
    console.log({from: getNodeName(c.from), to: getNodeName(c.to), amount: c.amount});
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

  function initRunning() {
    let list = listActiveRebalancesSync();
    if (!list) return {};
    let map = {};
    list.forEach(l => {
      let entry = map[l.from];
      if (!entry) { 
        entry = {};
        map[l.from] = entry;
      }
      entry[l.to] = true;
    })
    return map;
  }

  function addRunning(c) {
    if (!running) return;
    let entry = running[c.from];
    if (!entry) { 
      entry = {};
      running[c.from] = entry;
    }
    entry[c.to] = true;
  }

  function isRunning(c) {
    //console.log('c:', c);
    //console.log('running:', running);
    return running && running[c.from] && running[c.from][c.to];
  }
}

// either a tag or an alias
function getNodeName(id) {
  return tagsMap[id] || peers[id].name;
}

// generate a normalized and unique node name for a log file
function normalizeName(id) {
  if (tagsMap[id]) return tagsMap[id];
  let name = peers[id].name;
  name = removeEmojis(name);
  return name.replace(constants.logNameRegEx, "").substring(0, 15); // hardcoded???
}
