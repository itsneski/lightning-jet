const routerRpc = require('./api/router-rpc');
const {sendMessageToNode} = require('./lnd-api/utils');

sendMessageToNode(routerRpc, '03f80288f858251aed6f70142fab79dede5427a0ff4b618707bd0a616527a8cec7', 'from Neski via sendPaymentV2');
