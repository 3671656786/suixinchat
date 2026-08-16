// routes/user.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcrypt');
const db = require('../db/connection');
const { storage, fileFilter } = require('../config/multer');
const { DEFAULT_AVATAR_URL } = require('../config');
const { logToFile } = require('../utils/logger');
const { onlineUsers, broadcastOnlineUsers, getIO } = require('../socket');
const { isLoggedIn } = require('../middleware/auth');
const { validateFileType } = require('../utils/fileValidator');

// 获取当前用户信息
router.get('/api/me', (req, res) => {
    const userId = req.session.userId;
    if (!userId) return res.json({ success: false });
    try {
        const user = db.prepare('SELECT userId, username, avatarUrl, role, email, receive_email_announcements FROM users WHERE userId = ?').get(userId);
        if (!user) return res.json({ success: false });
        res.json({ success: true, user });
    } catch (err) {
        console.error(err);
        res.json({ success: false });
    }
});

// 更新个人资料（用户名 + 邮件公告接收设置）
router.post('/api/updateProfile', isLoggedIn, async (req, res) => {
    const userId = req.userId;
    const { username, receiveEmailAnnouncements } = req.body;
    try {
        if (username) {
            // 修复：用户名修改同样校验长度（与注册规则一致：2-20 字符）
            const cleanName = String(username).trim();
            if (cleanName.length < 2 || cleanName.length > 20) {
                return res.json({ success: false, message: '用户名长度应为2-20个字符' });
            }
            const existing = db.prepare('SELECT * FROM users WHERE username = ? AND userId != ?').get(cleanName, userId);
            if (existing) return res.json({ success: false, message: '用户名已存在' });
            db.prepare('UPDATE users SET username = ? WHERE userId = ?').run(cleanName, userId);
            db.prepare('UPDATE messages SET username = ? WHERE userId = ?').run(cleanName, userId);
            const onlineInfo = onlineUsers.get(userId);
            if (onlineInfo) onlineInfo.username = cleanName;
        }
        if (receiveEmailAnnouncements !== undefined) {
            const val = receiveEmailAnnouncements ? 1 : 0;
            db.prepare('UPDATE users SET receive_email_announcements = ? WHERE userId = ?').run(val, userId);
        }
        const updated = db.prepare('SELECT userId, username, avatarUrl, role, email, receive_email_announcements FROM users WHERE userId = ?').get(userId);
        res.json({ success: true, user: updated });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: '服务器错误' });
    }
});

// 上传头像
router.post('/api/uploadAvatar', isLoggedIn, (req, res, next) => {
    const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } }).single('avatar');
    upload(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, message: err.message });
        next();
    });
}, (req, res) => {
    const userId = req.userId;
    if (!req.file) return res.status(400).json({ success: false, message: '未上传文件' });
    const validation = validateFileType(req.file.path, req.file.mimetype);
    if (!validation.valid) {
        try { require('fs').unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ success: false, message: '头像文件类型验证失败：' + validation.reason });
    }
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    try {
        db.prepare('UPDATE users SET avatarUrl = ? WHERE userId = ?').run(avatarUrl, userId);
        db.prepare('UPDATE messages SET avatarUrl = ? WHERE userId = ?').run(avatarUrl, userId);
        const onlineInfo = onlineUsers.get(userId);
        if (onlineInfo) onlineInfo.avatarUrl = avatarUrl;
        const io = getIO();
        if (io) io.to('chatroom').emit('user updated', { userId, newAvatar: avatarUrl });
        res.json({ success: true, avatarUrl });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 修改密码
router.post('/api/changePassword', isLoggedIn, async (req, res) => {
    const userId = req.userId;
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.json({ success: false, message: '旧密码和新密码不能为空' });
    // 修复：新密码长度校验（与注册规则一致：至少 6 位，且不超过 bcrypt 上限 72 字节）
    if (newPassword.length < 6) return res.json({ success: false, message: '新密码长度至少6位' });
    if (newPassword.length > 72) return res.json({ success: false, message: '新密码长度不能超过72个字符' });
    try {
        const user = db.prepare('SELECT password FROM users WHERE userId = ?').get(userId);
        if (!user) return res.json({ success: false, message: '用户不存在' });
        const match = await bcrypt.compare(oldPassword, user.password);
        if (!match) return res.json({ success: false, message: '旧密码错误' });
        const hashedNew = await bcrypt.hash(newPassword, 10);
        db.prepare('UPDATE users SET password = ? WHERE userId = ?').run(hashedNew, userId);
        res.json({ success: true, message: '密码修改成功' });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: '服务器错误' });
    }
});

// 登出
router.post('/api/logout', (req, res) => {
    const userId = req.session.userId;
    if (userId) {
        const info = onlineUsers.get(userId);
        if (info) {
            if (info.disconnectTimer) clearTimeout(info.disconnectTimer);
            for (const socketId of info.sockets) {
                const io = getIO();
                const targetSocket = io?.sockets.sockets.get(socketId);
                if (targetSocket) targetSocket.disconnect(true);
            }
            onlineUsers.delete(userId);
            broadcastOnlineUsers();
        }
    }
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destroy error:', err);
            return res.status(500).json({ success: false, message: '登出失败' });
        }
        res.json({ success: true });
    });
});

module.exports = router;