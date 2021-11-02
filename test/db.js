const dbUtils = require('../db/utils');
dbUtils.enableTestMode();

const timeout = 2 * 1000; // msec

dbUtils.recordRebalanceAvoid('node_a', 'node_b', 750, 'avoid_a');
dbUtils.recordRebalanceAvoid('node_a', 'node_b', 750, 'avoid_b');
setTimeout(() => {
  console.log(dbUtils.listRebalanceAvoidSync('node_a', 'node_b', 750)); 
}, timeout);

dbUtils.recordHtlc({
  incoming_channel_id: '775688960799080448',
  outgoing_channel_id: '775647179368169473',
  incoming_htlc_id: '8730',
  outgoing_htlc_id: '0',
  timestamp_ns: '1635784333782439038',
  event_type: 'FORWARD',
  link_fail_event: {
    info: {
      incoming_timelock: 708016,
      outgoing_timelock: 707976,
      incoming_amt_msat: '200004799',
      outgoing_amt_msat: '200004598'
    },
    wire_failure: 'TEMPORARY_CHANNEL_FAILURE',
    failure_detail: 'INSUFFICIENT_BALANCE',
    failure_string: 'insufficient bandwidth to route htlc'
  },
  event: 'link_fail_event'
})

dbUtils.recordHtlc({
  incoming_channel_id: '754789443771498496',
  outgoing_channel_id: '770300254396219392',
  incoming_htlc_id: '1605',
  outgoing_htlc_id: '0',
  timestamp_ns: '1635784474205371242',
  event_type: 'FORWARD',
  link_fail_event: {
    info: {
      incoming_timelock: 708091,
      outgoing_timelock: 708051,
      incoming_amt_msat: '261035380',
      outgoing_amt_msat: '260989706'
    },
    wire_failure: 'TEMPORARY_CHANNEL_FAILURE',
    failure_detail: 'INSUFFICIENT_BALANCE',
    failure_string: 'insufficient bandwidth to route htlc'
  },
  event: 'link_fail_event'
})
setTimeout(() => {
  console.log(dbUtils.listHtlcsSync()); 
}, timeout);

dbUtils.recordRebalance('node_a', 'node_b', 1000000, 350000);
dbUtils.recordRebalance('node_a', 'node_c', 2000000, 550000);
dbUtils.recordRebalanceFailure('node_a', 'node_c', 1000000, 'ops');
dbUtils.recordRebalanceFailure('node_a', 'node_c', 2000000, 'ops again');
setTimeout(() => {
  console.log(dbUtils.listRebalancesSync()); 
}, timeout);
