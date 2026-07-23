// config/index.js
require('dotenv').config();
const path = require('path');

module.exports = {
    // 服务器配置
    PORT: process.env.PORT || 3000,
    SESSION_SECRET: process.env.SESSION_SECRET || 'fallback-secret',
    NODE_ENV: process.env.NODE_ENV || 'development',
    
    // Session 存储配置
    SESSION_TABLE_NAME: 'sessions',
    SESSION_MAX_AGE: 7 * 24 * 60 * 60 * 1000, // 7 days
    
    // 日志配置
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    LOG_MAX_FILES: 14,
    LOG_MAX_SIZE: '20m',
    
    // 安全配置
    MAX_MESSAGE_LENGTH: parseInt(process.env.MAX_MESSAGE_LENGTH) || 2000,
    MESSAGE_RATE_LIMIT_MS: parseInt(process.env.MESSAGE_RATE_LIMIT_MS) || 300,
    HEARTBEAT_INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL) || 30000,
    HEARTBEAT_TIMEOUT: parseInt(process.env.HEARTBEAT_TIMEOUT) || 40000,
    
    // 文件大小限制
    FILE_SIZE_LIMITS: {
        user: 50 * 1024 * 1024,   // 50MB
        admin: 1024 * 1024 * 1024  // 1GB
    },
    
    // 文件类型白名单（MIME 类型）
    ALLOWED_UPLOAD_MIMES: [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
        'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
        'video/webm', 'video/ogg',
        'application/pdf',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain', 'text/csv',
        'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
        'application/json', 'application/xml',
        'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'
    ],
    // 头像仅允许图片类型
    ALLOWED_AVATAR_MIMES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    
    // 默认头像
    DEFAULT_AVATAR_URL: 'https://api.dicebear.com/7.x/avataaars/svg?seed=default',
    
    // 上传目录
    UPLOAD_DIR: path.join(__dirname, '../uploads'),
    AVATAR_DIR: path.join(__dirname, '../uploads/avatars'),
    FILES_DIR: path.join(__dirname, '../uploads/files'),
    PUBLIC_FILES_DIR: path.join(__dirname, '../uploads/public_files'),
    RECALLED_DIR: path.join(__dirname, '../uploads/recalled'),
    NOTES_FILES_DIR: path.join(__dirname, '../uploads/notes_files'),
    PRIVATE_FILES_DIR: path.join(__dirname, '../uploads/private_files'),
    
    // 表情映射
    EMOJI_MAP: {
        ':smile:': '😊', ':laugh:': '😂', ':heart:': '❤️', ':thumbsup:': '👍',
        ':cry:': '😢', ':angry:': '😠', ':surprise:': '😲', ':wink:': '😉',
        ':cool:': '😎', ':pray:': '🙏'
    },
    
    // 支持预览的视频格式
    VIDEO_PREVIEW_TYPES: [
        'video/mp4', 'video/quicktime', 'video/x-msvideo',
        'video/x-matroska', 'video/webm', 'video/ogg',
        '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv'
    ]
};