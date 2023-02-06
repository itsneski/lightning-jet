#!/usr/bin/env node

global.testModeOn = true;

const bosPay = require('../bos/pay');

const stringify = obj => JSON.stringify(obj, null, 2);

let lastRoute;
module.exports = (args) => {
  const pref = 'pay:';
  if (!args) throw new Error('arguments missing');
  if (!args.request) throw new Error('missing request');

  const logger = {
    eval: (route) => {
      console.log('\nprobing route:', route);
      lastRoute = route;
    },
    amount: (amount) => {
      console.log('pay eval:', amount);
      lastAmount = amount;
    },
    debug: (msg) => {
      console.log('pay debug:', stringify(msg));
    },
    info: (msg) => {
      console.log('pay info:', stringify(msg));
    },
    warn: (msg) => {
      console.warn('pay warn:', stringify(msg));
    },
    error: (msg) => {
      const code = errcode(msg);
      if (code === 'TemporaryChannelFailure') console.log('(TemporaryChannelFailure) insufficient liquidity on one of the route hops, skip');
      else console.error('bos rebalance error:', stringify(msg));
    }
  }

  args.logger = logger;

  // loop until we find the payment route
  let avoidArr = args.avoid;
  let keepRunning = true;
  while (keepRunning) {
    const ret = bosPay(args);
    if (!ret.error) return {result: ret.result};  // exit the loop
    if (ret.error.error === 'MaxFeeLimitTooLow') {
      console.log(pref, 'exceeds max fee, find and exclude most expensive node');
      if (!lastRoute) {
        const err = 'couldnt find last route';
        console.error(pref, err);
        return {error: err}; // exit the loop
      }
      // find and exclude the most expensive node
      let max;
      lastRoute.forEach(r => {
        if (!max || r.ppm > max.ppm) {
          max = r;
          return;
        }
      })
      console.log(pref, 'excluding:', max);
      avoidArr.push(max.id);
    } else {
      console.error(pref, ret.error);
      return {error: ret.error};
    }
  }
}
