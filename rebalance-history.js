const {rebalanceHistoryFormattedSync} = require('./api/utils');

const withCommas = x => x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");

var mins = 30;  // default
var args = process.argv.slice(2);
if (args[0]) {
  if (args[0].indexOf('-all') >= 0) {
    mins = -1;
  } else {
    mins = parseInt(args[0]);
  }
}

let secs = (mins > 0) ? mins * 60 : -1;
let formatted = rebalanceHistoryFormattedSync(secs);
if (mins > 0) console.log('rebalances over the past', mins, 'minutes');
console.table(formatted);
