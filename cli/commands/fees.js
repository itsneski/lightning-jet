const {
  requireLndAlive,
  lndUtils,
} = require('../utils/lnd');

function registerFeesCommand(program) {
  program
    .command('fees')
    .summary('Lists peer fees')
    .description('Lists peer fees.')
    .action(async () => {
      const lndClient = requireLndAlive();

      const fees = lndUtils.listFeesSync(lndClient);
      const formatted = [];

      fees.forEach((fee) => {
        formatted.push({
          peer: fee.name,
          lc_base: fee.local.base,
          lc_rate: fee.local.rate,
          rm_base: fee.remote.base,
          rm_rate: fee.remote.rate,
        });
      });

      formatted.sort((a, b) => b.rm_rate - a.rm_rate);

      console.table(formatted);
    });
}

module.exports = {
  registerFeesCommand,
};