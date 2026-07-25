// routes/admin.js
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const db = require('../db/connection');
const { isAdmin } = require('../middleware/admin');
const { logToFile } = require('../utils/logger');
const { DEFAULT_AVATAR_URL } = require('../config');
const { sendMail } = require('../utils/email');
const { onlineUsers, broadcastOnlineUsers, getIO } = require('../socket');
const { safePath } = require('../utils/safePath');

// 表名白名单（安全审计）
const ALLOWED_TABLES = [
    'users', 'messages', 'private_messages', 'message_reads', 'announcements',
    'file_nodes', 'notes', 'note_attachments', 'user_sessions', 'user_traffic',
    'user_bans', 'email_blacklist', 'system_config', 'agreement_version', 'report_config',
    'chat_groups', 'group_members'
];

// ========== 用户管理 ==========
router.get('/api/admin/users', isAdmin, (req, res) => {
    const users = db.prepare('SELECT userId, username, email, avatarUrl, role FROM users').all();
    res.json({ success: true, users });
});

router.post('/api/admin/kick', isAdmin, (req, res) => {
    const { userId } = req.body;
    const targetUser = db.prepare('SELECT role, username FROM users WHERE userId = ?').get(Number(userId));
    if (!targetUser) return res.json({ success: false, message: '用户不存在' });
    if (targetUser.role === 'admin') return res.json({ success: false, message: '不能踢管理员' });
    const info = onlineUsers.get(Number(userId));
    if (info) {
        const io = getIO();
        // #19 修复：清理用户所在的所有私聊房间
        for (const socketId of info.sockets) {
            const targetSocket = io?.sockets.sockets.get(socketId);
            if (targetSocket) {
                // 获取该 socket 的所有房间
                const rooms = Array.from(targetSocket.rooms || []);
                for (const room of rooms) {
                    // 退出所有私聊房间（格式：private:userId1-userId2）
                    if (room.startsWith('private:')) {
                        targetSocket.leave(room);
                    }
                }
                targetSocket.disconnect(true);
            }
        }
        onlineUsers.delete(Number(userId));
        broadcastOnlineUsers();
        logToFile(`[踢出] 管理员踢出用户 ${targetUser.username} (${userId})`);
    }
    res.json({ success: true });
});

// ========== 消息管理 ==========
router.post('/api/admin/deleteMessage', isAdmin, (req, res) => {
    const { messageId } = req.body;
    db.prepare('DELETE FROM message_reads WHERE message_id = ?').run(Number(messageId));
    db.prepare('DELETE FROM messages WHERE id = ?').run(Number(messageId));
    const io = getIO();
    if (io) io.to('chatroom').emit('message recalled', { messageId });
    res.json({ success: true });
});

router.get('/api/admin/messages', isAdmin, (req, res) => {
    const messages = db.prepare('SELECT * FROM messages ORDER BY timestamp DESC LIMIT 200').all();
    res.json({ success: true, messages });
});

// ========== 服务器日志 ==========
router.get('/api/admin/logs', isAdmin, async (req, res) => {
    try {
        const logDir = path.join(__dirname, '../logs');
        const files = await fs.readdir(logDir);
        const logFiles = files.filter(f => f.startsWith('application-')).sort().reverse();
        if (logFiles.length === 0) {
            return res.json({ success: true, logs: ['暂无日志'] });
        }
        const latestLog = path.join(logDir, logFiles[0]);
        const content = await fs.readFile(latestLog, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        res.json({ success: true, logs: lines.slice(-200) });
    } catch (err) {
        res.json({ success: true, logs: ['暂无日志'] });
    }
});

// ========== 在线时长统计 ==========
router.get('/api/admin/online-stats', isAdmin, (req, res) => {
    try {
        const stats = db.prepare(`
            SELECT u.username, COALESCE(SUM(s.duration), 0) as totalSeconds, COUNT(s.id) as sessionCount
            FROM users u
            LEFT JOIN user_sessions s ON u.userId = s.userId
            GROUP BY u.userId 
            ORDER BY totalSeconds DESC 
            LIMIT 50
        `).all();
        res.json({ success: true, stats });
    } catch (err) {
        console.error('在线统计错误:', err);
        res.json({ success: true, stats: [] });
    }
});

// ========== 流量统计 ==========
router.get('/api/admin/traffic-stats', isAdmin, (req, res) => {
    const { startDate, endDate } = req.query;
    let sql = `
        SELECT 
            u.userId,
            u.username,
            COALESCE(SUM(CASE WHEN t.type = 'upload' THEN t.bytes ELSE 0 END), 0) AS total_upload_bytes,
            COALESCE(SUM(CASE WHEN t.type = 'download' THEN t.bytes ELSE 0 END), 0) AS total_download_bytes
        FROM users u
        LEFT JOIN user_traffic t ON u.userId = t.user_id
    `;
    const params = [];
    if (startDate || endDate) {
        sql += ' WHERE 1=1';
        if (startDate) {
            sql += ' AND t.timestamp >= ?';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND t.timestamp <= ?';
            params.push(endDate + ' 23:59:59');
        }
    }
    sql += ' GROUP BY u.userId ORDER BY (total_upload_bytes + total_download_bytes) DESC';
    try {
        const stats = db.prepare(sql).all(...params);
        res.json({ success: true, stats });
    } catch (err) {
        console.error('流量统计错误:', err);
        res.json({ success: true, stats: [] });
    }
});

// ========== 全局存储容量 ==========
router.get('/api/admin/global-storage', isAdmin, (req, res) => {
    try {
        const usedRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('total_upload_bytes');
        const maxRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('max_global_upload_bytes');
        const used = usedRow ? parseInt(usedRow.value) : 0;
        const max = maxRow ? parseInt(maxRow.value) : 10 * 1024 * 1024 * 1024;
        const usedGB = (used / 1024 / 1024 / 1024).toFixed(2);
        const maxGB = (max / 1024 / 1024 / 1024).toFixed(0);
        const percent = (used / max) * 100;
        res.json({ success: true, data: { used, max, usedGB, maxGB, percent } });
    } catch (err) {
        console.error('获取全局存储容量失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 邮件公告 ==========
router.post('/api/admin/send-email-announcement', isAdmin, async (req, res) => {
    const { target, subject, message } = req.body;
    if (!subject || !message) return res.status(400).json({ success: false, message: '主题和内容不能为空' });
    try {
        if (target === 'all') {
            const users = db.prepare('SELECT email FROM users WHERE email IS NOT NULL AND email != ""').all();
            if (users.length === 0) return res.status(400).json({ success: false, message: '没有找到任何用户的邮箱' });
            let successCount = 0, failCount = 0;
            for (const u of users) {
                try {
                    await sendMail(u.email, subject, `<p>${message.replace(/\n/g, '<br>')}</p>`);
                    successCount++;
                } catch (err) { failCount++; }
            }
            res.json({ success: true, message: `邮件发送完成：成功 ${successCount}，失败 ${failCount}` });
        } else if (target && target.includes('@')) {
            await sendMail(target, subject, `<p>${message.replace(/\n/g, '<br>')}</p>`);
            res.json({ success: true, message: `邮件已发送至 ${target}` });
        } else {
            res.status(400).json({ success: false, message: '目标格式错误' });
        }
    } catch (err) {
        console.error('发送邮件失败:', err);
        res.status(500).json({ success: false, message: '发送失败: ' + err.message });
    }
});

// ========== 封禁管理 ==========
router.get('/api/admin/bans', isAdmin, (req, res) => {
    const bans = db.prepare(`
        SELECT b.*, u.username 
        FROM user_bans b
        LEFT JOIN users u ON b.user_id = u.userId
        ORDER BY b.banned_at DESC
    `).all();
    res.json({ success: true, bans });
});

router.post('/api/admin/bans', isAdmin, (req, res) => {
    const { userId, banType, reason, expiresAt } = req.body;
    if (!userId || !banType) return res.status(400).json({ success: false, message: '缺少必要参数' });
    const validTypes = ['login', 'chat', 'files_upload', 'files_download', 'notes', 'all'];
    if (!validTypes.includes(banType)) return res.status(400).json({ success: false, message: '无效的封禁类型' });
    const user = db.prepare('SELECT userId FROM users WHERE userId = ?').get(userId);
    if (!user) return res.status(404).json({ success: false, message: '用户不存在' });
    const expires = expiresAt ? new Date(expiresAt).toISOString() : null;
    db.prepare(`
        INSERT INTO user_bans (user_id, ban_type, reason, expires_at) 
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, ban_type) DO UPDATE SET 
            reason = excluded.reason,
            expires_at = excluded.expires_at,
            banned_at = CURRENT_TIMESTAMP
    `).run(userId, banType, reason || null, expires);
    logToFile(`管理员添加封禁: 用户 ${userId}, 类型 ${banType}, 原因 ${reason || '无'}`);
    res.json({ success: true });
});

router.delete('/api/admin/bans/:userId/:banType', isAdmin, (req, res) => {
    const { userId, banType } = req.params;
    db.prepare('DELETE FROM user_bans WHERE user_id = ? AND ban_type = ?').run(userId, banType);
    logToFile(`管理员解除封禁: 用户 ${userId}, 类型 ${banType}`);
    res.json({ success: true });
});

router.get('/api/admin/bans/user/:userId', isAdmin, (req, res) => {
    const { userId } = req.params;
    const now = new Date().toISOString();
    const bans = db.prepare(`
        SELECT * FROM user_bans 
        WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY banned_at DESC
    `).all(userId, now);
    res.json({ success: true, bans });
});

// ========== 邮箱黑名单 ==========
router.get('/api/admin/email-blacklist', isAdmin, (req, res) => {
    const list = db.prepare('SELECT * FROM email_blacklist ORDER BY created_at DESC').all();
    res.json({ success: true, list });
});

router.post('/api/admin/email-blacklist', isAdmin, (req, res) => {
    const { email, reason } = req.body;
    if (!email) return res.status(400).json({ success: false, message: '邮箱不能为空' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: '邮箱格式不正确' });
    try {
        db.prepare('INSERT OR IGNORE INTO email_blacklist (email, reason) VALUES (?, ?)').run(email, reason || null);
        logToFile(`管理员添加邮箱黑名单: ${email}, 原因: ${reason || '无'}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/api/admin/email-blacklist/:email', isAdmin, (req, res) => {
    const { email } = req.params;
    db.prepare('DELETE FROM email_blacklist WHERE email = ?').run(email);
    logToFile(`管理员从黑名单移除邮箱: ${email}`);
    res.json({ success: true });
});

// ========== 文件清理工具 ==========
router.get('/api/admin/scan-files', isAdmin, async (req, res) => {
    const uploadDir = path.join(__dirname, '../uploads');
    const results = { orphanFiles: [], missingFiles: [], totalLocal: 0, totalDb: 0 };
    const localFiles = [];
    async function scanDir(dir, basePath = '') {
        try {
            const items = await fs.readdir(dir, { withFileTypes: true });
            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                const relativePath = path.join(basePath, item.name).replace(/\\/g, '/');
                if (item.isDirectory()) {
                    if (item.name === 'recalled') continue;
                    await scanDir(fullPath, relativePath);
                } else {
                    const stat = await fs.stat(fullPath);
                    localFiles.push({ fullPath, relativePath: `/uploads/${relativePath}`, size: stat.size, mtime: stat.mtime });
                }
            }
        } catch (err) { console.error('扫描目录失败:', err); }
    }
    await scanDir(uploadDir);
    results.totalLocal = localFiles.length;
    const dbFilesMap = new Map();
    const nodes = db.prepare('SELECT id, fileUrl FROM file_nodes WHERE fileUrl IS NOT NULL').all();
    for (const node of nodes) dbFilesMap.set(node.fileUrl, { table: 'file_nodes', id: node.id });
    const messages = db.prepare('SELECT id, fileUrl FROM messages WHERE fileUrl IS NOT NULL').all();
    for (const msg of messages) dbFilesMap.set(msg.fileUrl, { table: 'messages', id: msg.id });
    const users = db.prepare('SELECT userId, avatarUrl FROM users WHERE avatarUrl IS NOT NULL').all();
    for (const user of users) dbFilesMap.set(user.avatarUrl, { table: 'users', id: user.userId });
    // #25 修复：添加云笔记附件到映射
    const noteAttachments = db.prepare('SELECT id, fileUrl FROM note_attachments WHERE fileUrl IS NOT NULL').all();
    for (const att of noteAttachments) {
        dbFilesMap.set(att.fileUrl, { table: 'note_attachments', id: att.id });
    }
    results.totalDb = dbFilesMap.size;
    for (const local of localFiles) {
        if (!dbFilesMap.has(local.relativePath)) {
            if (local.relativePath.startsWith('/uploads/avatars/')) continue;
            results.orphanFiles.push(local);
        }
    }
    for (const [dbUrl, info] of dbFilesMap.entries()) {
        if (dbUrl.startsWith('http://') || dbUrl.startsWith('https://')) continue;
        const localPath = path.join(__dirname, '../', dbUrl);
        try { await fs.access(localPath); } catch (err) {
            results.missingFiles.push({ fileUrl: dbUrl, error: err.message, table: info.table, id: info.id });
        }
    }
    res.json({ success: true, results });
});

router.post('/api/admin/clean-orphan-files', isAdmin, async (req, res) => {
    const { files } = req.body;
    const uploadBase = path.join(__dirname, '../uploads');
    let deleted = 0, errors = [];
    for (const filePath of files) {
        let safeFilePath;
        try {
            safeFilePath = safePath(uploadBase, filePath);
        } catch (e) {
            errors.push({ file: filePath, error: '路径非法: ' + e.message });
            continue;
        }
        if (safeFilePath.startsWith(path.join(uploadBase, 'avatars'))) {
            errors.push({ file: filePath, error: '禁止删除头像文件' });
            continue;
        }
        try {
            await fs.unlink(safeFilePath);
            deleted++;
            logToFile(`[清理] 已删除孤儿文件: ${filePath}`);
        } catch (err) {
            errors.push({ file: filePath, error: err.message });
        }
    }
    res.json({ success: true, deleted, errors });
});

router.post('/api/admin/delete-missing-record', isAdmin, async (req, res) => {
    const { fileUrl, table, id } = req.body;
    if (!fileUrl || !table || !id) return res.status(400).json({ success: false, message: '参数不全' });
    try {
        if (table === 'file_nodes') db.prepare('DELETE FROM file_nodes WHERE id = ?').run(Number(id));
        else if (table === 'messages') db.prepare('DELETE FROM messages WHERE id = ?').run(Number(id));
        else if (table === 'users') db.prepare('UPDATE users SET avatarUrl = ? WHERE userId = ?').run(DEFAULT_AVATAR_URL, Number(id));
        else if (table === 'note_attachments') db.prepare('DELETE FROM note_attachments WHERE id = ?').run(Number(id));
        else return res.status(400).json({ success: false, message: '不支持的表' });
        logToFile(`[清理] 已删除缺失文件记录: ${table} ID=${id}, 路径=${fileUrl}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 数据库管理（安全审计） ==========
router.get('/api/admin/db/tables', isAdmin, (req, res) => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const filteredTables = tables.filter(t => ALLOWED_TABLES.includes(t.name));
    res.json({ success: true, tables: filteredTables });
});

router.get('/api/admin/db/schema', isAdmin, (req, res) => {
    const { table } = req.query;
    if (!table) return res.status(400).json({ success: false });
    if (!ALLOWED_TABLES.includes(table)) {
        return res.status(403).json({ success: false, message: '不允许查询此表' });
    }
    try {
        const schema = db.prepare(`PRAGMA table_info(${table})`).all();
        res.json({ success: true, schema });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/api/admin/db/query', isAdmin, (req, res) => {
    const { sql } = req.body;
    if (!sql) return res.status(400).json({ success: false });
    const upperSql = sql.trim().toUpperCase();
    if (!upperSql.startsWith('SELECT')) return res.status(403).json({ success: false, message: '只允许 SELECT 查询' });
    const lowerSql = sql.toLowerCase();
    let tableFound = false;
    for (const table of ALLOWED_TABLES) {
        if (lowerSql.includes(table.toLowerCase())) {
            tableFound = true;
            break;
        }
    }
    if (!tableFound) return res.status(403).json({ success: false, message: '查询仅限白名单中的表' });
    const forbiddenPatterns = ['sqlite_master', 'sqlite_sequence', 'sqlite_temp'];
    for (const pattern of forbiddenPatterns) {
        if (lowerSql.includes(pattern)) {
            return res.status(403).json({ success: false, message: '不允许查询系统表' });
        }
    }
    try {
        const rows = db.prepare(sql).all();
        res.json({ success: true, rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/api/admin/db/data', isAdmin, (req, res) => {
    const { table, limit = 100 } = req.query;
    if (!table) return res.status(400).json({ success: false });
    if (!ALLOWED_TABLES.includes(table)) {
        return res.status(403).json({ success: false, message: '不允许查询此表' });
    }
    try {
        const rows = db.prepare(`SELECT * FROM ${table} LIMIT ?`).all(parseInt(limit));
        res.json({ success: true, rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 重启服务器（优雅关闭） ==========
router.post('/api/admin/restart', isAdmin, (req, res) => {
    res.json({ success: true, message: '服务器即将重启，倒计时10秒...' });
    const io = getIO();
    if (io) {
        io.to('global').emit('system message', '⚠️ 服务器将在10秒后重启，请保存数据！');
        let countdown = 10;
        const interval = setInterval(() => {
            countdown--;
            io.to('global').emit('system message', `⏰ 服务器重启倒计时: ${countdown} 秒`);
            if (countdown <= 0) {
                clearInterval(interval);
                io.to('global').emit('system message', '🔄 服务器正在重启...');
                if (process.send) {
                    process.send('shutdown');
                } else {
                    console.log('Graceful shutdown requested');
                    process.exit(0);
                }
            }
        }, 1000);
    } else {
        console.log('Graceful shutdown requested');
        process.exit(0);
    }
});

module.exports = router;