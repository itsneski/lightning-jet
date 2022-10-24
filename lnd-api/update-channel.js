const deasync = require('deasync');
const constants = require('../api/constants');
const {getInfoSync} = require('../lnd-api/utils');

const toBytes = id => Buffer.from(id, 'hex').reverse();

module.exports = {
  // returns true if successful, throws an error otherwise
  updateChannelSync: function(lndClient, req) {
    if (!req.chan) throw new Error('channel is missing');
    if (!req.base && !req.ppm) throw new Error('either base or ppm need to be provided');

    // get channel info
    let chan, error, done;
    lndClient.getChanInfo({chan_id: req.chan}, (err, resp) => {
      error = err;
      chan = resp;
      done = true;
    })
    deasync.loopWhile(() => !done);

    if (error) throw new Error('error getting channel info: ' + error.toString());
    
    let nodeInfo;
    try {
     nodeInfo = getInfoSync(lndClient);
    } catch(err) {
      throw new Error('error getting node info: ' + err.toString());
    }

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

    done = false;
    error = undefined;
    lndClient.updateChannelPolicy(grpc, (err, resp) => {
      error = err;
      done = true;
    })
    deasync.loopWhile(() => !done);
 
    if (error) throw new Error('error updating channel: ' + error.toString());
    return true;
  }
}
