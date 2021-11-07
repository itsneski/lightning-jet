// https://www.npmjs.com/package/sqlite3

const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const constants = require('../api/constants');

const dbFile = __dirname + '/jet.db';
const oldDbFile = __dirname + '/../lnd_optimize.db';
const testDbFile = '/tmp/jet_test.db';  

const REBALANCE_HISTORY_TABLE = 'rebalance_history';
const FAILED_HTLC_TABLE = 'failed_htlc';
const REBALANCE_AVOID_TABLE = 'rebalance_avoid';
const NAMEVAL_TABLE = 'nameval';
const TELEGRAM_MESSAGES_TABLE = 'telegram_messages';

var testMode = false;

// rename db file based on the latest update
if (!fs.existsSync(dbFile) && fs.existsSync(oldDbFile)) {
  fs.renameSync(oldDbFile, dbFile);
}

// create tables
createTables();

const uniqueArr = arr => arr.filter(function(elem, pos) {
  return arr.indexOf(elem) == pos;
})

module.exports = {
  deleteTelegramMessages(ids) {
    let db = getHandle();
    try {
      // now delete those message from the db
      db.serialize(function() {
        let cmd = 'DELETE FROM ' + TELEGRAM_MESSAGES_TABLE + ' WHERE rowid IN (' + ids.join(',') + ')';
        executeDb(db, cmd);
      })
    } catch(error) {
      console.error('deleteTelegramMessages:', error.message);
    } finally {
      closeHandle(db);
    }
  },
  fetchTelegramMessageSync() {
    let db = getHandle();
    try {
      let done;
      let messages = [];
      db.serialize(function() {
        let q = 'SELECT rowid, * FROM ' + TELEGRAM_MESSAGES_TABLE;
        db.each(q, function(err, row) {
          messages.push({id:row.rowid, message:row.message});
        }, function(error) {
          if (error) throw new Error(error.message);
          done = true;
        })
      })
      while(done === undefined) {
        require('deasync').runLoopOnce();
      }
      return messages;
    } catch(error) {
      console.error('fetchTelegramMessageSync:', error.message);
    } finally {
      closeHandle(db);
    }
  },
  recordTelegramMessageSync(msg) {
    let db = getHandle();
    try {
      db.serialize(function() {
        let values = constructInsertString([Date.now(), msg]);
        let cmd = 'INSERT INTO ' + TELEGRAM_MESSAGES_TABLE + ' VALUES (' + values + ')';
        executeDbSync(db, cmd);
      })
    } catch(error) {
      console.error('recordTelegramMessage:', error.message);
    } finally {
      closeHandle(db);
    }
  },
  getPropSync(name) {
    let data = module.exports.getPropAndDateSync(name);
    return data && data.val;
  },
  getPropAndDateSync(name) {
    let db = getHandle();
    let done;
    let data;
    try {
      db.serialize(function() {
        let q = 'SELECT date, val FROM ' + NAMEVAL_TABLE + ' WHERE name="' + name + '"';
        db.each(q, function(err, row) {
          data = row;
        }, function(error) {
          if (error) throw new Error(error.message);
          done = true;
        })
      })
      while(done === undefined) {
        require('deasync').runLoopOnce();
      }
      return data;
    } catch(error) {
      console.error('setProp:', error.message);
    } finally {
      closeHandle(db);
    }
  },
  setPropSync(name, val) {
    let db = getHandle();
    try {
      db.serialize(function() {
        let values = constructInsertString([Date.now(), name, val]);
        let cmd = 'INSERT OR IGNORE INTO ' + NAMEVAL_TABLE + ' VALUES (' + values + ')';
        executeDbSync(db, cmd);
        cmd = 'UPDATE ' + NAMEVAL_TABLE + ' SET date="' + Date.now() + '", val="' + val + '" WHERE name="' + name + '"';
        executeDbSync(db, cmd);
      })
    } catch(error) {
      console.error('setProp:', error.message);
    } finally {
      closeHandle(db);
    }
  },
  listRebalanceAvoidSync(from, to, maxPpm, mins = 60) {
    if (!from || !to || !maxPpm) throw new Error('from, to, and maxPpm are mandatory');
    let db = getHandle();
    let avoid;
    db.serialize(function() {
      let q = 'SELECT * FROM ' + REBALANCE_AVOID_TABLE;
      q += ' WHERE from_node="' + from + '" AND to_node="' + to + '" AND max_ppm=' + maxPpm;
      q += ' AND date > ' + (Date.now() - mins * 60 * 1000);
      let list = [];
      db.each(q, function(err, row) {
        list.push(row);
      }, function(err) {
        avoid = list;
      })
    })
    while(avoid === undefined) {
      require('deasync').runLoopOnce();
    }
    closeHandle(db);
    let list = [];
    avoid.forEach(a => list.push(a.avoid));
    return uniqueArr(list);
  },
  recordRebalanceAvoid(from, to, maxPpm, avoid) {
    if (!from || !to || !maxPpm || !avoid) throw new Error('from, to, maxPpm, and avoid are mandatory');

    if (doIt()) {
      // retry in case of an error
      console.log('recordRebalanceAvoid: retrying due to an error');
      doIt();
    }

    function doIt() {
      let err;
      let db = getHandle();
      try {
        db.serialize(function() {
          let values = constructInsertString([Date.now(), from, to, maxPpm, avoid]);
          let cmd = 'INSERT INTO ' + REBALANCE_AVOID_TABLE + ' VALUES (' + values + ')';
          executeDb(db, cmd);
        })
      } catch(error) {
        err = error;
        console.error('recordRebalanceAvoid:', error);
      } finally {
        closeHandle(db);
      }
      return err;
    }
  },
  listHtlcsSync(days = -1) {
    let db = getHandle();
    let htlcs;
    let list = [];
    db.serialize(function() {
      let q = 'SELECT * FROM ' + FAILED_HTLC_TABLE;
      if (days > 0) {
        q += ' WHERE date > ' + (Date.now() - Math.round(days * 24 * 60 * 60 * 1000));
      }
      db.each(q, function(err, row) {
        list.push(row);
      }, function(err) {
        htlcs = list;
      })
    })
    while(htlcs === undefined) {
      require('deasync').runLoopOnce();
    }
    closeHandle(db);
    return htlcs;
  },
  recordHtlc(htlc) {
    if (doIt()) {
      // retry in case of an error
      console.log('recordHtlc: retrying due to an error');
      doIt();
    }

    function doIt() {
      let err;
      let db = getHandle();
      try {
        db.serialize(function() {
          let values = constructInsertString([
            Math.round(parseInt(htlc.timestamp_ns)/Math.pow(10, 6)),
            htlc.incoming_channel_id,
            htlc.outgoing_channel_id,
            Math.round(htlc.link_fail_event.info.incoming_amt_msat / 1000),
            JSON.stringify(htlc)
          ]);
          let cmd = 'INSERT INTO ' + FAILED_HTLC_TABLE + ' VALUES (' + values + ')';
          executeDb(db, cmd);
        })
      } catch(error) {
        err = error;
        console.error('recordHtlc:', error);
      } finally {
        closeHandle(db);          
      }
      return err;
    }
  },
  recordRebalance(from, to, amount, rebalanced) {
    if (doIt()) {
      // retry in case of an error
      console.log('recordRebalance: retrying due to an error');
      doIt();
    }

    function doIt() {
      let err;
      let db = getHandle();
      try {
        db.serialize(function() {
          let values = constructInsertString([Date.now(), from, to, amount, rebalanced, 1]);
          let cmd = 'INSERT INTO ' + REBALANCE_HISTORY_TABLE + '(date, from_node, to_node, amount, rebalanced, status) VALUES (' + values + ')';
          executeDb(db, cmd);
        })
      } catch(error) {
        err = error;
        console.error('recordRebalance:', error);
      } finally {
        closeHandle(db);
      }
      return err;
    }
  },
  recordRebalanceFailure(from, to, amount, errorMsg) {
    if (doIt()) {
      // retry in case of an error
      console.log('recordRebalanceFailure: retrying due to an error');
      doIt();
    }

    function doIt() {
      let err;
      let db = getHandle();
      try {
        db.serialize(function() {
          let values = constructInsertString([Date.now(), from, to, amount, 0, errorMsg]);
          let cmd = 'INSERT INTO ' + REBALANCE_HISTORY_TABLE + '(date, from_node, to_node, amount, status, extra) VALUES (' + values + ')';
          executeDb(db, cmd);
        })
      } catch(error) {
        err = error;
        console.error('recordRebalanceFailure:', error);
      } finally {
        closeHandle(db);
      }
      return err;
    }
  },
  listRebalancesSync(secs = -1) {
    let db = getHandle();
    let list = [];
    let res;
    db.serialize(function() {
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
        res = list;
      })
    })
    while(res === undefined) {
      require('deasync').runLoopOnce();
    }
    closeHandle(db);
    return res;
  },
  enableTestMode() {
    console.log('test mode enabled');
    testMode = true;
    createTables(); // for test mode
  }
}

function getHandle() {
  if (testMode) return new sqlite3.Database(testDbFile); 
  return new sqlite3.Database(dbFile);
}

function closeHandle(handle) {
  handle.close();
}

function executeDb(db, cmd) {
  if (testMode) console.log(cmd);
  db.run(cmd);
}

function executeDbSync(db, cmd) {
  if (testMode) console.log(cmd);
  let finished;
  db.run(cmd, function() { finished = true; })
  while(!finished) {
    require('deasync').runLoopOnce();
  }
}

function constructInsertString(arr) {
  return "'" + arr.join("', '") + "'";
}

function createTables() {
  let db = getHandle();
  db.serialize(() => {
    createRebalanceHistoryTable(db);
    createFailedHtlcTable(db);
    createRebalanceAvoidTable(db);
    createNamevalTable(db);
    createTelegramMessagesTable(db);
  })
  closeHandle(db);
}


function createTelegramMessagesTable(db) {
  executeDbSync(db, "CREATE TABLE IF NOT EXISTS " + TELEGRAM_MESSAGES_TABLE + " (date INTEGER NOT NULL, message TEXT NOT NULL)");
}

function createNamevalTable(db) {
  executeDbSync(db, "CREATE TABLE IF NOT EXISTS " + NAMEVAL_TABLE + " (date INTEGER NOT NULL, name TEXT NOT NULL UNIQUE, val TEXT)");
}

function createFailedHtlcTable(db) {
  executeDbSync(db, "CREATE TABLE IF NOT EXISTS " + FAILED_HTLC_TABLE + " (date INTEGER NOT NULL, from_chan TEXT NOT NULL, to_chan TEXT NOT NULL, sats INTEGER NOT NULL, extra TEXT DEFAULT NULL)");
}

function createRebalanceHistoryTable(db) {
  executeDbSync(db, "CREATE TABLE IF NOT EXISTS " + REBALANCE_HISTORY_TABLE + " (date INTEGER NOT NULL, from_node TEXT NOT NULL, to_node TEXT NOT NULL, amount INTEGER NOT NULL, rebalanced INTEGER DEFAULT 0, status INTEGER, extra TEXT DEFAULT NULL)");
}

function createRebalanceAvoidTable(db) {
  executeDbSync(db, "CREATE TABLE IF NOT EXISTS " + REBALANCE_AVOID_TABLE + " (date INTEGER NOT NULL, from_node TEXT NOT NULL, to_node TEXT NOT NULL, max_ppm INTEGER NOT NULL, avoid TEXT NOT NULL)");
}
