const importLazy = require('import-lazy')(require);
const { Option } = require('commander');

const constants = importLazy('../../api/constants');
const apiUtils = importLazy('../../api/utils');

const {
  requireLndAlive,
} = require('../utils/lnd');

function registerRebalanceHistoryCommand(program) {
  program
    .command('rebalance-history')
    .summary('Lists past rebalances')
    .description('Lists past rebalances.')
    .argument('[node]', 'Pub id or an alias, full or partial')
    .option('--mins <mins>', 'Depth of history in minutes', parsePositiveNumber)
    .option('--hours <hours>', 'Depth of history in hours', parsePositiveNumber)
    .option('--days <days>', 'Depth of history in days', parsePositiveNumber)
    .option('--all', 'Show all records from the beginning')
    .addOption(
      new Option('--filter <filter>', 'Filter by success or failed')
        .choices(['success', 'failed'])
    )
    .action(async (node, options) => {
      requireLndAlive();

      let secs = constants.defaultRebalanceHistoryDepth * 60 * 60;

      if (options.mins) {
        secs = options.mins * 60;
      }

      if (options.hours) {
        secs = options.hours * 60 * 60;
      }

      if (options.days) {
        secs = options.days * 24 * 60 * 60;
      }

      if (options.all) {
        secs = undefined;
      }

      if (secs && secs <= 0) {
        throw new Error('depth of history must be a positive number');
      }

      const readable = secs ? formatDuration(secs) : undefined;

      let id;
      let name;

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
      }

      const formatted = apiUtils.rebalanceHistoryFormattedSync(
        secs,
        options.filter,
        id
      );

      let msg = 'rebalance history';

      msg += options.all
        ? ' showing all transactions since the beginning'
        : ' over the past ' + readable;

      if (name) {
        msg += ' for ' + name;
      }

      msg += '\n date - when rebalance started';
      msg += '\n secs - how long rebalance ran in seconds';
      msg += '\n min - minimum max ppm required for rebalance to go through';
      msg += '\n type - rebalance type: regular (from inbound to outbound peers), low volume (between low volume peers), missed (based on missed htlcs), forward (ad-hoc on forwards)';

      console.log(msg);

      if (!formatted || formatted.length === 0) {
        console.log('no entries found');
      } else {
        console.table(formatted);
      }
    });
}

function formatDuration(secs) {
  const mins = Math.round(secs / 60);

  if (mins < 60) {
    return Math.round(secs / 60) + ' min(s)';
  }

  if (mins > 60 * 24) {
    const remainder = mins % (60 * 24);

    if (remainder === 0) {
      return mins / (60 * 24) + ' day(s)';
    }

    return (
      Math.floor(mins / (60 * 24)) +
      ' day(s) and ' +
      Math.round(remainder / 60) +
      ' hour(s)'
    );
  }

  const remainder = mins % 60;

  if (remainder === 0) {
    return mins / 60 + ' hour(s)';
  }

  return Math.floor(mins / 60) + ' hour(s) and ' + remainder + ' min(s)';
}

function parsePositiveNumber(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Expected a positive number');
  }

  return parsed;
}

module.exports = {
  registerRebalanceHistoryCommand,
};