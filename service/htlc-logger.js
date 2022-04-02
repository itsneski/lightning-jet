// logs htlcs into the jet db.  filters htlcs by failed htlcs due to
// insufficient funds.  skips the probes.
//
// logs channel state updates into the jet db.
//
// jet start logger


const routerRpc = require('../api/router-rpc');
const lnRpc = require('../api/ln-rpc');
const {recordHtlc} = require('../db/utils');
const {isRunningSync} = require('../api/utils');
const {setPropSync} = require('../db/utils');
const {recordChannelEvent} = require('../db/utils');
const constants = require('../api/constants');
const date = require('date-and-time');

// only one instance allowed
const fileName = require('path').basename(__filename);
if (isRunningSync(fileName, true)) {
  return console.error(`${fileName} is already running, only one instance is allowed`);
}

async function subscribeToHtlcs() {
  console.log('\n---------------------------------------');
  console.log(date.format(new Date, 'MM/DD hh:mm:ss A'));
  console.log('subscribing to htlc events');
  for await (const event of routerRpc.subscribeHtlcEvents()) {
    let lf = event.link_fail_event;
    // filter events
    if (lf && lf.wire_failure === 'TEMPORARY_CHANNEL_FAILURE' && lf.failure_detail === 'INSUFFICIENT_BALANCE') {
      logHtlc(event);
    }
  }
}

async function subscribeToChannelEvents() {
  console.log('\n---------------------------------------');
  console.log(date.format(new Date, 'MM/DD hh:mm:ss A'));
  console.log('subscribing to channel events');
  for await (const event of lnRpc.subscribeChannelEvents()) {
    try {
      logChannelUpdate(event);
    } catch(err) {
      console.error('error logging channel event:', err);
    }
  }
}

function logHtlc(event) {
  if (event.incoming_channel_id == '0') {
    return console.log('skipping htlc since the incoming chan id is 0 (due to rebalance as opposed to a forward)')
  }
  console.log('\n' + date.format(new Date, 'MM/DD hh:mm:ss A'));
  console.log('logging htlc:', event);

  try {
    recordHtlc(event);
  } catch(err) {
    console.log('error logging event:', err.message);
  }
}

function logChannelUpdate(event) {
  const pref = 'logChannelUpdate:';
  const getTxid = s => Buffer.from(s).reverse().toString('hex');
  console.log('\n' + date.format(new Date, 'MM/DD hh:mm:ss A'));
  console.log(pref, event);
  let txid, index;
  if (event.type === 'INACTIVE_CHANNEL') {
    txid = getTxid(event.inactive_channel.funding_txid_bytes);
    index = event.inactive_channel.output_index;
  } else if (event.type === 'ACTIVE_CHANNEL') {
    txid = getTxid(event.active_channel.funding_txid_bytes);
    index = event.active_channel.output_index;
  }
  if (!txid) return console.error(pref, 'error: could not identify transaction id');
  
  // record in the db
  recordChannelEvent(event.type, txid, index);
}

function processError(error) {
  console.error(date.format(new Date, 'MM/DD hh:mm:ss A'));
  console.error('log error:', error.toString());
  // record in the db so that the service will be restarted
  setPropSync(constants.services.logger.errorProp, error.toString());
}

subscribeToHtlcs().catch(error => {
  processError(error);
})

subscribeToChannelEvents().catch(error => {
  processError(error);
})
