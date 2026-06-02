const { Command } = require('commander');
const { version } = require('../package.json');

const { registerStatusCommand } = require('./commands/status');

const program = new Command();

program
  .name('jet')
  .description('Lightning Jet CLI')
  .version(version);

registerStatusCommand(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
