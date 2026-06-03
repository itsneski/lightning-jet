const importLazy = require('import-lazy')(require);

const listChannelsApi = importLazy('../../api/list-channels');

const {
  requireLndAlive,
} = require('../utils/lnd');

function registerListChannelsCommand(program) {
  program
    .command('list-channels')
    .summary('Lists channels: active, inactive and force closing')
    .description(
      'Lists channels: active, inactive and force closing. Lists top ten channels sorted based on channel state updates.'
    )
    .action(async () => {
      requireLndAlive();

      const chans = listChannelsApi.listChannels();

      if (!chans) {
        console.log('no channels found, likely due to an error');
        return;
      }

      if (chans.active && chans.active.length > 0) {
        console.log('all channels:');
        console.table(chans.active);
      }

      const inactive = listChannelsApi.inactiveChannels();

      if (inactive && inactive.length > 0) {
        console.log(
          '\ninactive channels:\n-mins: shows how long a channel has been inactive in minutes (based on recorded channel events)'
        );
        console.table(inactive);
      }

      if (chans.pendingOpen && chans.pendingOpen.length > 0) {
        const pending = [];
        const fundingTxn = [];

        chans.pendingOpen.forEach((channel) => {
          pending.push({
            peer: channel.peer,
            id: channel.id,
            capacity: channel.capacity,
            remote: channel.remote_balance,
            local: channel.local_balance,
          });

          fundingTxn.push({
            peer: channel.peer,
            txn: channel.channel_point,
          });
        });

        console.log('\npending channels:');
        console.table(pending);

        console.log('\nfunding txn for pending channels:');
        console.table(fundingTxn);
      }

      if (chans.updates && chans.updates.length > 0) {
        console.log('\ntop channels based on updates:');
        console.log('-updates: number of channel state updates');
        console.log('-p: channel updates as a % out of the total across all channels');
        console.table(chans.updates);
      }

      if (chans.waitingClose && chans.waitingClose.length > 0) {
        console.log('\nwaiting close channels:');
        console.table(chans.waitingClose);
      }

      if (chans.pending && chans.pending.length > 0) {
        console.log('\nforce closing channels:');
        console.log('-limbo: number of sats in limbo state');
        console.log('-htlcs: number of pending htlcs');
        console.log('-maturity: blocks till maturity');
        console.log('-time: hours till maturity');
        console.table(chans.pending);
      }
    });
}

module.exports = {
  registerListChannelsCommand,
};