const config = require('./config');
const {routerrpc} = require('../lnd-api/connect');

const PROTO = __dirname + '/proto/router.proto';

const routerRpc = routerrpc(config.routerProto || PROTO, config.macaroonPath, config.tlsCertPath, config.serverAddress);

module.exports = routerRpc;
