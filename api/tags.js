const config = require('./config')

var tags = {};

if (config.debugMode) console.log('loading bos tags...');
try {
  let data = require('child_process').execSync('bos tags').toString();
  let alias;
  data.split(/\r?\n/).forEach(line => {
    if (line.indexOf('alias:') >= 0) {
      alias = normalizeString(line.substring(line.indexOf('alias:') + 6));
    } else if (alias && line.indexOf('-') >= 0) {
      tags[alias] = normalizeString(line.substring(line.indexOf('-') + 1));
      alias = null;
    }
  })
  if (config.debugMode) console.log('loaded', Object.keys(tags).length, 'tags');
} catch (error) {
  throw new Error('error loading bos tags: ' + error.toString());
}

function normalizeString(str) {
  // take care of funkiness of bos output
  let index = str.indexOf('[39m');
  if (index >= 0) str = str.substring(index + 4);
  return str.trim();
}

module.exports = tags;
