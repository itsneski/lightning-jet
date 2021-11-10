
# Lightning Jet 🚀⚡️, or simply Jet
General-purpose automated rebalancer for LND Lightning nodes. Helps get an insight into peers' classification based on routing history, missed routing opportunities, and stuck htlcs.

## Prerequisites
- Install [BalanceOfSatoshi](https://github.com/alexbosworth/balanceofsatoshis) along with its prerequisites (Node).
- Check out the [BalanceOfSatoshi install page for Umbrel](https://plebnet.wiki/wiki/Umbrel_-_Installing_BoS) on [Plebnet](https://plebnet.wiki/).

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
|`jet peers`|Lists peers classified into inbound, outbound and balanced based on htlc history. Notable columns: `p` - % of [inbound or outbound] routing by the peer out of total [inbound or outbound] across all peers; `ppm` - peer's current ppm rate; `margin` - rebalance ppm margin, rebalance will be profitable as long as its ppm is below the margin.|
|`jet monitor`|Lists ongoing rebalances, rebalance history, and stuck htlcs.|
|`jet htlc-analyzer`|Analyzes failed htlcs and lists peers sorted based on missed routing opportunities. Missed routing opportunities are typically due to [outbound] peers not having sufficient liquidity and / or having low fees. Prerequisites: make sure to kick off `jet start htlc-logger` and varify that the logger service is running by `jet status`.|
|`jet analyze-fees`|Analyzes fees for [outbound] peers and provides recommendation on whether to increase or decrease fees based on routing history.|
|`jet htlc-history`|Lists peers classified into inbound, outbound and balanced based on htlc history. Notable columns: `%` of inbound or outbound routing by a peer out of total [inbound or outbound] across all peers; `d%` of [inbound or outbound] routing by a peer out of total routing [inbound & outbound] by the peer.|
|`jet rebalance dplus neski 500000 --ppm 550 --mins 30`|Circular rebalance from dplus to neski for 5mil sats with 550 max ppm and max runtime of 30 mins.|
|`jet update-channel 769123776873431041 --base 1 --ppm 375`|Sets the base fee to 1 msat and ppm to 375 sats per million for a channel with id of 769123776873431041.|

## Telegram bot
Lightning Jet telegram bot (jet bot) that will notify you about important events such as change in fees for your remote peers.

To create jet bot: initiate a conversation with [BotFather](https://core.telegram.org/bots#3-how-do-i-create-a-bot) on your Telegram app. Select bot's name (e.g. JET bot) and bot's username (e.g. jet_bot).

Copy the telegram token from the Telegram app chat with BotFather (right under 'Use this token to access the HTTP API:'). `nano ./api/config.json` to add the `telegramToken` setting with the above value (see config file example below).

`jet start telegram` to kick off the service. Make sure there are no errors. Then open a chat with the bot you just created in your Telegram app and type `/start`. This will kick off the communication between the Telegram bot with Jet. You only need to do this step once.

## Config file
A list of config settings under `./api/config.json`:
|||
|--|--|
|`macaroonPath`|Macaroon path to enable LND API calls. Most calls will work with `readonly.macaroon` with the exception of `jet update-channel` that requires `admin.macaroon`.|
|`tlsCertPath`|Path to the tls cert to enable LND API calls.|
|`avoid`|A list of nodes to avoid during manual and automated rebalances. `jet rebalance` avoids expensive nodes automatically. the `avoid` setting can help speed things up by providing a static list of nodes to avoid.|
|`telegramToken`|The telegram bot token.|
|`rebalancer.maxPpm`|Maximum fee rate to pay for manual rebalances.|
|`rebalancer.maxAutoPpm`|Maximum fee rate to pay for automated rebalances. This setting is typically kept lower than `maxPpm` since automated rebalances can spend more time looking for a cheaper route than manual rebalances.|
|`rebalancer.maxTime`|Timeout rebalance after N minutes. This setting can be overriden by `jet rebalance --mins` parameter for manual rebalances.|
|`rebalancer.maxInstances`|Maximum rebalance instances that can be launched by the auto rebalancer. Keep this setting lower in case your node gets overloaded (e.g. monitor by `top` command).|
|`rebalancer.maxPendingHtlcs`|Maximum number of pending htlcs that a peer can have for citcular rebalance. Rebalance will be skipped otherwise.|
|`rebalancer.exclude`|A list of nodes to exclude from auto rebalancing. E.g.`exclude = ["035e4ff418fc8b5554c5d9eea66396c227bd429a3251c8cbc711002ba215bfc226"]`|

### Example:

```json
{
  "avoid": [
    "03d2e20bc19d995098ba357157a9cfbfbfdff4b78fce5ec713128e988e0115d776",
    "03f80288f858251aed6f70142fab79dede5427a0ff4b618707bd0a616527a8cec7",
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
    "exclude": [
    ]
  }
}
```
