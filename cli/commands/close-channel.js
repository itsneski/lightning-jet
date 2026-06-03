const importLazy = require('import-lazy')(require);

const apiUtils = importLazy('../../api/utils');

const {
  requireLndAlive,
  lndUtils,
} = require('../utils/lnd');

function registerCloseChannelCommand(program) {
  program
    .command('close-channel')
    .summary('Closes a channel')
    .description('Closes a channel.')
    .argument('<chan>', 'Channel id, node id, or partial/full node alias')
    .option('--fee <fee>', 'Sat/vbyte closing fee, default 1', parsePositiveNumber)
    .option('--force', 'Force close the channel')
    .action(async (chan, options) => {
      const lndClient = requireLndAlive();

      const matches = apiUtils.resolveChannel(chan);

      if (!matches || matches.length === 0) {
        console.error('found no matches');
        return;
      }

      if (matches.length > 1) {
        console.error('found multiple matches: ' + matches);
        console.log('narrow your selection');
        return;
      }

      const chanId = matches[0];

      if (chan !== chanId) {
        console.log('idenfied channel id:', chanId);
      }

      const fee = options.fee || 1;

      if (!options.force && !options.fee) {
        const accept = apiUtils.readInput(
          'accept default fee of ' + fee + ' sat/vbyte (y/n)?'
        );

        if (accept !== 'y') {
          console.log('provide fee in --fee argument');
          return;
        }
      }

      const response = lndUtils.closeChannel(
        lndClient,
        chanId,
        fee,
        options.force
      );

      if (response.error) {
        console.error('error closing channel:', response.error.details);

        if (
          response.error.details &&
          response.error.details.indexOf('try force closing it instead') >= 0
        ) {
          console.log(
            'the error indicates that the channel is offline and can not be co-operatively closed'
          );

          const accept = apiUtils.readInput(
            'would you like to force close the channel? (y/n)'
          );

          if (accept === 'y') {
            const ret = lndUtils.closeChannel(lndClient, chanId, undefined, true);

            console.log(ret);

            if (ret.error) {
              console.error('error force closing the channel:', ret.error.details);
              return;
            }

            console.log('the channel is force closed');
          }
        }

        return;
      }

      console.log('the channel is closed');
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
  registerCloseChannelCommand,
};