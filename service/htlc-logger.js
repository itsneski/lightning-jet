// logs htlcs into htlc-logger.db.  filters htlcs by failed htlcs due to
// insufficient funds.  this skips all the probes. 
//
// to run in the background:
// nohup node htlc-logger.js > /tmp/htlc-logger.log 2>&1 & disown; tail -f /tmp/htlc-logger.log
//

const fs = require('fs');
const routerRpc = require('../api/router-rpc');
const {recordHtlc} = require('../db/utils');

async function logEvents(readable) {
  console.log('logging events...');
  for await (const event of routerRpc.subscribeHtlcEvents()) {
    let lf = event.link_fail_event;
    // filter events 
    if (lf && lf.wire_failure === 'TEMPORARY_CHANNEL_FAILURE' && lf.failure_detail === 'INSUFFICIENT_BALANCE') {
      logEvent(event);
    }
  }
}

function logEvent(event) {
  console.log('logging event:', event);
  recordHtlc(event);
}

logEvents();
