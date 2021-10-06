const lndClient = require('./api/connect');
const {listPeersMapSync} = require('./lnd-api/utils');
const {listChannelsSync} = require('./lnd-api/utils');

let peerMap = listPeersMapSync(lndClient);
let channels = listChannelsSync(lndClient);
let formatted = [];
channels.forEach(c => {
  formatted.push({
    chan: c.chan_id,
    peer: peerMap[c.remote_pubkey].name,
    id: c.remote_pubkey,
    active: c.active
  })
})
console.table(formatted);
