const {execSync} = require('child_process');
const date = require('date-and-time');

const withCommas = x => x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");

// process arguments
var secs = 60;  // one week by default
var args = process.argv.slice(2);
if (args[0]) secs = parseInt(args[0]);

runLoop();
setInterval(runLoop, secs * 1000);

function runLoop() {
  try {
    var result = execSync('ps -aux | grep bosrebalance.js | grep -v grep').toString().trim();
  } catch(error) {
    //return console.error(error.toString());
    return; // typically not critical
  }

  let formatted = [];
  let lines = result.split(/\r?\n/);
  if (lines.length === 0) return console.log('nothing is running');
  lines.forEach(l => {
    let pref = 'bosrebalance.js';
    if (l.indexOf(pref) < 0) return;
    let tok = l.substring(l.indexOf(pref) + pref.length).split(' ');
    let from, to, amount, ppm;
    tok.forEach(t => {
      let val = t.trim();
      if (val.length <= 0) return;
      if (!from) from = val;
      else if (!to) to = val;
      else if (!amount) amount = parseInt(val);
      else if (!ppm && val !== '--ppm') ppm = parseInt(val);
    })
    formatted.push({from:from, to:to, amount: withCommas(amount), ppm: ppm});
  })
  formatted.sort(function(a, b) { return a.from.localeCompare(b.from); });
  console.clear();
  console.log(date.format(new Date, 'MM/DD hh:mm:ss'));
  console.table(formatted);
}
