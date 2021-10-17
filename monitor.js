const {listActiveRebalancesSync} = require('./api/utils');
const date = require('date-and-time');

const withCommas = x => x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");

// process arguments
var secs = 5;  // one week by default
var args = process.argv.slice(2);
if (args[0]) secs = parseInt(args[0]);

runLoop();
setInterval(runLoop, secs * 1000);

function runLoop() {
  console.clear();
  console.log(date.format(new Date, 'MM/DD hh:mm:ss'));
  let list = listActiveRebalancesSync();
  if (!list) return console.log('no active rebalances');
  list.forEach(l => l.amount = withCommas(l.amount));
  list.sort(function(a, b) { return a.from.localeCompare(b.from); });
  console.table(list);
}
