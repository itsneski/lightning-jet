#!/bin/sh

CONFIG_FILE=$HOME/.lightning-jet/config.json

[ -f "$CONFIG_FILE" ] || cat <<'EOF' > $CONFIG_FILE 
{
  "avoid": [],
  "macaroonPath": "/home/umbrel/umbrel/lnd/data/chain/bitcoin/mainnet/readonly.macaroon",
  "tlsCertPath": "/home/umbrel/umbrel/lnd/tls.cert",
  "debugMode": false,
  "rebalancer": {
    "maxTime": 30,
    "maxPpm": 650,
    "maxAutoPpm": 500,
    "maxInstances": 10,
    "maxPendingHtlcs": 4,
    "enforceMaxPpm": false,
    "exclude": []
  }
}
EOF
