// analyzes htlcs logged in htlc-logger.db

const fs = require('fs');
const lndClient = require('./connect');
const {getInfoSync} = require('../lnd-api/utils');
const {listChannelsSync} = require('../lnd-api/utils');
const {listPeersSync} = require('../lnd-api/utils');
const {listPeersMapSync} = require('../lnd-api/utils');
const {listHtlcsSync} = require('../db/utils');
const {withCommas} = require('../lnd-api/utils');
const date = require('date-and-time');

module.exports = {
  htlcAnalyzerNode(node, days = 1) {
    if (!node) throw new Error('node is missing');

    // find node id
    let peers = listPeersSync(lndClient);
    let nodeId;
    let matches = [];
    let peerMap = {};
    peers.forEach(p => {
      peerMap[p.id] = p.name;
      if (p.id === node) {
        nodeId = p.id;
        matches.push(p);
        return;
      }
      let lc1 = p.name.toLowerCase();
      let lc2 = node.toLowerCase();
      if (lc1.indexOf(lc2) >= 0) {
        nodeId = p.id;
        matches.push(p);
        return;
      }
    })
    if (!nodeId) throw new Error('couldnt find node id');
    if (matches.length > 1) {
      let names = [];
      matches.forEach(m => names.push(m.name));
      throw new Error('multiple node id matches ' + names);
    }

    // find chan
    let chan;
    let chanMap = {};
    listChannelsSync(lndClient).forEach(c => {
      if (c.remote_pubkey === nodeId) chan = c.chan_id;
      chanMap[c.chan_id] = c.remote_pubkey;
    })
    if (!chan) throw new Error('couldnt locate channel');

    // now get htlcs
    let unknown = [];
    let formatted = [];
    let htlcs = listHtlcsSync({toChan:chan, days:days});

    if (!htlcs || htlcs.length === 0) return;

    // sort & get stats
    let stats = {
      id: nodeId,
      name: peerMap[nodeId],
      total: 0,
      count: 0
    }
    htlcs.sort(function(a, b) { return b.date - a.date });
    htlcs.forEach(h => {
      if (!chanMap[h.from_chan]) {
        unknown.push(h.from_chan);
        return;
      }
      stats.total += h.sats;
      stats.count++;
    })

    if (stats.count === 0) return;

    stats.avg = Math.round(stats.total / stats.count);
    if (unknown.length > 0) stats.unknown = unknown;

    // create per-peer map
    let perPeerMap = {};
    htlcs.forEach(h => {
      if (!perPeerMap[h.from_chan]) perPeerMap[h.from_chan] = { total: 0, count: 0 };
      perPeerMap[h.from_chan].total += h.sats;
      perPeerMap[h.from_chan].count++;
    })
    let peerStats = [];
    Object.keys(perPeerMap).forEach(c => {
      peerStats.push({
        from: peerMap[chanMap[c]],
        sats: perPeerMap[c].total,
        count: perPeerMap[c].count,
        avg: Math.round(perPeerMap[c].total / perPeerMap[c].count)
      })
    })
    peerStats.sort(function(a, b) { return b.sats - a.sats });
    peerStats.forEach(s => {
      s.sats = withCommas(s.sats);
      s.avg = withCommas(s.avg);
    })

    // format
    htlcs.forEach(h => {
      formatted.push({
        date: date.format(new Date(h.date), 'MM/DD hh:mm:ss A'),
        from: peerMap[chanMap[h.from_chan]],
        sats: withCommas(h.sats)
      })
    })

    return {
      stats: stats,
      peers: peerStats,
      list: formatted
    }
  },
  htlcAnalyzer(days = 1) {
    let curr;
    let htlcs = listHtlcsSync({days:days});

    if (htlcs.length === 0) return console.log('no events found');

    let perPeerMap = {};
    let sumMap = {};
    htlcs.forEach(h => {
      if (h.from_chan == '0') return;  // skip rebalances from my node

      // cumulative peer stats
      if (!perPeerMap[h.to_chan]) perPeerMap[h.to_chan] = { total:0, count: 0 };
      perPeerMap[h.to_chan].total += h.sats;
      perPeerMap[h.to_chan].count++;

      let item = sumMap[h.from_chan] && sumMap[h.from_chan][h.to_chan];
      if (!item) {
        item = { sum: 0, count: 0 };
        sumMap[h.from_chan] = sumMap[h.from_chan] || {};
        sumMap[h.from_chan][h.to_chan] = item;
      }
      item.sum += h.sats;
      item.count++;
    })

    // format for printing
    let channelMap = {};
    let channels = listChannelsSync(lndClient).forEach(c => {
      channelMap[c.chan_id] = c;
    })
    let peerMap = listPeersMapSync(lndClient);
    let formatted = [];
    let info = getInfoSync(lndClient);

    let sum = 0;
    Object.keys(sumMap).forEach(k => {
      Object.keys(sumMap[k]).forEach(l => {
        if (!channelMap[k]) {
          return console.error('unknown channel:', k);
        }
        if (!channelMap[l]) {
          return console.error('unknown channel:', l);
        }
        let name = (k == '0') ? info.alias : peerMap[channelMap[k].remote_pubkey].name
        formatted.push({
          from: name,
          to: peerMap[channelMap[l].remote_pubkey].name,
          sats: sumMap[k][l].sum,
          avg: Math.round(sumMap[k][l].sum / sumMap[k][l].count),
          count: sumMap[k][l].count
        })
        sum += sumMap[k][l].sum;
      })
    })
    formatted.sort(function(a, b) {
      return b.sats - a.sats;
    })
    formatted.forEach(f => {
      f.p = Math.round(100 * f.sats / sum);
      f.sats = withCommas(f.sats);
      f.avg = withCommas(f.avg);
    })

    // format for printing
    let peerStats = [];
    Object.keys(perPeerMap).forEach(c => {
      if (!channelMap[c]) return; // unknown channel, already reported above
      peerStats.push({
        to: peerMap[channelMap[c].remote_pubkey].name,
        sats: perPeerMap[c].total,
        count: perPeerMap[c].count,
        avg: Math.round(perPeerMap[c].total / perPeerMap[c].count),
        p: Math.round(100 * perPeerMap[c].total / sum)
      })
    })
    peerStats.sort(function(a, b) { return b.sats - a.sats });
    peerStats.forEach(s => {
      s.sats = withCommas(s.sats);
      s.avg = withCommas(s.avg);
    })

    return {
      peers: peerStats,
      list: formatted
    }
  }
}
