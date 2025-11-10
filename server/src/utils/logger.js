import { createLogger, format, transports } from 'winston';
import fs from 'fs';
import DailyRotateFile from 'winston-daily-rotate-file';

const { combine, timestamp, printf, colorize, errors } = format;

const logLevel = process.env.LOG_LEVEL || 'info';

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} ${level}: ${stack || message}`;
});

// Ensure logs directory exists to avoid startup crashes
const logsDir = 'logs';
let fileTransports = [];
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Daily rotate transport to avoid unbounded disk growth
  fileTransports = [
    new DailyRotateFile({
      level: 'error',
      filename: `${logsDir}/error-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
    }),
    new DailyRotateFile({
      level: logLevel,
      filename: `${logsDir}/combined-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '50m',
      maxFiles: '30d',
    })
  ];
} catch (err) {
  // If file transport initialization fails, fallback to console-only logger
  // We cannot import logger yet, so write to stderr as fallback
  // Note: do not throw here to avoid bringing the app down due to logging issues
  // eslint-disable-next-line no-console
  console.warn('Logger file transport initialization failed, falling back to console-only logging:', err && err.message);
  fileTransports = [];
}

const logger = createLogger({
  level: logLevel,
  format: combine(
    errors({ stack: true }),
    timestamp(),
    logFormat
  ),
  transports: [
    // spread file transports only if created successfully
    ...fileTransports,
  ],
  exitOnError: false,
});

// Always include console transport to ensure logs appear during startup and in environments where files are unavailable
const consoleTransport = new transports.Console({ format: combine(colorize(), timestamp(), logFormat) });
logger.add(consoleTransport);

// Export logger
export default logger;
