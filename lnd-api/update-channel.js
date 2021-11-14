const deasync = require('deasync');
const constants = require('../api/constants');
const {getInfoSync} = require('../lnd-api/utils');

const toBytes = id => Buffer.from(id, 'hex').reverse();

module.exports = {
  updateChannelSync: function(lndClient, req) {
    if (!req.chan) throw new Error('channel is missing');
    if (!req.base && !req.ppm) throw new Error('either base or ppm need to be provided');

    // get channel info
    let chan;
    let error;

    lndClient.getChanInfo({chan_id: req.chan}, (err, response) => {
      if (err) {
        error = err;
        chan = true;  // unblock the loop
      } else {
        chan = response;
      }
    })
    while(chan === undefined) {
      deasync.runLoopOnce();
    }
    if (error) throw new Error('error getting channel info: ' + error.toString());
    let nodeInfo = getInfoSync(lndClient);

    // there is a weird bug in https://api.lightning.community/#updatechannelpolicy
    // if i don't pass the base fee, it'll zero it out. to workaround, the code
    // will fetch & pass the current base fee (if none specified). this is so that
    // the base fee wont be zeroed out.
    let reqBase = req.base;
    if (!reqBase) {
      if (nodeInfo.identity_pubkey === chan.node1_pub) reqBase = chan.node1_policy.fee_base_msat;
      else reqBase = chan.node2_policy.fee_base_msat;
    }

    let tokens = chan.chan_point.split(':');
    let cpoint = { 
      funding_txid_str: tokens[0],
      output_index: parseInt(tokens[1]),
    };
    let grpc = { chan_point: cpoint, time_lock_delta: constants.lnd.timeLockDelta };
    if (reqBase) grpc.base_fee_msat = reqBase
    if (req.ppm) grpc.fee_rate = req.ppm / 1000000;
    //console.log(grpc);

    let res;
    error = undefined;
    lndClient.updateChannelPolicy(grpc, (err, response) => {
      if (err) {
        error = err;
        res = true; // unblock the loop
      } else {
        res = response;
      }
    })
    while(res === undefined) {
      deasync.runLoopOnce();
    }
    if (error) throw new Error('error updating channel: ' + error.toString());
    return true;
  }
}
