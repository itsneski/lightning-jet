const importLazy = require('import-lazy')(require);

const channeldbApi = importLazy('../../api/channeldb');

function registerChanneldbCommand(program) {
  program
    .command('channeldb')
    .summary('Prints stats about the channel.db')
    .description('Prints stats about the channel.db.')
    .action(async () => {
      const path = channeldbApi.getPath();

      if (path) {
        console.log('channel.db is located at', path);
      }

      channeldbApi.printCheckSize();
    });
}

module.exports = {
  registerChanneldbCommand,
};