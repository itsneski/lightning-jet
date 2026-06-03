const importLazy = require('import-lazy')(require);

const htlcHistoryApi = importLazy('../../api/htlc-history');

const {
  requireLndAlive,
} = require('../utils/lnd');

function registerHtlcHistoryCommand(program) {
  program
    .command('htlc-history')
    .summary('Prints cumulative HTLC history for peers')
    .description('Prints cumulative HTLC history for peers.')
    .argument('[days]', 'Depth of history in days', parsePositiveInt, 7)
    .addHelpText(
      'after',
      `
Details:
  Prints % of total inbound / outbound routing for each peer.
  Example: inbound routing from a peer takes 25% of total inbound traffic across all peers.

  Also prints % of inbound / outbound routing for a peer.
  Example: inbound routing from a peer takes 95% of total routing from that peer.
`
    )
    .action(async (days) => {
      requireLndAlive();

      const history = htlcHistoryApi.htlcHistoryFormatted(days);

      console.log('htlc history over the past', days, 'days');

      if (history.unknown) {
        console.log('unknown channels:', history.unknown);
      }

      console.log('inbound routing:');
      console.table(history.inbound);

      console.log('outbound routing:');
      console.table(history.outbound);

      if (history.noTraffic) {
        console.log('no routing:');
        console.table(history.noTraffic);
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
  registerHtlcHistoryCommand,
};