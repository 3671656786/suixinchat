// routes/operations.js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { isLoggedIn } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');
const { logToFile } = require('../utils/logger');

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
        result.online = onlineStats.map(function(u) { 
            return { username: u.username, hours: (u.totalSeconds / 3600).toFixed(1) }; 
        });

        // 流量统计
        const totalUpload = db.prepare(`SELECT COALESCE(SUM(bytes), 0) as total FROM user_traffic WHERE type = 'upload'`).get().total;
        const totalDownload = db.prepare(`SELECT COALESCE(SUM(bytes), 0) as total FROM user_traffic WHERE type = 'download'`).get().total;
        result.traffic = { 
            uploadMB: (totalUpload / 1024 / 1024).toFixed(2), 
            downloadMB: (totalDownload / 1024 / 1024).toFixed(2) 
        };

        // 全局网盘容量
        const usedRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('total_upload_bytes');
        const maxRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('max_global_upload_bytes');
        const globalUsed = usedRow ? parseInt(usedRow.value) : 0;
        const globalMax = maxRow ? parseInt(maxRow.value) : 10 * 1024 * 1024 * 1024;
        // 修复 #43：globalMax 为 0 时 percent 计算为 Infinity，修正为 0
        const percent = globalMax > 0 ? (globalUsed / globalMax) * 100 : 0;
        result.globalStorage = {
            usedGB: (globalUsed / 1024 / 1024 / 1024).toFixed(2),
            maxGB: (globalMax / 1024 / 1024 / 1024).toFixed(0),
            percent: percent
        };

        // 封禁统计
        const bannedCount = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM user_bans WHERE expires_at IS NULL OR expires_at > datetime('now')`).get().count;
        result.banned = { count: bannedCount };

        res.json({ success: true, data: result });
    } catch (err) {
        console.error('获取运营数据失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 容量管理 API（管理员） ==========

// 获取全局容量配置
router.get('/api/admin/capacity/config', isAdmin, (req, res) => {
    try {
        const maxRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('max_global_upload_bytes');
        const globalMax = maxRow ? parseInt(maxRow.value) : 10 * 1024 * 1024 * 1024;
        const usedRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('total_upload_bytes');
        const used = usedRow ? parseInt(usedRow.value) : 0;
        const maxFileRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('max_file_size_bytes');
        const maxFileSize = maxFileRow ? parseInt(maxFileRow.value) : 50 * 1024 * 1024;
        
        res.json({ 
            success: true, 
            data: {
                globalMax: globalMax,
                globalMaxMB: (globalMax / 1024 / 1024).toFixed(0),
                globalMaxGB: (globalMax / 1024 / 1024 / 1024).toFixed(2),
                used: used,
                usedMB: (used / 1024 / 1024).toFixed(2),
                usedGB: (used / 1024 / 1024 / 1024).toFixed(2),
                maxFileSize: maxFileSize,
                maxFileSizeMB: (maxFileSize / 1024 / 1024).toFixed(0)
            }
        });
    } catch (err) {
        console.error('获取容量配置失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 更新全局容量
router.post('/api/admin/capacity/global', isAdmin, (req, res) => {
    const { maxGlobalGB } = req.body;
    // 修复：容量值校验，避免 NaN 写入配置
    const gb = parseFloat(maxGlobalGB);
    if (isNaN(gb) || gb < 1) {
        return res.status(400).json({ success: false, message: '请输入有效的容量值（至少1GB）' });
    }
    try {
        const maxBytes = gb * 1024 * 1024 * 1024;
        db.prepare('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)').run('max_global_upload_bytes', maxBytes.toString());
        logToFile(`管理员修改全局容量为 ${gb} GB`);
        res.json({ success: true, message: `全局容量已更新为 ${gb} GB` });
    } catch (err) {
        console.error('更新全局容量失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 修复 #44/#77：用户默认容量从 system_config 读取，不再硬编码 100MB
function getUserDefaultMaxBytes() {
    try {
        const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get('user_default_capacity_bytes');
        if (row) {
            const v = parseInt(row.value);
            if (!isNaN(v) && v > 0) return v;
        }
    } catch (e) {}
    return 100 * 1024 * 1024;
}

// 获取单个用户的容量
router.get('/api/admin/capacity/user/:userId', isAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const user = db.prepare('SELECT userId, username, role FROM users WHERE userId = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        const userRoot = db.prepare('SELECT id FROM file_nodes WHERE name = ? AND parentId = 0 AND isFolder = 1').get('user_' + userId);
        let used = 0;
        if (userRoot) {
            const files = db.prepare('SELECT SUM(fileSize) as total FROM file_nodes WHERE parentId = ? AND isFolder = 0').get(userRoot.id);
            used = files && files.total ? files.total : 0;
        }
        const customRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('user_capacity_' + userId);
        const customMax = customRow ? parseInt(customRow.value) : null;
        // 修复 #77：默认容量从 system_config 读取
        const defaultMax = getUserDefaultMaxBytes();
        
        res.json({
            success: true,
            data: {
                userId: user.userId,
                username: user.username,
                role: user.role,
                used: used,
                usedMB: (used / 1024 / 1024).toFixed(2),
                customMax: customMax,
                customMaxMB: customMax ? (customMax / 1024 / 1024).toFixed(0) : null,
                defaultMax: defaultMax,
                defaultMaxMB: (defaultMax / 1024 / 1024).toFixed(0),
                effectiveMax: customMax || defaultMax,
                effectiveMaxMB: ((customMax || defaultMax) / 1024 / 1024).toFixed(0)
            }
        });
    } catch (err) {
        console.error('获取用户容量失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 修改单个用户的容量
router.post('/api/admin/capacity/user', isAdmin, (req, res) => {
    const { userId, maxMB } = req.body;
    if (!userId) {
        return res.status(400).json({ success: false, message: '请指定用户' });
    }
    const user = db.prepare('SELECT userId, username, role FROM users WHERE userId = ?').get(parseInt(userId));
    if (!user) {
        return res.status(404).json({ success: false, message: '用户不存在' });
    }
    if (user.role === 'admin') {
        return res.status(400).json({ success: false, message: '管理员无容量限制' });
    }
    try {
        if (maxMB === null || maxMB === undefined || maxMB === '') {
            db.prepare('DELETE FROM system_config WHERE key = ?').run('user_capacity_' + userId);
            logToFile(`管理员移除用户 ${user.username} 的自定义容量`);
            res.json({ success: true, message: '已恢复默认容量 100MB' });
        } else {
            const maxBytes = parseFloat(maxMB) * 1024 * 1024;
            // 修复：容量值校验，避免 NaN 写入
            if (isNaN(maxBytes) || maxBytes < 1) {
                return res.status(400).json({ success: false, message: '容量必须大于0' });
            }
            db.prepare('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)').run('user_capacity_' + userId, maxBytes.toString());
            logToFile(`管理员设置用户 ${user.username} 的容量为 ${maxMB} MB`);
            res.json({ success: true, message: `用户 ${user.username} 的容量已设置为 ${maxMB} MB` });
        }
    } catch (err) {
        console.error('修改用户容量失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 修改单文件大小限制
router.post('/api/admin/capacity/file-size', isAdmin, (req, res) => {
    const { maxFileSizeMB } = req.body;
    // 修复：容量值校验，避免 NaN 写入配置
    const mb = parseFloat(maxFileSizeMB);
    if (isNaN(mb) || mb < 1) {
        return res.status(400).json({ success: false, message: '请输入有效的文件大小限制（至少1MB）' });
    }
    try {
        const maxBytes = mb * 1024 * 1024;
        db.prepare('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)').run('max_file_size_bytes', maxBytes.toString());
        logToFile(`管理员修改单文件大小限制为 ${mb} MB`);
        res.json({ success: true, message: `单文件大小限制已更新为 ${mb} MB` });
    } catch (err) {
        console.error('更新文件大小限制失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 获取所有用户的容量列表
router.get('/api/admin/capacity/users', isAdmin, (req, res) => {
    try {
        const users = db.prepare('SELECT userId, username, role FROM users ORDER BY userId').all();
        const result = [];
        for (var i = 0; i < users.length; i++) {
            var u = users[i];
            if (u.role === 'admin') {
                result.push({
                    userId: u.userId,
                    username: u.username,
                    role: u.role,
                    usedMB: 0,
                    maxMB: '无限制',
                    isCustom: false
                });
                continue;
            }
            var userRoot = db.prepare('SELECT id FROM file_nodes WHERE name = ? AND parentId = 0 AND isFolder = 1').get('user_' + u.userId);
            var used = 0;
            if (userRoot) {
                var files = db.prepare('SELECT SUM(fileSize) as total FROM file_nodes WHERE parentId = ? AND isFolder = 0').get(userRoot.id);
                used = files && files.total ? files.total : 0;
            }
            var customRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('user_capacity_' + u.userId);
            var customMax = customRow ? parseInt(customRow.value) : null;
            // 修复 #44：默认容量从 system_config 读取
            var defaultMax = getUserDefaultMaxBytes();
            var effectiveMax = customMax || defaultMax;
            
            result.push({
                userId: u.userId,
                username: u.username,
                role: u.role,
                usedMB: (used / 1024 / 1024).toFixed(2),
                maxMB: (effectiveMax / 1024 / 1024).toFixed(0),
                isCustom: !!customMax
            });
        }
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('获取用户容量列表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;