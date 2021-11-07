const {sendMessage} = require('../api/telegram');

let msgs = ['test', 'another test', 'and one more'];
msgs.forEach(m => {
  console.log('sending message:', m);
  sendMessage(m);
})
