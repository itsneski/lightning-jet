const config = require('./config');
const {lnrpc} = require('../lnd-api/connect');

const PROTO = __dirname + '/proto/rpc.proto';

const lndClient = lnrpc(config.rpcProto || PROTO, config.adminMacaroonPath, config.tlsCertPath);

module.exports = lndClient;
