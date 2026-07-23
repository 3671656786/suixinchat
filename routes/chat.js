// routes/chat.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const db = require('../db/connection');
const { storage, fileFilter } = require('../config/multer');
const { FILE_SIZE_LIMITS } = require('../config');
const { logToFile } = require('../utils/logger');
const { isLoggedIn } = require('../middleware/auth');
const { checkChatBan } = require('../middleware/banCheck');
const { validateFileType } = require('../utils/fileValidator');

// 获取消息历史（分页）
router.get('/api/messages', isLoggedIn, (req, res) => {
    const { limit = 50, before } = req.query;
    let query = 'SELECT * FROM messages WHERE groupId = 0';
    let params = [];
    if (before) { query += ' AND id < ?'; params.push(Number(before)); }
    query += ' ORDER BY id DESC LIMIT ?'; params.push(parseInt(limit));
    try {
        let messages = db.prepare(query).all(...params);
        messages = messages.reverse();
        res.json({ success: true, messages });
    } catch (err) {
        console.error(err);
        res.json({ success: false });
    }
});

// 搜索消息
router.get('/api/search', isLoggedIn, (req, res) => {
    const userId = req.userId;
    const { keyword, username, startDate, endDate, type = 'all' } = req.query;
    try {
        const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
        let query = 'SELECT * FROM messages WHERE groupId = 0';
        let params = [];
        if (keyword) {
            query += ' AND content LIKE ?';
            params.push(`%${keyword}%`);
        }
        if (username) {
            query += ' AND username LIKE ?';
            params.push(`%${username}%`);
        }
        if (startDate) {
            query += ' AND date(timestamp) >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND date(timestamp) <= ?';
            params.push(endDate);
        }
        if (type === 'mine' && user.role !== 'admin') {
            query += ' AND userId = ?';
            params.push(userId);
        }
        query += ' ORDER BY timestamp DESC LIMIT 200';
        const results = db.prepare(query).all(...params);
        res.json({ success: true, results });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: '服务器错误' });
    }
});

// 聊天室文件上传（需要检查封禁）
router.post('/api/upload', isLoggedIn, checkChatBan, async (req, res, next) => {
    const userId = req.userId;
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    const isAdmin = user && user.role === 'admin';
    const limit = isAdmin ? FILE_SIZE_LIMITS.admin : FILE_SIZE_LIMITS.user;
    const uploadSingle = multer({ storage, fileFilter, limits: { fileSize: limit } }).single('file');
    uploadSingle(req, res, (err) => {
        if (err) {
            console.error('Multer error:', err);
            if (err.code === 'FILE_TOO_LARGE') {
                return res.status(413).json({ success: false, message: `文件过大，${isAdmin ? '管理员最大1GB' : '普通用户最大50MB'}` });
            }
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: '未上传文件' });
    // 验证文件真实内容
    const validation = validateFileType(req.file.path, req.file.mimetype);
    if (!validation.valid) {
        try { fs.unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ success: false, message: '文件类型验证失败：' + validation.reason });
    }
    const fileSize = req.file.size;
    db.prepare(`INSERT INTO user_traffic (user_id, type, bytes, path) VALUES (?, 'upload', ?, ?)`).run(req.userId, fileSize, req.file.originalname);
    logToFile(`[上传] 用户 ${req.userId} 上传文件: ${req.file.originalname} (${fileSize} bytes)`);
    res.json({ success: true, fileUrl: `/uploads/files/${req.file.filename}`, fileName: req.file.originalname, fileType: req.file.mimetype });
});

// 获取在线用户列表
router.get('/api/online-users', isLoggedIn, (req, res) => {
    const { onlineUsers } = require('../socket');
    const list = [];
    for (let [uid, info] of onlineUsers.entries()) {
        list.push({ userId: uid, username: info.username, avatarUrl: info.avatarUrl, status: info.status });
    }
    res.json({ success: true, users: list });
});

module.exports = router;