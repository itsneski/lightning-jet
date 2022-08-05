// Lnd admin macaroon is at ~/.lnd/data/chain/bitcoin/simnet/admin.macaroon on Linux and
// ~/Library/Application Support/Lnd/data/chain/bitcoin/simnet/admin.macaroon on Mac
//
// On umbrel admin macaroon is at ~/umbrel/lnd/data/chain/bitcoin/mainnet/admin.macaroon,
// tls cert is at ~/umbrel/lnd/tls.cert.

const fs = require('fs');
const grpc = require("@grpc/grpc-js");
const protoLoader = require('@grpc/proto-loader');
const loaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
};

module.exports = {
  routerrpc(protoPath, macaroonPath, tlsCertPath, serverAddress = 'localhost:10009') {
    let descriptor = generateDescriptor(protoPath, macaroonPath, tlsCertPath);
    let routerrpc = descriptor.desc.routerrpc;
    let client = new routerrpc.Router(serverAddress, descriptor.creds);
    return client;
  },
  lnrpc(protoPath, macaroonPath, tlsCertPath, serverAddress = 'localhost:10009') {
    let descriptor = generateDescriptor(protoPath, macaroonPath, tlsCertPath);
    let lnrpc = descriptor.desc.lnrpc;
    return new lnrpc.Lightning(serverAddress, descriptor.creds);
  }
}

function generateDescriptor(protoPath, macaroonPath, tlsCertPath) {
  const packageDefinition = protoLoader.loadSync(protoPath, loaderOptions);

  process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA';

  let m = fs.readFileSync(macaroonPath);
  let macaroon = m.toString('hex');

  // build meta data credentials
  let metadata = new grpc.Metadata()
  metadata.add('macaroon', macaroon)
  let macaroonCreds = grpc.credentials.createFromMetadataGenerator((_args, callback) => {
    callback(null, metadata);
  });

  // build ssl credentials using the cert the same as before
  const lndCert = (tlsCertPath) ? fs.readFileSync(tlsCertPath) : '';
  const sslCreds = grpc.credentials.createSsl(lndCert);

  // combine the cert credentials and the macaroon auth credentials
  // such that every call is properly encrypted and authenticated
  const credentials = grpc.credentials.combineChannelCredentials(sslCreds, macaroonCreds);

  // Pass the crendentials when creating a channel
  const descriptor = grpc.loadPackageDefinition(packageDefinition);

  return { desc: descriptor, creds: credentials };
}
