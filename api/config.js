const fs = require('fs');

const CONFIG_FILE = __dirname + '/config.json';

// load config
var config;
try {
  const data = fs.readFileSync(CONFIG_FILE, { encoding:'utf8', flag:'r' });
  config = JSON.parse(data);
  if (config.debugMode) console.log('config loaded');
} catch(error) {
  throw new Error('error loading ' + CONFIG_FILE + ': ' + error.toString());
}

module.exports = config;
