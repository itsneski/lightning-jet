
# Lightning Jet, or simply Jet
Helps Lighting (LND) node operators to keep their node up to speed with rebalancing, fees, stuck htlcs, etc.

## Prerequisites
- Install [BalanceOfSatoshi](https://github.com/alexbosworth/balanceofsatoshis) along with its prerequisites (Node).

## Installation
- Run `npm install`
- Run `./tools/genconfig` to generate `./api/config.json`
- Edit `config.json`, e.g. `nano ./api/config.json`: set correct paths for `adminMacaroonPath` and `tlsCertPath`. On umbrel, admin macaroon is typicall located at `~/umbrel/lnd/data/chain/bitcoin/mainnet/admin.macaroon`, tls cert is at `~/umbrel/lnd/tls.cert`. Optional: you can list expensive nodes to avoid in the `avoid` section of the config file (can be done later)

## Post-Installation
- Kick off htlc logger: `jet start htlc-logger`

## How to run

```shell
jet --help
```

#### Examples:
```shell
jet peers
jet fees
jet htlc-history
jet rebalance dplus neski 500000 --ppm 550
```
