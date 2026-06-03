const importLazy = require('import-lazy')(require);

const htlcAnalyzerApi = importLazy('../../api/htlc-analyzer');

const {
  requireLndAlive,
  lndUtils,
} = require('../utils/lnd');

function registerHtlcAnalyzerCommand(program) {
  program
    .command('htlc-analyzer')
    .summary('Prints stats about failed HTLCs')
    .description('Prints stats about failed HTLCs.')
    .argument(
      '[node]',
      'Pub id or an alias, full or partial, of outbound node for HTLC analysis'
    )
    .option(
      '--days <days>',
      'Depth of history in days. Can provide partial days, e.g. .5 days for 12 hours',
      parsePositiveNumber
    )
    .option(
      '--hours <hours>',
      'Depth of history in hours',
      parsePositiveNumber
    )
    .action(async (node, options) => {
      requireLndAlive();

      try {
        let days = options.days || 1;

        if (options.hours) {
          days = options.hours / 24;
        }

        const showDays = isInt(days)
          ? days
          : days.toFixed(2);

        const hours = days * 24;
        const showHours = isInt(hours)
          ? hours
          : hours.toFixed(1);

        console.log(
          'htlc analysis over the past',
          showDays,
          'day(s) or',
          showHours,
          'hour(s)'
        );

        console.log(
          "terminology: missed routing opportunity are htlcs that an [outbound] peer would've routed if it had enough [local] liquidity"
        );

        if (node) {
          const formatted = htlcAnalyzerApi.htlcAnalyzerNode(node, days);

          if (formatted) {
            console.log(
              'node: ' + formatted.stats.name + ', ' + formatted.stats.id
            );

            console.log(
              'missed htlc count: ' +
                formatted.stats.count +
                ', total missed sats: ' +
                lndUtils.withCommas(formatted.stats.total) +
                ', avg htlc size in sats: ' +
                lndUtils.withCommas(formatted.stats.avg)
            );

            console.log('\ndetailed breakdown of missed htlcs for [inbound] peers:');
            console.log('-from: [inbound] peer that attempted to route sats');
            console.log('-sats: total missed sats for the peer');
            console.log('-count: # of missed htlcs');
            console.log('-avg: average htlc size in sats');

            console.table(formatted.peers);

            console.log('\ndetailed list of missed htlcs:');
            console.table(formatted.list);
          } else {
            console.log('no missed htlcs found');
          }

          return;
        }

        const formatted = htlcAnalyzerApi.htlcAnalyzerFormatted(days);

        if (formatted) {
          console.log('\ndetailed breakdown of missed htlcs for [outbound] peers:');
          console.log('-to: [outbound] peer that attempted to route sats');
          console.log('-sats: total missed sats for the peer');
          console.log('-count: # of missed htlcs');
          console.log('-avg: average htlc size in sats');
          console.log('-p: total missed sats for the peer as a % of the total across all peers');

          console.table(formatted.peers);

          console.log('\ndetailed breakdown of missed htlcs for peer pairs:');
          console.log('-from: [inbound] peer that attempted to route sats');
          console.log('-to: [outbound] peer');
          console.log('-sats: total missed sats for the [outbound] peer');
          console.log('-avg: average htlc size in sats');
          console.log('-count: # of missed htlcs');
          console.log('-p: total missed sats for the peer pair as a % of the total across all peers');

          console.table(formatted.list);
        } else {
          console.log('no missed htlcs found');
        }
      } catch (error) {
        console.error(error.toString());
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
  registerHtlcAnalyzerCommand,
};