const constants = require('./constants');
const config = require('./config');

module.exports = {
  printFeeAnalysis(peerName, peerId, localFee, remoteFee, profit = 0) {
    let msgs = module.exports.analyzeFees(peerName, peerId, localFee, remoteFee, profit);
    msgs.forEach(m => {
      let color;
      if (m.importance === constants.feeAnalysis.urgent) color = constants.colorRed;
      if (m.importance === constants.feeAnalysis.warning) color = constants.colorYellow;
      if (color) console.log(color, m.message);
      else console.log(m.message)
    })
    return msgs.length;
  },
  // analyzes peer fees and returns an array of messages with importance
  // importance grades: normal, warning, urgent
  // profit - profit margin to evaluate fees against; default - 0, means
  // that there arent any paricular profit requirements. the rebalancer
  // will attempt to rebalance as long as its not at a loss
  analyzeFees(peerName, peerId, localFee, remoteFee, profit = 0) {
    if (profit < 0 || profit > 100) throw new Error('profit has to be between 0 and 100'); 

    let local = Math.round(localFee.base/1000 + localFee.rate);
    let remote = Math.round(remoteFee.base/1000 + remoteFee.rate);

    const normal = constants.feeAnalysis.normal;
    const warning = constants.feeAnalysis.warning;
    const urgent = constants.feeAnalysis.urgent;

    const maxPpm = global.testMaxPpm || config.rebalancer.maxAutoPpm || constants.rebalancer.maxAutoPpm;
    const enforceMaxPpm = (global.testEnforceMaxPpm === undefined) ? config.rebalancer.enforceMaxPpm : global.testEnforceMaxPpm;
    const buffer = constants.rebalancer.buffer;

    let optimalMaxPpm;
    let array = [];

    let intro = 'evaluating [outbound] ' + peerName + '. current fees: local { base: ' + localFee.base + ', ppm: ' + localFee.rate + '} remote { base: ' + remoteFee.base + ', ppm: ' + remoteFee.rate + ' }. max ppm: ' + maxPpm + ', max ppm is ';
    intro += (enforceMaxPpm) ? 'being enforced' : 'not being enforced';

    array.push({
      importance: normal,
      message: intro
    })

    // calculate optimal max ppm
    let optimal = maxPpm;
    if (enforceMaxPpm) {
      if (local > maxPpm) {
        array.push({
          importance: normal,
          message: 'local fee exceeds the max ppm of ' + maxPpm + ', assuming the current max ppm as the optimal max ppm'
        })
      } else {
        optimal = local;
        array.push({
          importance: normal,
          message: 'local ppm of ' + localFee.rate + ' is below the max ppm, assuming the local ppm as optimal max ppm so that rebalances are more cost-effective'
        })
      }
      if (optimal < remote) {
        array.push({
          importance: urgent,
          message: 'remote fee exceeds the optimal max ppm of ' + optimal + ', the rebalancer will pause. keep on monitoring peer\'s fees.'
        })
        return array; // serious enough to exit
      }
      // let's figure out profit margin
      // make sure we are above the min to be profitable
      if (profit) {
        let minProfitable = Math.round((remote + buffer) * (1 + profit/100));
        let profitOptimal = Math.round(optimal * (1 - profit / 100));
        array.push({
          importance: normal,
          message: 'optimal rebalance max ppm given the profit margin of ' + profit + '% is ' + minProfitable
        })
        if (profitOptimal < minProfitable) {
          array.push({
            importance: warning,
            message: 'not enough of a buffer for rebalancer to meet the profitability of ' + profit + '%. consider increasing the local fee to ' + minProfitable
          })
        } else {
          array.push({
            importance: normal,
            message: 'the rebalance max ppm of ' + profitOptimal + ' meets the profitability of ' + profit + '%'
          })
        }
      } else {  // profit requirements not specified
        if (optimal < remote) {
          array.push({
            importance: urgent,
            message: 'the optimal max ppm is below the remote fee of ' + remote + '. the rebalancer will pause. keep on monitoring peer\'s fees'
          })
        } else if (optimal < remote + buffer) {
          let msg = 'not enough of a buffer between the remote fee and the optimal max ppm of ' + optimal + '. this means that rebalances have less of a change to go through.';
          msg += (optimal === maxPpm) ? ' consider increasing maxPpm to ' + (remote + buffer) : ' consider increasing your local fee to ' + (remote + buffer);
          array.push({
            importance: warning,
            message: msg 
          })
        } else {
          array.push({
            importance: normal,
            message: 'there is enough of a buffer between the remote fee and the optimal max ppm of ' + optimal + '. the rebalance is good to go'
          })
        }
      }
      return array;
    } // eo enforceMaxPpm on

    // enforceMaxPpm is off, make sure to cap the max ppm
    let xx = Math.floor(local / maxPpm);
    if (xx >= 10) {
      // the local ppm is insane
      array.push({
        importance: urgent,
        message: 'local fee exceeds the max ppm by more than ' + xx + 'x. revisit your fees. the rebalancer will pause'
      })
      return array; // important enough to exit
    }
    if (xx >= 2) {
      array.push({
        importance: warning,
        message: 'local fee exceeds the max ppm by more than ' + xx + 'x. consider revisiting your fees'
      })
    }
    optimal = local;
    if (profit) {
      let minProfitable = Math.round((remote + buffer) / (1 - profit/100));
      let profitOptimal = Math.round(optimal * (1 - profit / 100));
      array.push({
        importance: normal,
        message: 'optimal rebalance max ppm given the profit margin of ' + profit + '% is ' + minProfitable
      })
      if (profitOptimal < minProfitable) {
        array.push({
          importance: warning,
          message: 'not enough of buffer for rebalancer to meet the profitability requirements. consider increasing local ppm from ' + localFee.rate + ' to ' + minProfitable
        })
      } else {
        array.push({
          importance: normal,
          message: 'there is enough of a buffer between the remote fee and the optimal max ppm of ' + profitOptimal + '. the rebalance is good to go'
        })
      }
    } else {
      if (optimal < remote + buffer) {
        array.push({
          importance: urgent,
          message: 'not enough of a buffer between the remote fee and the optimal max ppm of ' + optimal + '. consider increasing local ppm from ' + localFee.rate + ' to ' + (remote + buffer)
        })
      } else {
        array.push({
          importance: normal,
          message: 'there is enough of a buffer between the remote fee and the optimal max ppm of ' + optimal + '. the rebalance is good to go'
        })
      }
    }
    return array;
  }
}
