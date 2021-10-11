// lnd rebalance is built on top of https://github.com/alexbosworth/balanceofsatoshis
// tool.
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
const lndClient = require('./connect');
const tags = require('./tags');
const {getNodesInfoSync} = require('../lnd-api/utils');

const arrAvg = arr => arr.reduce((a,b) => a + b, 0) / arr.length;
const stringify = obj => JSON.stringify(obj, null, 2);

// check bos version compatibility
const MIN_VERSION = '10.16.0';  // min bos version required
try {
  let ver = require('child_process').execSync('bos --version').toString().trim();
  if (config.debugMode) console.log('identified bos version:', ver);
  if (ver < MIN_VERSION) {  // string based compare works?
    throw new Error('incompatible bos version, minimum required: ' + MIN_VERSION);
  }
} catch(error) {
  throw new Error('error checking bos version: ' + error.toString());
}

// keep track of nodes to report stats
const REPS = 2;
const PPM_PET_HOP = 350;
const MIN_PPMS_TRIES = 4; // min ppm occurances before attempting to exclude a node.
                          // the greater the number, the more chances nodes get
                          // to prove they are not expensive before being excluded

module.exports = ({from, to, amount, ppm = config.max_ppm || 750, avoidArr = config.avoid || []}) => {
  if (!from || !to || !amount) {
    throw new Error('from, to and amount are mandatory arguments');
  }

  const OUT = from;
  const IN = to;
  const AMOUNT = amount;

  // test arguments against parsed tags
  if (OUT.length < 60 && !tags[OUT]) {
    throw new Error('tag ' + OUT + ' does not exist');
  }
  if (IN.length < 60 && !tags[IN]) {
    throw new ('tag ' + IN + ' does not exist');
  }

  var ppm_per_hop = Math.min(PPM_PET_HOP, Math.round(.75 * ppm));
  var avoidNodes = {};

  var nodeStats = {};
  var routes = [];
  var lastMessage;
  var amountRebalanced = 0;
  var feesSpent = 0;
  var skippedHops = {};

  // construct avoid string
  var avoid = "";
  var nodeInfo = {};
  if (avoidArr) {
    avoidArr.forEach(n => {
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

  console.log('\n----------------------------------------')
  console.log('from:', OUT + ', ' + tags[OUT]);
  console.log('to:', IN + ', ' + tags[IN]);
  console.log('amount:', numberWithCommas(AMOUNT));
  console.log('max ppm:', ppm);
  console.log('ppm per hop:', ppm_per_hop);
  console.log('repetitions:', REPS);
  if (config.debugMode) console.log('debug mode: enabled');
  console.log('----------------------------------------\n')

  // run the loop for bos rebalance
  for (let rep = 0; rep < REPS; ) {
    let command = "bos rebalance --no-color --out " + OUT + " --in " + IN + " --amount " + (AMOUNT - amountRebalanced) + " --max-fee-rate " + ppm + avoid;
    console.log('\n-------------------------------------------');
    console.log('* rebalancing from', OUT, 'to', IN);
    if (amountRebalanced > 0) console.log('* targeted amount:', numberWithCommas(AMOUNT));
    console.log('* remaining amount:', numberWithCommas(AMOUNT - amountRebalanced));
    console.log('* running iteration:', rep + 1 + '/' + REPS)
    console.log('* command:', command);

    let stderr;
    let stdout;
    try {
      stdout = require('child_process').execSync(command).toString();
    } catch (error) {
      stdout = error.stdout.toString();
      stderr = error.stderr.toString();
    }

    if (stderr && config.debugMode) console.log('stderr: ', stderr);
    if (stdout && config.debugMode) console.log('stdout: ', stdout);

    // process output, collect stats
    stdout.split(/\r?\n/).forEach(line => {
      let node = parseNode(line);
      if (node) {
        //console.log('parsed node: ', stringify(node));

        // collect stats
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

        if (node.ppm > ppm_per_hop) {
          console.log('found a node that exceeds ppm_per_hop:', stringify(node));
        }
      }
    })

    if (stderr) {
      let rebalanceFeeTooHigh = stderr.indexOf('RebalanceTotalFeeTooHigh') >= 0 || stderr.indexOf('RebalanceFeeRateTooHigh') >= 0;
      let failedToFindPath = stderr.indexOf('FailedToFindPathBetweenPeers') >= 0;
      let lowRebalanceAmount = stderr.indexOf('LowRebalanceAmount') >= 0;
      let failedToFindPeer = stderr.indexOf('FailedToFindPeerAliasMatch') >= 0;
      let noSufficientBalance = stderr.indexOf('NoOutboundPeerWithSufficientBalance') >= 0;

      if (rebalanceFeeTooHigh) {
        // find nodes that exceed the per hop ppm in the last
        // segment of the output
        console.log('\n-------------------------------------------');
        console.log('found a prospective route, but the fee is too high');
        //console.log('evaluating output:', stdout);
        let index = stdout.lastIndexOf('evaluating:');
        if (index >= 0) {
          let nodes = parseNodes(stdout.substring(index));
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
            console.log('the route has a cumulative fee of', ppmsum, 'vs', ppm, 'targeted');
            if (max) {
              console.log('identified a node to unblock the route:', stringify(max));
              if (max.ppm > ppm_per_hop) {
                let entry = nodeStats[max.id];
                console.log('identified corresponding nodeStats entry:', nodeToString(entry));
                // see if the node is a repeat offender
                // basically give the node a few chances to show that it's
                // not an expensive node before excluding it
                if (entry.ppms.length >= MIN_PPMS_TRIES && arrAvg(entry.ppms) > ppm_per_hop) {
                  console.log('the node was part of', entry.ppms.length, 'routes with an average ppm of', Math.round(arrAvg(entry.ppms)));
                  console.log('excluding node:', max.id);
                  avoidNodes[max.id] = true;
                  avoid += ' --avoid ' + max.id;
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
        lastMessage = 'low rebalance amount';
        console.log('\n-------------------------------------------');
        console.log(lastMessage + ', exiting');
        rep = REPS; // force to exit the loop
      } else if (failedToFindPeer) {
        lastMessage = 'failed to find peer'
        console.log(lastMessage + ', exiting');
        rep = REPS; // force to exit the loop
      } else if (noSufficientBalance) {
        lastMessage = 'insufficient local balance';
        console.log(lastMessage + ', exiting');
        rep = REPS;
      } else {
        lastMessage = 'unidentified error';
        console.log('\n-------------------------------------------');
        console.log(lastMessage + ', retrying');
        console.log('stdout:', stdout);
        rep++;
      }
    } else {  // !stderr
      console.log('\n-------------------------------------------');
      lastMessage = 'successful rebalance';
      // determine amount rebalanced
      let amount = parseAmountRebalanced(stdout);
      let fees = parseFeesSpent(stdout);
      if (amount > 0) {
        console.log('* amount rebalanced:', numberWithCommas(amount));
        amountRebalanced += amount;
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

      // remember the route
      let index = stdout.lastIndexOf('evaluating:');
      if (index >= 0) {
        let nodes = parseNodes(stdout.substring(index));
        if (nodes) {
          console.log('* nodes:', stringify(nodes));
          nodes.unshift({
            amount: amount || 0,
            fees: fees || 0
          })
          routes.push(nodes);
        } else {
          lastMessage = 'failed to parse nodes after successful rebalance';
          console.log(lastMessage);
        }
      } else {
        lastMessage = 'failed to parse route after successful rebalance';
        console.log(lastMessage);
      }

      if (config.debugMode) console.log('output:', stdout);
    } // if stderr

    // helper function
    function canAvoidNode(id) {
      return !avoidNodes[id] && id !== OUT && id !== IN && id !== tags[OUT] && id !== tags[IN];
    }
  } // for

  printStats(lndClient, nodeStats, nodeInfo);

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

function parseNodes(str) {
  let nodes = [];
  str.split(/\r?\n/).forEach(line => {
    let n = parseNode(line);
    if (n) nodes.push(n);
  })
  return (nodes.length > 0) ? nodes : undefined;
}

function parseNode(str) {
  let node;
  let index = str.indexOf(". Fee rate");
  if (index >= 0) {
    node = {};
    let part1 = str.substring(0, index).split(/(\s+)/).filter( e => e.trim().length > 0);
    let part2 = str.substring(index + 1);
    // get node id
    node.id = part1[part1.length-1];
    // determine name
    let name = normalizeString(str.substring(0, index));
    if (name.indexOf('-') === 0) name = name.substring(name.indexOf('-') + 1, name.indexOf(node.id)).trim();
    node.name = name;
    // get ppm
    node.ppm = parseInt(part2.substring(part2.indexOf('(') + 1, part2.indexOf(')')));
  }
  return node;
}

function normalizeString(str) {
  // take care of funkiness of bos output
  let index = str.indexOf('[39m');
  if (index >= 0) str = str.substring(index + 4);
  return str.trim();
}

function parseAmountRebalanced(str) {
  let amount = 0;
  let index1 = str.indexOf('rebalanced:');
  let index2 = str.indexOf('rebalance_fees_spent:');
  if (index1 >= 0 && index2 >=0 ) {
    amount = str.substring(index1 + 11, index2).trim();
    amount = Math.round(amount * 100000000);  // convert to sats
  }
  return amount;
}

function parseFeesSpent(str) {
  let fees = 0;
  let index1 = str.indexOf('rebalance_fees_spent:');
  let index2 = str.indexOf('rebalance_fee_rate:');
  if (index1 >= 0 && index2 >=0 ) {
    fees = str.substring(index1 + 21, index2).trim();
    fees = Math.round(fees * 100000000);  // convert to sats
  }
  return fees;
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
