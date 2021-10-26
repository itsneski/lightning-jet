// analyzes htlcs logged in htlc-logger.db

const fs = require('fs');
const lndClient = require('./connect');
const {getInfoSync} = require('../lnd-api/utils');
const {listChannelsSync} = require('../lnd-api/utils');
const {listPeersMapSync} = require('../lnd-api/utils');
const {listHtlcsSync} = require('../db/utils');
const {withCommas} = require('../lnd-api/utils');

module.exports = {
  htlcAnalyzer: function(days = 1) {
    let curr;
    let htlcs = listHtlcsSync(days);

    if (htlcs.length === 0) return console.log('no events found');

    let sumMap = {};
    htlcs.forEach(h => {
      if (h.from_chan == '0') return;  // skip rebalances from my Node
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
    return formatted;
  }
}
