const { Command } = require('commander');
const { styleText } = require('node:util');
const { version } = require('../package.json');

const { registerServiceCommands } = require('./commands/services');
const { registerStatsCommand } = require('./commands/stats');
const { registerProbesCommand } = require('./commands/probes');
const { registerRebalanceCommand } = require('./commands/rebalance');
const { registerPayCommand } = require('./commands/pay');
const { registerPeersCommand } = require('./commands/peers');
const { registerFeesCommand } = require('./commands/fees');
const { registerAnalyzeFeesCommand } = require('./commands/analyze-fees');
const { registerHtlcHistoryCommand } = require('./commands/htlc-history');
const { registerHtlcAnalyzerCommand } = require('./commands/htlc-analyzer');
const { registerRebalanceHistoryCommand } = require('./commands/rebalance-history');
const { registerListPeersCommand } = require('./commands/list-peers');
const { registerInfoCommand } = require('./commands/info');

const program = new Command();

program.configureHelp({
  styleTitle: (str) => styleText('bold', str),
  styleCommandText: (str) => styleText('cyan', str),
  styleCommandDescription: (str) => styleText('dim', str),
  styleOptionText: (str) => styleText('green', str),
  styleArgumentText: (str) => styleText('yellow', str),
  styleSubcommandText: (str) => styleText('cyan', str),
});

program
  .name('jet')
  .description('Lightning Jet CLI')
  .version(version);

registerServiceCommands(program);
registerStatsCommand(program);
registerProbesCommand(program);
registerRebalanceCommand(program);
registerPayCommand(program);
registerPeersCommand(program);
registerFeesCommand(program);
registerAnalyzeFeesCommand(program);
registerHtlcHistoryCommand(program);
registerHtlcAnalyzerCommand(program);
registerRebalanceHistoryCommand(program);
registerListPeersCommand(program);
registerInfoCommand(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
