const lndClient = require('./api/connect');
const {listPeersMapSync} = require('./lnd-api/utils');
const {listChannelsSync} = require('./lnd-api/utils');
const {listPendingChannelsSync} = require('./lnd-api/utils');
const {getNodesInfoSync} = require('./lnd-api/utils');

const stringify = obj => JSON.stringify(obj, null, 2);
const withCommas = x => x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");

let peerMap = listPeersMapSync(lndClient);
let channels = listChannelsSync(lndClient);
let formatted = [];
channels.forEach(c => {
  let name = peerMap[c.remote_pubkey].name;
  if (!c.active) name = '💀 ' + name;
  formatted.push({
    chan: c.chan_id,
    peer: name,
    id: c.remote_pubkey,
    active: c.active
  })
})
formatted.sort(function(a, b) {
  return a.peer.localeCompare(b.peer);
})

console.log('active channels:');
console.table(formatted);

// get pending channels
let pending = listPendingChannelsSync(lndClient);

// pending peers
let pendingPeers = [];
Object.keys(pending).forEach(k => {
  if (k === 'total_limbo_balance') return;
  pending[k].forEach(p => {
    pendingPeers.push(p.channel.remote_node_pub);
  })
})
if (pendingPeers.length === 0) return;
let pendingInfo = getNodesInfoSync(lndClient, pendingPeers);
let pendingMap = {};
pendingInfo.forEach(i => {
  pendingMap[i.node.pub_key] = i.node.alias;
})

formatted = [];
let list = pending.pending_force_closing_channels;
if (list && list.length > 0) {
  list.forEach(p => {
    let maturity = p.blocks_til_maturity;
    p.pending_htlcs.forEach(h => maturity = Math.max(maturity, h.blocks_til_maturity));
    formatted.push({
      peer: pendingMap[p.channel.remote_node_pub],
      id: p.channel.remote_node_pub,
      limbo: withCommas(p.limbo_balance),
      htlcs: p.pending_htlcs.length,
      maturity: maturity,
      time: (maturity * 10 / 60).toFixed(1)
    })
  })
}

if (formatted.length > 0) {
  console.log('force closing channels:');
  console.table(formatted);  
}
