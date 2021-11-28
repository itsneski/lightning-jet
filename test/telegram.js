const {sendMessage} = require('../api/telegram');

let msgs = ['message1', 'message2', 'message3', 'message4', 'message5'];
msgs.forEach(m => {
  console.log('sending message:', m);
  sendMessage(m);
})
