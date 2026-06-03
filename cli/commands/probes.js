const importLazy = require('import-lazy')(require);
const { Option } = require('commander');

const constants = importLazy('../../api/constants');
const config = importLazy('../../api/config');
const dbUtils = importLazy('../../db/utils');
const apiUtils = importLazy('../../api/utils');

const {
  requireLndAlive,
  lndUtils,
} = require('../utils/lnd');

function registerProbesCommand(program) {
  program
    .command('probes')
    .summary('Displays nodes discovered during probes that have signaled a commitment to liquidity')
    .description(
      'Displays nodes discovered during probes that have signaled a commitment to liquidity. This tool can be used to identify prospects for new channels.'
    )
    .option('--days <days>', 'Depth of history in days', parsePositiveNumber)
    .option('--hours <hours>', 'Depth of history in hours', parsePositiveNumber)
    .option('--top <n>', 'Return top n records, default ' + constants.defaultProbeTopN, parsePositiveInt)
    .option('--all', 'Return all records')
    .option('--peers', 'Shows probe data for current peers instead of prospects for new channels')
    .addOption(
      new Option('--sort <col>', 'Sort by a column')
        .choices(['sats_sum', 'count', 'avg_ppm', 'min_ppm', 'max_ppm'])
    )
    .action(async (options) => {
      const lndClient = requireLndAlive();

      if (options.top && options.top <= 1) {
        console.error('--top must be above or equal to 1');
        return;
      }

      const top = options.all
        ? options.top
        : options.top || constants.defaultProbeTopN;

      const hours = options.all
        ? options.hours || (options.days && options.days * 24)
        : options.hours || (options.days && options.days * 24) || constants.defaultProbeInterval;

      const maxInterval =
        24 * ((config.db && config.db.maxProbeDepth) || constants.db.maxProbeDepth);

      if (hours > maxInterval) {
        console.error(
          'provided depth exceeds the max of ' +
            maxInterval +
            ' hours (' +
            maxInterval / 24 +
            ' days)'
        );
        return;
      }

      const msec = new Date(new Date().toUTCString()).getTime();
      const fromDate = hours && (msec - hours * 60 * 60 * 1000);
      const sortCol = options.sort || 'count';

      const list = dbUtils.reportLiquidity(fromDate);

      if (!list || list.length === 0) {
        console.log('no records found');
        return;
      }

      sortProbeList(list, sortCol);

      const peers = lndUtils.listPeersSync(lndClient);
      const peerMap = {};

      peers.forEach((peer) => {
        peerMap[peer.id] = peer;
      });

      const days = Math.max(1, Math.round(hours / 24));
      const classified = apiUtils.classifyPeersSync(lndClient, days);
      const classificationMap = {};

      if (classified.inbound) {
        classified.inbound.forEach((peer) => {
          classificationMap[peer.peer] = {
            type: 'inbound',
            node: peer,
          };
        });
      }

      if (classified.outbound) {
        classified.outbound.forEach((peer) => {
          classificationMap[peer.peer] = {
            type: 'outbound',
            node: peer,
          };
        });
      }

      if (classified.balanced) {
        classified.balanced.forEach((peer) => {
          classificationMap[peer.peer] = {
            type: 'low volume',
            node: peer,
          };
        });
      }

      let formatted = [];

      list.forEach((item) => {
        if (!options.peers && peerMap[item.node]) {
          return;
        }

        if (options.peers && !peerMap[item.node]) {
          return;
        }

        if (peerMap[item.node]) {
          const record = {
            peer: item.node,
            name: peerMap[item.node].name,
            count: item.count,
            sats_sum: item.sats_sum,
            avg_ppm: item.avg_ppm,
            min_ppm: item.min_ppm,
            max_ppm: item.max_ppm,
          };

          if (classificationMap[item.node]) {
            record.local = lndUtils.withCommas(classificationMap[item.node].node.local);
            record.type = classificationMap[item.node].type;
          }

          formatted.push(record);
          peerMap[item.node].included = true;
        } else {
          formatted.push(item);
        }
      });

      if (top) {
        formatted = formatted.slice(0, top);
      }

      let message = 'probe data showing nodes that signaled commitment of liquidity\n';

      if (options.peers) {
        message += 'analyzing data for existing peers (as opposed to prospects for new channels)\n';
      }

      message += 'data generated';

      if (hours) {
        const days = isInt(hours / 24) && Math.floor(hours / 24);

        if (days) {
          message += ' over the past ' + days + ' day(s)';
        } else {
          message += ' over the past ' + hours + ' hour(s)';
        }
      } else {
        message += ' since the beginning';
      }

      if (top) {
        message += '; returning top ' + top + ' records';
      }

      message += '; sorted by ' + sortCol;

      console.log(message + '\n');
      console.log('-count: total number of times a node signaled commitment of liquidity');
      console.log('-sats_sum: total number of sats a node signaled to commit');
      console.log('-avg_ppm: average ppm of committed liquidity');

      if (options.peers) {
        console.log('-local: sats on the local side (assumes one channel per peer)');
        console.log("-type: peer's classification info inbound, outbound and low-volume");
      }

      console.table(formatted);

      if (options.peers) {
        const none = [];

        Object.keys(peerMap).forEach((key) => {
          if (!peerMap[key].included) {
            none.push({
              peer: key,
              name: peerMap[key].name,
            });
          }
        });

        if (none.length > 0) {
          console.log('\npeers that havent signaled any commitment of liquidity');
          console.table(none);
        }
      }
    });
}

function sortProbeList(list, sortCol) {
  if (sortCol === 'sats_sum') {
    list.sort((a, b) => b.sats_sum - a.sats_sum);
  } else if (sortCol === 'count') {
    list.sort((a, b) => b.count - a.count);
  } else if (sortCol === 'avg_ppm') {
    list.sort((a, b) => a.avg_ppm - b.avg_ppm);
  } else if (sortCol === 'min_ppm') {
    list.sort((a, b) => a.min_ppm - b.min_ppm);
  } else if (sortCol === 'max_ppm') {
    list.sort((a, b) => b.max_ppm - a.max_ppm);
  } else {
    console.error('unknown sort column,', sortCol);
  }
}

function parsePositiveNumber(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Expected a positive number');
  }

  return parsed;
}

function parsePositiveInt(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Expected a positive integer');
  }

  return parsed;
}

function isInt(value) {
  const parsed = parseFloat(value);

  return !Number.isNaN(parsed) && (parsed | 0) === parsed;
}

module.exports = {
  registerProbesCommand,
};
