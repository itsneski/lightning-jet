const lndClient = require('../api/connect');
const {listPeersMapSync} = require('../lnd-api/utils');
const {listChannelsSync} = require('../lnd-api/utils');
const {listPendingChannelsSync} = require('../lnd-api/utils');
const {getNodesInfoSync} = require('../lnd-api/utils');
const {withCommas} = require('../lnd-api/utils')

const stringify = obj => JSON.stringify(obj, null, 2);

module.exports = {
  listChannels: function () {
    let peerMap = listPeersMapSync(lndClient);
    let channels = listChannelsSync(lndClient);
    let activeChannels = [];
    let topUpdates = [];
    let sum = 0;
    channels.forEach(c => {
      let name = peerMap[c.remote_pubkey].name;
      if (!c.active) name = '💀 ' + name;
      activeChannels.push({
        chan: c.chan_id,
        peer: name,
        id: c.remote_pubkey,
        active: c.active
      })
      topUpdates.push({
        chan: c.chan_id,
        peer: name || c.remote_pubkey,
        updates: parseInt(c.num_updates)
      })
      sum += parseInt(c.num_updates);
    })
    activeChannels.sort((a, b) => a.peer.localeCompare(b.peer));
    topUpdates.sort((a, b) => b.updates - a.updates);
    topUpdates = topUpdates.slice(0, 10); // top 10
    topUpdates.forEach(u => { u.p = Math.round(100 * u.updates / sum) });

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

    if (pendingPeers.length === 0) return { 
      active: activeChannels,
      updates: topUpdates
    }

    let pendingInfo = getNodesInfoSync(lndClient, pendingPeers);
    let pendingMap = {};
    pendingInfo.forEach(i => {
      pendingMap[i.node.pub_key] = i.node.alias;
    })

    let pendingChannels = [];
    let list = pending.pending_force_closing_channels;
    if (list && list.length > 0) {
      list.forEach(p => {
        let maturity = p.blocks_til_maturity;
        p.pending_htlcs.forEach(h => maturity = Math.max(maturity, h.blocks_til_maturity));
        pendingChannels.push({
          peer: pendingMap[p.channel.remote_node_pub],
          id: p.channel.remote_node_pub,
          limbo: withCommas(p.limbo_balance),
          htlcs: p.pending_htlcs.length,
          maturity: maturity,
          time: (maturity * 10 / 60).toFixed(1)
        })
      })
    }

    return {
      active: activeChannels,
      updates: topUpdates,
      pending: pendingChannels
    }
  }
}
