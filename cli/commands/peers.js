const importLazy = require('import-lazy')(require);

const apiUtils = importLazy('../../api/utils');

const {
  requireLndAlive,
} = require('../utils/lnd');

function registerPeersCommand(program) {
  program
    .command('peers')
    .summary('Lists peers classified into inbound, outbound and balanced based on routing history')
    .description('Lists peers classified into inbound, outbound and balanced based on routing history.')
    .addHelpText(
      'after',
      `
Notable columns:
  p       % of inbound or outbound routing by the peer out of total inbound or outbound across all peers
  ppm     peer's current ppm rate
  margin  rebalance ppm margin; rebalance will be profitable as long as its ppm is below this margin
`
    )
    .option('--days <days>', 'Depth of routing history in days', parsePositiveInt, 1)
    .action(async (options) => {
      requireLndAlive();

      const days = options.days;
      const peers = apiUtils.listPeersFormattedSync(days);

      console.log('classification of peers based on past', days, 'day(s):');
      console.log('-local: total sats on local side (excluding htlcs)');
      console.log('-remote: total sats on remote side (excluding htlcs)');

      if (peers.inbound.length > 0) {
        console.log('\ninbound peers:');
        console.table(peers.inbound);
      } else {
        console.log('no inbound peers found');
      }

      if (peers.outbound.length > 0) {
        console.log('\noutbound peers:');
        console.table(peers.outbound);
      } else {
        console.log('no outbound peers found');
      }

      if (peers.balanced.length > 0) {
        console.log('\nlow routing volume peers:');
        console.table(peers.balanced);
      }

      if (peers.skipped.length > 0) {
        console.log('\nskipped peers:');
        console.table(peers.skipped);
      }

      if (peers.all.length > 0) {
        console.log('\nall peers:');
        console.table(peers.all);
      } else {
        console.log('no peers found');
      }
    });
}

function parsePositiveInt(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Expected a positive integer');
  }

  return parsed;
}

module.exports = {
  registerPeersCommand,
};
