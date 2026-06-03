const importLazy = require('import-lazy')(require);
const date = require('date-and-time');

const constants = importLazy('../../api/constants');
const apiUtils = importLazy('../../api/utils');
const analyzeFeesApi = importLazy('../../api/analyze-fees');
const serviceUtils = importLazy('../../service/utils');

const {
  requireLndAlive,
  lndUtils,
} = require('../utils/lnd');

function registerMonitorCommand(program) {
  program
    .command('monitor')
    .summary('Prints information about ongoing rebalances and stuck HTLCs')
    .description('Prints information about ongoing rebalances and stuck HTLCs.')
    .argument('[secs]', 'Refresh delay in seconds', parsePositiveNumber)
    .option('--status', 'Prints rebalance status for peers')
    .option('--current', 'Lists rebalances in progress')
    .action(async (secs, options) => {
      requireLndAlive();

      const delay = secs || constants.monitor.refresh;
      const inProgress = !!options.current;

      console.log('loading data...');

      if (options.status) {
        runMonitorStatusLoop();
        setInterval(runMonitorStatusLoop, delay * 1000);
        return;
      }

      runMonitorLoop(inProgress);
      setInterval(runMonitorLoop, delay * 1000, inProgress);
    });
}

function runMonitorStatusLoop() {
  if (!serviceUtils.Rebalancer.isRunning()) {
    console.log('rebalancer isnt running');
    return;
  }

  const arr = analyzeFeesApi.rebalanceStatus();

  console.clear();
  console.log(date.format(new Date(), 'MM/DD hh:mm:ss A'));

  if (arr.outbound.length === 0) {
    console.log('no [outbound] peers found');
  } else {
    console.log('rebalance status for [outbound] peers');
    console.table(arr.outbound);
  }

  if (arr.balanced.length === 0) {
    console.log('no [low-volume] peers found');
  } else {
    console.log('\nrebalance status for [low-volume] peers');
    console.table(arr.balanced);
  }
}

function runMonitorLoop(inProgress) {
  const hours = 4;

  const list = apiUtils.listActiveRebalancesFormattedSync();

  let htlcs;
  let history;
  let closed;

  if (!inProgress) {
    htlcs = apiUtils.pendingHtlcsFormattedSync();

    history = apiUtils
      .rebalanceHistoryFormattedSync(hours * 60 * 60)
      .filter((record) => record.status === 'success');

    closed = apiUtils.listForcedClosingFormattedSync();
  }

  console.clear();
  console.log(date.format(new Date(), 'MM/DD hh:mm:ss A'));

  if (list) {
    list.forEach((item) => {
      item.amount = lndUtils.withCommas(item.amount);
    });

    list.sort((a, b) => a.from.localeCompare(b.from));

    console.log('rebalances in progress:');
    console.table(list);
  } else {
    console.log('no active rebalances');
  }

  if (inProgress) {
    return;
  }

  const maxHistoryLines = constants.monitor.rebalanceHistoryLines;

  if (history.length > 0) {
    console.log(
      `\nsuccessful rebalances over the past ${hours} hour(s) (${maxHistoryLines} max lines):`
    );

    console.table(history.slice(0, maxHistoryLines));
  }

  if (htlcs && htlcs.length > 0) {
    console.log('\npending htlcs:');
    console.table(htlcs);
  }

  if (closed && closed.length > 0) {
    console.log('\nforced closing channels:');
    console.table(closed);
  }

  console.log('\nservices:');
  serviceUtils.printStatus();

  if (!serviceUtils.Launcher.isRunning()) {
    console.error(
      constants.colorYellow,
      "daddy service is not running, this means that other services won't be auto-restarted in case of an error. jet start daddy"
    );
  }

  if (!serviceUtils.TelegramBot.isRunning()) {
    console.error(
      constants.colorYellow,
      "telegram bot service is not running, you won't get notified about important events.",
      constants.telegramBotHelpPage
    );
  }

  const last = apiUtils.readLastLineSync(serviceUtils.Rebalancer.log);

  if (last && last.toLowerCase().indexOf('error') >= 0) {
    console.error(
      constants.colorRed,
      '\ndetected an error in the rebalancer log file:',
      last
    );

    console.log(
      'it is possible that the rebalancer is stuck. consider restarting: jet restart rebalancer'
    );

    const interval = 5;
    const msg =
      'detected an error in the rebalancer log file. the rebalancer may be stuck. consider restarting: jet restart rebalancer';

    apiUtils.sendTelegramMessageTimed(
      msg,
      'telegramNotifiedRebalancerError',
      interval * 60
    );
  }

  try {
    const { printCheckSize } = require('../../api/channeldb');

    console.log();
    printCheckSize();
  } catch (error) {
    console.error(
      constants.colorRed,
      'error checking channel.db size:',
      error.toString()
    );
  }
}

function parsePositiveNumber(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Expected a positive number');
  }

  return parsed;
}

module.exports = {
  registerMonitorCommand,
};