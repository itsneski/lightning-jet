const lndClient = require('./api/connect');
const {listPeersSync} = require('./lnd-api/utils');
const {classifyPeersSync} = require('./lnd-api/utils');

var IN_PEERS = {};
var OUT_PEERS = {};
var BALANCED_PEERS = {};

let classified = classifyPeersSync(lndClient);
classified.inbound.forEach(c => {
  IN_PEERS[c.peer] = { p: c.p };
})
classified.outbound.forEach(c => {
  OUT_PEERS[c.peer] = { p: c.p };
})
classified.balanced.forEach(c => {
  BALANCED_PEERS[c.peer] = { p: c.p };
})

let peers = listPeersSync(lndClient);

let allPeers = [];
peers.forEach(p => allPeers.push(convertPeer(p)) );

allPeers.sort(function(a, b) {
  return a.in - b.in;
})
allPeers.forEach(p => { p.in = numberWithCommas(p.in); p.out = numberWithCommas(p.out); });

let inPeers = [];
peers.forEach(p => {
  if (IN_PEERS[p.id]) inPeers.push(convertPeer(p, IN_PEERS[p.id], true));
})
inPeers.sort(function(a, b) {
  return a.in - b.in;
})
inPeers.forEach(p => { p.in = numberWithCommas(p.in); p.out = numberWithCommas(p.out); });

let outPeers = [];
peers.forEach(p => {
  if (OUT_PEERS[p.id]) outPeers.push(convertPeer(p, OUT_PEERS[p.id]));
})
outPeers.sort(function(a, b) {
  return a.out - b.out;
})
outPeers.forEach(p => { p.in = numberWithCommas(p.in); p.out = numberWithCommas(p.out); });

let balancedPeers = [];
peers.forEach(p => {
  if (BALANCED_PEERS[p.id]) balancedPeers.push(convertPeer(p, BALANCED_PEERS[p.id]));
})
balancedPeers.sort(function(a, b) {
  return a.out - b.out;
})
balancedPeers.forEach(p => { p.in = numberWithCommas(p.in); p.out = numberWithCommas(p.out); });

console.table(allPeers);
console.log('inbound peers:');
console.table(inPeers);
console.log('outbound peers:');
console.table(outPeers);
console.log('balanced peers:');
console.table(balancedPeers);

function convertPeer(p, pp = undefined, inbound = false) {
  let s = (inbound) ? { name: p.name, in: p.in, out: p.out } : { name: p.name, out: p.out, in: p.in };
  if (pp && pp.p) s.p = pp.p;
  if (!p.active) s.name = '💀 ' + s.name;
  return s;
}

function numberWithCommas(x) {
  return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");
}
