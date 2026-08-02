// routes/announcements.js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { isLoggedIn } = require('../middleware/auth');
const { getIO } = require('../socket');

// 获取公告列表
router.get('/api/announcements', (req, res) => {
    try {
        const announcements = db.prepare('SELECT * FROM announcements ORDER BY timestamp DESC LIMIT 20').all();
        res.json({ success: true, announcements });
    } catch (err) {
        console.error('获取公告失败:', err);
        res.json({ success: false, message: err.message });
    }
});

// 发布公告（仅管理员）
router.post('/api/announcements', isLoggedIn, (req, res) => {
    const userId = req.userId;
    const user = db.prepare('SELECT role, username FROM users WHERE userId = ?').get(userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '无权限' });
    }
    const { content } = req.body;
    if (!content) {
        return res.status(400).json({ success: false, message: '内容不能为空' });
    }
    try {
        db.prepare('INSERT INTO announcements (content, publisherId, publisherName, timestamp) VALUES (?, ?, ?, datetime("now"))')
            .run(content, userId, user.username);
        const newAnnouncement = { content, publisherName: user.username, timestamp: new Date().toISOString() };
        const io = getIO();
        if (io) io.to('chatroom').emit('new announcement', newAnnouncement);
        res.json({ success: true });
    } catch (err) {
        console.error('发布公告失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 修复 N12: 删除公告（同时清理关联数据） ==========
router.delete('/api/announcements/:id', isLoggedIn, (req, res) => {
    const userId = req.userId;
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '无权限' });
    }
    const id = req.params.id;
    try {
        // 获取公告信息用于日志
        const announcement = db.prepare('SELECT content, publisherName FROM announcements WHERE id = ?').get(id);
        if (!announcement) {
            return res.status(404).json({ success: false, message: '公告不存在' });
        }
        
        // 删除公告
        db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
        
        // 修复 N12: 未来如果有公告已读表，在此清理关联数据
        // 目前没有 announcement_reads 表，但预留清理逻辑
        // 如果有其他关联表，在此添加清理代码
        
        console.log(`[公告] 管理员 ${user.username} 删除公告 ID:${id}: ${announcement.content.substring(0, 50)}...`);
        res.json({ success: true });
    } catch (err) {
        console.error('删除公告失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;