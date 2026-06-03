const importLazy = require('import-lazy')(require);

const updateChannelApi = importLazy('../../lnd-api/update-channel');
const apiUtils = importLazy('../../api/utils');

const {
  requireLndAlive,
} = require('../utils/lnd');

function registerUpdateChannelCommand(program) {
  program
    .command('update-channel')
    .summary('Updates fees on a channel')
    .description('Updates fees on a channel. Requires admin.macaroon in api/config.json.')
    .argument('<chan>', 'Channel id')
    .option('--base <base>', 'Base fee in msats', parseNonNegativeNumber)
    .option('--ppm <ppm>', 'Ppm in sats per million', parseNonNegativeNumber)
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

      const channelId = matches[0];

      console.log('updating channel:', channelId);

      try {
        updateChannelApi.updateChannelSync(lndClient, {
          chan: channelId,
          base: options.base,
          ppm: options.ppm,
        });

        console.log('done');
      } catch (err) {
        console.error('error:', err.toString());
      }
    });
}

function parseNonNegativeNumber(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Expected a non-negative number');
  }

  return parsed;
}

module.exports = {
  registerUpdateChannelCommand,
};