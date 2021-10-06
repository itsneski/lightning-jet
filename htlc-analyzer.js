// analyzes htlcs logged in htlc-logger.db

const fs = require('fs');
const lndClient = require('./api/connect');
const {getInfoSync} = require('./lnd-api/utils');
const {listChannelsSync} = require('./lnd-api/utils');
const {listPeersMapSync} = require('./lnd-api/utils');

const FILE = './htlc-logger.db';

try {
  var data = fs.readFileSync(FILE, { encoding:'utf8', flag:'r' });
} catch(error) {
  return console.error('error reading from ' + FILE + ':', error.toString());
}

let htlcs = [];
let curr;
data.split(/\r?\n/).forEach(line => {
  if (curr) {
    if (line.indexOf('outgoing_channel_id:') >= 0) {
      let id = parseValue(line, 'outgoing_channel_id:');
      curr.outbound_id = id;
    } else if (line.indexOf('outgoing_amt_msat:') >= 0) {
      curr.sats = Math.round(parseInt(parseValue(line, 'outgoing_amt_msat:')) / 1000);
    } else if (line.indexOf(' event:') >= 0) {
      htlcs.push(curr);
      curr = undefined;
    }
  } else if (line.indexOf('incoming_channel_id:') >= 0) {
    let id = parseValue(line, 'incoming_channel_id:');
    curr = { inbound_id: id };
  }

  function parseValue(line, pref) {
    let s = line.substring(line.indexOf(pref) + pref.length);
    if (s.indexOf('\'')) {
      s = s.substring(s.indexOf('\'') + 1);
      s = s.substring(0, s.indexOf('\''));
    } else {
      s = s.substring(0, s.indexOf(','));
    }
    return s.trim();
  }
})

let sumMap = {};
htlcs.forEach(h => {
  if (h.inbound_id == '0') return;  // skip rebalances from my Node
  let item = sumMap[h.inbound_id] && sumMap[h.inbound_id][h.outbound_id];
  if (!item) {
    item = { sum: 0, count: 0 };
    sumMap[h.inbound_id] = sumMap[h.inbound_id] || {};
    sumMap[h.inbound_id][h.outbound_id] = item;
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

Object.keys(sumMap).forEach(k => {
  Object.keys(sumMap[k]).forEach(l => {
    let name = (k == '0') ? info.alias : peerMap[channelMap[k].remote_pubkey].name
    formatted.push({
      from: name,
      to: peerMap[channelMap[l].remote_pubkey].name,
      sats: numberWithCommas(sumMap[k][l].sum),
      avg: numberWithCommas(Math.round(sumMap[k][l].sum / sumMap[k][l].count)),
      count: sumMap[k][l].count
    })
  })
})
console.table(formatted);

function numberWithCommas(x) {
  return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");
}
