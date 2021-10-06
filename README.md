lnd-optimize is a collection of tools to help optimize rebalancing and other functions of a Lighting (LND) routing node.

prerequisites:
- https://github.com/alexbosworth/balanceofsatoshis - including Node

how to run:
- 'node <command> [options]', e.g. 'node fees.js'

list of tools:

  bosrebalance.js - main rebalancing tool.  Runs BalanceOfSatoshis in a loop until the target amount is met or until all possible routes are exhausted.

  fees.js - displays local and remote fees for routing peers.

  peers.js - partitions peers into inbound, outbound and balanced based on htlc history.

  htlc-history.js - outputs cumulative stats about htlc history.

  htlc-logger.js - logs select htlcs into a local database (currently stored in a file).

  htlc-analyzer.js - outputs stats about the htlcs logged into the local database.

  list-channels.js - lists channels along with the peers.

  list-peers.js - lists peer aliases along with their ids.
