const lndClient = require('../api/connect');
const {listPeersMapSync} = require('../lnd-api/utils');
const {listChannelsSync} = require('../lnd-api/utils');
const {listPendingChannelsSync} = require('../lnd-api/utils');
const {getNodesInfoSync} = require('../lnd-api/utils');
const {withCommas} = require('../lnd-api/utils')
const {latestChannelEvents} = require('../db/utils');

const stringify = obj => JSON.stringify(obj, null, 2);

module.exports = {
  // returns a list of inactive chans: (chan, peer, name, mins)
  // with mins denoting how long a channel has been inactive in minutes
  inactiveChannels: () => {
    const chans = listChannelsSync(lndClient);

    let chanMap = {};
    chans.forEach(chan => {
      if (chan.active) return;  // only inactive
      chanMap[chan.channel_point] = chan;
    })
    if (Object.keys(chanMap).length === 0) return []; // no inactive chans found

    const peerMap = listPeersMapSync(lndClient);
    const latest = latestChannelEvents();

    let eventMap = {};
    if (latest && latest.length > 0) {
      latest.forEach(event => {
        if (event.type !== 'INACTIVE_CHANNEL') return;
        const key = event.txid + ':' + event.ind;
        const chan = chanMap[key];
        if (!chan) return;  // either no longer exists or active
        eventMap[chan.chan_id] = event;
      })
    }

    let inactive = [];
    Object.values(chanMap).forEach(chan => {
      let item = {};
      item.chan = chan.chan_id;
      item.peer = chan.remote_pubkey;
      item.name = peerMap[chan.remote_pubkey].name;
      const event = eventMap[chan.chan_id];
      if (event) item.mins = Math.round((Date.now() - event.date)/1000/60);
      inactive.push(item);
    })
    inactive.sort( (a, b) => { return b.mins - a.mins });
    return inactive;
  },
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
      if (!i) return console.error('failed to get pending peer info');
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
