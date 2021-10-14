const lndClient = require('./api/connect');
const {listPeersSync} = require('./lnd-api/utils');

let peers = listPeersSync(lndClient);
let peerNames = [];
peers.forEach(p => {
  peerNames.push({
    name: (p.active) ? p.name : '💀 ' + p.name,
    id: p.id,
    active: p.active
  })
})
peerNames.sort(function(a, b) {
  return a.name.localeCompare(b.name);
})
console.table(peerNames);
