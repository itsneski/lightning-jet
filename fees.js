const lndClient = require('./api/connect');
const {listFeesSync} = require('./lnd-api/utils');

let fees = listFeesSync(lndClient);
//console.log(fees);
let formatted = [];
fees.forEach(f => {
  let name = f.name;
  formatted.push({
    peer: f.name,
    lc_base: f.local.base,
    lc_rate: f.local.rate,
    rm_base: f.remote.base,
    rm_rate: f.remote.rate
  })
})
formatted.sort(function(a, b) {
  return b.rm_rate - a.rm_rate;
})
console.table(formatted);
