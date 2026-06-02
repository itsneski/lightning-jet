const { printStatus } = require('../../service/utils');

function registerStatusCommand(program) {
  program
    .command('status')
    .description('Shows services status')
    .action(async () => {
      await printStatus();
    });
}

module.exports = {
  registerStatusCommand,
};
