const importLazy = require('import-lazy')(require);

const constants = importLazy('../../api/constants');
const analyzeFeesApi = importLazy('../../api/analyze-fees');
const apiUtils = importLazy('../../api/utils');

const {
  requireLndAlive,
  lndUtils,
} = require('../utils/lnd');

function registerAnalyzeFeesCommand(program) {
  program
    .command('analyze-fees')
    .summary('Analyzes peer fees')
    .description(
      "Each peer's channel local and remote fees will be evaluated against the profitability margin."
    )
    .argument(
      '[node]',
      'Pub id or an alias, full or partial, of outbound node for fee analysis'
    )
    .option(
      '--profit <profit>',
      'Profit margin in % to evaluate fees against',
      parseProfit
    )
    .action(async (node, options) => {
      const lndClient = requireLndAlive();
      const profit = options.profit;

      const classified = apiUtils.classifyPeersSync(lndClient);

      const chans = [];
      const nodesFound = [];

      collectClassifiedPeers(classified.outbound, node, chans, nodesFound);
      collectClassifiedPeers(classified.balanced, node, chans, nodesFound);

      if (node) {
        if (nodesFound.length >= 2) {
          const matches = nodesFound.map((match) => match.name);
          console.error('multiple node matches found:', matches);
          return;
        }

        if (nodesFound.length === 0) {
          console.error('node not found (possibly an inbound node)');
          return;
        }

        const matchedNode = nodesFound[0];
        const fees = lndUtils.listFeesSync(lndClient, [
          {
            chan: matchedNode.id,
            peer: matchedNode.peer,
          },
        ]);

        if (!fees || fees.length === 0) {
          console.error('unknown fee data for node:', matchedNode.name, matchedNode.peer);
          return;
        }

        analyzeFeesApi.printFeeAnalysis(
          matchedNode.name,
          matchedNode.peer,
          fees[0].local,
          fees[0].remote,
          profit
        );

        return;
      }

      const fees = lndUtils.listFeesSync(lndClient, chans);
      const feeMap = {};

      fees.forEach((fee) => {
        feeMap[fee.id] = fee;
      });

      const unknownPeers = [];

      analyzeGroup({
        title: 'analyzing fees for [outbound] peers',
        peers: classified.outbound || [],
        feeMap,
        unknownPeers,
        profit,
      });

      analyzeGroup({
        title: 'analyzing fees for [balanced] peers',
        peers: classified.balanced || [],
        feeMap,
        unknownPeers,
        profit,
        leadingNewline: true,
      });

      if (unknownPeers.length > 0) {
        console.log(constants.colorYellow, '\nunknown fee data for the following peers (excluded):');

        unknownPeers.forEach((peer) => {
          console.log(peer.name, peer.id);
        });
      }
    });
}

function collectClassifiedPeers(peers, node, chans, nodesFound) {
  if (!peers) {
    return;
  }

  peers.forEach((peer) => {
    chans.push({
      chan: peer.id,
      peer: peer.peer,
    });

    if (!node) {
      return;
    }

    const peerName = peer.name && peer.name.toLowerCase();
    const search = node.toLowerCase();

    if (node === peer.peer || (peerName && peerName.indexOf(search) >= 0)) {
      nodesFound.push(peer);
    }
  });
}

function analyzeGroup({
  title,
  peers,
  feeMap,
  unknownPeers,
  profit,
  leadingNewline,
}) {
  let message = title;

  message += profit !== undefined
    ? ' based on profit of ' + profit + '%'
    : '. no profit requirements specified';

  console.log(leadingNewline ? '\n-------------------------------------------------------------' : '-------------------------------------------------------------');
  console.log(message);
  console.log('-------------------------------------------------------------');

  let count = 0;

  peers.forEach((peer) => {
    console.log();

    const fee = feeMap[peer.peer];

    if (!fee) {
      unknownPeers.push({
        name: peer.name,
        id: peer.peer,
      });

      return;
    }

    const num = analyzeFeesApi.printFeeAnalysis(
      peer.name,
      peer.peer,
      fee.local,
      fee.remote,
      profit
    );

    count += num;
  });

  if (count === 0) {
    console.log('no issues to report');
  }
}

function parseProfit(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error('profit has to be between 0 and 100');
  }

  return parsed;
}

module.exports = {
  registerAnalyzeFeesCommand,
};