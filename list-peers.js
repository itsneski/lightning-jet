const lndClient = require('./api/connect');
const {listPeersSync} = require('./lnd-api/utils');

let peers = listPeersSync(lndClient);
let peerNames = [];
peers.forEach(p => {
  peerNames.push({
    name: p.name,
    id: p.id,
    active: p.active
  })
})
console.table(peerNames);
