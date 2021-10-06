const config = require('./config');
const {routerrpc} = require('../lnd-api/connect');

const PROTO = __dirname + '/proto/router.proto';

const routerRpc = routerrpc(config.routerProto || PROTO, config.adminMacaroonPath, config.tlsCertPath);

module.exports = routerRpc;
