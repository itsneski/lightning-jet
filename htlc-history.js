
// process arguments
var days = 7;
var args = process.argv.slice(2);
if (args[0]) {
  if (args[0].indexOf('--d') >= 0) {
    days = parseInt(args[1]);
  } else if (args[0].indexOf('--help') >= 0) {
    return printHelp();
  }
}

const lndClient = require('./api/connect');
const {htlcHistorySync} = require('./lnd-api/utils');
const {listPeersSync} = require('./lnd-api/utils');

const round = n => Math.round(n);
const withCommas = x => x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");

let history = htlcHistorySync(lndClient, days);

// figure out peers without traffic
let peers = listPeersSync(lndClient);
let withTraffic = {};
history.inbound.forEach(h => withTraffic[h.peer] = true);
history.outbound.forEach(h => withTraffic[h.peer] = true);
let noTraffic = [];
peers.forEach(p => { 
  if (!withTraffic[p.id]) noTraffic.push(p.name);
})

console.log('htlc history over the past', days, 'days');
if (history.unknown && history.unknown.length > 0) 
  console.log('unknown channels:', history.unknown);
console.log('inbound traffic:');
console.table(formatArray(history.inbound));
console.log('outbound traffic:');
console.table(formatArray(history.outbound));
console.log('no traffic:');
console.table(noTraffic);

function printHelp() {
  console.log(
    'Prints cumulative htlcs forward stats over the specified number of time period (in days).'
  );
}

function formatArray(list) {
  let newList = []
  list.forEach(n => {
    newList.push({
      name: n.name,
      total: withCommas(n.sum),
      "%": n.p,
      "d%": n.d
    })
  })
  return newList;
}
