// https://www.npmjs.com/package/sqlite3

const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const constants = require('../api/constants');

const dbFile = global.testDb || (__dirname + '/jet.db');
const oldDbFile = __dirname + '/../lnd_optimize.db';
const testDbFile = '/tmp/jet_test.db';  

const REBALANCE_HISTORY_TABLE = 'rebalance_history';
const FAILED_HTLC_TABLE = 'failed_htlc';
const REBALANCE_AVOID_TABLE = 'rebalance_avoid';
const NAMEVAL_TABLE = 'nameval';
const NAMEVAL_LIST_TABLE = 'nameval_list';
const TELEGRAM_MESSAGES_TABLE = 'telegram_messages';
const FEE_HISTORY_TABLE = 'fee_history';
const ACTIVE_REBALANCE_TABLE = 'active_rebalance';
const CHANNEL_EVENTS_TABLE = 'channel_events';

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
  listChannelEvents() {
    let db = getHandle();
    let done;
    let list = [];
    db.serialize(function() {
      let q = 'SELECT rowid, * FROM ' + CHANNEL_EVENTS_TABLE + ' ORDER BY date DESC';
      if (testMode) console.log(q);
      db.each(q, function(err, row) {
        list.push(row);
      }, (err) => {
        done = true;
      })
    })
    while(!done) {
      require('deasync').runLoopOnce();
    }
    closeHandle(db);
    return list;
  },
  recordChannelEvent(type, txid, index) {
    let db = getHandle();
    try {
      db.serialize(function() {
        const vals = constructInsertString([Date.now(), type, txid, index]);
        const cols = '(date, type, txid, ind)';
        let cmd = 'INSERT INTO ' + CHANNEL_EVENTS_TABLE + ' ' + cols + ' VALUES (' + vals + ')';
        executeDb(db, cmd);
      })
    } catch(error) {
      console.error('recordChannelEvent:', error.message);
    } finally {
      closeHandle(db);
    }
  },
  deleteActiveRebalance(rowid) {
    let db = getHandle();
    try {
      db.serialize(function() {
        let cmd = 'DELETE FROM ' + ACTIVE_REBALANCE_TABLE + ' WHERE rowid = ' + rowid;
        executeDb(db, cmd);
      })
    } catch(error) {
      console.error('deleteActiveRebalance:', error.message);
    } finally {
      closeHandle(db);
    }
  },
  listActiveRebalancesSync() {
    let db = getHandle();
    let done;
    let list = [];
    db.serialize(function() {
      let q = 'SELECT rowid, * FROM ' + ACTIVE_REBALANCE_TABLE;
      if (testMode) console.log(q);
      db.each(q, function(err, row) {
        list.push(row);
      }, function(err) {
        done = true;
      })
    })
    while(!done) {
      require('deasync').runLoopOnce();
    }
    closeHandle(db);
    return list;
  },
  // pid is optional, used for testing
  recordActiveRebalanceSync({from, to, amount, ppm, mins}, pid) {
    let db = getHandle();
    let rowid;
    try {
      const proc = pid || require('process').pid;
      db.serialize(() => {
        const vals = constructInsertString([Date.now(), from, to, amount, ppm, mins, proc]);
        const cols = '(date, from_node, to_node, amount, ppm, mins, pid)';
        let cmd = 'INSERT INTO ' + ACTIVE_REBALANCE_TABLE + ' ' + cols + ' VALUES (' + vals + ')';
        rowid = execInsertDbSync(db, cmd); // rowid
      })
    } catch(error) {
      console.error('recordActiveRebalanceSync:', error.message);
    } finally {
      closeHandle(db);
    }
    return rowid;
  },
  getValByFilterSync(filter) {
    let db = getHandle();
    let done;
    let data = [];
    try {
      db.serialize(function() {
        let q = 'SELECT date, val FROM ' + NAMEVAL_LIST_TABLE + ' WHERE name like "' + filter + '"';
        db.each(q, function(err, row) {
          data.push(row);
        }, function(error) {
          if (error) throw new Error(error.message);
          done = true;
        })
      })
      while(done === undefined) {
        require('deasync').runLoopOnce();
      }
      return data.length > 0 ? data : undefined;
    } catch(error) {
      console.error('getValByFilterSync:', error.message);
    } finally {
      closeHandle(db);
    }
  },
  getValSync(name) {
    let db = getHandle();
    let done;
    let data = [];
    try {
      db.serialize(function() {
        let q = 'SELECT date, val FROM ' + NAMEVAL_LIST_TABLE + ' WHERE name="' + name + '"';
        db.each(q, function(err, row) {
          data.push(row);
        }, function(error) {
          if (error) throw new Error(error.message);
          done = true;
        })
      })
      while(done === undefined) {
        require('deasync').runLoopOnce();
      }
      return data.length > 0 ? data : undefined;
    } catch(error) {
      console.error('getValSync:', error.message);
    } finally {
      closeHandle(db);
    }
  },
  recordValSync(name, val) {
    let db = getHandle();
    try {
      db.serialize(function() {
        let values = constructInsertString([Date.now(), name, val]);
        let cmd = 'INSERT INTO ' + NAMEVAL_LIST_TABLE + ' VALUES (' + values + ')';
        executeDbSync(db, cmd);
      })
    } catch(error) {
      console.error('addValSync:', error.message);
    } finally {
      closeHandle(db);
    }
  },
  feeHistorySync({node, mins = 60}) {
    let db = getHandle();
    let done;
    let list = [];
    db.serialize(function() {
      let q = 'SELECT * FROM ' + FEE_HISTORY_TABLE;
      q += ' WHERE date > ' + (Date.now() - mins * 60 * 1000);
      if (node) q += ' AND node="' + node + '"';
      q += ' ORDER BY date ASC';
      if (testMode) console.log(q);
      db.each(q, function(err, row) {
        list.push(row);
      }, function(err) {
        done = true;
      })
    })
    while(!done) {
      require('deasync').runLoopOnce();
    }
    closeHandle(db);
    return list;
  },
  recordFee({node, chan, base, ppm}) {
    if (!node) throw new Error('node is missing');
    if (!chan) throw new Error('chan is missing');
    if (!base && !ppm) throw new Error('base or ppm needs to be specified');

    if (doIt()) {
      // retry in case of an error
      console.log('recordFee: retrying due to an error');
      doIt();
    }

    function doIt() {
      let err;
      let db = getHandle();
      try {
        db.serialize(function() {
          let cols = '(date,node,chan';
          let vals = Date.now() + ',"' + node + '","' + chan + '"';
          if (base) {
            cols += ',base';
            vals += ',' + base;
          }
          if (ppm) {
            cols += ',ppm';
            vals += ',' + ppm;
          }
          cols += ')';
          let cmd = 'INSERT INTO ' + FEE_HISTORY_TABLE + ' ' + cols + ' VALUES (' + vals + ')';
          executeDbSync(db, cmd);
        })
      } catch(error) {
        err = error;
        console.error('recordFee:', error);
      } finally {
        closeHandle(db);
      }
      return err;
    }
  },
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
        let q = 'SELECT rowid, * FROM ' + TELEGRAM_MESSAGES_TABLE + ' ORDER BY date ASC';
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
  deleteProp(name) {
    if (!name) throw new Error('name is missing');
    let db = getHandle();
    try {
      db.serialize(function() {
        let cmd = 'DELETE FROM ' + NAMEVAL_TABLE + ' WHERE name = "' + name + '"';
        executeDb(db, cmd);
      })
    } catch(error) {
      console.error('deleteProp:', error.message);
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
      console.error('getPropAndDateSync:', error.message);
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
      console.error('setPropSync:', error.message);
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
  listHtlcsSync({fromChan, toChan, days}) {
    let db = getHandle();
    let htlcs;
    let list = [];
    db.serialize(function() {
      let init;
      let q = 'SELECT * FROM ' + FAILED_HTLC_TABLE;
      if (fromChan) {
        if (init) q += ' AND'
        else { q += ' WHERE'; init = true; }
        q += ' from_chan = ' + fromChan;
        init = true;
      }
      if (toChan) {
        if (init) q += ' AND'
        else { q += ' WHERE'; init = true; }
        q += ' to_chan = ' + toChan;
      }
      if (days) {
        if (init) q += ' AND'
        else { q += ' WHERE'; init = true; }
        q += ' date > ' + (Date.now() - Math.round(days * 24 * 60 * 60 * 1000));
      }
      if (testMode) console.log(q);
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
  recordHtlc(htlc, sync) {
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
          if (sync) executeDbSync(db, cmd); else executeDb(db, cmd);
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
  recordRebalance(startDate, from, to, amount, rebalanced, ppm) {
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
          let values = constructInsertString([Date.now(), startDate, from, to, amount, rebalanced, ppm, 1]);
          let cmd = 'INSERT INTO ' + REBALANCE_HISTORY_TABLE + '(date, start_date, from_node, to_node, amount, rebalanced, ppm, status) VALUES (' + values + ')';
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
  recordRebalanceFailure(startDate, from, to, amount, errorMsg, ppm, min) {
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
          let props = [Date.now(), startDate, from, to, amount, 0, errorMsg, ppm];
          let names = 'date, start_date, from_node, to_node, amount, status, extra, ppm';
          if (min > 0) {
            props.push(min);
            names += ', min';
          }
          let values = constructInsertString(props);
          let cmd = 'INSERT INTO ' + REBALANCE_HISTORY_TABLE + '(' + names + ') VALUES (' + values + ')';
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
  listRebalancesSync(secs = -1, status, node) {
    let db = getHandle();
    let list = [];
    let res;
    db.serialize(function() {
      let q = 'SELECT rowid AS id, * FROM ' + REBALANCE_HISTORY_TABLE;
      let first;
      if (secs > 0) {
        if (first) q += ' AND'; else { q += ' WHERE'; first = true; };
        q += ' date > ' + (Date.now() - secs * 1000);
      }
      if (status !== undefined) {
        if (first) q += ' AND'; else { q += ' WHERE'; first = true; }
        q += ' status = ' + status;
      }
      if (node) {
        if (first) q += ' AND'; else { q += ' WHERE'; first = true; }
        q += ' (from_node = "' + node + '" OR to_node = "' + node + '")';
      }
      db.each(q, function(err, row) {
        list.push({
          row: row.id,
          date: row.date,
          start: row.start_date,
          from: row.from_node,
          to: row.to_node,
          amount: row.amount,
          rebalanced: row.rebalanced,
          ppm: row.ppm,
          min: row.min,
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

function execInsertDbSync(db, cmd) {
  if (testMode) console.log(cmd);
  let finished;
  let rowid;
  db.run(cmd, function() { rowid = this.lastID; finished = true; })
  while(!finished) {
    require('deasync').runLoopOnce();
  }
  return rowid;
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
    createNamevalListTable(db);
    createTelegramMessagesTable(db);
    createFeeHistoryTable(db);
    createActiveRebalanceTable(db);
    createChannelEventsTable(db);
  })
  closeHandle(db);
}

function createChannelEventsTable(db) {
  executeDbSync(db, "CREATE TABLE IF NOT EXISTS " + CHANNEL_EVENTS_TABLE + " (date INTEGER NOT NULL, type TEXT NOT NULL, txid TEXT NOT NULL, ind INTEGER NOT NULL, extra TEXT)");
}

function createActiveRebalanceTable(db) {
  executeDbSync(db, "CREATE TABLE IF NOT EXISTS " + ACTIVE_REBALANCE_TABLE + " (date INTEGER NOT NULL, from_node TEXT NOT NULL, to_node TEXT NOT NULL, amount INTEGER NOT NULL, ppm INTEGER, mins INTEGER, pid INTEGER NOT NULL, extra TEXT)");
}

function createFeeHistoryTable(db) {
  executeDbSync(db, "CREATE TABLE IF NOT EXISTS " + FEE_HISTORY_TABLE + " (date INTEGER NOT NULL, node TEXT NOT NULL, chan TEXT NOT NULL, base INTEGER, ppm INTEGER)");
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
  executeDbSync(db, "CREATE TABLE IF NOT EXISTS " + REBALANCE_HISTORY_TABLE + " (date INTEGER NOT NULL, from_node TEXT NOT NULL, to_node TEXT NOT NULL, amount INTEGER NOT NULL, rebalanced INTEGER DEFAULT 0, ppm INTEGER, min INTEGER, status INTEGER, extra TEXT DEFAULT NULL)");
  // add a column, it'll error out if the column already exists
  executeDbSync(db, "ALTER TABLE " + REBALANCE_HISTORY_TABLE + " ADD COLUMN ppm INTEGER");
  executeDbSync(db, "ALTER TABLE " + REBALANCE_HISTORY_TABLE + " ADD COLUMN min INTEGER");
  executeDbSync(db, "ALTER TABLE " + REBALANCE_HISTORY_TABLE + " ADD COLUMN start_date INTEGER");
}

function createNamevalListTable(db) {
  executeDbSync(db, "CREATE TABLE IF NOT EXISTS " + NAMEVAL_LIST_TABLE + " (date INTEGER NOT NULL, name TEXT NOT NULL, val TEXT)");
}

function createRebalanceAvoidTable(db) {
  executeDbSync(db, "CREATE TABLE IF NOT EXISTS " + REBALANCE_AVOID_TABLE + " (date INTEGER NOT NULL, from_node TEXT NOT NULL, to_node TEXT NOT NULL, max_ppm INTEGER NOT NULL, avoid TEXT NOT NULL)");
}
