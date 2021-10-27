
# Lightning Jet 🚀⚡️, or simply Jet
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
Edit `.profile`: add a prefix `$HOME/lightning-jet:` to the line that says `export PATH=`. The line should look like this:
```bash
export PATH="$HOME/lightning-jet:<rest of your path, leave it as is>"
```
Add `export PATH=$HOME/lightning-jet:$PATH` to the end of `.profile` if the line does not exist.

Next execute the updated `.profile` for you current terminal session. The path will be set automatically for all new sessions.
```bash
. ~/.profile
```
Test your path by running `jet`. If you get help promt then your path is set correctly. Double check the `PATH` in `.profile` in case you get an error.

## Post-Installation
- Kick off htlc logger: `jet start htlc-logger`

## How to run

```shell
jet help
```

#### Examples:
|||
|--|--|
|`jet peers`|Lists peers classified into inbound, outbound and balanced based on htlc history. Notable columns: `p` - % of [inbound or outbound] routing by the peer out of total [inbound or outbound] across all peers; `ppm` - peer's current ppm rate.|
|`jet monitor`|Lists ongoing rebalances, rebalance history, and stuck htlcs.|
|`jet htlc-analyzer`|Analyzes failed htlcs and lists peers sorted based on missed routing opportunities. Missed routing opportunities are typically due to [outbound] peers not having sufficient liquidity and / or having low fees. Prerequisites: make sure to kick off `jet start htlc-logger` and varify that the logger service is running by `jet status`.|
|`jet htlc-history`|Lists peers classified into inbound, outbound and balanced based on htlc history. Notable columns: `%` of inbound or outbound routing by a peer out of total [inbound or outbound] across all peers; `d%` of [inbound or outbound] routing by a peer out of total routing [inbound & outbound] by the peer.|
|`jet rebalance dplus neski 500000 --ppm 550 --mins 30`|Circular rebalance from dplus to neski for 5mil sats with 550 max ppm and max runtime of 30 mins.|

## Config file
A list of config properties under `./api/config.json`:
|||
|--|--|
|`macaroonPath`|Macaroon path to enable LND API calls. Most calls will work with `readonly.macaroon` with the exception of `jet update-channel` that requires `admin.macaroon`.|
|`tlsCertPath`|Path to the tls cert to enable LND API calls.|
|`avoid`|A list of nodes to avoid during manual and automated rebalances. `jet rebalance` avoids expensive nodes automatically. the `avoid` setting can help speed things up by providing a static list of nodes to avoid.|
|`rebalancer.maxPpm`|Maximum fee rate to pay for manual rebalances.|
|`rebalancer.maxAutoPpm`|Maximum fee rate to pay for automated rebalances. This setting is typically kept lower than `maxPpm` since automated rebalances can spend more time looking for a cheaper route than manual rebalances.|
|`rebalancer.maxTime`|Timeout rebalance after N minutes. This setting can be overriden by `jet rebalance --mins` parameter for manual rebalances.|
|`rebalancer.maxInstances`|Maximum rebalance instances that can be launched by the auto rebalancer. Keep this setting lower in case your node gets overloaded (e.g. monitor by `top` command).|
