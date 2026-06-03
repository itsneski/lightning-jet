const {
  requireLndAlive,
  lndUtils,
} = require('../utils/lnd');

function registerListPeersCommand(program) {
  program
    .command('list-peers')
    .summary('Lists peer aliases and ids')
    .description('Lists peer aliases and ids.')
    .action(async () => {
      const lndClient = requireLndAlive();

      const peers = lndUtils.listPeersSync(lndClient);
      const peerNames = [];

      peers.forEach((peer) => {
        peerNames.push({
          name: peer.active ? peer.name : '💀 ' + peer.name,
          id: peer.id,
          active: peer.active,
        });
      });

      peerNames.sort((a, b) => a.name.localeCompare(b.name));

      console.table(peerNames);
    });
}

module.exports = {
  registerListPeersCommand,
};