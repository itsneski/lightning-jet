const constants = require('./constants');
const config = require('./config');
const {listFeesSync} = require('../db/utils');

module.exports = {
  printFeeAnalysis(peerName, peerId, localFee, remoteFee, profit = 0) {
    let msgs = module.exports.analyzeFees(peerName, peerId, localFee, remoteFee, profit);
    msgs.forEach(m => {
      let color;
      if (m.importance === constants.feeAnalysis.urgent) color = constants.colorRed;
      if (m.importance === constants.feeAnalysis.warning) color = constants.colorYellow;
      if (m.importance === constants.feeAnalysis.success) color = constants.colorGreen;
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
    const success = constants.feeAnalysis.success;

    const maxPpm = global.testMaxPpm || config.rebalancer.maxAutoPpm || constants.rebalancer.maxAutoPpm;
    const enforceMaxPpm = (global.testEnforceMaxPpm === undefined) ? config.rebalancer.enforceMaxPpm : global.testEnforceMaxPpm;
    const buffer = constants.rebalancer.buffer;

    let optimalMaxPpm;
    let array = [];

    // get recent fee changes for the peer
    const feeHistoryDepth = 240;  // minutes
    let feeHistory = listFeesSync(peerId, feeHistoryDepth);
    let feeStats;
    if (feeHistory && feeHistory.length > 0) {
      let min;
      let max;
      let count = 0;
      feeHistory.forEach(h => {
        if (h.ppm > 0) {
          min = (min) ? Math.min(min, h.ppm) : h.ppm;
          max = (max) ? Math.max(max, h.ppm) : h.ppm;
          count++;
        }
      })
      if (count > 0) {
        feeStats = { count: count, min: min, max: max };
      }
    }

    // formulate intro
    let intro = 'evaluating [outbound] ' + peerName;
    addMessage(success, intro);

    intro = 'current fees: local { base: ' + localFee.base + ', ppm: ' + localFee.rate + '} remote { base: ' + remoteFee.base + ', ppm: ' + remoteFee.rate + ' }. max ppm: ' + maxPpm + ' (max ppm is ';
    intro += (enforceMaxPpm) ? 'being enforced)' : 'not being enforced)';
    if (feeStats) intro += '\nthe peer changed their ppm ' + feeStats.count + ' times over the past ' + feeHistoryDepth/60 + ' hours, min: ' + feeStats.min + ', max: ' + feeStats.max;
    addMessage(normal, intro);

    // calculate optimal max ppm
    let optimal = maxPpm;
    if (enforceMaxPpm) {
      if (local > maxPpm) {
        addMessage(normal, 'local fee exceeds the max ppm of ' + maxPpm + ', assuming the current max ppm as the optimal max ppm');
        if (maxPpm < remote) {
          addMessage(normal, 'remote fee exceeds the max ppm, this means that rebalances can not go through this peer');
          // check fee stats, at least two occurances, otherwise it don't matter as much
          if (feeStats && feeStats.count >= 2) {
            if (feeStats.min < maxPpm) {
              // the peer has been flip flopping between fees, with the
              // min being less than the max ppm, so there is a chance
              // the peer will lower fees
              addMessage(normal, 'the peers has been changing their fees fairly often, with the min of ' + feeStats.min + ' that is less than the max ppm');
              addMessage(normal, 'suggestion: keep on monitoring peer\'s fees, there is a chance the peer will drop their fees');
            } else {
              // is there a hope for the peer to drop their fees?
              addMessage(normal, 'suggestion: keep on monitoring peer\'s fees');
            }
          } else {  // no fee history, is there hope?
            addMessage(normal, 'suggestion: keep on monitoring peer\'s fees');
          }
          return array;          
        }
      } else {  // local <= max ppm
        optimal = local;
        addMessage(normal, 'local ppm of ' + localFee.rate + ' is below the max ppm, assuming the local ppm as optimal max ppm so that rebalances are more cost-effective');
      }
      
      if (optimal < remote) {
        if (optimal + buffer < maxPpm) {
          // this will change once profitability is enforced
          optimal = optimal + buffer;
          addMessage(normal, 'adjusting the optimal max ppm to ' + optimal + ' to account for min rebalance buffer');
        } else {
          addMessage(urgent, 'remote fee exceeds the optimal max ppm of ' + optimal + ', the rebalancer will pause for this peer');
          addMessage(normal, 'suggestion: keep on monitoring peer\'s fees');
          return array; // serious enough to exit
        }
      }

      // let's figure out profit margin
      // make sure we are above the min to be profitable
      if (profit) {
        let minProfitable = Math.round((remote + buffer) * (1 + profit/100));
        let profitOptimal = Math.round(optimal * (1 - profit / 100));
        addMessage(normal, 'optimal rebalance max ppm given the profit margin of ' + profit + '% is ' + minProfitable);
        if (profitOptimal < minProfitable) {
          addMessage(warning, 'not enough of a buffer for rebalancer to meet the profitability of ' + profit + '%. consider increasing local ppm to ' + minProfitable);
        } else {
          addMessage(normal, 'the rebalance max ppm of ' + profitOptimal + ' meets the profitability of ' + profit + '%');
        }
      } else {  // profit requirements not specified
        if (optimal < remote) {
          addMessage(urgent, 'the optimal max ppm is below the remote fee of ' + remote + '. the rebalancer will pause for this peer');
          addMessage(normal, 'suggestion: keep on monitoring peer\'s fees');
        } else if (optimal < remote + buffer) {
          let msg = 'not enough of a buffer between the remote fee and the optimal max ppm of ' + optimal + '. this means that rebalances have less of a chance to go through';
          addMessage(normal, msg);
          msg = (optimal === maxPpm) ? 'suggestion: consider increasing maxPpm to ' + (remote + buffer) : 'suggestion: consider increasing your local ppm to ' + (remote + buffer);
          addMessage(warning, msg);
        } else {
          addMessage(normal, 'there is enough of a buffer between the remote fee and the optimal max ppm of ' + optimal + '. the rebalance is good to go');
        }
      }
      return array;
    } // eo enforceMaxPpm on

    // enforceMaxPpm is off, make sure to cap the max ppm
    let xx = Math.floor(local / maxPpm);
    if (xx >= 10) {
      // the local ppm is insane
      addMessage(urgent, 'local fee exceeds the max ppm by more than ' + xx + 'x');
      addMessage(normal, 'suggestion: revisit your fees. the rebalancer will pause for this peer');
      return array; // important enough to exit
    }
    if (xx >= 2) {
      addMessage(warning, 'local fee exceeds the max ppm by more than ' + xx + 'x');
      addMessage(normal, 'suggestion: revisit your fees');
    }
    optimal = local;
    if (profit) {
      let minProfitable = Math.round((remote + buffer) / (1 - profit/100));
      let profitOptimal = Math.round(optimal * (1 - profit / 100));
      addMessage(normal, 'optimal rebalance max ppm given the profit margin of ' + profit + '% is ' + minProfitable);
      if (profitOptimal < minProfitable) {
        addMessage(warning, 'not enough of buffer for rebalancer to meet the profitability requirements');
        addMessage(normal, 'suggestion: consider increasing local ppm from ' + localFee.rate + ' to ' + minProfitable);
      } else {
        addMessage(normal, 'there is enough of a buffer between the remote fee and the optimal max ppm of ' + profitOptimal + '. the rebalance is good to go');
      }
    } else {
      if (optimal < remote) {
        addMessage(urgent, 'the optimal max ppm of ' + optimal + ' is below the remote fee. this means that rebalances will not go through for this peer');
        addMessage(normal, 'suggestion: keep on monitoring peer\'s fees');
      } else if (optimal < remote + buffer) {
        addMessage(warning, 'not enough of a buffer between the remote fee and the optimal max ppm of ' + optimal);
        addMessage(normal, 'suggestion: consider increasing local ppm from ' + localFee.rate + ' to ' + (remote + buffer));
      } else {
        addMessage(normal, 'there is enough of a buffer between the remote fee and the optimal max ppm of ' + optimal + '. the rebalance is good to go');
      }
    }
    return array;

    function addMessage(importance, message) {
      array.push({importance:importance, message:message})
    }
  }
}
