const {listActiveRebalancesSync} = require('./api/utils');
const {rebalanceHistoryFormattedSync} = require('./api/utils');
const {stuckHtlcsFormattedSync} = require('./api/utils');
const {listForcedClosingFormattedSync} = require('./api/utils');
const {withCommas} = require('./lnd-api/utils');
const date = require('date-and-time');

const MINS = 120;

// process arguments
var secs = 20;  // one week by default
var args = process.argv.slice(2);
if (args[0]) secs = parseInt(args[0]);

runLoop();
setInterval(runLoop, secs * 1000);

function runLoop() {
  console.clear();
  // active rebalances
  console.log(date.format(new Date, 'MM/DD hh:mm:ss'));
  let list = listActiveRebalancesSync();
  if (!list) return console.log('no active rebalances');
  list.forEach(l => l.amount = withCommas(l.amount));
  list.sort(function(a, b) { return a.from.localeCompare(b.from); });
  console.log('rebalances in progress:');
  console.table(list);

  // rebalance history
  let history = rebalanceHistoryFormattedSync(MINS * 60);
  if (history.length > 0) {
    console.log('\nrebalances over the past', MINS, 'minutes:');
    console.table(history);
  }

  // stuck htlcs
  let htlcs = stuckHtlcsFormattedSync();
  if (htlcs.length > 0) {
    console.log('\nstuck htlcs:');
    console.table(htlcs);
  }

  // forced closed
  let closed = listForcedClosingFormattedSync();
  if (closed.length > 0) {
    console.log('\nforced closing channels:');
    console.table(closed);  
  }
}
