// logger

const winston = require('winston');
const config = require('./config');

const myFormat = winston.format.printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${label}] [${level}] ${message}`;
})

const level = (config.log && config.log.level) || 'info';

const logger = winston.createLogger({
  level: level,
  format: winston.format.combine(
    level === 'debug' ? winston.format.colorize() : winston.format.uncolorize(),
    winston.format.label({ label: 'jet' }),
    winston.format.timestamp(),
    myFormat    
  ),
  transports: [
    new winston.transports.Console()
  ]
})

module.exports = {
  info(s) {
    if (!s) return;
    logger.log({
      level: 'info',
      message: s
    })
  },
  warn(s) {
    if (!s) return;
    logger.log({
      level: 'warn',
      message: s
    })
  },
  error(s) {
    if (!s) return;
    logger.log({
      level: 'error',
      message: s
    })
  },
  debug(s) {
    if (!s) return;
    logger.log({
      level: 'debug',
      message: s
    })
  }
}
