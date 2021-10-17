const lndClient = require('./api/connect');
lndClient.deleteAllPayments({}, (err, response) => {
  if (err) throw new Error(err);
  console.log('success');
})
