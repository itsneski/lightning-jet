
# Lightning Jet 🚀⚡️, or simply Jet

Fully automated rebalancer for LND Lightning nodes. Helps get an insight into peers' classification based on routing history, missed routing opportunities, and stuck htlcs.

The mission of Lightning Jet is to help independent node operators compete in the ever-changing landscape of the Lightning Network, especially as big institutional players enter the space.

Join [Lightning Jet telegram chat](https://t.me/lnjet).

## Supported Platforms

You can [install Lightning Jet](#prerequisites) on a laptop, desktop, Raspberry Pi, RaspiBlitz, myNode and other platforms.

You can use Lightning Jet to rebalance your node in [Voltage Cloud](#voltage-cloud). In this setup, Jet will connect to your node remotely via a secure connection.

You can also run Lightning Jet in [Docker](#docker) - for advanced users with prior Docker experience.

## Prerequisites

Make sure to [install node](https://nodejs.org/en/download/) if you don't have it already. Run `node -v` to check if you have `node` and whether it is up to date (version 16.x+). Update `node` in case of an old version (this will also update `npm`).  
```bash
curl -sL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt-get install -y nodejs
```
> The above command updates node binaries. Alternatively, you can [download an installable](https://nodejs.org/en/download/) for your platform.

Make sure `npm` is up to date (version 8.x) by running `npm -v`. Update `npm` in case of an old version; refer to `node` update steps above.

> You may run into an issue of having multiple copies of `npm` installed if you update `npm` separately from `node`. Re-run `npm -v` after the update to ensure that your path is picking the update version. You can locate multiple copies by `find / -name npm 2> /dev/null`; identify the right copy of `npm` and update `PATH` in `~/.profile` accordingly.

## Installation

```bash
git clone https://github.com/itsneski/lightning-jet
cd lightning-jet
npm install --build-from-source --python=/usr/bin/python3
nano ./api/config.json
```
Edit `config.json`: set correct paths for `macaroonPath` and `tlsCertPath`. On umbrel, macaroons are typically located at `~/umbrel/lnd/data/chain/bitcoin/mainnet/readonly.macaroon`, tls cert is at `~/umbrel/lnd/tls.cert`. Optional: you can list expensive nodes to avoid in the `avoid` section of the config file (can be done later).
```bash
nano ~/.profile
```
Edit `.profile`: add a prefix `$HOME/lightning-jet:` to the line that says `export PATH=`. The line should look like this:
```bash
export PATH="$HOME/lightning-jet:<rest of your path, leave it as is>"
```
Add `export PATH=$HOME/lightning-jet:$PATH` to the end of `.profile` if the line does not exist.

Next, execute the updated `.profile` for your current terminal session. The path will be set automatically for all new sessions.
```bash
. ~/.profile
```
Test your path by running `jet -v`. Your path is set correctly if it prints out help. Fix the `PATH` in `~/.profile` in case of an error.

#### RaspiBlitz

- Install JET (following the [above steps](#node-and-npm)) 
- Set the following in `config.json`:
```
"macaroonPath": "/home/bos/.lnd/data/chain/bitcoin/mainnet/readonly.macaroon"
"tlsCertPath": "/home/bos/.lnd/tls.cert"
```

The following step may not be necessary in case you get read access to channel.db via a symlink.

```bash
chmod +r /home/bos/.lnd/data/chain/bitcoin/mainnet/readonly.macaroon
```

## Post-Installation

```shell
jet start daddy
```

## How to run

```shell
jet help
```

#### Examples:
|||
|--|--|
|`jet peers`|Lists peers classified into inbound, outbound, and balanced based on htlc history. Notable columns: `p` - % of [inbound or outbound] routing by the peer out of a total [inbound or outbound] across all peers; `ppm` - peer's current ppm rate; `margin` - rebalance will be profitable as long as its ppm is below the margin.|
|`jet monitor`|Monitors ongoing rebalances, rebalance history, and stuck htlcs. Warns about the state of BOLT database (channel.db); for example, jet will warn when the channel.db grows over a threshold.|
|`jet monitor --status`|Monitors the status of rebalances; shows whether rebalances are paused or active; provides recommendation for local ppm range.|
|`jet htlc-analyzer`|Analyzes failed htlcs and lists peers sorted based on missed routing opportunities. Missed routing opportunities are typically due to [outbound] peers not having sufficient liquidity and/or having low fees.|
|`jet htlc-analyzer ln2me --hours 12`|Shows missed routing opportunities for ln2me node over the past 12 hours.|
|`jet analyze-fees`|Analyzes fees for [outbound] peers and recommends whether to increase or decrease fees based on routing history.|
|`jet analyze-fees WalletOfSatoshi`|Analyzes fees for WalletOfSatoshi and recommends to increase or decrease fees based on routing history.|
|`jet fee-history`|Shows fee history for all peers.|
|`jet fee-history d++`|Shows fee history for d++.|
|`jet htlc-history`|Shows total sats that peers routed based on htlc history. Notable columns: `%` of inbound or outbound routing by a peer out of total [inbound or outbound] across all peers; `d%` of [inbound or outbound] routing by a peer out of total routing [inbound & outbound] by the peer.|
|`jet rebalance-history --hours 12`|Shows rebalance history for all peers over the past 12 hours.|
|`jet rebalance-history coingate --hours 12`|Shows rebalance history for coingate over the past 12 hours.|
|`jet rebalance d++ neski 500000 --ppm 550 --mins 30`|Circular rebalance from dplus to neski for 5mil sats with 550 max ppm and a max runtime of 30 mins.|
|`jet update-channel 769123776873431041 --base 1 --ppm 375`|Sets the base fee to 1 msat and ppm to 375 sats per million for a channel with id of 769123776873431041.|
|`jet reconnect`|Reconnects to disconnected peers (via BalancesOfSatoshis (bos) api)|

## Docker

This installation is for advanced users with prior Docker experiece. Refer [here](#prerequisites) for a host-based installation on a laptop, desktop, Raspberry Pi, RaspiBlitz, myNode and other platforms.

### Prerequisites

- [Install Docker](https://docs.docker.com/get-docker/) if not exists (`docker -v`)
- [Install docker-compose](https://docs.docker.com/compose/install/) if not exists (`docker-compose -v`)
- Add user id to the docker group; run `id` to see if its in the group

### Installation

```bash
git clone https://github.com/itsneski/lightning-jet
cd lightning-jet
. docker/genconfig.sh
```

Edit `$HOME/.lightning-jet/config.json`: set correct paths for `macaroonPath` and `tlsCertPath`. On Umbrel, macaroons are typically located at `~/umbrel/lnd/data/chain/bitcoin/mainnet/readonly.macaroon`, tls cert is at `~/umbrel/lnd/tls.cert`. Optional: list expensive nodes to avoid in the `avoid` section.

```bash
nano $HOME/.lightning-jet/config.json
```

Edit the `docker/.env`: set `LND_DIR` to your installation of LND (typically `/home/umbrel/umbrel/lnd`). Set `LND_HOSTNAME` and `LND_IP_ADDRESS` to match your instance of LND. On Umbrel you can leave default `LND_HOSTNAME`. For `LND_IP_ADDRESS` run `ifconfig -a | grep inet` then select IP address that begins with `10.`. Make sure that `LND_CONFIG_FILE` path is correct.

```bash
nano docker/.env
```

### Build image

```bash
docker-compose -f docker/docker-compose.yml build
```
This make take a while, make sure not to interrupt the process.

### Start up daddy

```shell
docker-compose -f docker/docker-compose.yml up
```

### Execute commands

Prepend [all commands](#how-to-run) with `docker exec -it lightning-jet`:
```shell
docker exec -it lightning-jet jet help
```

## Voltage Cloud

Lightning Jet can rebalance your node in Voltage Cloud by connecting to it remotely via a secure grpc connection. You can select any platform (host-based or cloud, like AWS) to install Jet as long as it supports [Node](https://nodejs.org/en/download/). Jet runs as a daemon (background process), so its best to select a platform that supports running Jet 24/7.

1. Download `admin.macaroon` from Voltage Cloud, the option is visible on the front page when you log into the dashboard. Remember the location where you downloaded the file.

2. [Install Jet](#prerequisites), skip the section that edits `config.json`. Run `jet -v` to ensure you get a valid response.

3. Create a folder under lightning-jet, say `voltage`, and move `admin.macaroon` there. This will ensure that the macaroon file won't get accidentally deleted.

Next, update `config.json` by `nano api/config.json`:

1. Set `macaroonPath` to the absolute path of `admin.macaroon` file from the previous step, e.g. `/home/umbrel/lightning-jet/voltage/admin.macaroon` if on umbrel.

2. Remove `tlsCertPath` from the config.

3. Add `serverAddress` to config that points at API Endpoint, you can find it on the front page of Voltage Cloud dashboard. The value should be in the following format: `<node alias>.m.voltageapp.io:10009`.

Example of config file:

```json
{
  "avoid": [
  ],
  "macaroonPath": "/home/umbrel/lightning-jet/voltage/admin.macaroon",
  "serverAddress": "<node alias>.m.voltageapp.io:10009",
  "debugMode": false,
  "rebalancer": {
    "maxTime": 30,
    "maxPpm": 650,
    "maxAutoPpm": 500,
    "maxInstances": 40,
    "maxPendingHtlcs": 4,
    "enforceMaxPpm": false,
    "exclude": [
    ]
  }
}
```

Run `jet peers` once installation is completed and ensure you get a correct answer as opposed to an error. `jet start daddy` to kick off Jet's automated rebalancer.

## Telegram bot
Lightning Jet telegram bot (jet bot) will notify you about important events such as changes in fees for your remote peers.

To create jet bot: initiate a conversation with [BotFather](https://core.telegram.org/bots#3-how-do-i-create-a-bot) on your Telegram app. Then, select the bot's name (e.g., JET bot) and bot's username (e.g., JET_bot).

Copy the telegram token from the Telegram app chat with BotFather (right under 'Use this token to access the HTTP API:'). `nano ./api/config.json` to add the `telegramToken` setting with the above value (see config file example below).

`jet start telegram` to kick off the service. Make sure there are no errors. Then open a chat with the bot you just created in your Telegram app and type `/start`. This will kick off the communication between the Telegram bot with Jet. You only need to do this step once.

> Make sure to restart the telegram service if it was already running prior to updating the config file: `jet restart telegram`.

## Config file
A list of config settings under `./api/config.json`:
|||
|--|--|
|`macaroonPath`|Macaroon path to enable LND API calls. Most calls will work with `readonly.macaroon` except for `jet update-channel` that requires `admin.macaroon`.|
|`tlsCertPath`|Path to the tls cert to enable LND API calls.|
|`avoid`|A list of nodes to avoid during manual and automated rebalances. `jet rebalance` avoids expensive nodes automatically. the `avoid` setting can help speed things up by providing a static list of nodes to avoid.|
|`telegramToken`|The telegram bot token.|

Settings under `rebalancer` section:
|||
|--|--|
|`maxPpm`|Maximum ppm for manual rebalances.|
|`maxAutoPpm`|Maximum ppm for automated rebalances. This setting is typically lower than `maxPpm` since automated rebalances can spend more time looking for a cheaper route than manual rebalances.|
|`maxTime`|Timeout rebalance after N minutes. This setting can be overridden by `jet rebalance --mins` parameter for manual rebalances.|
|`maxInstances`|Maximum rebalance instances that the auto rebalancer can launch. Keep this setting lower if your node gets overloaded (e.g., monitor by `top` command).|
|`maxPendingHtlcs`|Maximum number of pending htlcs that a peer can have for circular rebalance. Rebalance will be skipped otherwise.|
|`enforceMaxPpm`|Controls whether jet will enforce max ppm default set by `maxAutoPpm` for all rebalances. By default, as long as rebalances are still profitable, jet may override the default max ppm with [outbound] peer's local ppm. With `enforceMaxPpm` set to `true` jet will cap the rebalances by`maxAutoPpm`. The downside is that it may reduce the rebalance success rate for peers with local ppm being higher than the default max ppm.|
|`enforceProfitability`|When set to true, jet will pause all non profitable automated rebalances, leaving only profitable rebalances. Monitor rebalance status by `jet monitor --status`|
|`minCapacity`|Sets minimum capacity (in sats) for channels to be included in automated rebalancing. For example, `"minCapacity": 500000` means that channels with capacity below or equal to `500000` sats will be excluded from automated rebalancing.|
|`buffer`|Minimum rebalance buffer in sats, overrides default value of `250`. Jet will warn when the delta between local and remote ppm for outbound and balanced peers is below the buffer.|
|`exclude`|A list of nodes to exclude from auto rebalancing. Nodes can be excluded from inbound peers, outbound peers, or both. By default, nodes will be excluded from outbound peers when no further info is provided, meaning that excluded nodes won't be rebalanced into. E.g.`"exclude": ["11111111", "22222222:outbound", "33333333:inbound", "44444444:all"]` excludes nodes with ids `11111111` and `22222222` from outbound peers, node with id `33333333` from inbound peers and node with id `44444444` from both inbound and outbound peers.|

### Example:

```json
{
  "avoid": [
    "03d2e20bc19d995098ba357157a9cfbfbfdff4b78fce5ec713128e988e0115d776",
    "03f80288f858251aed6f70142fab79dede5427a0ff4b618707bd0a616527a8cec7"
  ],
  "macaroonPath": "/home/umbrel/umbrel/lnd/data/chain/bitcoin/mainnet/readonly.macaroon",
  "tlsCertPath": "/home/umbrel/umbrel/lnd/tls.cert",
  "debugMode": false,
  "telegramToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  "rebalancer": {
    "maxTime": 30,
    "maxPpm": 650,
    "maxAutoPpm": 500,
    "maxInstances": 10,
    "enforceMaxPpm": false,
    "exclude": [
    ]
  }
}
```
