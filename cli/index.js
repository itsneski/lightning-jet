const { Command } = require('commander');
const { styleText } = require('node:util');
const { version } = require('../package.json');

const { registerInfoCommand } = require('./commands/info');
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
const { registerListChannelsCommand } = require('./commands/list-channels');
const { registerMonitorCommand } = require('./commands/monitor');
const { registerFeeHistoryCommand } = require('./commands/fee-history');
const { registerChannelEventsCommand } = require('./commands/channel-events');
const { registerChanneldbCommand } = require('./commands/channeldb');
const { registerSendMessageCommand } = require('./commands/send-message');
const { registerUpdateChannelCommand } = require('./commands/update-channel');
const { registerCloseChannelCommand } = require('./commands/close-channel');
const { registerReconnectCommand } = require('./commands/reconnect');

// --no-color has to take effect before help styling runs, which happens during
// the parse, so read it straight from argv. Setting NO_COLOR covers both
// styleText below and winston's colorizer.
if (process.argv.includes('--no-color')) process.env.NO_COLOR = '1';

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
  .version(version, '-V, --version')
  .option('-v', 'output the version number')
  .option('--quiet', 'Quiet mode - only displays warn and error messages')
  .option('--verbose', 'Verbose mode - will also output debug messages')
  .option('--no-color', 'Disable colors');

// Commander only allows one short flag per option, so -v is wired up separately
// rather than folded into the --version flags. The README documents `jet -v` as
// the post-install path check.
program.on('option:v', () => {
  console.log(version);
  process.exit(0);
});

registerInfoCommand(program);
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
registerListChannelsCommand(program);
registerMonitorCommand(program);
registerFeeHistoryCommand(program);
registerChannelEventsCommand(program);
registerChanneldbCommand(program);
registerSendMessageCommand(program);
registerUpdateChannelCommand(program);
registerCloseChannelCommand(program);
registerReconnectCommand(program);

// caporal accepted its global options after the command name (jet status
// --quiet). Commander scopes options to the command they are declared on, so
// mirror them onto every subcommand to keep that working both ways.
const globalOptions = [
  ['--quiet', 'Quiet mode - only displays warn and error messages'],
  ['--verbose', 'Verbose mode - will also output debug messages'],
  ['--no-color', 'Disable colors'],
];

for (const cmd of program.commands) {
  for (const [flags, description] of globalOptions) {
    // pay already declares its own --no-color; skip anything already present.
    if (cmd.options.some((o) => o.long === flags)) continue;
    cmd.option(flags, description);
  }
}

// Apply --quiet/--verbose before the command runs so that modules it loads pick
// up the overridden level. Required lazily: api/logger pulls in api/config,
// which is not available on paths that never touch lnd.
program.hook('preAction', (thisCommand, actionCommand) => {
  const opts = { ...thisCommand.opts(), ...actionCommand.opts() };
  const level = opts.verbose ? 'debug' : opts.quiet ? 'warn' : null;
  if (level) require('../api/logger').setLevel(level);
});

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
