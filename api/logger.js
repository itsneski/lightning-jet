// logger
// https://www.npmjs.com/package//winston

const winston = require('winston');
const config = require('./config');

const myFormat = winston.format.printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${level}] ${message}`;
})

const level = (config.log && config.log.level) || 'info';

const logger = winston.createLogger({
  level: level,
  format: winston.format.combine(
    level === 'debug' ? winston.format.colorize() : winston.format.uncolorize(),
    winston.format.timestamp({format: 'MM-DD hh:mm:ss.SSS A'}),
    myFormat    
  ),
  transports: [
    new winston.transports.Console()
  ]
})

module.exports = {
  log: (...args) => log('info', args),  // for compatibility, same as info
  info: (...args) => log('info', args),
  warn: (...args) => log('warn', args),
  error: (...args) => log('error', args),
  debug: (...args) => log('debug', args)
}

function log(lvl, args) {
  if (!args || args.length === 0) return;
  let s = (args.length > 1) ? args.join(' ') : args[0];

  // get function name and line number
  const stack = new Error().stack;
  const parse = stack.split('\n').slice(2)[1];
  // get function name
  let ind1 = parse.indexOf('at');
  let ind2 = parse.indexOf('(', ind1);
  let fname;
  if (ind2 >= 0) {
    const part = parse.substring(ind1 + 2, ind2).trim();
    const prfx = 'Timeout.';
    if (part.indexOf(prfx) === 0) {
      const parts = part.substring(prfx.length).split(/\s+/);
      fname = parts[0];
    } else if (part.indexOf('Object.') === 0) {
      // skip
    } else if (part.indexOf('module.exports') === 0) {
      // skip
    } else {
      fname = part;      
    }
  }
  const arr = parse.split('/');
  let sub = arr[arr.length - 1];
  const ind = sub.indexOf(')');
  let line = (ind >= 0) ? sub.substring(0, ind) : sub.substring(0);
  // drop column number, not needed
  const arr2 = line.split(':');
  line = arr2[0] + ':' + arr2[1];

  if (level === 'debug') {
    s = (fname) ? '[' + fname + ',' + line + '] ' + s : '[' + line + '] ' + s;
  } else {
    s = (fname) ? '[' + fname + '] ' + s : '[' + line + '] ' + s;
  }

  logger.log({ 
    level: lvl,
    message: s
  })
}
