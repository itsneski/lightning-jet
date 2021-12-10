const {printFeeAnalysis} = require('../api/analyze-fees');
const constants = require('../api/constants');

const profit = 25;
global.testModeOn = true;

global.testMaxPpm = 500;
global.testEnforceMaxPpm = false;

runAnalysis();

global.testEnforceMaxPpm = true;

runAnalysis();

global.testEnforceProfitability = true;

runAnalysis();

function runAnalysis() {
  console.log();
  console.log('max ppm:', global.testMaxPpm);
  console.log('enforce ppm:', global.testEnforceMaxPpm);
  console.log('enforce profitability:', global.testEnforceProfitability != undefined);
  console.log('profit:', profit);
  console.log('buffer:', constants.rebalancer.buffer);
  console.log();

  printFeeAnalysis(
    'WalletOfSatoshi',
    '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
    { base: 0, rate: 1 },  // local
    { base: 0, rate: 1 }   // remote
  )

  console.log();
  printFeeAnalysis(
    'WalletOfSatoshi',
    '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
    { base: 0, rate: 2 },  // local
    { base: 0, rate: 1 }   // remote
  )

  console.log();
  printFeeAnalysis(
    'WalletOfSatoshi',
    '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
    { base: 1, rate: 3000 },  // local
    { base: 1, rate: 1000 }   // remote
  )

  console.log();
  printFeeAnalysis(
    'WalletOfSatoshi',
    '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
    { base: 1, rate: 3000 },  // local
    { base: 1, rate: 1000 },  // remote
    profit
  )

  console.log();
  printFeeAnalysis(
    'WalletOfSatoshi',
    '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
    { base: 1, rate: 10000 },
    { base: 1, rate: 1000 }
  )

  console.log();
  printFeeAnalysis(
    'WalletOfSatoshi',
    '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
    { base: 1, rate: 10000 },
    { base: 1, rate: 1000 },
    profit
  )

  console.log();
  printFeeAnalysis(
    'WalletOfSatoshi',
    '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
    { base: 1, rate: 100 },
    { base: 1, rate: 1 }
  )

  console.log();
  printFeeAnalysis(
    'WalletOfSatoshi',
    '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
    { base: 1, rate: 100 },
    { base: 1, rate: 1 },
    profit
  )

  console.log();
  printFeeAnalysis(
    'WalletOfSatoshi',
    '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
    { base: 1, rate: 200 },
    { base: 1, rate: 150 }
  )

  console.log();
  printFeeAnalysis(
    'WalletOfSatoshi',
    '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
    { base: 1, rate: 275 },
    { base: 1, rate: 250 },
    profit
  )
}
