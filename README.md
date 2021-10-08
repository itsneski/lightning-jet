
# lnd-optimize
A collection of tools to help Lighting (LND) node operators with rebalancing, fee optimization, htlc analysis, and other node management functions.

## Prerequisites
- Install [BalanceOfSatoshi](https://github.com/alexbosworth/balanceofsatoshis) along with its prerequisites (Node).

## Installation
- Run `node genconfig.js` to generate `./api/config.json`
- Edit `config.json`, e.g. `nano ./api/config.json`: set correct paths for `adminMacaroonPath` and `tlsCertPath`. On umbrel, admin macaroon is typicall located at `~/umbrel/lnd/data/chain/bitcoin/mainnet/admin.macaroon`, tls cert is at `~/umbrel/lnd/tls.cert`. Optional: you can list expensive nodes to avoid in the `avoid` section of the config file (can be done later)
- Run `npm install`

## How to run tools

```shell
node <tool> [options]
node <tool> --help
```

#### Examples:
```shell
node peers.js
node fees.js
node htlc-history.js --d 7
node bosrebalance.js --help
node bosrebalance.js dplus neski 500000 --ppm 550
```

#### List of tools:

| Tool  | Description |
| ------------- | ------------- |
| `bosrebalance.js`  | Runs [BalanceOfSatoshi](https://github.com/alexbosworth/balanceofsatoshis) in a loop until the target amount is met or until all possible routes are exhausted.  |
| `fees.js`  |  Displays local and remote fees for routing peers.  |
| `peers.js`  |  Partitions peers into inbound, outbound and balanced peers based on htlc history.  |
| `htlc-history.js`  |  Outputs cumulative stats about htlc history.  |
| `htlc-logger.js`  |  Logs select htlcs into a local database (currently stored in a file).  |
| `htlc-analyzer.js`   |  Outputs stats about the htlcs logged into the local database.  |
| `list-channels.js`  |  Lists channels along with the peers.  |
| `list-peers.js`  |  Lists peer aliases along with their ids.  |
