// utils/logger.js
const winston = require('winston');
require('winston-daily-rotate-file');
const fs = require('fs');
const path = require('path');

// 修复 #90：确保 logs/ 目录存在，避免日志写入失败
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const fileRotateTransport = new winston.transports.DailyRotateFile({
    filename: path.join(logDir, 'application-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    )
});

const consoleTransport = new winston.transports.Console({
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
    ),
    level: 'info'
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [
        fileRotateTransport,
        consoleTransport
    ]
});

// 修复 #91：logToFile 支持指定日志级别，不再只能记录 info
function logToFile(message, level = 'info') {
    const validLevels = ['error', 'warn', 'info', 'debug'];
    if (!validLevels.includes(level)) level = 'info';
    logger[level](message);
}

// 便捷的错误日志函数
function logError(message) {
    logToFile(message, 'error');
}

module.exports = { logger, logToFile, logError };
