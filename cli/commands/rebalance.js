const importLazy = require('import-lazy')(require);

const rebalanceApi = importLazy('../../api/rebalance');

const {
  requireLndAlive,
} = require('../utils/lnd');

function registerRebalanceCommand(program) {
  program
    .command('rebalance')
    .summary('Rebalances the node via circular rebalance')
    .description(
      'Rebalances the node via circular rebalance. Calls the BalanceOfSatoshis rebalance API in a loop until the target amount is met or all possible routes are exhausted.'
    )
    .argument(
      '<from>',
      'From this peer. Can be a partial alias, a pub id, or a BOS tag'
    )
    .argument(
      '<to>',
      'To this peer. Can be a partial alias, a pub id, or a BOS tag'
    )
    .argument('<amount>', 'Amount in sats', parsePositiveNumber)
    .option('--ppm <ppm>', 'Max ppm', parsePositiveNumber)
    .option('--mins <mins>', 'Max time to run in minutes', parsePositiveNumber)
    .action(async (from, to, amount, options) => {
      requireLndAlive();

      const rebalanceAmount = amount < 1000
        ? amount * 1000000
        : amount;

      try {
        await rebalanceApi({
          from,
          to,
          amount: rebalanceAmount,
          ppm: options.ppm,
          mins: options.mins,
        });
      } catch (err) {
        console.error(err.message || err);
      }
    });
}

function parsePositiveNumber(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Expected a positive number');
  }

  return parsed;
}

module.exports = {
  registerRebalanceCommand,
};
