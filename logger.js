require('dotenv').config();
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Get environment variables with defaults
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_TO_CONSOLE = process.env.LOG_TO_CONSOLE !== 'false';
const LOG_TO_FILE = process.env.LOG_TO_FILE !== 'false';
const LOG_MAX_SIZE = parseInt(process.env.LOG_MAX_SIZE || '5242880', 10); // 5MB
const LOG_MAX_FILES = parseInt(process.env.LOG_MAX_FILES || '5', 10);

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat()
);

// Create logs directory if it doesn't exist and LOG_TO_FILE is true
const logsDir = path.join(__dirname, 'logs');
if (LOG_TO_FILE && !fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Configure transports
const transports = [];

// Add file transports if LOG_TO_FILE is true
if (LOG_TO_FILE) {
    transports.push(
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: LOG_MAX_SIZE,
            maxFiles: LOG_MAX_FILES,
            format: winston.format.combine(logFormat, winston.format.json())
        }),
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: LOG_MAX_SIZE,
            maxFiles: LOG_MAX_FILES,
            format: winston.format.combine(logFormat, winston.format.json())
        })
    );
}

// Add console transport if LOG_TO_CONSOLE is true
if (LOG_TO_CONSOLE) {
    // Use different formats for development and production
    const consoleFormat = NODE_ENV === 'development'
        ? winston.format.combine(
            logFormat,
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp, ...meta }) => {
                return `${timestamp} ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
            })
        )
        : winston.format.combine(
            logFormat,
            winston.format.colorize(),
            winston.format.simple()
        );

    transports.push(
        new winston.transports.Console({
            level: LOG_LEVEL,
            format: consoleFormat
        })
    );
}

// Create logger
const logger = winston.createLogger({
    level: LOG_LEVEL,
    defaultMeta: { service: 'youtube-downloader' },
    transports
});

// Add environment info to logger
logger.info(`Logger initialized in ${NODE_ENV} mode`);

// Export logger
module.exports = logger;