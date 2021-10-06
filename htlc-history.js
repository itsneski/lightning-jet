
const lndClient = require('./api/connect');
const {htlcHistorySync} = require('./lnd-api/utils');
const {listPeersSync} = require('./lnd-api/utils');

const round = n => Math.round(n);
const withCommas = x => x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");

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

let history = htlcHistorySync(lndClient, days);

console.log('htlc history over the past', days, 'days');
console.log('unknown channels:', history.unknown);
console.log('inbound traffic:');
console.table(formatArray(history.inbound));
console.log('outbound traffic:');
console.table(formatArray(history.outbound));

function printHelp() {
  console.log(
    'Prints cumulative htlcs forward stats over the specified number of days. ' +
    'Aggregates htlcs into two sets, inbound and outbound.  Shows '
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
