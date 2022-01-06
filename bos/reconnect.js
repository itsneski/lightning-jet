// a shim that call the bos reconnect
const importLazy = require('import-lazy')(require);
const network = importLazy('balanceofsatoshis/network');
const lnd = importLazy('balanceofsatoshis/lnd');
const responses = importLazy('balanceofsatoshis/responses');
const lndForNode = (logger, node) => lnd.authenticatedLnd({logger, node});

module.exports = {
  async reconnect(logger) {
    const lndHandle = await lndForNode(logger);
    return new Promise(async (resolve, reject) => {
      try {
        return network.reconnect({
          lnd: lndHandle.lnd,
        },
        responses.returnObject({logger, reject, resolve}));
      } catch (err) {
        return reject(logger.error({err}));
      }
    })
  }
}
