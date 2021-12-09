global.testModeOn = true;

const config = require('../api/config');
const constants = require('../api/constants');
const dbUtils = require('../db/utils');
const {setPropSync} = require('../db/utils');
const lndClient = require('../api/connect');
const {listFeesSync} = require('../lnd-api/utils');
const {runMonitor} = require('../service/telegram');

const encode = s => Buffer.from(s).toString('base64');
const decode = s => Buffer.from(s, 'base64').toString();

const testNodes = [
  '0357853bbdbeda5b662783f391f29bd10194e2254d0f091eb4116a0b405001dd52',   // steelrat
  '020605d79106b5a27a94436c57f56c4d04015c902aac9739f71d5ed9b18e24d3d1',   // windwardmark
  '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',   // wos
  '03eba3295492a69621a2501675b663c7051f6035b52f98f0e911475534f105e670',   // d++
  '0283c8e76952e4391a298ef991250406906b8877088b285f032b60867ebe27dad9'    // tinolight
]

dbUtils.enableTestMode();

recordFees();
console.log('waiting for db update')
setTimeout(() => {
  runMonitor();
}, 1000)

function recordFees() {
  let fees = listFeesSync(lndClient);
  fees.forEach(f => {
    if (testNodes.includes(f.id)) {
      // steelrat
      f.remote = { base: f.remote.base + 10, rate: f.remote.rate + 100 }
    }
  })
  setPropSync('fees', encode(JSON.stringify(fees, null, 2)));
}
