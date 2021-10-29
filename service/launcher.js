const date = require('date-and-time');
const {exec} = require('child_process');
const {isRunning} = require('./utils');
const {startService} = require('./utils');
const {Rebalancer} = require('./utils');
const {HtlcLogger} = require('./utils');

const loopInterval = 5;  // mins
const bosReconnectInterval = 60;  // mins

function bosReconnect() {
  try {
    console.log('bos reconnect...');
    exec('bos reconnect');
  } catch (error) {
    console.error('error running bos reconnect:', error.toString());
  }
}

function runLoop() {
  console.log('\n', date.format(new Date, 'MM/DD hh:mm'));
  if (isRunning(HtlcLogger.name)) {
    console.log(`${HtlcLogger.name} is already running`)
  } else {
    console.log(`starting ${HtlcLogger.name} ...`);
    startService(HtlcLogger.name);
  }
  if (isRunning(Rebalancer.name)) {
    console.log(`${Rebalancer.name} is already running`)
  } else {
    console.log(`starting ${Rebalancer.name} ...`);
    startService(Rebalancer.name);
  }
}

runLoop();
setInterval(runLoop, loopInterval * 60 * 1000);
setInterval(bosReconnect, bosReconnectInterval * 60 * 1000);
