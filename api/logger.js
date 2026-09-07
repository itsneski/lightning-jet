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
    // handleExceptions/handleRejections are deliberately not set here; see the
    // process handlers at the bottom of this file
    new winston.transports.Console()
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

// Process event handlers. These log the crash and exit non-zero so the
// launcher's watchdog restarts the service.
//
// The Console transport's handleExceptions/handleRejections are not used
// because they duplicate these handlers - every crash gets logged twice - and
// winston defers its exit long enough that the process keeps running in a
// broken state after the throw.
//
// reason/error are optional-chained: Promise.reject() with no argument gives an
// undefined reason, and reading .stack off it throws inside the handler, which
// masks the original failure.
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason?.stack || reason}`);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error?.stack || error}`);
  process.exit(1);
});
