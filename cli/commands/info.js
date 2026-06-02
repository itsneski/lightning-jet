const importLazy = require('import-lazy')(require);

const { version } = require('../../package.json');
const lndClient = importLazy('../../api/connect');
const logger = require('../../api/logger');

const {
  isLndAlive,
  withCommas,
  getChanInfo,
  getNodeInfoSync,
  getInfoSync,
  walletBalance,
  closeLndHandle,
} = importLazy('../../lnd-api/utils');

const {
  resolveNode,
  resolveChannel,
  table,
  jetDbStats,
} = importLazy('../../api/utils');

function registerInfoCommand(program) {
  program
    .command('info')
    .summary('Prints info about a node (this or another), or a channel')
    .description('Returns various node or channel stats')
    .argument('[id]', 'Node id, node partial alias, or channel id')
    .option('--db', 'Lists db tables sorted by size')
    .option('--os', 'Prints OS stats (cpu & mem)')
    .action(async (nodeId, options) => {
      if (options.db) {
        const { stats } = require('../../db/utils');

        console.log('list of database tables sorted by [on-disk] size:');
        console.table(stats());
        return;
      }

      if (options.os) {
        const osStats = require('../../api/os-stats').getStats();

        if (!osStats) {
          throw new Error('error generating OS stats');
        }

        const stats = [
          { name: 'cpu %', val: osStats.cpu },
          { name: 'mem %', val: osStats.mem },
          { name: 'mem (gb)', val: osStats.memGb },
          { name: 'disk', val: osStats.diskGb },
          { name: 'free', val: osStats.freeGb },
        ];

        console.log('cpu % - cpu utilization');
        console.log('mem % - memory utilization');
        console.log('mem(gb) - available memory in Gb');
        console.log('disk(gb) - hard drive size in Gb');
        console.log('free(gb) - available hard drive space in Gb');

        table(stats);
        return;
      }

      try {
        if (!isLndAlive(lndClient)) {
          throw new Error('lnd is offline');
        }

        if (nodeId) {
          let matches = resolveNode(nodeId);

          if (matches && matches.length > 0) {
            if (matches.length > 1) {
              console.log('multiple node matches found; narrow your selection');
              return;
            }

            printNode(matches[0].id);
            return;
          }

          matches = resolveChannel(nodeId);

          if (matches && matches.length > 0) {
            if (matches.length > 1) {
              console.error('multiple channel matches found; narrow your selection');
              return;
            }

            printChan(matches[0]);
            return;
          }

          if (printNode(nodeId)) {
            return;
          }

          if (printChan(nodeId)) {
            return;
          }

          console.log('no matches found');
          return;
        }

        const nodeInfo = getInfoSync(lndClient);
        const balance = walletBalance(lndClient);
        const { checkSize } = require('../../api/channeldb');
        const check = checkSize();
        const stats = jetDbStats();

        console.log('jet version:', version);
        console.log('lnd version:', nodeInfo.version);
        console.log('node id:', nodeInfo.identity_pubkey);
        console.log('node alias:', nodeInfo.alias);
        console.log('total chans:', nodeInfo.num_active_channels + nodeInfo.num_inactive_channels);
        console.log('--active:', nodeInfo.num_active_channels);
        console.log('--inactive:', nodeInfo.num_inactive_channels);

        if (balance.response) {
          console.log('bitcoin balance (sats):', withCommas(balance.response.total_balance));
          console.log('--confirmed:', withCommas(balance.response.confirmed_balance));
          console.log('--unconfirmed:', withCommas(balance.response.unconfirmed_balance));
        }

        if (check.error) {
          console.log('channel.db:', check.error);
        } else {
          const str = check.size >= 1000
            ? withCommas(check.size) + ' gb'
            : check.size + ' mb';

          console.log('channel.db:', str);
        }

        if (stats) {
          console.log('jet.db:', stats.str);
        }
      } finally {
        closeLndHandle(lndClient);
      }
    });
}

function printNode(id) {
  try {
    const info = getNodeInfoSync(lndClient, id).info;

    if (!info) {
      return undefined;
    }

    console.log('pub id:', info.node.pub_key);
    console.log('name:', info.node.alias);
    console.log('total chans:', info.num_channels);
    console.log('total capacity:', withCommas(info.total_capacity), '(sats)');

    return info;
  } catch (err) {
    return undefined;
  }
}

function printChan(id) {
  try {
    const info = getChanInfo(lndClient, id);

    if (!info) {
      return undefined;
    }

    console.log('chan id:', info.chan.channel_id);
    console.log('capacity:', withCommas(info.chan.capacity));

    const myNode = getInfoSync(lndClient).identity_pubkey;
    const peer1 = getNodeInfoSync(lndClient, info.chan.node1_pub);
    const peer2 = getNodeInfoSync(lndClient, info.chan.node2_pub);

    if (peer1.info.node.pub_key === myNode) {
      console.log('peer:', peer2.info.node.alias + ', ' + peer2.info.node.pub_key);
    } else if (peer2.info.node.pub_key === myNode) {
      console.log('peer:', peer1.info.node.alias + ', ' + peer1.info.node.pub_key);
    } else {
      console.log('peer1:', peer1.info.node.alias + ', ' + peer1.info.node.pub_key);
      console.log('peer2:', peer2.info.node.alias + ', ' + peer2.info.node.pub_key);
    }

    return info;
  } catch (err) {
    return undefined;
  }
}

module.exports = {
  registerInfoCommand,
};
