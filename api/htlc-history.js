// process arguments
const importLazy = require('import-lazy')(require);
const lndClient = importLazy('./connect');
const {htlcHistorySync} = require('../lnd-api/utils');
const {listPeersSync} = require('../lnd-api/utils');
const {withCommas} = require('../lnd-api/utils');

const round = n => Math.round(n);
const defaultDays = 7;

module.exports = {
  htlcHistoryFormatted: function(days = defaultDays) {
    let history = htlcHistorySync(lndClient, days);
    // figure out peers without traffic
    let peers = listPeersSync(lndClient);
    let withTraffic = {};
    history.inbound.forEach(h => withTraffic[h.peer] = true);
    history.outbound.forEach(h => withTraffic[h.peer] = true);
    let noTraffic = [];
    peers.forEach(p => { 
      if (!withTraffic[p.id]) noTraffic.push(p.name);
    })

    let ret = {};
    if (history.unknown && history.unknown.length > 0) ret.unknown = history.unknown;
    ret.inbound = formatArray(history.inbound);
    ret.outbound = formatArray(history.outbound);
    if (noTraffic.length > 0) ret.noTraffic = noTraffic;

    return ret;

    function formatArray(list) {
      let newList = []
      list.forEach(n => {
        newList.push({
          name: n.name,
          total: withCommas(n.sum),
          "%": n.p,
          "d%": n.d,
          ppm: n.ppm,
          margin: n.margin
        })
      })
      return newList;
    }
  }
}
