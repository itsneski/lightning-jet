// related to https://github.com/itsneski/lightning-jet/issues/79
// jet calls bos rebalance api directly, it does not require bos to be installed
// bos rebalance needs lnd api handle. can't re-use existing lnd handle
// as bos needs the one from ln-service.

const fs = require('fs');
const config = require('../api/config');
const lnService = require('ln-service');

const macaroon = fs.readFileSync(config.macaroonPath).toString('base64');
const tlsCert = fs.readFileSync(config.tlsCertPath).toString('base64');
const address = config.serverAddress || 'localhost:10009';

const {lnd} = lnService.authenticatedLndGrpc({
  cert: tlsCert,
  macaroon: macaroon,
  socket: address
})

module.exports = lnd;
