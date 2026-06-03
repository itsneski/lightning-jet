const importLazy = require('import-lazy')(require);

const lndClient = importLazy('../../api/connect');
const lndUtils = importLazy('../../lnd-api/utils');

function getLndClient() {
  return lndClient;
}

function requireLndAlive() {
  if (!lndUtils.isLndAlive(lndClient)) {
    throw new Error('lnd is offline');
  }

  return lndClient;
}

module.exports = {
  getLndClient,
  requireLndAlive,
  lndUtils,
};
