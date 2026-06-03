const importLazy = require('import-lazy')(require);

const constants = importLazy('../../api/constants');
const dbUtils = importLazy('../../db/utils');

const {
  requireLndAlive,
  lndUtils,
} = require('../utils/lnd');

function registerStatsCommand(program) {
  program
    .command('stats')
    .summary('Shows channel profitability stats')
    .description('Shows channel profitability stats.')
    .option(
      '--days <days>',
      'Depth of history in days; max of ' +
        Math.floor(constants.db.maxTxnDepth / 2) +
        ' days, default ' +
        Math.floor(constants.defaultTxnInterval / 24),
      parsePositiveNumber
    )
    .option(
      '--hours <hours>',
      'Depth of history in hours; max of ' +
        24 * Math.floor(constants.db.maxTxnDepth / 2) +
        ' hours, default ' +
        constants.defaultTxnInterval,
      parsePositiveNumber
    )
    .action(async (options) => {
      const lndClient = requireLndAlive();

      const maxDepth = 24 * Math.floor(constants.db.maxTxnDepth / 2);
      const hours =
        options.hours ||
        (options.days && options.days * 24) ||
        constants.defaultTxnInterval;

      if (hours > maxDepth) {
        console.error(
          'history depth exceeds the max of ' +
            maxDepth +
            ' hours (' +
            Math.floor(maxDepth / 24) +
            ' days)'
        );
        return;
      }

      const msec = new Date(new Date().toUTCString()).getTime();
      const fromTimestamp = (msec - hours * 60 * 60 * 1000) * Math.pow(10, 6);

      const list = dbUtils.txnByChanAndType(fromTimestamp);

      if (!list || list.length === 0) {
        console.log('no records found');
        return;
      }

      const fromT = (msec - 2 * hours * 60 * 60 * 1000) * Math.pow(10, 6);
      const toT = (msec - hours * 60 * 60 * 1000) * Math.pow(10, 6);
      const prevList = dbUtils.txnByChanAndType(fromT, toT);

      const historyMap = {};
      const historyTotal = {
        profit: 0,
        inbound: { amount: 0 },
        forward: { fee: 0, amount: 0 },
        rebalance: { fee: 0, amount: 0 },
      };

      if (prevList && prevList.length > 0) {
        prevList.sort((a, b) => a.txdate_ns - b.txdate_ns);

        prevList.forEach((item) => {
          if (!historyMap[item.chan]) {
            historyMap[item.chan] = {
              forward: { fee: 0, amount: 0 },
              inbound: { amount: 0 },
              rebalance: { fee: 0, amount: 0 },
            };
          }

          if (item.type === 'forward') {
            historyMap[item.chan].forward.fee = item.total_fee;
            historyMap[item.chan].forward.amount = item.total_amount;
            historyTotal.forward.fee += item.total_fee;
            historyTotal.forward.amount += item.total_amount;
          } else if (item.type === 'inbound') {
            historyMap[item.chan].inbound.amount = item.total_amount;
          } else if (item.type === 'rebalance') {
            historyMap[item.chan].rebalance.fee = item.total_fee;
            historyMap[item.chan].rebalance.amount = item.total_amount;
            historyTotal.rebalance.fee += item.total_fee;
            historyTotal.rebalance.amount += item.total_amount;
          }

          historyMap[item.chan].delta =
            historyMap[item.chan].forward.fee -
            historyMap[item.chan].rebalance.fee;
        });

        historyTotal.profit =
          historyTotal.forward.fee - historyTotal.rebalance.fee;
      }

      const chanMap = {};
      const chans = lndUtils.listChannelsSync(lndClient);

      chans.forEach((channel) => {
        chanMap[channel.chan_id] = channel.remote_pubkey;
      });

      const peerMap = {};
      const peers = lndUtils.listPeersSync(lndClient);

      peers.forEach((peer) => {
        peerMap[peer.id] = peer.name;
      });

      const map = {};

      list.forEach((item) => {
        const chan = item.chan;

        if (!map[chan]) {
          map[chan] = {};
        }

        const record = map[chan];

        if (item.type === 'forward') {
          record.forward = {
            amount: item.total_amount,
            fee: item.total_fee,
          };
        } else if (item.type === 'inbound') {
          record.inbound = {
            amount: item.total_amount,
          };
        } else if (item.type === 'rebalance') {
          record.rebalance = {
            amount: item.total_amount,
            fee: item.total_fee,
          };
        }
      });

      const combined = [];

      Object.keys(map).forEach((chan) => {
        const item = {};

        item.chan = chan;
        item.peer = chanMap[chan];
        item.name = peerMap[chanMap[chan]];

        if (map[chan].forward) {
          item.forward = map[chan].forward;
        }

        if (map[chan].inbound) {
          item.inbound = map[chan].inbound;
        }

        if (map[chan].rebalance) {
          item.rebalance = map[chan].rebalance;
        }

        const feeForward = (item.forward && item.forward.fee) || 0;
        const feeRebalance = (item.rebalance && item.rebalance.fee) || 0;

        item.delta = feeForward - feeRebalance;

        combined.push(item);
      });

      let total = 0;
      const totalForwarded = { amount: 0, fee: 0 };
      const totalRebalanced = { amount: 0, fee: 0 };

      combined.forEach((item) => {
        total += item.delta;
        totalForwarded.amount += (item.forward && item.forward.amount) || 0;
        totalForwarded.fee += (item.forward && item.forward.fee) || 0;
        totalRebalanced.amount +=
          (item.rebalance && item.rebalance.amount) || 0;
        totalRebalanced.fee += (item.rebalance && item.rebalance.fee) || 0;
      });

      let str = 'cumulative stats';
      const days = isInt(hours / 24) && Math.floor(hours / 24);

      if (days) {
        str += ' over the past ' + days + ' day(s)';
      } else {
        str += ' over the past ' + hours + ' hour(s)';
      }

      console.log(str + ':');

      const cumulative = [];

      cumulative.push({
        period: 'current',
        profit: total,
        forwarded: lndUtils.withCommas(totalForwarded.amount),
        earned: totalForwarded.fee,
        rebalanced: lndUtils.withCommas(totalRebalanced.amount),
        paid: totalRebalanced.fee,
      });

      cumulative.push({
        period: 'previous',
        profit: historyTotal.profit,
        forwarded: lndUtils.withCommas(historyTotal.forward.amount),
        earned: historyTotal.forward.fee,
        rebalanced: lndUtils.withCommas(historyTotal.rebalance.amount),
        paid: historyTotal.rebalance.fee,
      });

      console.log(
        'this table displays data for two time periods, current and previous; e.g. display weekly data over the past week along with the data from a week ago'
      );
      console.table(cumulative);

      const profitable = [];

      combined.forEach((item) => {
        if (item.delta <= 0) {
          return;
        }

        const rec = {
          chan: item.chan,
          peer: item.name,
          profit: item.delta,
          inbound: (item.inbound && item.inbound.amount) || 0,
          outbound: (item.forward && item.forward.amount) || 0,
          earned: (item.forward && item.forward.fee) || 0,
          rebalanced: (item.rebalance && item.rebalance.amount) || 0,
          paid: (item.rebalance && item.rebalance.fee) || 0,
        };

        const prev = historyMap[item.chan] && historyMap[item.chan].delta;

        if (prev !== undefined && prev !== 0) {
          const delta = rec.profit - prev;

          if (delta !== 0) {
            rec.delta = delta;
          }

          if (historyMap[item.chan].forward.amount !== 0) {
            rec['delta_fw %'] = Math.round(
              (100 *
                (rec.outbound - historyMap[item.chan].forward.amount)) /
                historyMap[item.chan].forward.amount
            );
          }

          if (historyMap[item.chan].rebalance.amount !== 0) {
            rec['delta_rb %'] = Math.round(
              (100 *
                (rec.rebalanced -
                  historyMap[item.chan].rebalance.amount)) /
                historyMap[item.chan].rebalance.amount
            );
          }
        }

        profitable.push(rec);
      });

      profitable.sort((a, b) => b.profit - a.profit);

      console.log('\nprofitable channels:');

      if (profitable.length === 0) {
        console.log('none found');
      } else {
        console.log('-profit: profit in sats');
        console.log('-inbound: total inbound sats');
        console.log('-outbound: total outbound sats');
        console.log('-earned: total sats earned on forwards (outbound)');
        console.log('-rebalanced: total sats rebalanced');
        console.log('-paid: total sats paid for rebalances');
        console.log(
          '-delta: change in profit (sats) since the last interval; e.g. 15 means that the profit has increased by 15 sats'
        );
        console.log(
          '-delta_fw: change in sats (%) forwarded since the last interval; e.g. 25 means that the node forwarded 25% more sats comparing to the last interval'
        );
        console.log(
          '-delta_rb: change in sats (%) rebalanced since the last interval; e.g. 25 means that the node rebalanced 25% more sats comparing to the last interval'
        );
        console.table(profitable);
      }

      const unprofitable = [];

      combined.forEach((item) => {
        if (item.delta > 0) {
          return;
        }

        const rec = {
          chan: item.chan,
          peer: item.name,
          loss: Math.abs(item.delta),
          inbound: (item.inbound && item.inbound.amount) || 0,
          outbound: (item.forward && item.forward.amount) || 0,
          earned: (item.forward && item.forward.fee) || 0,
          rebalanced: (item.rebalance && item.rebalance.amount) || 0,
          paid: (item.rebalance && item.rebalance.fee) || 0,
        };

        const prev = historyMap[item.chan] && historyMap[item.chan].delta;

        if (prev !== undefined && prev !== 0) {
          const delta = -(item.delta - prev);

          if (delta !== 0) {
            rec.delta = delta;
          }

          if (historyMap[item.chan].forward.amount !== 0) {
            rec['delta_fw %'] = Math.round(
              (100 *
                (rec.outbound - historyMap[item.chan].forward.amount)) /
                historyMap[item.chan].forward.amount
            );
          }

          if (historyMap[item.chan].rebalance.amount !== 0) {
            rec['delta_rb %'] = Math.round(
              (100 *
                (rec.rebalanced -
                  historyMap[item.chan].rebalance.amount)) /
                historyMap[item.chan].rebalance.amount
            );
          }
        }

        unprofitable.push(rec);
      });

      unprofitable.sort((a, b) => b.loss - a.loss);

      console.log('\nunprofitable channels:');

      if (unprofitable.length === 0) {
        console.log('none found');
      } else {
        console.log(
          '-delta: change in loss (sats) since the last interval; e.g. 15 means that the loss has increased by 15 sats'
        );
        console.table(unprofitable);
      }
    });
}

function parsePositiveNumber(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Expected a positive number');
  }

  return parsed;
}

function isInt(value) {
  const parsed = parseFloat(value);

  return !Number.isNaN(parsed) && (parsed | 0) === parsed;
}

module.exports = {
  registerStatsCommand,
};
