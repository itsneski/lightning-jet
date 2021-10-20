const {execSync} = require('child_process');
const lndClient = require('./connect');
const {listPeersMapSync} = require('../lnd-api/utils');
const {stuckHtlcsSync} = require('../lnd-api/utils');
const {listRebalancesSync} = require('./db');
const {withCommas} = require('../lnd-api/utils');
const {getInfoSync} = require('../lnd-api/utils');
const {listPendingChannelsSync} = require('../lnd-api/utils');
const {getNodesInfoSync} = require('../lnd-api/utils');
const date = require('date-and-time');


module.exports = {
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
  stuckHtlcsFormattedSync() {
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
  listActiveRebalancesSync: function() {
    try {
      var result = execSync('ps -aux | grep bosrebalance.js | grep -v grep').toString().trim();
    } catch(error) {
      // not a critical error??
      return undefined;
    }

    let list = [];
    let lines = result.split(/\r?\n/);
    if (lines.length === 0) return undefined;
    lines.forEach(l => {
      let pref = 'bosrebalance.js';
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
