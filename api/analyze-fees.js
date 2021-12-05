const constants = require('./constants');
const config = require('./config');
const {listFeesSync} = require('../db/utils');

module.exports = {
  printFeeAnalysis(peerName, peerId, localFee, remoteFee, profit = 0) {
    let msgs = module.exports.analyzeFees(peerName, peerId, localFee, remoteFee, profit);
    const action = constants.feeAnalysis.action;
    let status = [];
    msgs.forEach(m => {
      let color;
      if (m.importance === constants.feeAnalysis.urgent) color = constants.colorRed;
      if (m.importance === constants.feeAnalysis.warning) color = constants.colorYellow;
      if (m.importance === constants.feeAnalysis.success) color = constants.colorGreen;
      if (color) console.log(color, m.message);
      else console.log(m.message);
      // rebalancing status
      if (m.action === action.pause) status.push('action: pause');
      if (m.maxPpm) status.push('current max ppm: ' + m.maxPpm);
      if (m.suggestedPpm) status.push('suggested max ppm: ' + m.suggestedPpm);
    })
    if (global.testModeOn && status.length > 0) console.log('(' + status.join(', ') + ')');
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
    const action = constants.feeAnalysis.action;

    const maxPpm = global.testMaxPpm || config.rebalancer.maxAutoPpm || constants.rebalancer.maxAutoPpm;
    const enforceMaxPpm = (global.testEnforceMaxPpm === undefined) ? config.rebalancer.enforceMaxPpm : global.testEnforceMaxPpm;
    const buffer = constants.rebalancer.buffer;

    let optimalMaxPpm;
    let array = [];

    // get recent fee changes for the peer
    const feeHistoryDepth = 360;  // 6h?
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
    let status = { importance: normal, message: 'evaluating [outbound] ' + peerName };
    array.push(status);

    let intro = 'current fees: local { base: ' + localFee.base + ', ppm: ' + localFee.rate + ' } remote { base: ' + remoteFee.base + ', ppm: ' + remoteFee.rate + ' }. max ppm: ' + maxPpm + ' (';
    intro += (enforceMaxPpm) ? 'enforced)' : 'not enforced)';
    if (profit) intro += ', profit margin: ' + profit + '%';
    if (feeStats) intro += '\nthe peer changed ppm ' + feeStats.count + ' time(s) over the past ' + feeHistoryDepth/60 + ' hours, min: ' + feeStats.min + ', max: ' + feeStats.max;
    addMessage(normal, intro);

    // check if the node operator intends to accumulate local liquidity,
    // with 10x difference being an indication
    let x = Math.floor(local/maxPpm);
    if (x > 10) {
      addMessage(warning, 'local ppm exceeds max ppm by more than ' + x + 'x. assuming node operator intends to accumulate sats');
      addMessage(urgent, 'pausing rebalancing for this peer');
      addMessage(normal, 'suggestion: consider revisiting local ppm to resume rebalancing');
      status.action = action.pause;
      return array;
    }

    let optimal = maxPpm;
    if (local > maxPpm) {
      if (enforceMaxPpm) {
        addMessage(normal, 'local ppm exceeds the max ppm, setting optimal max ppm to ' + maxPpm);
        optimal = maxPpm;
      } else {
        // extra warning about local/maxPpm ratio
        if (x >= 2) {
          // not critical?
          addMessage(warning, 'local ppm exceeds max ppm by more than ' + x + 'x');
          addMessage(normal, 'setting optimal max ppm to ' + local);
        } else {
          addMessage(normal, 'setting optimal max ppm to ' + local);
        }
        optimal = local;
      }
    } else {
      addMessage(normal, 'setting optimal max ppm to ' + local);
      optimal = local;  // local is below the max, so assume it as the max
    }

    // can rebalance be profitable
    if (optimal <= remote) {
      addMessage(warning, 'remote fee exceeds the optimal max ppm');
      addMessage(urgent, 'pausing rebalancing for this peer');
      // see if it makes to make ppm reco
      if (feeStats && feeStats.count >= 2) {
        if (feeStats.min < remote) {
          // the peer has been flip flopping between fees, with the min being below
          // remote, meaning there is still chance that the fee will be reversed
          addMessage(normal, 'the peer has been changing fees fairly often, with the min of ' + feeStats.min + ' that is less than remote fee');
          addMessage(normal, 'suggestion: keep on monitoring peer\'s fees, there is a chance the peer will drop fees');
        } else {
          // is there a hope for the peer to drop fees?
          addMessage(normal, 'suggestion: keep on monitoring peer\'s fees');
        }
      } else {  // no fee history
        let suggested = remote + buffer;
        if (profit) suggested *= (1 + profit/100);
        let array = [];
        if (local < suggested) array.push('local ppm');
        if (enforceMaxPpm && remote > maxPpm) {
          array.push('max ppm');
          addMessage(normal, 'suggestion: consider bumping ' + array.join(' and ') + ' to ' + suggested);
        } else {
          addMessage(normal, 'suggestion: consider increasing local ppm to ' + suggested);
        }
        status.suggestedPpm = suggested;
      }
      status.action = action.pause;
      return array; // serious enough to exit
    }

    // is there a sufficient buffer to rebalance profitably
    if (profit) {
      let minProfitable = Math.ceil((remote + buffer) * (1 + profit/100));
      if (optimal < minProfitable) {
        addMessage(warning, 'insufficient buffer for rebalancer to meet profitability margin of ' + profit + '%');
        if (enforceMaxPpm && minProfitable > maxPpm) {
          addMessage(normal, 'suggestion: consider increasing local ppm and max ppm to ' + minProfitable);
        } else {
          addMessage(normal, 'suggestion: consider increasing local ppm to ' + minProfitable);
        }
        status.suggestedPpm = minProfitable;
      } else {
        addMessage(normal, 'optimal max ppm meets profitability margin of ' + profit + '%');
      }
      status.maxPpm = optimal;
    } else {  // profit requirements not specified
      if (optimal < remote + buffer) {
        addMessage(normal, 'insufficient buffer between optimal max and remote ppm, rebalances have less of a chance to go through');
        if (enforceMaxPpm && remote + buffer > maxPpm) {
          addMessage(warning, 'suggestion: consider increasing local and max ppm to ' + (remote + buffer));
        } else {
          addMessage(warning, 'suggestion: consider increasing local ppm to ' + (remote + buffer));
        }
        status.suggestedPpm = remote + buffer;
      } else {
        addMessage(normal, 'sufficient buffer between remote ppm and optimal max ppm. things are looking good');
      }
      status.maxPpm = optimal;
    }
    return array;

    function addMessage(importance, message) {
      array.push({importance:importance, message:message})
    }
  }
}
