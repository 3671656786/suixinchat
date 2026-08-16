// utils/helpers.js
const { EMOJI_MAP, MAX_MESSAGE_LENGTH } = require('../config');
const crypto = require('crypto');

// 修复 #5：转义 & < > " ' 和反引号，防止属性注入与 XSS
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/[&<>"'`]/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;'
    }[m]));
}

function escapeHtmlAttr(text) {
    if (!text) return '';
    return text.replace(/[&<>"]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        return m;
    });
}

function safeText(text) {
    if (!text) return '';
    return escapeHtml(text).replace(/\n/g, '<br>').replace(/\s/g, ' ');
}

function replaceEmojis(text) {
    let result = text;
    for (let [code, emoji] of Object.entries(EMOJI_MAP)) {
        result = result.replace(new RegExp(code, 'g'), emoji);
    }
    return result;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    return date.toLocaleDateString();
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 修复 #63：使用密码学安全随机数生成验证码，避免 Math.random() 可预测
function generateVerificationCode() {
    return crypto.randomInt(100000, 1000000).toString();
}

// #65 修复：正确处理代理链。
// x-forwarded-for 格式为 "client, proxy1, proxy2"，取最后一个非空值作为来源 IP，
// 避免直接伪造 X-Forwarded-For 头将限流目标指向内网/伪造地址。
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const parts = String(forwarded).split(',');
        for (let i = parts.length - 1; i >= 0; i--) {
            const ip = parts[i].trim();
            if (ip) return ip;
        }
    }
    return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

function isValidMessageLength(content) {
    return !content || content.length <= MAX_MESSAGE_LENGTH;
}

// 修复 #64：使用密码学安全随机数生成随机字符串
function generateRandomString(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = crypto.randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[bytes[i] % chars.length];
    }
    return result;
}

function safeJsonParse(str, defaultValue = null) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return defaultValue;
    }
}

// 修复 #73：按 Unicode 码点安全截断（后端版），避免截断中文字符/emoji 产生乱码
function truncateText(text, maxLength) {
    if (text === null || text === undefined) return '';
    text = String(text);
    if (text.length <= maxLength) return text;
    return Array.from(text).slice(0, maxLength).join('');
}

module.exports = {
    escapeHtml,
    escapeHtmlAttr,
    safeText,
    replaceEmojis,
    formatTime,
    formatFileSize,
    generateVerificationCode,
    getClientIp,
    isValidMessageLength,
    generateRandomString,
    safeJsonParse,
    truncateText
};