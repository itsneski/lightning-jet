// https://www.npmjs.com/package/node-telegram-bot-api

const config = require('../api/config');
const constants = require('../api/constants');
const TelegramBot = require('node-telegram-bot-api');
const {getPropSync} = require('../db/utils');
const {getPropAndDateSync} = require('../db/utils');
const {setPropSync} = require('../db/utils');
const {recordFee} = require('../db/utils');
const {fetchTelegramMessageSync} = require('../db/utils');
const {deleteTelegramMessages} = require('../db/utils');
const lndClient = require('../api/connect');
const {listFeesSync} = require('../lnd-api/utils');
const {classifyPeersSync} = require('../api/utils');
const {analyzeFees} = require('../api/analyze-fees');
const serviceUtils = require('./utils');
const util = require('util');
const date = require('date-and-time');

const pollInterval = constants.services.telegram.pollInterval;
const feeInterval = constants.services.telegram.feeInterval;

const encode = s => Buffer.from(s).toString('base64');
const decode = s => Buffer.from(s, 'base64').toString();
const formatDate = d => date.format(new Date(d), 'MM/DD hh:mm A')

if (global.testModeOn) {
  // for testing
  module.exports.runMonitor = monitorFeesExec;
} else {
  initBot();
  monitorFees();
  setInterval(monitorFees, feeInterval * 1000);
}

function monitorFees() {
  try {
    monitorFeesExec();
  } catch(error) {
    console.error('monitorFees:', error.toString());
  }
}

// monitor fee updates
function monitorFeesExec() {
  serviceUtils.TelegramBot.recordHeartbeat('fees');
  let fees = listFeesSync(lndClient);
  let prev = getPropAndDateSync('fees');
  setPropSync('fees', encode(JSON.stringify(fees, null, 2)));
  if (!prev) return;

  let outboundMap = {};
  let classified = classifyPeersSync(lndClient);
  if (classified && classified.outbound) {
    classified.outbound.forEach(c => outboundMap[c.peer] = c.name);
  }
  if (classified && classified.balanced) {
    classified.balanced.forEach(c => outboundMap[c.peer] = c.name);
  }

  let prevFees = JSON.parse(decode(prev.val));
  console.log('\nidentified existing fees recorded on', formatDate(prev.date));
  let prevMap = {};
  prevFees.forEach(f => prevMap[f.chan] = f);
  let feeMap = {};
  fees.forEach(f => feeMap[f.chan] = f);
  fees.forEach(f => {
    let p = prevMap[f.chan];
    if (!p) return console.log('new channel', f.chan, 'with ', f.name);
    // compare the stats
    let newFee = {};
    if (f.remote.base != p.remote.base) {
      newFee.base = f.remote.base;
      let msg = util.format('channel %s with %s: base fee changed from %d to %d', f.chan, f.name, p.remote.base, f.remote.base);
      console.log(msg);
      // format for telegram
      msg = util.format('channel %s with <b>%s</b>: base fee changed from %d to %d', f.chan, f.name, p.remote.base, f.remote.base);
      sendMessageFormatted(msg);
    }
    if (f.remote.rate != p.remote.rate) {
      newFee.ppm = p.remote.rate;
      let msg = util.format('channel %s with %s: ppm fee changed from %d to %d', f.chan, f.name, p.remote.rate, f.remote.rate);
      console.log(msg);
      msg = util.format('channel %s with <b>%s</b>: ppm fee changed from %d to %d', f.chan, f.name, p.remote.rate, f.remote.rate);
      sendMessageFormatted(msg);
    }
    if (newFee.base || newFee.ppm) {
      // record in the db
      recordFee({node:f.id, chan:f.chan, base:newFee.base, ppm:newFee.ppm});
      // analyze fees
      if (outboundMap[p.id]) {
        let analysis = analyzeFees(p.name, p.id, p.local, f.remote);
        if (analysis) {
          const action = constants.feeAnalysis.action;
          let status = analysis[0];
          // format telegram msg
          let msg = util.format('channel %s with <b>%s</b>:', p.chan, p.name);
          if (status.action === action.pause) msg += ' rebalancing is paused';
          else msg += ' rebalancing is active';
          if (status.range || status.summary) {
            if (status.range) msg += ', suggested local ppm range: ' + status.range;
            if (status.summary) msg += ', ' + status.summary;
            console.log(msg);
            sendMessageFormatted(msg);
          } else {
            console.log(p.name + ': no range or summary found, skipping');
          }
        } else {
          console.log(p.name + ': analysis not generated, weird, skipping');
        }
      } else {
        console.log(p.name + ': is not outbound peer, skipping');
      }
    }
  })
  // see if any of the channels closed
  prevFees.forEach(f => {
    let p = feeMap[f.chan];
    if (!p) {
      let msg = util.format('channel %s with %s: could not find the fee, the channel was likely closed', f.chan, f.name);
      console.log(msg);
      msg = util.format('channel %s with <b>%s</b>: could not find the fee, the channel was likely closed', f.chan, f.name);
      sendMessageFormatted(msg);
    }
  })
}

if (global.bot) {
  setInterval(pollMessages, pollInterval * 1000);
}

// poll messages from the db
function pollMessages() {
  serviceUtils.TelegramBot.recordHeartbeat('poll');
  let list = fetchTelegramMessageSync();
  if (!list || list.length === 0) return;
  console.log('processing', list.length, 'messages');
  let chatId = getChatId();
  let ids = [];
  try {
    let count = 0;
    list.forEach(m => {
      console.log('processing message:', m);
      // make sure that messages are delivered sequentially
      // the best way i found so far to do it is by adding a small
      // interval between each message. just waiting for async promise
      // did not solve the above.
      setTimeout (() => { sendMessageImpl(m.message) }, count++ * 250);
      ids.push(m.id);
    })
  } catch(error) {
    console.error('pollMessages:', error.message);
  } finally {
    deleteTelegramMessages(ids);
  }

  function sendMessageImpl(m) {
    global.bot.sendMessage(chatId, m);
  }
}

function initBot() {
  if (global.bot) return;
  const token = config.telegramToken;
  if (!token) return console.error('could not find telegram token. check your config file');

  // initialize
  global.bot = new TelegramBot(token, { polling: true });

  // return help string
  global.bot.onText(/\/help/, (msg, match) => {  
    const chatId = msg.chat.id;
    setChatId(chatId);

    const help = 'Welcome to the Lightning Jet telegram bot.  The bot will notify you of important events relevant to your node.';

    // send back the matched "whatever" to the chat
    global.bot.sendMessage(chatId, help);
  })

  global.bot.onText(/\/start/, (msg, match) => {  
    const chatId = msg.chat.id;
    setChatId(chatId);

    // send back the matched "whatever" to the chat
    global.bot.sendMessage(chatId, 'started');
  })
}

function setChatId(id) {
  console.log('setting chat id:', id);
  setPropSync('botChatId', id);
}

function getChatId() {
  return getPropSync('botChatId');
}

function sendMessage(msg) {
  let chatId = getChatId();
  if (!chatId || !global.bot) return;
  global.bot.sendMessage(chatId, msg);
}

function sendMessageFormatted(msg) {
  let chatId = getChatId();
  if (!chatId || !global.bot) return;
  global.bot.sendMessage(chatId, msg, {parse_mode: 'HTML'});
}
