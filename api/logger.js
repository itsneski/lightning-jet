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
    winston.format.timestamp({format: 'YYYY-MM-DD hh:mm:ss.SSS A'}),
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
  const part = parse.substring(ind1 + 2, ind2).trim();
  const fname = (part.indexOf('Object.') !== 0) ? part : undefined;
  const arr = parse.split('/');
  let sub = arr[arr.length - 2] + '/' + arr[arr.length - 1];
  const ind = sub.indexOf(')');
  const line = sub.substring(0, ind);

  if (level === 'debug') {
    s = (fname) ? '[' + fname + ',' + line + '] ' + s : '[' + line + '] ' + s;
  } else {
    s = (fname) ? '[' + fname + '] ' + s : s;
  }

  logger.log({ 
    level: lvl,
    message: s
  })
}
