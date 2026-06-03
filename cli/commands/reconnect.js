const importLazy = require('import-lazy')(require);

const bosReconnect = importLazy('../../bos/reconnect');

const {
  requireLndAlive,
} = require('../utils/lnd');

function registerReconnectCommand(program) {
  program
    .command('reconnect')
    .summary('Reconnects to disconnected peers')
    .description('Reconnects to disconnected peers. Same as BalanceOfSatoshis reconnect; calls the BOS API.')
    .action(async () => {
      requireLndAlive();

      await bosReconnect.reconnect(console);
    });
}

module.exports = {
  registerReconnectCommand,
};