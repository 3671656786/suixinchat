// routes/private.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db/connection');
const { isLoggedIn } = require('../middleware/auth');
const { checkChatBan } = require('../middleware/banCheck');
const { validateFileType } = require('../utils/fileValidator');
const { logToFile } = require('../utils/logger');
const { storage, fileFilter } = require('../config/multer');
const { FILE_SIZE_LIMITS } = require('../config');
const { safePath } = require('../utils/safePath');

const fs = require('fs');
const path = require('path');

// ========== 修复 N1: 私聊文件上传添加封禁检查 ==========
router.post('/api/private/upload', isLoggedIn, checkChatBan, (req, res, next) => {
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(req.userId);
    const isAdmin = user && user.role === 'admin';
    const limit = isAdmin ? FILE_SIZE_LIMITS.admin : FILE_SIZE_LIMITS.user;
    const uploadSingle = multer({ storage, fileFilter, limits: { fileSize: limit } }).single('file');
    uploadSingle(req, res, (err) => {
        if (err) {
            if (err.code === 'FILE_TOO_LARGE') {
                return res.status(413).json({ success: false, message: `文件过大，${isAdmin ? '管理员最大1GB' : '普通用户最大50MB'}` });
            }
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: '未上传文件' });
    const validation = validateFileType(req.file.path, req.file.mimetype);
    if (!validation.valid) {
        try { require('fs').unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ success: false, message: '文件类型验证失败：' + validation.reason });
    }
    const fileSize = req.file.size;
    db.prepare(`INSERT INTO user_traffic (user_id, type, bytes, path) VALUES (?, 'upload', ?, ?)`).run(req.userId, fileSize, req.file.originalname);
    logToFile(`[私聊上传] 用户 ${req.userId} 上传私聊文件: ${req.file.originalname} (${fileSize} bytes)`);
    res.json({ success: true, fileUrl: `/uploads/private_files/${req.file.filename}`, fileName: req.file.originalname, fileType: req.file.mimetype });
});

// ========== 私聊文件下载（已使用safePath） ==========
router.get('/api/private/download/:id', isLoggedIn, async (req, res) => {
    const msgId = req.params.id;
    const userId = req.userId;
    const msg = db.prepare('SELECT fileUrl, fileName, fileSize, from_user, to_user FROM private_messages WHERE id = ? AND (from_user = ? OR to_user = ?)').get(msgId, userId, userId);
    if (!msg || !msg.fileUrl) {
        return res.status(404).json({ success: false, message: '文件不存在或无权访问' });
    }
    let safeFilePath;
    try {
        const uploadBase = path.join(__dirname, '..');
        safeFilePath = safePath(uploadBase, msg.fileUrl);
    } catch (err) {
        return res.status(403).json({ success: false, message: '路径非法' });
    }
    try {
        await fs.promises.access(safeFilePath);
        let fileSize = msg.fileSize;
        if (!fileSize) {
            const stat = await fs.promises.stat(safeFilePath);
            fileSize = stat.size;
        }
        db.prepare(`INSERT INTO user_traffic (user_id, type, bytes, path) VALUES (?, 'download', ?, ?)`).run(userId, fileSize, msg.fileUrl);
        
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(msg.fileName || 'file')}`);
        res.setHeader('Content-Type', 'application/octet-stream');
        const readStream = fs.createReadStream(safeFilePath);
        readStream.pipe(res);
    } catch (err) {
        console.error('私聊文件下载失败:', err);
        res.status(500).json({ success: false, message: '文件不存在或服务器错误' });
    }
});

// ========== 获取与指定用户的私聊记录 ==========
router.get('/api/private/messages/:userId', isLoggedIn, (req, res) => {
    const currentUserId = req.userId;
    const targetUserId = parseInt(req.params.userId);
    
    const targetUser = db.prepare('SELECT userId FROM users WHERE userId = ?').get(targetUserId);
    if (!targetUser) {
        return res.status(404).json({ success: false, message: '用户不存在' });
    }
    
    try {
        const messages = db.prepare(`
            SELECT pm.*, 
                   u1.username as from_username,
                   u2.username as to_username
            FROM private_messages pm
            LEFT JOIN users u1 ON pm.from_user = u1.userId
            LEFT JOIN users u2 ON pm.to_user = u2.userId
            WHERE (pm.from_user = ? AND pm.to_user = ?) OR (pm.from_user = ? AND pm.to_user = ?)
            ORDER BY pm.timestamp ASC
        `).all(currentUserId, targetUserId, targetUserId, currentUserId);
        res.json({ success: true, messages });
    } catch (err) {
        console.error('获取私聊记录失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 获取私聊列表 ==========
router.get('/api/private/list', isLoggedIn, (req, res) => {
    const currentUserId = req.userId;
    try {
        const chats = db.prepare(`
            SELECT DISTINCT 
                CASE 
                    WHEN pm.from_user = ? THEN pm.to_user 
                    ELSE pm.from_user 
                END as userId,
                u.username,
                u.avatarUrl,
                (SELECT COUNT(*) FROM private_messages WHERE to_user = ? AND from_user = userId AND is_read = 0) as unread
            FROM private_messages pm
            JOIN users u ON u.userId = (CASE WHEN pm.from_user = ? THEN pm.to_user ELSE pm.from_user END)
            WHERE (pm.from_user = ? OR pm.to_user = ?) AND u.userId IS NOT NULL
            ORDER BY pm.timestamp DESC
        `).all(currentUserId, currentUserId, currentUserId, currentUserId, currentUserId);
        res.json({ success: true, chats });
    } catch (err) {
        console.error('获取私聊列表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;