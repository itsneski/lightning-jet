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
  routerrpc(protoPath, adminMacaroonPath, tlsCertPath) {
    let descriptor = generateDescriptor(protoPath, adminMacaroonPath, tlsCertPath);
    let routerrpc = descriptor.desc.routerrpc;
    let client = new routerrpc.Router('localhost:10009', descriptor.creds);
    return client;
  },
  lnrpc(protoPath, adminMacaroonPath, tlsCertPath) {
    let descriptor = generateDescriptor(protoPath, adminMacaroonPath, tlsCertPath);
    let lnrpc = descriptor.desc.lnrpc;
    let client = new lnrpc.Lightning('localhost:10009', descriptor.creds);
    return client;
  }
}

function generateDescriptor(protoPath, adminMacaroonPath, tlsCertPath) {
  const packageDefinition = protoLoader.loadSync(protoPath, loaderOptions);

  process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA';

  let m = fs.readFileSync(adminMacaroonPath);
  let macaroon = m.toString('hex');

  // build meta data credentials
  let metadata = new grpc.Metadata()
  metadata.add('macaroon', macaroon)
  let macaroonCreds = grpc.credentials.createFromMetadataGenerator((_args, callback) => {
    callback(null, metadata);
  });

  // build ssl credentials using the cert the same as before
  let lndCert = fs.readFileSync(tlsCertPath);
  let sslCreds = grpc.credentials.createSsl(lndCert);

  // combine the cert credentials and the macaroon auth credentials
  // such that every call is properly encrypted and authenticated
  let credentials = grpc.credentials.combineChannelCredentials(sslCreds, macaroonCreds);

  // Pass the crendentials when creating a channel
  let descriptor = grpc.loadPackageDefinition(packageDefinition);

  return { desc: descriptor, creds: credentials };
}
