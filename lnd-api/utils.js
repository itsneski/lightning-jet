const parallel = require('run-parallel');
const deasync = require('deasync');

const round = n => Math.round(n);

const pThreshold = 2;

module.exports = {
  withCommas: function(s) {
    return (s) ? s.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",") : s;
  },
  stuckHtlcsSync: function(lndClient) {
    let data;
    lndClient.listChannels({}, function(err, response) {
      if (err) {
        throw new Error(err);
      }
      data = response;
    })
    while(data === undefined) {
      require('deasync').runLoopOnce();
    }
    let htlcs = [];
    data.channels.forEach(c => {
      if (c.pending_htlcs.length === 0) return;
      htlcs.push({
        id: c.chan_id,
        peer: c.remote_pubkey,
        htlcs: c.pending_htlcs
      })
    })
    return htlcs;
  },
  sendMessageToNode: function(routerRpc, node, message) {
    sendMessage();
    async function sendMessage() {
      let req = {
        dest: node,
        amp: true,
        timeout_seconds: 60
      }
      for await (const payment of routerRpc.sendPaymentV2(req)) {
        console.log('payment:', payment);
      }
    }
  },
  listPendingChannelsSync: function(lndClient) {
    let channels;
    lndClient.pendingChannels({}, function(err, response) {
      if (err) {
        throw new Error(err);
      }
      channels = response;
    })
    while(channels === undefined) {
      require('deasync').runLoopOnce();
    }
    return channels;
  },
  classifyPeersSync: function(lndClient, days = 7) {
    let history = module.exports.htlcHistorySync(lndClient, days);
    let inSum = 0;
    let outSum = 0;
    let historyMap = {};
    history.inbound.forEach(h => inSum += h.sum);
    history.outbound.forEach(h => outSum += h.sum);
    history.inbound.forEach(h => {
      h.p = round(100 * h.sum / inSum);
      historyMap[h.id] = h;
    })
    history.outbound.forEach(h => {
      h.p = round(100 * h.sum / outSum);
      historyMap[h.id] = h;
    })

    // now classify; nodes with less than a week lifetime are
    // classified balanced
    let balanced = {};
    let inbound = {};
    let currTime = Math.floor(+new Date() / 1000);
    let minlife = 7 * 24 * 60 * 60;
    history.inbound.forEach(h => {
      if (h.p >= pThreshold) {
        inbound[h.id] = h;
        delete balanced[h.id];
      } else if (currTime - h.lifetime < minlife && h.name.indexOf('LNBIG.com') < 0) {
        balanced[h.id] = h;
      }
    })
    let outbound = {};
    history.outbound.forEach(h => {
      if (h.p >= pThreshold) {
        if (inbound[h.id]) {  // can a node be classified as both inbound & outbound?
          if (h.sum > inbound[h.id].sum) {
            outbound[h.id] = h;
            delete inbound[h.id];
            delete balanced[h.id];
          }
        } else {
          outbound[h.id] = h;
          delete balanced[h.id];
        }
      } else if (currTime - h.lifetime < minlife && h.name.indexOf('LNBIG.com') < 0) {
        balanced[h.id] = h; // exception for KP (Yoda)
      }
    })

    let skipped = {};
    let peers = module.exports.listPeersMapSync(lndClient);
    let channels = module.exports.listChannelsSync(lndClient);
    channels.forEach(c => {
      if (inbound[c.chan_id] || outbound[c.chan_id] || balanced[c.chan_id]) return;
      let map;
      if (peers[c.remote_pubkey].name.indexOf('LNBIG.com') >= 0) {  // find a better way
        map = outbound;
        c.p = c.p || 0; // must have p for outbound channels otherwise the sorting will be screwed up
      } else if (c.capacity <= 1000000) {  // should we even have tiny nodes?
        // skip tiny nodes
        map = skipped;
      } else if (c.capacity <= 2000000) { // do smaller nodes given a chance to shine???
        map = balanced; // what about stale nodes????
      } else {
        map = balanced;
      }
      if (map) {
        map[c.chan_id] = {
          id: c.chan_id,
          peer: c.remote_pubkey,
          name: peers[c.remote_pubkey].name,
          lifetime: c.lifetime
        }
        if (c.p != undefined) map[c.chan_id].p = c.p;
      }
    })

    let inboundSorted = Object.values(inbound);
    inboundSorted.sort(function(a, b) {
      return b.p - a.p;
    })
    let outboundSorted = Object.values(outbound);
    outboundSorted.sort(function(a, b) {
      return b.p - a.p;
    })

    return ({
      inbound: inboundSorted,
      outbound: outboundSorted,
      balanced: Object.values(balanced),
      skipped: Object.values(skipped)
    })
  },
  htlcHistorySync: function(lndClient, days = 7) {
    let currTime = Math.floor(+new Date() / 1000);
    let history;
    lndClient.forwardingHistory({
      start_time: currTime - days * 24 * 60 * 60,
      num_max_events: 10000
    }, (err, response) => {
      if (err) {
        return console.error('Error: ' + err);
      }
      history = response;
    })
    while(history === undefined) {
      require('deasync').runLoopOnce();
    }

    // aggregate
    let mapIn = {};
    let mapOut = {}
    history.forwarding_events.forEach(h => {
      let sum = mapIn[h.chan_id_in] || 0;
      mapIn[h.chan_id_in] = sum + parseInt(h.amt_in);
      sum = mapOut[h.chan_id_out] || 0;
      mapOut[h.chan_id_out] = sum + parseInt(h.amt_out);
    })

    let peers = module.exports.listPeersMapSync(lndClient);
    let channels = {};
    module.exports.listChannelsSync(lndClient).forEach(c => {
      channels[c.chan_id] = c;
    })

    //console.log(channels);
    //console.log(mapIn);
    let unknown = [];
    let inPeers = [];
    Object.keys(mapIn).forEach(n => {
      if (!channels[n]) {
        unknown.push(n);
        //console.log('couldnt find channel data for', n);
        return;
      }
      inPeers.push({
        id: channels[n].chan_id,
        peer: channels[n].remote_pubkey,
        name: peers[channels[n].remote_pubkey].name,
        sum: mapIn[n],
        lifetime: channels[n].lifetime
      })
    })
    inPeers.sort(function(a, b) {
      return b.sum - a.sum;
    })
    let outPeers = [];
    Object.keys(mapOut).forEach(n => {
      if (!channels[n]) {
        unknown.push(n);
        //console.log('couldnt find channel data for', n);
        return;
      }
      outPeers.push({
        id: channels[n].chan_id,
        peer: channels[n].remote_pubkey,
        name: peers[channels[n].remote_pubkey].name,
        sum: mapOut[n],
        lifetime: channels[n].lifetime
      })
    })
    outPeers.sort(function(a, b) {
      return b.sum - a.sum;
    })
    unknown = unknown.filter(function(elem, pos) {
      return unknown.indexOf(elem) === pos;
    })

    // generate balance map
    let inMap = {};
    let outMap = {};
    let balanceMap = {};
    let inSum = 0;
    let outSum = 0;
    inPeers.forEach(h => { inMap[h.id] = h; inSum += h.sum});
    outPeers.forEach(h => { outMap[h.id] = h; outSum += h.sum});
    Object.keys(channels).forEach(k => {
      if (inMap[k]) {
        if (outMap[k]) {
          balanceMap[k] = round(100 * inMap[k].sum / (inMap[k].sum + outMap[k].sum));
        } else {
          balanceMap[k] = 100;
        }
      } else if (outMap[k]) {
        if (inMap[k]) {
          balanceMap[k] = round(100 * inMap[k].sum / (inMap[k].sum + outMap[k].sum));
        } else {
          balanceMap[k] = 0;
        }
      }
    })
    inPeers.forEach(h => { 
      h.p = round(100 * h.sum / inSum); 
      h.d = balanceMap[h.id];
    })
    outPeers.forEach(h => { 
      h.p = round(100 * h.sum / outSum);
      h.d = 100 - balanceMap[h.id]
    })

    return {inbound: inPeers, outbound: outPeers, unknown: unknown};
  },
  getNodeFeeSync: function(lndClient, node) {
    // not the most optimal implementation, rethink
    let fees = module.exports.listFeesSync(lndClient);
    let fee;
    fees.forEach(f => {
      if (f.id === node) { fee = f; return; }
    })
    return fee && fee.remote;
  },
  listFeesSync: function(lndClient, chans) {
    let fees;
    module.exports.listFees(lndClient, chans, function(result) {
      if (!result) {
        throw new Error('null result');
      }
      fees = result;
    })
    while(fees === undefined) {
      require('deasync').runLoopOnce();
    }
    return fees;
  },
  listFees: function(lndClient, chans, callback) {
    let info = module.exports.getInfoSync(lndClient);
    let peers = module.exports.listPeersMapSync(lndClient);
    //console.log(peers);
    let ids = chans;
    if (!ids) {
      ids = [];
      let channels = module.exports.listChannelsSync(lndClient);
      channels.forEach(c => ids.push({peer: c.remote_pubkey, chan: c.chan_id}));
    }
    let calls = [];
    ids.forEach(id => {
      calls.push(function(cb) {
        lndClient.getChanInfo({chan_id: id.chan}, (err, response) => {
          if (err) {
            console.log('Error: ' + err);
            return cb(err);
          }
          response.peer = id.peer;
          return cb(null, response);
        })
      })
    })
    parallel(calls, function (err, results) {
      if (err) {
        console.log(err);
        return callback(null);
      }

      //console.log(results);
      let fees = [];
      results.forEach(r => {
        let fee = {
          chan: r.channel_id,
          id: r.peer,
          name: peers[r.peer].name,
        }
        if (r.node1_pub === info.identity_pubkey) {
          fee.local = {
            base: parseInt(r.node1_policy.fee_base_msat),
            rate: parseInt(r.node1_policy.fee_rate_milli_msat)
          }
          fee.remote = {
            base: parseInt(r.node2_policy.fee_base_msat),
            rate: parseInt(r.node2_policy.fee_rate_milli_msat)
          }
        } else {
          fee.local = {
            base: parseInt(r.node2_policy.fee_base_msat),
            rate: parseInt(r.node2_policy.fee_rate_milli_msat)
          }
          fee.remote = {
            base: parseInt(r.node1_policy.fee_base_msat),
            rate: parseInt(r.node1_policy.fee_rate_milli_msat)
          }
        }
        fees.push(fee);
      })
      return callback(fees);
    })
  },
  getInfoSync: function(lndClient) {
    let info;
    lndClient.getInfo({}, function(err, response) {
      if (err) {
        throw new Error(err);
      }
      info = response;
    })
    while(info === undefined) {
      require('deasync').runLoopOnce();
    }
    return info;
  },
  listPeersMapSync: function(lndClient) {
    let map;
    let peers = module.exports.listPeersSync(lndClient);
    if (peers) {
      map = {};
      peers.forEach(p => {
        map[p.id] = p;
      })
    }
    return map;
  },
  listPeersSync: function(lndClient) {
    let channels = module.exports.listChannelsSync(lndClient);
    let peerIds = [];
    channels.forEach(c => peerIds.push(c.remote_pubkey));
    let peerInfo = {};
    module.exports.getNodesInfoSync(lndClient, peerIds).forEach(p => {
      peerInfo[p.node.pub_key] = p;
    })
    let peers = [];
    channels.forEach(c => {
      // fix funkiness in the alias that screws up the output
      // IMPORTANT: this is temporary, needs to be removed
      let name = peerInfo[c.remote_pubkey].node.alias;
      name = module.exports.removeEmojis(name);  // get rid of emojis to avoid skewed tables

      peers.push({
        id: c.remote_pubkey,
        name: name,
        out: c.local_balance,
        in: c.remote_balance,
        active: c.active
      })
    })
    return peers;
  },
  listChannelsMapSync: function(lndClient) {
    let map;
    let channels = module.exports.listChannelsSync(lndClient);
    if (channels) {
      map = {};
      channels.forEach(c => {
        map[c.remote_pubkey] = c;
      })
    }
    return map;
  },
  listChannelsSync: function(lndClient) {
    let channels;
    lndClient.listChannels({}, function(err, response) {
      if (err) {
        throw new Error(err);
      }
      channels = response.channels;
    })
    while(channels === undefined) {
      require('deasync').runLoopOnce();
    }
    return channels;
  },
  getNodesInfo: function(lndClient, nodes, callback) {
    let calls = [];
    nodes.forEach(n => {
      calls.push(function(cb) {
        lndClient.getNodeInfo({pub_key: n}, (err, response) => {
          if (err) {
            console.error('node: ' + n + ', error: ' + err);
            return cb(null, null);
          }
          return cb(null, response);
        })
      })
    })

    parallel(calls, function (err, results) {
      // the results array will equal ['one','two'] even though
      // the second function had a shorter timeout.
      if (err) {
        console.log(err);
        return callback(null);
      }
      return callback(results);
    })
  },
  getNodesInfoSync: function(lndClient, nodes) {
    if (!nodes || nodes.length === 0) {
      return nodes;
    }
    let info;
    module.exports.getNodesInfo(lndClient, nodes, function(result) {
      info = result;
    })
    while(info === undefined) {
      require('deasync').runLoopOnce();
    }
    return info;
  },
  getInfoSync: function(lndClient) {
    let info;
    lndClient.getInfo({}, (err, response) => {
      if (err) throw new Error(err);
      info = response;
    })
    while(info === undefined) {
      require('deasync').runLoopOnce();
    }
    return info;
  },
  removeEmojis: function(str) {
    const {isEmoji} = require('../api/constants');
    return str.replace(isEmoji, String()).trim();
  }
}
