const {printFeeAnalysis} = require('../api/analyze-fees');

var profit = 25;
global.testMaxPpm = 650;
global.testEnforceMaxPpm = false;

console.log();
console.log('max ppm:', global.testMaxPpm);
console.log('enforce ppm:', global.testEnforceMaxPpm);
console.log('profit:', profit);
console.log();

let messages = printFeeAnalysis(
  'WalletOfSatoshi',
  '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
  { base: 1, rate: 3000 },
  { base: 1, rate: 1000 }
)

console.log();
messages = printFeeAnalysis(
  'WalletOfSatoshi',
  '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
  { base: 1, rate: 10000 },
  { base: 1, rate: 1000 }
)

console.log();
messages = printFeeAnalysis(
  'WalletOfSatoshi',
  '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
  { base: 1, rate: 200 },
  { base: 1, rate: 150 },
  25
)

global.testMaxPpm = 650;
global.testEnforceMaxPpm = true;

console.log();
console.log('max ppm:', global.testMaxPpm);
console.log('enforce ppm:', global.testEnforceMaxPpm);
console.log('profit:', profit);
console.log();

messages = printFeeAnalysis(
  'WalletOfSatoshi',
  '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
  { base: 1, rate: 3000 },
  { base: 1, rate: 1000 }
)

console.log();
messages = printFeeAnalysis(
  'WalletOfSatoshi',
  '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
  { base: 1, rate: 10000 },
  { base: 1, rate: 1000 }
)

console.log();
messages = printFeeAnalysis(
  'WalletOfSatoshi',
  '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
  { base: 1, rate: 200 },
  { base: 1, rate: 150 },
  25
)

console.log();
