// loads bos tags in case bos tool is present
// this is optional, but nice to have if the user
// already spend time configuring bos tags
/*const config = require('./config')
const {execSync} = require('child_process');

// check if bos exists
let bosExists;
try {
  let res = execSync('which bos').toString().trim();
  bosExists = res && res.indexOf('bos') >= 0;
} catch(err) {}

if (!bosExists) {
  if (config.debugMode) console.log('didnt locate bos, skipping bos tags');
  return;
}*/

var tags = {};

/*if (config.debugMode) console.log('loading bos tags...');
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
}*/

module.exports = tags;
