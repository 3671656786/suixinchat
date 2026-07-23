// utils/helpers.js
const { EMOJI_MAP, MAX_MESSAGE_LENGTH } = require('../config');

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
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

function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
}

function isValidMessageLength(content) {
    return !content || content.length <= MAX_MESSAGE_LENGTH;
}

function generateRandomString(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
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
    safeJsonParse
};