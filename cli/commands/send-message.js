const importLazy = require('import-lazy')(require);

const sendMessageApi = importLazy('../../api/send-message');

const {
  requireLndAlive,
} = require('../utils/lnd');

function registerSendMessageCommand(program) {
  program
    .command('send-message')
    .summary('Sends a message to a node via keysend')
    .description('Sends a message to a node via keysend.')
    .argument('<node>', 'Node pub id')
    .argument('<message>', 'Message to send')
    .action(async (node, message) => {
      requireLndAlive();

      sendMessageApi.sendMessage(node, message);
    });
}

module.exports = {
  registerSendMessageCommand,
};