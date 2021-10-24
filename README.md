

# Lightning Jet, or simply Jet
Tool that helps Lighting (LND) node operators to keep their node up to speed with rebalancing, fees, stuck htlcs, etc.

## Prerequisites
- Install [BalanceOfSatoshi](https://github.com/alexbosworth/balanceofsatoshis) along with its prerequisites (Node).

## Installation
```bash
git clone https://github.com/itsneski/lightning-jet
cd lightning-jet
npm install
nano ./api/config.json
```
Edit `config.json`: set correct paths for `macaroonPath` and `tlsCertPath`. On umbrel, admin macaroon is typicall located at `~/umbrel/lnd/data/chain/bitcoin/mainnet/readonly.macaroon`, tls cert is at `~/umbrel/lnd/tls.cert`. Optional: you can list expensive nodes to avoid in the `avoid` section of the config file (can be done later).
```bash
nano ~/.profile
```
Edit `.profile`: add `$HOME/lightning-jet:` to the line that says `export PATH=`. The line should look like this:
```bash
export PATH="$HOME/lightning-jet:<rest of your path, leave it as is>"
```
Next execute the updated `.profile` for you current terminal session. The path will be set automatically for all new sessions.
```bash
. ~/.profile
```
Test your path by running `jet`. If you get help promt then your path is set correctly. Double check the `PATH` in `.profile` in case you get an error.

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
## Config file
A list of properties located under `./api/config.json`. 
|||
|--|--|
|macaroonPath|Macaroon path to enable LND API calls.|
|tlsCertPath|Path to the tls cert to enable LND API calls.|
|maxPpm|Maximum fee rate pay for rebalance.|
|maxRebalanceTime|Timeout rebalance after N nimutes.|
