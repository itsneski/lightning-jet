const config = require('../api/config');
const TelegramBot = require('node-telegram-bot-api');
const {getPropSync} = require('../db/utils');
const {getPropAndDateSync} = require('../db/utils');
const {setPropSync} = require('../db/utils');
const {fetchTelegramMessageSync} = require('../db/utils');
const {deleteTelegramMessages} = require('../db/utils');
const lndClient = require('../api/connect');
const {listFeesSync} = require('../lnd-api/utils');
const util = require('util');
const date = require('date-and-time')

const pollInterval = 30;  // seconds
const feeInterval = 10;   // mins

const encode = s => Buffer.from(s).toString('base64');
const decode = s => Buffer.from(s, 'base64').toString();
const formatDate = d => date.format(new Date(d), 'MM/DD hh:mm A')

initBot();

monitorFees();
setInterval(monitorFees, feeInterval * 60 * 1000);

// monitor fee changes
function monitorFees() {
  try {
    let fees = listFeesSync(lndClient);
    let prev = getPropAndDateSync('fees');
    setPropSync('fees', encode(JSON.stringify(fees, null, 2)));
    if (!prev) return;

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
      if (f.remote.base != p.remote.base) {
        let msg = util.format('channel %s with %s: base fee changed from %d to %d', f.chan, f.name, f.remote.base, p.remote.base);
        console.log(msg);
        // format for telegram
        msg = util.format('channel %s with <b>%s</b>: base fee changed from %d to %d', f.chan, f.name, f.remote.base, p.remote.base);
        sendMessageFormatted(msg);
      }
      if (f.remote.rate != p.remote.rate) {
        let msg = util.format('channel %s with %s: ppm fee changed from %d to %d', f.chan, f.name, f.remote.rate, p.remote.rate);
        console.log(msg);
        msg = util.format('channel %s with <b>%s</b>: ppm fee changed from %d to %d', f.chan, f.name, f.remote.rate, p.remote.rate);
        sendMessageFormatted(msg);
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
  } catch(error) {
    console.error('monitorFees:', error.message);
  }
}

if (global.bot) {
  setInterval(pollMessages, pollInterval * 1000);
}

// poll messages from the db
function pollMessages() {
  let list = fetchTelegramMessageSync();
  if (!list || list.length === 0) return;
  console.log('processing', list.length, 'messages');
  let chatId = getChatId();
  let ids = [];
  try {
    list.forEach(m => {
      console.log('processing message:', m);
      global.bot.sendMessage(chatId, m.message);
      ids.push(m.id);
    })
  } catch(error) {
    console.error('pollMessages:', error.message);
  } finally {
    deleteTelegramMessages(ids);
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
