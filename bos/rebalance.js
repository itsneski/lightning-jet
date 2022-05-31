const importLazy = require('import-lazy')(require);
const swaps = importLazy('balanceofsatoshis/swaps');
const {readFile} = require('fs');
const {parseResult, parseError, parseNodes} = require('./parser');
const lndHandle = importLazy('./connect');

module.exports = {
  rebalanceSync(args) {
    let done, error, result;
    const callback = {
      failure: (err) => {
        //console.log('failure callback:', err);
        error = err;
        done = true;
      },
      success: (res) => {
        //console.log('success callback:', res);
        result = res;
        done = true;
      }
    }
    // async rebalance returns a promise. make sure to catch exceptions
    // and gracefully exit the deasync loop
    module.exports.rebalance(args, callback).catch((err) => {
      console.error('rebalanceSync: error calling rebalance:', err);
      error = err;
      done = true;
    })
    while(done === undefined) {
      require('deasync').runLoopOnce();
    }
    return {error, result};
  },

  // <args.logger> - callback for log messages
  //  logger.eval - called when a route is evaluated
  //  logger.info - info messages
  //  logger.debug - debug messages
  //  logger.warm - warnings
  //  logger.error - errors
  // <args.from> - rebalance starting node
  // <args.to> - rebalance target node
  // <args.amount> - amount to rebalance
  // [args.maxFee] - max fee
  // [args.maxFeeRate] - max fee rate
  // [args.avoid] - as list of nodes to avoid (pub ids)
  // [args.mins] - max time to run in minutes
  // <cbk> - callback on success or failure of rebalance
  //   cbk.success(sats) - called when rebalance is successfully completed
  //   cbk.failure(err) - called when rebalance errored out
  async rebalance(args, cbk) {
    if (!args.logger) throw new Error('missing logger');
    if (!args.from) throw new Error('missing from');
    if (!args.to) throw new Error('missing to');
    if (!args.amount) throw new Error('missing amount');
    if (!cbk) throw new Error('missing callback');

    const mylogger = {
      debug: (msg) => { return args.logger.debug(debug) },
      info: (msg) => {
        try {
          let nodes = parseNodes(msg);
          if (nodes) return args.logger.eval(nodes);
          else return args.logger.info(msg);
        } catch(err) {
          return args.logger.error('error parsing nodes: ' + err);
        }
      },
      warn: (msg) => { return args.logger.warn(msg) },
      error: (msg) => { return args.logger.error(msg) }
    }

    const callback = (err, res) => {
      try {
        if (err) return cbk.failure(parseError(err));
        else return cbk.success(parseResult(res));
      } catch(err) {
        console.log(msg);
        args.logger.error('error parsing result: ' + err);
      }
    }

    return new Promise((resolve, reject) => {
      if (global.testModeOn) console.log('rebalance from:', args.from, 'to:', args.to, 'amount:', args.amount, 'max fee:', args.maxFee, 'max fee rate:', args.maxFeeRate, 'mins:', args.mins);
      if (global.testModeOn) console.log('avoid:', args.avoid);

      swaps.manageRebalance({
        logger: mylogger,
        avoid: args.avoid,
        fs: {getFile: readFile},
        out_through: args.from,
        in_through: args.to,
        lnd: lndHandle,
        max_fee: args.maxFee,
        max_fee_rate: args.maxFeeRate,
        max_rebalance: args.amount,
        timeout_minutes: args.mins,
      }, callback);
    })
  }
}
