// rebalance build on top of https://github.com/alexbosworth/balanceofsatoshis
//
// calls 'bos rebalance' in a loop, until the target amount is met or until all
// possible routes is exhausted.  dynamically builds a list of nodes to avoid
// based on candidate routes.  once it encounters a candidate route where max ppm
// exceeds the argument, it excludes the most expensive route, or the corresponding hop.
//
// aggregates stats for nodes that it encounters. the aggregated stats make it
// easier to find candidate nodes.  e.g.:
// {
//    "name": "LightTheClassic",
//    "id": "02c29b89b2121b2c1fa2e5422bc70e0bb7ae7326c7a9d2b796ed6b89cdc5a2871b",
//    "ppms": "189,189,189,189",
//    "avg_ppm": 189,
//    "max_ppm": 189,
//    "channels": 67,
//    "updated_h_ago": 14
// }
// where ppms is a list of ppms for nodes that are encountered during routing.
//

const config = require('./config');
const tags = require('./tags');
const date = require('date-and-time');
const constants = require('./constants');
const lndClient = require('./connect');
const {getNodesInfoSync} = require('../lnd-api/utils');
const {recordRebalance} = require('../db/utils');
const {recordRebalanceFailure} = require('../db/utils');
const {recordRebalanceAvoid} = require('../db/utils');
const {listRebalanceAvoidSync} = require('../db/utils');
const {recordActiveRebalanceSync} = require('../db/utils');
const {deleteActiveRebalance} = require('../db/utils');
const {listPeersMapSync} = require('../lnd-api/utils');
const {getNodeFeeSync} = require('../lnd-api/utils');
const {rebalanceSync} = require('../bos/rebalance');

const arrAvg = arr => arr.reduce((a,b) => a + b, 0) / arr.length;
const stringify = obj => JSON.stringify(obj, null, 2);


// keep track of nodes to report stats
const REPS = 2;
const PPM_PET_HOP = 350;
const MIN_PPMS_TRIES = 4; // min ppm occurances before attempting to exclude a node.
                          // the greater the number, the more chances nodes get
                          // to prove they are not expensive before being excluded

module.exports = ({from, to, amount, ppm = config.rebalancer.maxPpm || constants.rebalancer.maxPpm, mins, avoidArr = config.avoid || []}) => {
  if (!from || !to || !amount) {
    throw new Error('from, to and amount are mandatory arguments');
  }

  console.log(date.format(new Date, 'MM/DD hh:mm A'));
  console.log('rebalancer is starting up');

  var peerMap = listPeersMapSync(lndClient);

  const OUT = from;
  const IN = to;
  const AMOUNT = amount;

  var tagsMap = {};
  Object.keys(tags).forEach(t => tagsMap[tags[t]] = t);

  // find ids
  var outId = findId(OUT);
  var inId = findId(IN);

  if (!outId) {
    throw new Error('couldnt find pub id for ' + OUT);
  }
  if (!inId) {
    throw new Error('couldnt find pub id for ' + IN);
  }

  // find names
  var outName = peerMap[outId].name;
  var inName = peerMap[inId].name;

  // check that the exit node's fee isn't higher than ppm
  let fee = getNodeFeeSync(lndClient, inId);
  if (fee) {
    let sum = fee.base/1000 + fee.rate;
    if (sum > ppm) {
      return console.error(`exit node's fee, base:${fee.base} rate:${fee.rate}, exceeds supplied ppm of ${ppm}`);
    } else if (100 * (ppm - sum) / ppm < 25) {   // enough fee buffer??
      console.log(`exit node's fee is within 25% of supplied ppm, may not be sufficient room to rebalance`);
    }
  } else {
    throw new Error(`couldnt find fee for ${inId}`);
  }

  var maxFee = Math.round(AMOUNT * ppm / 1000000);
  var ppm_per_hop = Math.min(PPM_PET_HOP, Math.round(.75 * ppm));
  var avoidNodes = {};

  var nodeStats = {};
  var routes = [];
  var lastMessage;
  var lastError;
  var amountRebalanced = 0;
  var feesSpent = 0;
  var skippedHops = {};

  const maxRuntime = mins || config.rebalancer.maxTime || constants.rebalancer.maxTime;
  const startTime = Date.now();

  // it takes time for the rebalancer to properly explore routes. the less time
  // its given, the less is the opportunity to find the cheapest route.
  // the rebalancer needs to be more aggressive when it comes
  // to skipping routes when it is given less than N minutes. the threshold
  // is a guess atm, but one hour seems reasonable.
  const aggresiveMode = maxRuntime < 60;

  // construct avoid string based on argument
  var avoid = "";
  var nodeInfo = {};
  if (avoidArr) {
    avoidArr.forEach(n => {
      avoidNodes[n] = true;
    })
  }
  // construct avoid string based on db avoid records
  // the depth of avoid lookup is a guess atm, but having
  // it be at least an hour makes sense. the longer rebalance
  // runs, the more work it does to determine expensive node,
  // the greater the depth of history.
  let avoidDepth = Math.max(60, 5 * maxRuntime);
  let dbAvoid = listRebalanceAvoidSync(outId, inId, ppm, avoidDepth);
  console.log(`dbAvoid: ${dbAvoid && dbAvoid.length} node(s), depth: ${avoidDepth} mins, ${dbAvoid}`);
  if (dbAvoid) {
    dbAvoid.forEach(n => {
      avoidNodes[n] = true;
    })
  }

  let info = getNodesInfoSync(lndClient, Object.keys(avoidNodes));
  if (info) {
    info.forEach(n => {
      if (n) nodeInfo[n.node.pub_key] = n;  // can be null if a node mentioned in the config doesn't exist
    })
  }
  let epoch = Math.floor(+new Date() / 1000);
  Object.keys(avoidNodes).forEach(node => {
    if (nodeInfo[node]) {
      console.log('excluding node:', node + ', ' + nodeInfo[node].node.alias + ', channels: '  + nodeInfo[node].num_channels + ', last updated', Math.round((epoch - nodeInfo[node].node.last_update)/3600), 'hours ago');
      avoid += ' --avoid ' + node;
    }
  })

  // store min ppm of a failed route due to high fee;
  // present it as a stat in jet rebalance-history
  let minFailedPpm = Number.MAX_SAFE_INTEGER;

  console.log('\n----------------------------------------')
  console.log(`from: ${outName}, ${outId}`);
  console.log(`to: ${inName}, ${inId}`);
  console.log('amount:', numberWithCommas(AMOUNT));
  console.log('max ppm:', ppm);
  console.log('max fee:', maxFee);
  console.log('ppm per hop:', ppm_per_hop);
  console.log('time left:', maxRuntime, 'mins');
  if (aggresiveMode) console.log('aggressive mode: on');
  if (config.debugMode) console.log('debug mode: enabled');
  console.log('----------------------------------------\n')

  // record for jet monitor
  const rebalanceId = recordActiveRebalanceSync({from: outId, to: inId, amount: AMOUNT, ppm, mins: maxRuntime});
  if (rebalanceId === undefined) console.error('rebalance db record id is undefined');

  // run the loop for bos rebalance
  try {
    for (let rep = 0; rep < REPS; ) {
      let timeRunning = Math.round((Date.now() - startTime) / 1000 / 60);
      let timeLeft = maxRuntime - timeRunning;
      if (timeLeft < 0) {
        console.log('Ran out of time');
        lastMessage = 'Ran out of time';
        break;
      }

      let remainingAmount = AMOUNT - amountRebalanced;
      maxFee = Math.round(remainingAmount * ppm / 1000000);

      console.log('\n-------------------------------------------');
      console.log(`* rebalancing from ${outName} to ${inName}`);
      if (amountRebalanced > 0) console.log('* targeted amount:', numberWithCommas(AMOUNT));
      console.log('* remaining amount:', numberWithCommas(remainingAmount));
      console.log('* time left:', timeLeft, 'mins');

      // call bos rebalance; async logger will be notified about route evals and log messages
      let lastRoute; // last route that was evaluated
      const rebalanceLogger = {
        eval: (route) => {
          console.log('\nprobing route:', route);
          lastRoute = route;

          // record the node for sats
          route.forEach(node => {
            if (nodeStats[node.id]) {
              let n = nodeStats[node.id];
              n.ppms.push(node.ppm);
            } else {
              nodeStats[node.id] = {
                name: node.name,
                id: node.id,
                ppms: [node.ppm]
              }
            }

            if (node.ppm > ppm_per_hop && canAvoidNode(node.id)) {
              console.log('identified expensive node:', stringify(node));
            }
          })
        },
        debug: (msg) => {
          if (config.debugMode) console.log(msg);
        },
        info: (msg) => {
          if (config.debugMode) console.log(msg);
        },
        warn: (msg) => {
          console.warn(msg);
        },
        error: (msg) => {
          console.error(msg);
        }
      }

      // call bos rebalance in sync mode
      let rbSuccess, rbError;
      try {
        let rbSync = rebalanceSync({logger: rebalanceLogger, from: outId, to: inId, amount: remainingAmount.toString(), maxFeeRate: ppm, maxFee, mins: timeLeft, avoid: Object.keys(avoidNodes)});
        rbSuccess = rbSync.result;
        rbError = rbSync.error;
      } catch(err) {
        console.error('error calling bos rebalance:', err.message);
        // force to exit the loop, otherwise may get into infinite loop
        rep = REPS;
        continue;
      }

      if (rbError) {
        let rebalanceFeeTooHigh = ['RebalanceTotalFeeTooHigh', 'RebalanceFeeRateTooHigh'].includes(rbError.error);
        let failedToFindPath = rbError.error === 'FailedToFindPathBetweenPeers';
        let lowRebalanceAmount = rbError.error === 'LowRebalanceAmount';
        let failedToFindPeer = rbError.error === 'FailedToFindPeerAliasMatch';
        let noSufficientBalance = rbError.error === 'NoOutboundPeerWithSufficientBalance';
        let probeTimeout = rbError.error === 'ProbeTimeout';
        let failedToParseAmount = rbError.error === 'FailedToParseSpecifiedAmount';
        let unexpectedError = rbError.error === 'UnexpectedErrInGetRouteToDestination';

        if (rebalanceFeeTooHigh) {
          // find nodes that exceed the per hop ppm in the last
          // segment of the output
          lastError = 'rebalanceFeeTooHigh';
          console.log('\n-------------------------------------------');
          console.log('found a prospective route, but the fee is too high');
          //console.log('evaluating output:', stdout);
          //let index = stdout.lastIndexOf('evaluating:');
          if (lastRoute) {
            let nodes = lastRoute;
            if (nodes) {
              // find a node with max ppm that's not already on the avoid list
              // its enough to select one node to unblock the route
              let max;
              let maxIndex;
              let ppmsum = 0;
              let count = 0;
              nodes.forEach(n => {
                ppmsum += n.ppm;
                if (canAvoidNode(n.id) && (!max || n.ppm > max.ppm)) {
                  max = n;
                  maxIndex = count;
                }
                count++;
              })
              console.log('the route has', nodes.length, 'nodes:', stringify(nodes));
              console.log('the route has a [cumulative] ppm of', ppmsum, 'vs', ppm, 'targeted');
              minFailedPpm = Math.min(minFailedPpm, ppmsum);
              if (max) {
                console.log('identified expensive node to exclude:', stringify(max));
                if (max.ppm > ppm_per_hop) {
                  let entry = nodeStats[max.id];
                  console.log('identified corresponding nodeStats entry:', nodeToString(entry));

                  // in addressive more just skip the node, as opposed to
                  // giving the node more chances to prove that it's not
                  // expensive
                  if (aggresiveMode) {
                    console.log('aggressive mode: on');
                    console.log('excluding node:', max.id);
                    avoidNodes[max.id] = true;
                    avoid += ' --avoid ' + max.id;
                    // record in the db
                    recordRebalanceAvoid(outId, inId, ppm, max.id);
                  } else {
                    // see if the node is a repeat offender
                    // basically give the node a few chances to show that it's
                    // not an expensive node before excluding it
                    if (entry.ppms.length >= MIN_PPMS_TRIES && arrAvg(entry.ppms) > ppm_per_hop) {
                      console.log('the node was part of', entry.ppms.length, 'routes with an average ppm of', Math.round(arrAvg(entry.ppms)));
                      console.log('excluding node:', max.id);
                      avoidNodes[max.id] = true;
                      avoid += ' --avoid ' + max.id;
                      // record in the db
                      recordRebalanceAvoid(outId, inId, ppm, max.id);
                    } else {
                      // give the node a few more tries, but don't exclude it
                      if (isSkippedHop(max.id, nodes[maxIndex + 1].id)) {
                        lastMessage = 'hop already skipped';
                        console.log('hop from', max.name, 'to', nodes[maxIndex + 1].name, 'already skipped, exiting');
                        rep = REPS;
                      } else {
                        lastMessage = 'skipping the hop';
                        skipHop(max.id, nodes[maxIndex + 1].id);
                        console.log('skipping the hop from', max.name, 'to', nodes[maxIndex + 1].name);
                        avoid += ' --avoid "FEE_RATE>' + computeFeeRate(max.ppm) + '/' + nodes[maxIndex + 1].id + '"';
                      }
                    }
                  }
                } else {  // max.ppm <= ppm_per_hop
                  // ppm is not greater than max; don't exclude the node
                  // but rather skip the hop
                  if (isSkippedHop(max.id, nodes[maxIndex + 1].id)) {
                    lastMessage = 'hop already skipped';
                    console.log('hop from', max.name, 'to', nodes[maxIndex + 1].name, 'already skipped, exiting');
                    rep = REPS;
                  } else {
                    lastMessage = 'ppm is not greater than max, skipping the hop';
                    skipHop(max.id, nodes[maxIndex + 1].id);
                    console.log(lastMessage, 'from', max.name, 'to', nodes[maxIndex + 1].name);
                    avoid += ' --avoid "FEE_RATE>' + computeFeeRate(max.ppm) + '/' + nodes[maxIndex + 1].id + '"';
                  }
                }
              } else {  // !max
                lastMessage = 'couldnt exclude any nodes, likely already on the avoid list';
                console.log(lastMessage + ', retrying');
                rep++;
              }
            } else {  // !nodes
              lastMessage = 'couldnt exclude any nodes';
              console.log(lastMessage + ', retrying');
              rep++;
            }
          } else {
            lastMessage = 'couldnt locate the segment of the output to analyze';
            console.log(lastMessage + ', retrying');
            rep++;
          }
        } else if (failedToFindPath) {
          // didn't find a route; last ditch effort - exclude all expensive nodes
          // that have not yet been excluded and retry
          lastError = 'failedToFindPath';
          lastMessage = 'failed to find a route';
          console.log('\n-------------------------------------------');
          console.log(lastMessage);
          console.log('exclude all expensive nodes and retry');
          let count = 0;
          Object.keys(nodeStats).forEach(id => {
            if (canAvoidNode(id) && arrAvg(nodeStats[id].ppms) > ppm_per_hop) {
              console.log('excluding node:', nodeToString(nodeStats[id]));
              avoidNodes[id] = true;
              avoid += ' --avoid ' + id;
              count++;
            }
          })
          if (count > 0) {
            console.log('excluded', count, 'nodes');
          } else {
            lastMessage += ', didnt find any nodes to exclude';
            console.log('didnt find any nodes to exclude, retrying');
            rep++;
          }
        } else if (lowRebalanceAmount) {
          lastError = 'lowRebalanceAmount';
          lastMessage = 'low rebalance amount';
          console.log('\n-------------------------------------------');
          console.log(lastMessage + ', exiting');
          rep = REPS; // force to exit the loop
        } else if (failedToFindPeer) {
          lastError = 'failedToFindPeer';
          lastMessage = 'failed to find peer'
          console.log(lastMessage + ', exiting');
          rep = REPS; // force to exit the loop
        } else if (noSufficientBalance) {
          lastError = 'noSufficientBalance';
          lastMessage = 'insufficient local balance';
          console.log(lastMessage + ', exiting');
          rep = REPS;
        } else if (probeTimeout) {
          lastError = 'probeTimeout';
          lastMessage = 'ran out of time';
          console.log(lastMessage + ', exiting');
          rep = REPS;
        } else if (failedToParseAmount) {
          lastError = 'FailedToParseSpecifiedAmount';
          lastMessage = 'failed to parse amount';
          console.log(lastMessage + ', exiting');
          rep = REPS;
        } else if (unexpectedError) {
          lastError = 'unexpectedError';
          lastMessage = 'unexpected error';
          console.log('\n-------------------------------------------');
          console.log(lastMessage, JSON.stringify(rbError, null, 2), ' exiting');
          rep = REPS;
        } else {
          lastError = 'unidentifiedError';
          lastMessage = 'unidentified error';
          console.log('\n-------------------------------------------');
          console.log(lastMessage, JSON.stringify(rbError, null, 2), ' exiting');
          rep = REPS;
        }
      } else {  // !stderr
        console.log('\n-------------------------------------------');
        lastMessage = 'successful rebalance';
        // determine amount rebalanced
        let amount = rbSuccess.amount;
        let fees = rbSuccess.fees;
        if (amount > 0) {
          console.log('* amount rebalanced:', numberWithCommas(amount));
          amountRebalanced += amount;

          // record result in the db for further optimation
          recordRebalance(outId, inId, AMOUNT, amount, Math.round(1000000 * fees / amount));

          console.log('* total amount rebalanced:', numberWithCommas(amountRebalanced));
          if (fees > 0) {
            console.log('* fees spent:', fees);
            feesSpent += fees;
            console.log('* total fees spent:', feesSpent);
            console.log('* ppm:', Math.round(1000000 * feesSpent / amountRebalanced));
          } else {
            lastMessage = 'couldnt parse fees';
            console.log(lastMessage + ', retrying');
          }
          if (amountRebalanced > AMOUNT) {
            console.log('* amount rebalanced exceeds targeted, exiting the loop');
            rep = REPS;
          } else if (AMOUNT - amountRebalanced < 50000) {
            console.log('* less than 50k to rebalance, exiting the loop');
            rep = REPS;
          }
        } else {
          lastMessage = 'successful rebalance, but couldnt extract amount rebalanced';
          console.log(lastMessage + ', exiting');
          rep = REPS; // force to exit the loop
        }
      } // if stderr

      // helper function
      function canAvoidNode(id) {
        return !avoidNodes[id] && id !== outId && id !== inId && id !== OUT && id !== IN && id !== tags[OUT] && id !== tags[IN];
      }
    } // for
  } catch(err) {
    console.error('error running rebalance loop:', err);
  } finally {
    if (rebalanceId != undefined) deleteActiveRebalance(rebalanceId);
  }

  // record rebalance failure, success has already been recorded
  if (amountRebalanced <= 0 && ['rebalanceFeeTooHigh', 'failedToFindPath', 'unexpectedError', 'unidentifiedError'].indexOf(lastError) >= 0) {
    if (minFailedPpm < Number.MAX_SAFE_INTEGER) recordRebalanceFailure(outId, inId, AMOUNT, lastError, ppm, minFailedPpm);
    else recordRebalanceFailure(outId, inId, AMOUNT, lastError, ppm);
  }

  printStats(lndClient, nodeStats, nodeInfo);

  // str can either be a tag, a portion of node's alias, or node's pub id
  function findId(str) {
    if (tags[str]) return tags[str];
    if (peerMap[str]) return str;
    // see if str is part of an alias
    let id;
    Object.values(peerMap).forEach(p => {
      if (p.name.toLowerCase().indexOf(str.toLowerCase()) >= 0) {
        if (id) throw new Error('more than one pub id associated with ' + str);
        id = p.id;
      }
    })
    return id;
  }

  // format for printing
  function printStats() {
    getNodesInfoSync(lndClient, Object.keys(nodeStats)).forEach(n => {
      nodeInfo[n.node.pub_key] = n;
    })
    epoch = Math.floor(+new Date() / 1000);
    let stats = Object.values(nodeStats);
    stats.forEach(n => { 
      n.avg_ppm = Math.round(arrAvg(n.ppms));
      n.max_ppm = Math.max.apply(Math, n.ppms);
      n.channels = nodeInfo[n.id].num_channels;
      n.updated_h_ago = Math.round((epoch - nodeInfo[n.id].node.last_update)/3600);
    })
    stats.forEach(n => n.ppms = n.ppms.join(','));
    stats.sort(function(a, b) {
      return b.avg_ppm - a.avg_ppm;
    })

    // splint into two groups based on ppm_per_hop
    let sortedMax = stats.filter(n => n.avg_ppm > ppm_per_hop);
    let lowFeeSorted = stats.filter(n => n.avg_ppm <= ppm_per_hop);

    let routesFormatted = [];
    routes.forEach(route => {
      let r = {
        amount: numberWithCommas(route[0].amount),
        ppm: Math.round(1000000 * route[0].fees / route[0].amount),
        nodes: []
      }
      route.slice(1).forEach(n => {
        r.nodes.push(n.name + ', ' + n.ppm + ', ' + n.id);
      })
      routesFormatted.push(r);
    })

    console.log('\n-------------------------------------------');
    console.log('finished rebalance from', OUT, 'to', IN);
    console.log('last message:', lastMessage);
    console.log('amount targeted:', numberWithCommas(AMOUNT));
    console.log('amount rebalanced:', numberWithCommas(amountRebalanced));
    if (feesSpent > 0) {
      console.log('fees spent:', feesSpent);
      console.log('ppm: ', Math.round(1000000 * feesSpent / amountRebalanced));
    }
    if (routesFormatted.length > 0) console.log('routes:', stringify(routesFormatted));
    console.log('nodes that exceeded per hop ppm:', stringify(sortedMax));
    console.log('low fee nodes:', stringify(lowFeeSorted));
    console.log('\n-------------------------------------------');
    console.log('finished rebalance from', OUT, 'to', IN);
    console.log('last message:', lastMessage);
    console.log('amount targeted:', numberWithCommas(AMOUNT));
    console.log('amount rebalanced:', numberWithCommas(amountRebalanced));
    if (feesSpent > 0) {
      console.log('fees spent:', feesSpent);
      console.log('ppm:', Math.round(1000000 * feesSpent / amountRebalanced));
    }
    console.log('-------------------------------------------\n');
  }

  function computeFeeRate(ppm) {
    // based on Alex B: route ppm includes base fee and is randomized.
    // ensure that there is enough of a delta to skip the route for
    // --avoid "FEE_RATE>". is 95% of node's ppm sufficient? e.g.
    // for 250 ppm, "FEE_RATE>238", with 12 sats threshold.
    return Math.min(ppm_per_hop, Math.round(ppm * .95));
  }

  function skipHop(a, b) {
    if (!skippedHops[a]) skippedHops[a] = [];
    skippedHops[a].push(b);
  }

  function isSkippedHop(a, b) {
    return skippedHops[a] && skippedHops[a].includes(b);
  }
}

function numberWithCommas(x) {
  return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, ",");
}

function nodeToString(n) {
  let c = {
    name: n.name,
    id: n.id,
    max_ppm: Math.max.apply(Math, n.ppms),
    avg_ppm: Math.round(arrAvg(n.ppms)),
    ppms: n.ppms.join(',')
  }
  return stringify(c);
}
