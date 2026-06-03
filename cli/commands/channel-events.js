const importLazy = require('import-lazy')(require);
const date = require('date-and-time');

const channelEventsApi = importLazy('../../db/utils');
const listChannelsApi = importLazy('../../api/list-channels');

const {
  requireLndAlive,
  lndUtils,
} = require('../utils/lnd');

function registerChannelEventsCommand(program) {
  program
    .command('channel-events')
    .summary('Lists channel events')
    .description('Lists channel events.')
    .option('--hours <hours>', 'Depth of history in hours', parsePositiveNumber)
    .action(async (options) => {
      const lndClient = requireLndAlive();

      const hours = options.hours || 24;
      const list = channelEventsApi.listChannelEvents({ hours });

      if (!list || list.length === 0) {
        console.log('no events found');
        return;
      }

      const chanMap = {};
      const chans = lndUtils.listChannelsSync(lndClient);

      chans.forEach((channel) => {
        chanMap[channel.channel_point] = channel;
      });

      const peerMap = lndUtils.listPeersMapSync(lndClient);
      const formatted = [];
      const notFound = {};

      list.forEach((event) => {
        const key = event.txid + ':' + event.ind;
        const chan = chanMap[key];

        if (!chan) {
          if (!notFound[key]) {
            console.warn(
              'did not find channel for channel point ' +
                key +
                '; the channel was likely closed'
            );

            notFound[key] = true;
          }

          return;
        }

        const peer = peerMap[chan.remote_pubkey];

        const item = {
          date: date.format(new Date(event.date), 'MM/DD hh:mm:ss A'),
          type: event.type,
          chan: chan.chan_id,
          peer: peer.id,
          name: peer.name,
        };

        formatted.push(item);
      });

      const inactive = listChannelsApi.inactiveChannels();

      if (inactive && inactive.length > 0) {
        console.log(
          '\nlist of inactive channels; mins column denotes how long a channel has been inactive in minutes (based on recorded channel events)'
        );

        console.table(inactive);
      }

      let msg = 'list of channel events';

      if (hours) {
        msg += ' over the past ' + hours + ' hours';
      }

      console.log('\n' + msg);
      console.table(formatted);
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
  registerChannelEventsCommand,
};