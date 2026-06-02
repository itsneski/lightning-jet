const importLazy = require('import-lazy')(require);
const { Argument } = require('commander');

const {
  getServiceNames,
  startService,
  stopService,
  restartService,
  printStatus,
} = importLazy('../../service/utils');

const serviceNames = getServiceNames();
const serviceNamesPlus = serviceNames.slice();

serviceNamesPlus.push('all');

function registerServiceCommands(program) {
  program
    .command('status')
    .summary('Shows services status')
    .description('Shows services status.')
    .action(async () => {
      await printStatus();
    });

  program
    .command('start')
    .summary('Starts a service')
    .description('Starts a service.')
    .addArgument(
      new Argument('<service>', "Service; use 'all' to start all services")
        .choices(serviceNamesPlus)
    )
    .addHelpText('after', getServicesHelpText())
    .action(async (service) => {
      const msg = await startService(service);

      if (msg) {
        console.log(msg);
      }
    });

  program
    .command('stop')
    .summary('Stops a service')
    .description('Stops a service.')
    .addArgument(
      new Argument('<service>', "Service; use 'all' to stop all services")
        .choices(serviceNamesPlus)
    )
    .addHelpText('after', getServicesHelpText())
    .action(async (service) => {
      await stopService(service);
    });

  program
    .command('restart')
    .summary('Restarts a service')
    .description('Restarts a service.')
    .addArgument(
      new Argument('<service>', "Service; use 'all' to restart all services")
        .choices(serviceNamesPlus)
    )
    .addHelpText('after', getServicesHelpText())
    .action(async (service) => {
      await restartService(service);
    });
}

function getServicesHelpText() {
  return `
Services: ${serviceNames.join(', ')}
`;
}

module.exports = {
  registerServiceCommands,
};
