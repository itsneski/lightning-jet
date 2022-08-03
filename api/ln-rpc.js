const config = require('./config');
const {lnrpc} = require('../lnd-api/connect');

const PROTO = __dirname + '/proto/lightning.proto';

const lnRpc = lnrpc(config.lightningProto || PROTO, config.macaroonPath, config.tlsCertPath, config.serverAddress);

module.exports = lnRpc;
