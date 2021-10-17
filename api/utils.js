const {execSync} = require('child_process');

module.exports = {
  listActiveRebalancesSync: function() {
    try {
      var result = execSync('ps -aux | grep bosrebalance.js | grep -v grep').toString().trim();
    } catch(error) {
      // not a critical error??
      return undefined;
    }

    let list = [];
    let lines = result.split(/\r?\n/);
    if (lines.length === 0) return undefined;
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
      let item = {from:from, to:to, amount: amount};
      if (ppm) item.ppm = ppm;
      list.push(item);
    })
    return list;
  }
}
