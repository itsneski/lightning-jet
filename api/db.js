var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('lnd_optimize.db');

const DB_FILE = 'lnd_optimize.db';
const REBALANCE_HISTORY_TABLE = 'rebalance_history';
const FAILED_HTLC_TABLE = 'failed_htlc';

// create tables
createRebalanceHistoryTable();
createFailedHtlcTable();

module.exports = {
  recordHtlc(htlc) {
    let db = getHandle();
    db.serialize(function() {
      let values = constructInsertString([
        Math.round(parseInt(htlc.timestamp_ns)/Math.pow(10, 6)),
        htlc.incoming_channel_id,
        htlc.outgoing_channel_id,
        Math.round(htlc.link_fail_event.info.incoming_amt_msat / 1000),
        JSON.stringify(htlc)
      ]);
      let cmd = 'INSERT INTO ' + FAILED_HTLC_TABLE + ' VALUES (' + values + ')';
      executeDb(cmd);
      closeHandle(db);
    })
    closeHandle(db);
  },
  recordRebalance(from, to, amount, rebalanced) {
    let db = getHandle();
    db.serialize(function() {
      let values = constructInsertString([Date.now(), from, to, amount, rebalanced, 1]);
      let cmd = 'INSERT INTO ' + REBALANCE_HISTORY_TABLE + '(date, from_node, to_node, amount, rebalanced, status) VALUES (' + values + ')';
      executeDb(cmd);
    })
    closeHandle(db);
  },
  recordRebalanceFailure(from, to, amount, error) {
    let db = getHandle();
    db.serialize(function() {
      let values = constructInsertString([Date.now(), from, to, amount, 0, error]);
      let cmd = 'INSERT INTO ' + REBALANCE_HISTORY_TABLE + '(date, from_node, to_node, amount, status, extra) VALUES (' + values + ')';
      executeDb(cmd);
    })
    closeHandle(db);
  },
  listRebalancesSync(secs = -1) {
    let list;
    module.exports.listRebalances(function(res) {
      list = res;
    }, secs)
    while(list === undefined) {
      require('deasync').runLoopOnce();
    }
    return list;
  },
  listRebalances(cb, secs = -1) {
    let db = getHandle();
    db.serialize(function() {
      let list = [];
      let q = 'SELECT rowid AS id, * FROM ' + REBALANCE_HISTORY_TABLE;
      if (secs > 0) {
        let epoch = Date.now();
        q += ' WHERE date > ' + (epoch - secs * 1000);
      }
      db.each(q, function(err, row) {
        list.push({
          row: row.id,
          date: row.date,
          from: row.from_node,
          to: row.to_node,
          amount: row.amount,
          rebalanced: row.rebalanced,
          status: row.status,
          extra: row.extra
        })
      }, function(err) {
        return cb(list);
      })
    })
    closeHandle(db);
  }
}

function getHandle() {
  return new sqlite3.Database(DB_FILE)
}

function closeHandle(handle) {
  handle.close();
}

function executeDb(cmd) {
  console.log(cmd);
  db.run(cmd);
}

function constructInsertString(arr) {
  return "'" + arr.join("', '") + "'";
}

function createFailedHtlcTable() {
  db.run("CREATE TABLE IF NOT EXISTS " + FAILED_HTLC_TABLE + " (date INTEGER NOT NULL, from_chan TEXT NOT NULL, to_chan TEXT NOT NULL, sats INTEGER NOT NULL, extra TEXT DEFAULT NULL)");
}

function createRebalanceHistoryTable() {
  db.run("CREATE TABLE IF NOT EXISTS " + REBALANCE_HISTORY_TABLE + " (date INTEGER NOT NULL, from_node TEXT NOT NULL, to_node TEXT NOT NULL, amount INTEGER NOT NULL, rebalanced INTEGER DEFAULT 0, status INTEGER, extra TEXT DEFAULT NULL)");
}
