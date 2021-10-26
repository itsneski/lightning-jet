const deasync = require('deasync');
const constants = require('../api/constants');

const toBytes = id => Buffer.from(id, 'hex').reverse();

module.exports = {
  updateChannelSync: function(lndClient, req) {
    if (!req.chan) throw new Error('channel is missing');

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

    if (!req.base && !req.ppm) throw new Error('either base or ppm need to be provided');
    let tokens = chan.chan_point.split(':');
    let cpoint = { 
      funding_txid_str: tokens[0],
      output_index: parseInt(tokens[1]),
    };
    let grpc = { chan_point: cpoint, time_lock_delta: constants.lnd.timeLockDelta };
    if (req.base) grpc.base_fee_msat = req.base
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
