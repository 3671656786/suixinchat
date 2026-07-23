// routes/operations.js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { isLoggedIn } = require('../middleware/auth');

router.get('/api/operations/stats', isLoggedIn, (req, res) => {
    try {
        const result = {};

        // 用户统计
        const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        let newUsersWeek = 0;
        try {
            const r = db.prepare(`SELECT COUNT(*) as count FROM users WHERE createdAt IS NOT NULL AND datetime(createdAt) >= datetime('now', '-7 days')`).get();
            newUsersWeek = r ? r.count : 0;
        } catch(e) { newUsersWeek = 0; }
        result.users = { totalUsers, newUsersWeek };

        // 消息统计
        const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
        const todayMessages = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE date(timestamp) = date('now')`).get().count;
        result.messages = { totalMessages, todayMessages };

        // 文件统计
        const totalFiles = db.prepare('SELECT COUNT(*) as count FROM file_nodes WHERE isFolder = 0').get().count;
        const totalSize = db.prepare('SELECT SUM(fileSize) as total FROM file_nodes WHERE isFolder = 0').get().total || 0;
        result.files = { totalFiles, totalSizeMB: (totalSize / 1024 / 1024).toFixed(2) };

        // 在线时长排行（Top 10）
        const onlineStats = db.prepare(`
            SELECT u.username, COALESCE(SUM(s.duration), 0) as totalSeconds
            FROM users u
            LEFT JOIN user_sessions s ON u.userId = s.userId
            GROUP BY u.userId
            HAVING totalSeconds > 0
            ORDER BY totalSeconds DESC
            LIMIT 10
        `).all();
        result.online = onlineStats.map(u => ({ username: u.username, hours: (u.totalSeconds / 3600).toFixed(1) }));

        // 流量统计
        const totalUpload = db.prepare(`SELECT COALESCE(SUM(bytes), 0) as total FROM user_traffic WHERE type = 'upload'`).get().total;
        const totalDownload = db.prepare(`SELECT COALESCE(SUM(bytes), 0) as total FROM user_traffic WHERE type = 'download'`).get().total;
        result.traffic = { uploadMB: (totalUpload / 1024 / 1024).toFixed(2), downloadMB: (totalDownload / 1024 / 1024).toFixed(2) };

        // 全局网盘容量
        const usedRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('total_upload_bytes');
        const maxRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('max_global_upload_bytes');
        const globalUsed = usedRow ? parseInt(usedRow.value) : 0;
        const globalMax = maxRow ? parseInt(maxRow.value) : 10 * 1024 * 1024 * 1024;
        result.globalStorage = {
            usedGB: (globalUsed / 1024 / 1024 / 1024).toFixed(2),
            maxGB: (globalMax / 1024 / 1024 / 1024).toFixed(0),
            percent: (globalUsed / globalMax) * 100
        };

        res.json({ success: true, data: result });
    } catch (err) {
        console.error('获取运营数据失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;