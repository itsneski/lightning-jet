const {execSync} = require('child_process');
const lndClient = require('./connect');
const {listPeersMapSync} = require('../lnd-api/utils');
const {stuckHtlcsSync} = require('../lnd-api/utils');
const {listRebalancesSync} = require('../db/utils');
const {withCommas} = require('../lnd-api/utils');
const {getInfoSync} = require('../lnd-api/utils');
const {listPendingChannelsSync} = require('../lnd-api/utils');
const {getNodesInfoSync} = require('../lnd-api/utils');
const {listPeersSync} = require('../lnd-api/utils');
const {classifyPeersSync} = require('../lnd-api/utils');
const {listFeesSync} = require('../lnd-api/utils');
const {removeEmojis} = require('../lnd-api/utils');
const constants = require('./constants');
const config = require('./config');
const findProc = require('find-process');

const date = require('date-and-time');

module.exports = {
  // rebalance margin for circular rebalance; rebalance will be profitable as long as
  // its ppm is below the margin
  rebalanceMargin(localFee, remoteFee) {
    return Math.round(localFee.base/1000 + localFee.rate - (remoteFee.base/1000 + remoteFee.rate));
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
  listPeersFormattedSync() {
    let IN_PEERS = {};
    let OUT_PEERS = {};
    let BALANCED_PEERS = {};
    let SKIPPED_PEERS = {};

    let classified = classifyPeersSync(lndClient);
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
  rebalanceHistoryFormattedSync(secs = -1) {
    let peers = listPeersMapSync(lndClient);
    let list = listRebalancesSync(secs);

    let formatted = [];
    list.forEach(l => {
      let item = {
        date: parseInt(l.date),
        from: peers[l.from].name,
        to: peers[l.to].name,
        amount: withCommas(l.amount),
      }
      if (l.rebalanced) item.rebalanced = withCommas(l.rebalanced);
      item.status = (l.status === 1) ? 'success' : 'failed';
      if (l.extra) item.error = l.extra;
      formatted.push(item);
    })
    formatted.sort(function(a, b) {
      return b.date - a.date;
    })
    formatted.forEach(f => {
      f.date = date.format(new Date(f.date), 'MM/DD hh:mm');
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
    try {
      var result = execSync('ps -aux | grep "jet rebalance" | grep -v grep').toString().trim();
    } catch(error) {
      // not a critical error??
      return;
    }

    let list = [];
    let lines = result.split(/\r?\n/);
    if (lines.length === 0) return;
    lines.forEach(l => {
      let pref = 'jet rebalance';
      if (l.indexOf(pref) < 0) return;
      let tok = l.substring(l.indexOf(pref) + pref.length).split(' ');
      let from, to, amount, ppm;
      tok.forEach(t => {
        let val = t.trim();
        if (val.length <= 0) return;
        if (!from) from = val;
        else if (!to) to = val;
        else if (!amount) amount = parseInt(val);
        else if (!ppm && val !== '--ppm') ppm = parseInt(val);
      })
      let item = {from:from, to:to, amount: amount};
      if (ppm) item.ppm = ppm;
      list.push(item);
    })
    return list;
  }
}
