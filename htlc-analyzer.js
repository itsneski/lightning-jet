// analyzes htlcs logged in htlc-logger.db

// process arguments
var days = 1;  // one week by default
var args = process.argv.slice(2);
if (args[0]) {
  if (args[0].indexOf('--d') >= 0) {
    days = parseFloat(args[1]);
  } else if (args[0].indexOf('--help') >= 0) {
    return printHelp();
  }
}

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
let epoch = Math.floor(+new Date() / 1000);
data.split(/\r?\n/).forEach(line => {
  //console.log(line);
  if (curr) {
    if (line.indexOf('"outgoing_channel_id":') >= 0) {
      let id = parseValue(line, '"outgoing_channel_id":');
      curr.outbound_id = id;
    } else if (line.indexOf('"outgoing_amt_msat":') >= 0) {
      curr.sats = Math.round(parseInt(parseValue(line, '"outgoing_amt_msat":')) / 1000);
    } else if (line.indexOf('"timestamp_ns":') >= 0) {
      curr.timestamp = Math.round(parseInt(parseValue(line, '"timestamp_ns":')) / Math.pow(10, 9));
    } else if (line.indexOf('"event":') >= 0) {
      if (epoch - curr.timestamp < days * 24 * 60 * 60) {
        htlcs.push(curr);
      }
      curr = undefined;
    }
  } else if (line.indexOf('"incoming_channel_id":') >= 0) {
    let id = parseValue(line, '"incoming_channel_id":');
    curr = { inbound_id: id };
  }

  function parseValue(line, pref) {
    let s = line.substring(line.indexOf(pref) + pref.length);
    if (s.indexOf('\"')) {
      s = s.substring(s.indexOf('\"') + 1);
      s = s.substring(0, s.indexOf('\"'));
    } else {
      s = s.substring(0, s.indexOf(','));
    }
    return s.trim();
  }
})

if (htlcs.length === 0) return console.log('no events found');

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
  })
})
formatted.sort(function(a, b) {
  return b.sats - a.sats;
})
formatted.forEach(f => {
  f.sats = numberWithCommas(f.sats);
  f.avg = numberWithCommas(f.avg);
})
console.log('htlc analysis over the past', days, 'day(s)');
console.table(formatted);

function numberWithCommas(x) {
  return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");
}
