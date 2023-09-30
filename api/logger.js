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
    winston.format.timestamp({format: 'MM/DD hh:mm:ss A'}),
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
  logger.log({ 
    level: lvl,
    message: s
  })
}
