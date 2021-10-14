const routerRpc = require('./api/router-rpc');
const {sendMessageToNode} = require('./lnd-api/utils');
const {createHash} = require('crypto');
const {randomBytes} = require('crypto');

var args = process.argv.slice(2);
if (args.length < 2) return console.error('missing arguments');
const nodeId = args[0];
const message = args[1];

const preimageByteLength = 32;
const amountSat = 1000;
const feeLimitSat = 2 * amountSat;
const timeoutSeconds = 60;
const keySendPreimageType = 5482373484;
const textMessageType = 34349334;

const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');
const hexToBuf = hex => Buffer.from(hex, 'hex');

const preimage = randomBytes(preimageByteLength);
const secret = preimage.toString('hex');
const id = createHash('sha256').update(preimage).digest().toString('hex');

let records = [];
records[keySendPreimageType] = hexToBuf(secret);
records[textMessageType] = hexToBuf(utf8AsHex(message));

const req = {   // routerRpc.SendPaymentRequest
  dest: hexToBuf(nodeId),
  fee_limit_msat: feeLimitSat,
  amt_msat: amountSat,
  payment_hash: hexToBuf(id),
  timeout_seconds: timeoutSeconds,
  dest_custom_records: records
}

async function sendMessage() {
  try {
    for await (const payment of routerRpc.sendPaymentV2(req)) {
      console.log(payment);
    }
  } catch(error) {
    console.error(error);
  }
}

sendMessage();
