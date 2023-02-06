const importLazy = require('import-lazy')(require);
const network = importLazy('balanceofsatoshis/network');
const {readFile} = require('fs');
const {parseResult, parseError, parseNodes} = require('./parser');
const lndHandle = importLazy('./connect');
const deasync = require('deasync');

module.exports = (args) => {
  const pref = 'pay:';
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
  payAsync(args, callback).catch((err) => {
    console.error(pref, 'error calling pay:', err);
    error = err;
    done = true;
  })
  deasync.loopWhile(() => !done);
  return {error, result};

  // <args.logger> - callback for log messages
  //  logger.eval - called when a route is evaluated
  //  logger.info - info messages
  //  logger.debug - debug messages
  //  logger.warm - warnings
  //  logger.error - errors
  // <args.request> - invoice
  // [args.maxFee] - max fee
  // [args.avoid] - as list of nodes to avoid (pub ids)
  // [args.mins] - max time to run in minutes
  // <cbk> - callback on success or failure of rebalance
  //   cbk.success(sats) - called when rebalance is successfully completed
  //   cbk.failure(err) - called when rebalance errored out
  async function payAsync(args, cbk) {
    if (!args) throw new Error('arguments missing');
    if (!args.logger) throw new Error('missing logger');
    if (!args.request) throw new Error('missing request');
    if (!cbk) throw new Error('missing callback');

    const mylogger = {
      debug: (msg) => { return args.logger.debug(debug) },
      info: (msg) => {
        if (msg && msg.evaluating_amount !== undefined) return args.logger.amount(msg.evaluating_amount);

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
      if (global.testModeOn) console.log('pay:', args.request, 'max fee:', args.maxFee);
      if (global.testModeOn) console.log('avoid:', args.avoid);

      network.pay({
        lnd: lndHandle,
        logger: mylogger,
        avoid: args.avoid,
        fs: {getFile: readFile},
        in_through: args.in,
        is_real_payment: true,
        max_fee: args.maxFee,
        max_paths: args.maxPaths,
        message: args.message,
        out: args.out,
        request: args.request,
      }, callback);
    })
  }
}
