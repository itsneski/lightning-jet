const winston = require('winston');
const config = require('./config');
const path = require('path');

// Custom format for log messages
const logFormat = winston.format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}] ${message}`;
});

// Get log level from config with fallback to 'info'. Mutable so that the CLI's
// --quiet/--verbose flags can override it at runtime; see setLevel below.
let logLevel = config?.log?.level || 'info';

// Configure Winston logger
const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    logLevel === 'debug' ? winston.format.colorize() : winston.format.uncolorize(),
    winston.format.timestamp({ format: 'MM-DD hh:mm:ss.SSS A' }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true
    })
  ]
});

// Log level methods
const logMethods = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug'
};

// Create logging functions
const createLogger = (level) => (...args) => {
  if (!args?.length) return;
  
  const message = args.length > 1 ? args.join(' ') : String(args[0]);
  const meta = getCallerInfo();
  
  logger.log({
    level,
    message: formatMessage(message, meta)
  });
};

// Format message with caller info
const formatMessage = (message, { functionName, fileLocation }) => {
  const prefix = logLevel === 'debug'
    ? `[${functionName || 'anonymous'},${fileLocation}]`
    : `[${functionName || fileLocation}]`;
  return `${prefix} ${message}`;
};

// Get caller information using Error stack
const getCallerInfo = () => {
  const stack = new Error().stack.split('\n');
  const callerLine = stack[3]; // 0: Error, 1: getCallerInfo, 2: createLogger, 3: caller
  
  if (!callerLine) return { fileLocation: 'unknown', functionName: null };

  // Parse stack line: "    at functionName (filePath:line:column)"
  const match = callerLine.match(/at\s+(?:([^\s]+)\s+)?\(?([^:]+):(\d+):(\d+)\)?/);
  if (!match) return { fileLocation: 'unknown', functionName: null };

  const [, functionName, filePath, line] = match;
  const fileName = path.basename(filePath || 'unknown');
  
  return {
    fileLocation: `${fileName}:${line}`,
    functionName: functionName === 'Object.<anonymous>' ? null : functionName
  };
};

// Export logging methods
module.exports = Object.fromEntries(
  Object.entries(logMethods).map(([method, level]) => [method, createLogger(level)])
);

// Override the configured log level at runtime. Note that the colorize choice
// is baked into the format chain at construction, so this changes filtering and
// the caller-info prefix, not colorization.
module.exports.setLevel = (level) => {
  if (!level) return;
  logLevel = level;
  logger.level = level;
};

// Process event handlers
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason.stack || reason}`);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.stack}`);
  process.exit(1);
});
