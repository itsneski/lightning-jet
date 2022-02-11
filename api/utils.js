const importLazy = require('import-lazy')(require);
const {execSync} = require('child_process');
const lndClient = importLazy('./connect');
const {listPeersMapSync} = require('../lnd-api/utils');
const {listChannelsSync} = require('../lnd-api/utils');
const {stuckHtlcsSync} = require('../lnd-api/utils');
const {listRebalancesSync} = require('../db/utils');
const {withCommas} = require('../lnd-api/utils');
const {getInfoSync} = require('../lnd-api/utils');
const {listPendingChannelsSync} = require('../lnd-api/utils');
const {getNodesInfoSync} = require('../lnd-api/utils');
const {listPeersSync} = require('../lnd-api/utils');
const {listFeesSync} = require('../lnd-api/utils');
const {removeEmojis} = require('../lnd-api/utils');
const {htlcHistorySync} = require('../lnd-api/utils');
const tags = importLazy('./tags');
const constants = require('./constants');
const config = importLazy('./config');
const findProc = require('find-process');
const date = require('date-and-time');

const round = n => Math.round(n);
const pThreshold = 1; // %

module.exports = {
  rebalanceHistoryConsolidated(hours = 1) {
    let history = listRebalancesSync(hours * 60 * 60);  // in secs
    if (!history || history.length === 0) return;
    let peerMap = {};
    let countFailures = 0;  
    history.forEach(n => {
      let entry = peerMap[n.to];
      if (!entry) {
        entry = { count: 0, map: {} };
        peerMap[n.to] = entry;
      }
      if (n.status !== 0) return; // skip success
      countFailures++;
      entry.count++;
      if (!entry.map[n.extra]) entry.map[n.extra] = 0;
      entry.map[n.extra]++;
    })
    let map = {};
    Object.keys(peerMap).forEach(n => {
      let entry = peerMap[n];
      map[n] = Math.round(100 * entry.count / history.length);
    })
    return {total: history.length, failures: countFailures, map};
  },

  // resolve a node based on a partial alias or a tag
  resolveNode(str, peers) {
    if (!str) return new Error('str is missing');
    let peerList = peers || listPeersSync(lndClient);
    let matches = [];
    let id = tags[str];
    peerList.forEach(p => {
      if (str === p.id) {
        matches.push({id:p.id, name:p.name});
      } else if (id === p.id) {
        matches.push({id:p.id, name:p.name});
      } else {
        let lc1 = str.toLowerCase();
        let lc2 = p.name.toLowerCase();
        if (lc2.indexOf(lc1) >= 0) matches.push({id:p.id, name:p.name});
      }
    })
    return (matches.length > 0) ? matches : undefined;
  },
  classifyPeersSync: function(lndClient, days = 7) {
    let history = htlcHistorySync(lndClient, days);
    let inSum = 0;
    let outSum = 0;
    let historyMap = {};
    history.inbound.forEach(h => inSum += h.sum);
    history.outbound.forEach(h => outSum += h.sum);
    history.inbound.forEach(h => {
      h.p = round(100 * h.sum / inSum);
      historyMap[h.id] = h;
    })
    history.outbound.forEach(h => {
      h.p = round(100 * h.sum / outSum);
      historyMap[h.id] = h;
    })

    // now classify; nodes with less than a week lifetime are
    // classified balanced
    let balanced = {};
    let inbound = {};
    const currTime = Math.floor(+new Date() / 1000);
    const minlife = 7 * 24 * 60 * 60; // one week
    history.inbound.forEach(h => {
      if (h.p >= pThreshold) {
        inbound[h.id] = h;
        delete balanced[h.id];
      } else if (currTime - h.lifetime < minlife) {
        balanced[h.id] = h;
      }
    })
    let outbound = {};
    history.outbound.forEach(h => {
      if (h.p >= pThreshold) {
        if (inbound[h.id]) {
          if (h.sum > inbound[h.id].sum) {
            h.split = Math.round(100 * h.sum / (h.sum + inbound[h.id].sum));
            outbound[h.id] = h;
            delete inbound[h.id];
            delete balanced[h.id];
          } else {
            // calculate % split between inbound and outbound routing
            inbound[h.id].split = Math.round(100 * inbound[h.id].sum / (h.sum + inbound[h.id].sum));
          }
        } else {
          outbound[h.id] = h;
          delete balanced[h.id];
        }
      } else if (currTime - h.lifetime < minlife) {
        balanced[h.id] = h;
      }
    })

    const minCapacity = config.rebalancer.minCapacity || constants.rebalancer.minCapacity;
    let skipped = {};
    let peers = listPeersMapSync(lndClient);
    let channels = listChannelsSync(lndClient);
    channels.forEach(c => {
      let entry = inbound[c.chan_id] || outbound[c.chan_id] || balanced[c.chan_id];
      if (entry) {
        entry.capacity = parseInt(c.capacity);
        entry.local = parseInt(c.local_balance);
        entry.remote = parseInt(c.remote_balance);
        return;
      }
      let map;
      if (c.capacity < minCapacity) {  // should we even have tiny nodes?
        // skip tiny nodes
        map = skipped;
      } else {
        map = balanced;
      }
      if (map) {
        map[c.chan_id] = {
          id: c.chan_id,
          peer: c.remote_pubkey,
          name: peers[c.remote_pubkey].name,
          lifetime: c.lifetime,
          capacity: parseInt(c.capacity),
          local: parseInt(c.local_balance),
          remote: parseInt(c.remote_balance)
        }

        if (c.p != undefined) map[c.chan_id].p = c.p;
      }
    })

    let inboundSorted = Object.values(inbound);
    inboundSorted.sort(function(a, b) {
      return b.p - a.p;
    })
    let outboundSorted = Object.values(outbound);
    outboundSorted.sort(function(a, b) {
      return b.p - a.p;
    })

    return ({
      inbound: inboundSorted,
      outbound: outboundSorted,
      balanced: Object.values(balanced),
      skipped: Object.values(skipped)
    })
  },
  // make sure that telegram isn't getting swamped with messages
  // ensures that a message is getting more often than once in
  // a time period specified in interval (secods) 
  sendTelegramMessageTimed(msg, category, interval) {
    const {getPropAndDateSync} = require('../db/utils');
    const {setPropSync} = require('../db/utils');
    let val = getPropAndDateSync(category);
    if (!val || (Date.now() - val.date) > interval * 1000) {
      const {sendMessage} = require('./telegram');
      sendMessage(msg);
      setPropSync(category, msg);
    }
  },
  // rebalance margin for circular rebalance; rebalance will be profitable as long as
  // its ppm is below the margin
  rebalanceMargin(localFee, remoteFee) {
    return Math.round(localFee.base/1000 + localFee.rate - (remoteFee.base/1000 + remoteFee.rate));
  },
  // is process running
  isRunningPidSync(pid) {
    let done, res;
    findProc('pid', pid).then(list => {
      res = list;
      done = true;
    }, err => {
      done = true;
    })
    while(!done) {
      require('deasync').runLoopOnce();
    }
    return res && res.length > 0;
  },
  // is process running
  isRunningSync(proc, self = false) {
    let res;
    findProc('name', proc).then(list => res = list);
    while(res === undefined) {
      require('deasync').runLoopOnce();
    }
    return (self) ? res.length > 1 : res.length > 0;
  },
  listPeersFormattedSync(days = 7) {
    let IN_PEERS = {};
    let OUT_PEERS = {};
    let BALANCED_PEERS = {};
    let SKIPPED_PEERS = {};

    let classified = module.exports.classifyPeersSync(lndClient, days);
    classified.inbound.forEach(c => {
      IN_PEERS[c.peer] = { p: c.p };
    })
    classified.outbound.forEach(c => {
      OUT_PEERS[c.peer] = { p: c.p };
    })
    classified.balanced.forEach(c => {
      BALANCED_PEERS[c.peer] = { p: c.p };
    })
    classified.skipped.forEach(c => {
      SKIPPED_PEERS[c.peer] = { p: c.p };
    })

    let peers = listPeersSync(lndClient);
    let feeMap = {};
    listFeesSync(lndClient).forEach(f => {
      feeMap[f.id] = f;
    })

    let allPeers = [];
    peers.forEach(p => allPeers.push(convertPeer(p)) );

    allPeers.sort(function(a, b) {
      return a.in - b.in;
    })
    allPeers.forEach(p => delete p.p);  // no need
    allPeers.forEach(p => { p.in = withCommas(p.in); p.out = withCommas(p.out); });

    let inPeers = [];
    peers.forEach(p => {
      if (IN_PEERS[p.id]) {
        let peer = convertPeer(p, IN_PEERS[p.id], true);
        peer.ppm = parseInt(feeMap[p.id].local.rate);
        inPeers.push(peer);
      }
    })
    inPeers.sort(function(a, b) {
      return b.p - a.p;
    })
    inPeers.forEach(p => { p.in = withCommas(p.in); p.out = withCommas(p.out); });

    let outPeers = [];
    peers.forEach(p => {
      if (OUT_PEERS[p.id]) {
        let peer = convertPeer(p, OUT_PEERS[p.id]);
        let fee = feeMap[p.id];
        peer.ppm = parseInt(fee.local.rate);
        peer.margin = module.exports.rebalanceMargin(fee.local, fee.remote);
        outPeers.push(peer);
      }
    })
    outPeers.sort(function(a, b) {
      return b.p - a.p;
    })
    outPeers.forEach(p => { p.in = withCommas(p.in); p.out = withCommas(p.out); });

    let balancedPeers = [];
    peers.forEach(p => {
      if (BALANCED_PEERS[p.id]) {
        let peer = convertPeer(p, BALANCED_PEERS[p.id]);
        peer.ppm = parseInt(feeMap[p.id].local.rate);
        balancedPeers.push(peer);
      }
    })
    balancedPeers.sort(function(a, b) {
      return a.out - b.out;
    })
    balancedPeers.forEach(p => delete p.p);  // no need
    balancedPeers.forEach(p => { p.in = withCommas(p.in); p.out = withCommas(p.out); });

    let skippedPeers = [];
    peers.forEach(p => {
      if (SKIPPED_PEERS[p.id]) skippedPeers.push(convertPeer(p, SKIPPED_PEERS[p.id]));
    })
    skippedPeers.sort(function(a, b) {
      return a.out - b.out;
    })
    skippedPeers.forEach(p => delete p.p);  // no need
    skippedPeers.forEach(p => { p.in = withCommas(p.in); p.out = withCommas(p.out); });

    return {
      all: allPeers,
      inbound: inPeers,
      outbound: outPeers,
      balanced: balancedPeers,
      skipped: skippedPeers
    }
    
    function convertPeer(p, pp = undefined, inbound = false) {
      let s = (inbound) ? { name: p.name, in: p.in, out: p.out } : { name: p.name, out: p.out, in: p.in };
      if (pp && pp.p) s.p = pp.p; else s.p = 0;
      if (!p.active) s.name = '💀 ' + s.name;
      return s;
    }
  },
  listForcedClosingFormattedSync() {
    let pending = listPendingChannelsSync(lndClient);
    let pendingPeers = [];
    Object.keys(pending).forEach(k => {
      if (k === 'total_limbo_balance') return;
      pending[k].forEach(p => {
        pendingPeers.push(p.channel.remote_node_pub);
      })
    })
    if (pendingPeers.length === 0) return;
    let pendingInfo = getNodesInfoSync(lndClient, pendingPeers);
    let pendingMap = {};
    pendingInfo.forEach(i => {
      if (!i) return; // https://github.com/itsneski/lightning-jet/issues/30
      pendingMap[i.node.pub_key] = i.node.alias;
    })

    formatted = [];
    let list = pending.pending_force_closing_channels;
    if (list && list.length > 0) {
      list.forEach(p => {
        let maturity = p.blocks_til_maturity;
        p.pending_htlcs.forEach(h => maturity = Math.max(maturity, h.blocks_til_maturity));
        formatted.push({
          peer: pendingMap[p.channel.remote_node_pub],
          limbo: withCommas(p.limbo_balance),
          htlcs: p.pending_htlcs.length,
          maturity: maturity,
          time: (maturity * 10 / 60).toFixed(1)
        })
      })
    }
    return formatted;
  },
  pendingHtlcsFormattedSync() {
    let htlcs = stuckHtlcsSync(lndClient);
    let peers = listPeersMapSync(lndClient);
    let info = getInfoSync(lndClient);
    let formatted = [];
    htlcs.forEach(h => {
      h.htlcs.forEach(t => {
        formatted.push({
          peer: peers[h.peer].name,
          ttl: t.expiration_height - info.block_height,
          incoming: t.incoming,
          amount: withCommas(t.amount),
          channel: t.forwarding_channel
        })
      })
    })
    return formatted;
  },
  rebalanceHistoryFormattedSync(secs = -1, filter, node) {
    let peers = listPeersMapSync(lndClient);
    let status;
    if (filter) status = (filter === 'success') ? 1 : 0;
    let list = listRebalancesSync(secs, status, node);

    let formatted = [];
    list.forEach(l => {
      let item = {
        date: parseInt(l.date),
        from: (peers[l.from]) ? peers[l.from].name : l.from,
        to: (peers[l.to]) ? peers[l.to].name : l.to,
        amount: withCommas(l.amount),
      }
      if (l.rebalanced) item.rebalanced = withCommas(l.rebalanced);
      item.status = (l.status === 1) ? 'success' : 'failed';
      if (l.extra) item.error = l.extra;
      if (l.ppm > 0) item.ppm  = l.ppm;
      if (l.min > 0) item.min = l.min;
      formatted.push(item);
    })
    formatted.sort(function(a, b) {
      return b.date - a.date;
    })
    formatted.forEach(f => {
      f.date = date.format(new Date(f.date), 'MM/DD hh:mm A');
    })
    return formatted;
  },
  listActiveRebalancesFormattedSync: function() {
    let list = module.exports.listActiveRebalancesSync();
    if (!list) return;
    let peers = listPeersMapSync(lndClient);
    let tags = require('./tags');
    let tagsMap = {};
    Object.keys(tags).forEach(t => tagsMap[tags[t]] = t);
    list.forEach(l => {
      // fix listActiveRebalancesSync so that it always returns ids, not tags
      l.from = tagsMap[l.from] || (peers[l.from] && peers[l.from].name) || l.from;
      l.to = tagsMap[l.to] || (peers[l.to] && peers[l.to].name) || l.to;
      l.log = '/tmp/rebalance_' + forLog(l.from) + '_' + forLog(l.to) + '.log';
    })
    return list;

    function forLog(str) {   // copy & paste from autorebalance???
      let name = removeEmojis(str);
      return name.replace(constants.logNameRegEx, "").substring(0, 15);
    }
  },
  listActiveRebalancesSync: function() {
    const dbUtils = require('../db/utils');
    let list = dbUtils.listActiveRebalancesSync();
    if (!list || list.length === 0) return;

    // clean up the list, remove processes that no longer exist
    let updated = [];
    list.forEach(l => {
      if (module.exports.isRunningPidSync(l.pid)) {
        // recalculate minites left
        let minsLeft = l.mins - Math.round((Date.now() - l.date)/(60 * 1000));
        updated.push({from:l.from_node, to:l.to_node, amount:l.amount, ppm:l.ppm, mins:minsLeft});
      } else {
        // for whatever reason the record lingers even though the process
        // is gone. clean up
        dbUtils.deleteActiveRebalance(l.rowid);
      }
    })
    return updated;
  },
  readLastLineSync: function(file) {
    let lastLine;
    let done;
    const fs = require('fs');
    const readline = require('readline');
    const readInterface = readline.createInterface({
      input: fs.createReadStream(file),
      console: false
    })

    readInterface.on("line", function(line){
      lastLine = line;
    }).on("close", function() {
      done = true;
    })

    while(done === undefined) {
      require('deasync').runLoopOnce();
    }
    return lastLine;
  }
}
