const importLazy = require('import-lazy')(require);
const date = require('date-and-time');

const dbUtils = importLazy('../../db/utils');
const apiUtils = importLazy('../../api/utils');

const {
  requireLndAlive,
  lndUtils,
} = require('../utils/lnd');

function registerFeeHistoryCommand(program) {
  program
    .command('fee-history')
    .summary('Prints fee history for a peer')
    .description('Prints fee history for a peer.')
    .argument('[node]', 'Pub id or an alias, full or partial')
    .option('--hours <hours>', 'Depth of history in hours', parsePositiveNumber)
    .option('--days <days>', 'Depth of history in days', parsePositiveNumber)
    .action(async (node, options) => {
      const lndClient = requireLndAlive();

      let id;
      let name;
      let peerMap;

      if (node) {
        const matches = apiUtils.resolveNode(node);

        if (!matches || matches.length === 0) {
          console.error('no matches found');
          return;
        }

        if (matches.length >= 2) {
          console.error('multiple matches found:', matches);
          return;
        }

        id = matches[0].id;
        name = matches[0].name;
      } else {
        peerMap = {};

        const peers = lndUtils.listPeersSync(lndClient);

        peers.forEach((peer) => {
          peerMap[peer.id] = peer.name;
        });
      }

      const hours = options.hours || (options.days && options.days * 24) || 24 * 7;
      const req = {
        mins: hours * 60,
      };

      if (id) {
        req.node = id;
      }

      const history = dbUtils.feeHistorySync(req);

      let period;

      if (hours > 24) {
        period = Math.floor(hours / 24) + ' days';

        if (hours % 24 > 0) {
          period += ' and ' + (hours % 24) + ' hours';
        }
      } else {
        period = hours + ' hours';
      }

      if (name) {
        console.log('fee history for', name, 'over the past', period);
      } else {
        console.log('fee history over the past', period);
      }

      if (!history || history.length === 0) {
        console.log('no history found');
        return;
      }

      history.sort((a, b) => b.date - a.date);

      const formatted = [];

      let min = Number.MAX_SAFE_INTEGER;
      let max = 0;
      let sum = 0;

      history.forEach((record) => {
        if (record.ppm) {
          sum += record.ppm;
          min = Math.min(min, record.ppm);
          max = Math.max(max, record.ppm);
        }

        const entry = {
          date: date.format(new Date(record.date), 'MM/DD hh:mm A'),
        };

        if (!id) {
          entry.peer = peerMap[record.node] || record.node;
        }

        if (record.base) {
          entry.base = record.base;
        }

        if (record.ppm) {
          entry.ppm = record.ppm;
        }

        formatted.push(entry);
      });

      console.log(
        'count:',
        history.length,
        'min:',
        min,
        'max:',
        max,
        'avg:',
        (sum / history.length).toFixed(1)
      );

      console.table(formatted);
    });
}

function parsePositiveNumber(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Expected a positive number');
  }

  return parsed;
}

module.exports = {
  registerFeeHistoryCommand,
};