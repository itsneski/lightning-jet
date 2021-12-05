// logs htlcs into htlc-logger.db.  filters htlcs by failed htlcs due to
// insufficient funds.  this skips all the probes. 
//
// to run in the background:
// nohup node htlc-logger.js > /tmp/htlc-logger.log 2>&1 & disown; tail -f /tmp/htlc-logger.log
//

const fs = require('fs');
const routerRpc = require('../api/router-rpc');
const {recordHtlc} = require('../db/utils');
const {isRunningSync} = require('../api/utils');
const {setPropSync} = require('../db/utils');
const constants = require('../api/constants');
const date = require('date-and-time');

// only one instance allowed
const fileName = require('path').basename(__filename);
if (isRunningSync(fileName, true)) {
  return console.error(`${fileName} is already running, only one instance is allowed`);
}

async function logEvents(readable) {
  console.log(date.format(new Date, 'MM/DD hh:mm:ss A'));
  console.log('subscribing to htlc events');
  for await (const event of routerRpc.subscribeHtlcEvents()) {
    let lf = event.link_fail_event;
    // filter events 
    if (lf && lf.wire_failure === 'TEMPORARY_CHANNEL_FAILURE' && lf.failure_detail === 'INSUFFICIENT_BALANCE') {
      logEvent(event);
    }
  }
}

function logEvent(event) {
  console.log(date.format(new Date, 'MM/DD hh:mm:ss A'));
  console.log('logging event:', event);
  recordHtlc(event);
}

function processError(error) {
  console.error(date.format(new Date, 'MM/DD hh:mm:ss A'));
  console.error('logEvents:', error.toString());
  // record in the db so that the service will be restarted
  setPropSync(constants.services.logger.errorProp, error.toString());
}

logEvents().catch(error => {
  processError(error);
})
