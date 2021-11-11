const {analyzeFees} = require('../api/utils');

let messages = analyzeFees(
  'WalletOfSatoshi',
  '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
  { base: 1, rate: 3000 },
  { base: 1, rate: 1000 }
)
console.log(messages);

messages = analyzeFees(
  'WalletOfSatoshi',
  '035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226',
  { base: 1, rate: 10000 },
  { base: 1, rate: 1000 }
)
console.log(messages);
