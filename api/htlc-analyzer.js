// analyzes htlcs logged in htlc-logger.db

const fs = require('fs');
const lndClient = require('./connect');
const {getInfoSync} = require('../lnd-api/utils');
const {listChannelsSync} = require('../lnd-api/utils');
const {listPeersSync} = require('../lnd-api/utils');
const {listPeersMapSync} = require('../lnd-api/utils');
const {listHtlcsSync} = require('../db/utils');
const {withCommas} = require('../lnd-api/utils');
const {classifyPeersSync} = require('./utils');
const date = require('date-and-time');

module.exports = {
  // overrides classifyPeersSync in api/utils. amends prioritization
  // of peers based on missed routing opportunities
  classifyPeersAnalyzer() {
    let htlcs = module.exports.htlcAnalyzer();
    let classify = classifyPeersSync(lndClient);
    if (!htlcs.peers || htlcs.peers.length === 0) return classify;
    
    // create a map for easy access
    let peerMap = {};
    htlcs.peers.forEach(p => peerMap[p.toId] = p);
    let outboundMap = {};
    if (classify.outbound) {
      classify.outbound.forEach(n => { if (!outboundMap[n.peer]) outboundMap[n.peer] = n});
    }
    let balancedMap = {};
    if (classify.balanced) {
      classify.balanced.forEach(n => {if (!balancedMap[n.peer]) balancedMap[n.peer] = n});
    }

    // amend prioritization of outbound and balanced peers based on
    // missed htlcs. current algo focuses on the outliers
    // with p of at least 10% of the total missed.
    htlcs.peers.forEach(p => {
      if (p.p < 10) return;
      let item = outboundMap[p.toId] || balancedMap[p.toId];
      if (!item) return;  // neither outbound nor balanced
      if (p.sats < .25 * item.sum) return; // revisit, ensure sufficient volume of missed sats, currently daily missed sats should be at least 25% of weekly routed
      item.pMissed = p.p;
      // record amended
      classify.amended = classify.amended || [];
      classify.amended.push(p);
      // move from balanced to outbound list to give it higher priority; revisit
      if (balancedMap[p.toId]) {
        let b = balancedMap[p.toId];
        let index = 0;
        for(i = 0; i < classify.balanced.length; i++) {
          if (classify.balanced[i].id === b.id) index = i;
        }
        classify.balanced.splice(index, 1);
        classify.outbound.push(b);
        balancedMap[p.toId] = undefined;
      }
    })

    // now resort
    resort(classify.outbound);
    resort(classify.balanced);

    return classify;

    function resort(list) {
      list.sort((a, b) => {
        if (a.pMissed && b.pMissed) return b.pMissed - a.pMissed;
        if (a.pMissed) return -1;
        if (b.pMissed) return 1;
        if (a.p && b.p) return b.p - a.p;
        return 0;
      })
    } 
  },
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
  htlcAnalyzerFormatted(days) {
    let res = module.exports.htlcAnalyzer(days);
    if (!res) return;
    if (res.peers) {
      res.peers.forEach(p => {
        p.sats = withCommas(p.sats);
        p.avg = withCommas(p.avg);
        delete p.toId;
      })
    }
    if (res.list) {
      res.list.forEach(p => {
        p.sats = withCommas(p.sats);
        p.avg = withCommas(p.avg);
        delete p.fromId;
        delete p.toId;
      })
    }
    return res;
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
          fromId: channelMap[k].remote_pubkey,
          to: peerMap[channelMap[l].remote_pubkey].name,
          toId: channelMap[l].remote_pubkey,
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
    })

    // format for printing
    let peerStats = [];
    Object.keys(perPeerMap).forEach(c => {
      if (!channelMap[c]) return; // unknown channel, already reported above
      peerStats.push({
        to: peerMap[channelMap[c].remote_pubkey].name,
        toId: channelMap[c].remote_pubkey,
        sats: perPeerMap[c].total,
        count: perPeerMap[c].count,
        avg: Math.round(perPeerMap[c].total / perPeerMap[c].count),
        p: Math.round(100 * perPeerMap[c].total / sum)
      })
    })
    peerStats.sort(function(a, b) { return b.sats - a.sats });

    return {
      peers: peerStats,
      list: formatted
    }
  }
}
