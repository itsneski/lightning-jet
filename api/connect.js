const config = require('./config');
const {lnrpc} = require('../lnd-api/connect');

const PROTO = __dirname + '/proto/rpc.proto';

const lndClient = lnrpc(config.rpcProto || PROTO, config.macaroonPath, config.tlsCertPath);

module.exports = lndClient;
