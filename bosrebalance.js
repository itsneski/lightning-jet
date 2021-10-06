// lnd rebalance built on top of https://github.com/alexbosworth/balanceofsatoshis
// tool.
//
// node bosrebalance.js <from> <to> <amount> [options]
//
//    from:   node pub id or bos tag
//    to:     node pub id or bos tag
//    amount: amount to rebalance in sats
//
//  OPTIONS
//
//    --help:   this help
//    --ppm:    max ppm in sats; default max ppm is in the config file
//

var args = process.argv.slice(2);

if (args.length < 3 || args[0].indexOf('--help') >= 0) {
  return printHelp();
}

const rebalanceApi = require('./api/rebalance');

const OUT = args[0];
const IN = args[1];
const AMOUNT = (args[2] < 1000) ? args[2] * 1000000 : args[2];
args = args.slice(3);

// process rest of the arguments
let ppm;
for ( i = 0; i < args.length; i++ ) {
  if (args[i].indexOf('--ppm') === 0) {
    ppm = args[++i];
  }
}

rebalanceApi({
  from: OUT,
  to: IN,
  amount: AMOUNT,
  ppm: ppm
})  

function printHelp() {
  console.log(
    '\n  node bosrebalance.js <from> <to> <amount> [options]\n\n' +
    '    from:   node pub id or bos tag\n' +
    '    to:     node pub id or bos tag\n' +
    '    amount: amount to rebalance in sats\n\n' +
    '  OPTIONS\n\n' +
    '    --help:   this help\n' +
    '    --ppm:    max ppm in sats\n'
  )
}
