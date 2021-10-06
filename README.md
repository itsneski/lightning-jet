# lnd-optimize
A collection of tools to help Lighting (LND) node operators with rebalancing and other functions their node.

## Prerequisites
- Install [BalanceOfSatoshi](https://github.com/alexbosworth/balanceofsatoshis) - this includes the prerequisites for Node install
- Update `./api/config.json` with correct paths for `adminMacaroonPath` and `tlsCertPath`.  Optional: list expensive nodes to avoid in `avoid` (can be done later). 

## Example commands
```shell
node peers.js
node fees.js
node htlc-history.js --d 7
node bosrebalance.js dplus neski 500000 --ppm 550
```

## List of tools
| Tool  | Description |
| ------------- | ------------- |
| `bosrebalance.js`  | Runs BalanceOfSatoshis in a loop until the target amount is met or until all possible routes are exhausted.  |
| `fees.js`  |  Displays local and remote fees for routing peers.  |
| `peers.js`  |  Partitions peers into inbound, outbound and balanced based on the htlc history.  |
| `htlc-history.js`  |  Outputs cumulative stats about the htlc history.  |
| `htlc-logger.js`  |  Logs select htlcs into a local database (currently stored in a file).  |
| `htlc-analyzer.js`   |  Outputs stats about the htlcs logged into the local database.  |
| `list-channels.js`  |  Lists channels along with the peers.  |
| `list-peers.js`  |  Lists peer aliases along with their ids.  |
