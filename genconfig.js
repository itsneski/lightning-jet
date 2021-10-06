const fs = require('fs');

const FILE = './api/config.json';

const data = 
'{\n\
  "avoid": [\n\
  ],\n\
  "max_ppm": 650,\n\
  "adminMacaroonPath": "/home/umbrel/umbrel/lnd/data/chain/bitcoin/mainnet/admin.macaroon",\n\
  "tlsCertPath": "/home/umbrel/umbrel/lnd/tls.cert",\n\
  "debugMode": false\n\
}';

fs.writeFile(FILE, data, err => {
  if (err) {
    return console.error(err)
  }
})
