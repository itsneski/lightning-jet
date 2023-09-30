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
  info: (s) => log('info', s),
  warn: (s) => log('warn', s),
  error: (s) => log('error', s),
  debug: (s) => log('debug', s)
}

function log(lvl, s) {
  if (!s) return;
  logger.log({ 
    level: lvl,
    message: s
  })
}
