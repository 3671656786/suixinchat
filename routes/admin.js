// routes/admin.js
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const db = require('../db/connection');
const notesDb = require('../db/notesConnection');
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
    'chat_groups', 'group_members', 'group_ban_list', 'group_join_requests'
];

console.log('✅ routes/admin.js 已加载');

// ========== 辅助函数：清理用户私聊房间 ==========
function cleanupUserPrivateRooms(io, userId) {
    try {
        // 获取用户的所有私聊房间
        const rooms = db.prepare(`
            SELECT DISTINCT 
                CASE WHEN from_user = ? THEN to_user ELSE from_user END as otherUserId
            FROM private_messages 
            WHERE from_user = ? OR to_user = ?
        `).all(userId, userId, userId);
        
        for (const room of rooms) {
            const roomId = [userId, room.otherUserId].sort().join('-');
            const sockets = onlineUsers.get(userId)?.sockets || [];
            for (const socketId of sockets) {
                const socket = io?.sockets.sockets.get(socketId);
                if (socket) {
                    socket.leave(`private:${roomId}`);
                    socket.emit('system message', '您已被管理员踢出，所有私聊连接已断开');
                }
            }
        }
        console.log(`[管理员踢人] 已清理用户 ${userId} 的私聊房间`);
    } catch (err) {
        console.error('[管理员踢人] 清理私聊房间失败:', err);
    }
}

// ========== 用户管理 ==========
router.get('/api/admin/users', isAdmin, (req, res) => {
    const users = db.prepare('SELECT userId, username, email, avatarUrl, role, receive_email_announcements FROM users').all();
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
        // 清理私聊房间
        cleanupUserPrivateRooms(io, Number(userId));
        
        for (const socketId of info.sockets) {
            const targetSocket = io?.sockets.sockets.get(socketId);
            if (targetSocket) {
                const rooms = Array.from(targetSocket.rooms || []);
                for (const room of rooms) {
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
    const { target, subject, message, userIds } = req.body;
    if (!subject || !message) {
        return res.status(400).json({ success: false, message: '主题和内容不能为空' });
    }

    try {
        let emailList = [];
        let userList = [];

        if (target === 'all') {
            const users = db.prepare('SELECT userId, username, email FROM users WHERE email IS NOT NULL AND email != "" AND receive_email_announcements = 1').all();
            emailList = users.map(u => ({ email: u.email, userId: u.userId, username: u.username }));
            userList = users;
        } else if (target === 'users' && userIds && userIds.length > 0) {
            const placeholders = userIds.map(() => '?').join(',');
            const sql = `SELECT userId, username, email FROM users WHERE userId IN (${placeholders}) AND email IS NOT NULL AND email != "" AND receive_email_announcements = 1`;
            const users = db.prepare(sql).all(...userIds);
            emailList = users.map(u => ({ email: u.email, userId: u.userId, username: u.username }));
            userList = users;
        } else if (target && target.includes('@')) {
            emailList = [{ email: target, userId: null, username: null }];
        } else {
            return res.status(400).json({ success: false, message: '目标格式错误' });
        }

        if (emailList.length === 0) {
            return res.status(400).json({ success: false, message: '没有找到符合条件的收件人' });
        }

        res.json({
            success: true,
            total: emailList.length,
            message: '开始发送邮件',
            emails: emailList.map(e => e.email)
        });

        (async function sendEmails() {
            let successCount = 0;
            let failCount = 0;
            let failedEmails = [];
            const io = getIO();

            for (let i = 0; i < emailList.length; i++) {
                const recipient = emailList[i];
                const email = recipient.email;
                const username = recipient.username || '用户';

                try {
                    const personalizedMessage = message.replace(/\{username\}/g, username);
                    await sendMail(email, subject, `<p>${personalizedMessage.replace(/\n/g, '<br>')}</p>`);
                    successCount++;
                    logToFile(`[邮件公告] 已发送至 ${email} (${i + 1}/${emailList.length})`);
                } catch (err) {
                    failCount++;
                    failedEmails.push(email);
                    console.error(`[邮件公告] 发送失败 ${email}:`, err);
                }

                if (io) {
                    io.to('admin').emit('email_progress', {
                        sent: i + 1,
                        total: emailList.length,
                        success: successCount,
                        fail: failCount,
                        currentEmail: email
                    });
                }

                if (i < emailList.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
            }

            logToFile(`[邮件公告] 发送完成：成功 ${successCount}，失败 ${failCount}`);
            if (io) {
                io.to('admin').emit('email_complete', {
                    success: successCount,
                    fail: failCount,
                    total: emailList.length,
                    failedEmails: failedEmails
                });
            }
        })();

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

// 扫描
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
                    localFiles.push({ 
                        fullPath, 
                        relativePath: `/uploads/${relativePath}`, 
                        size: stat.size, 
                        mtime: stat.mtime 
                    });
                }
            }
        } catch (err) { console.error('扫描目录失败:', err); }
    }
    await scanDir(uploadDir);
    results.totalLocal = localFiles.length;

    // 构建数据库文件映射
    const dbFilesMap = new Map();

    const nodes = db.prepare('SELECT id, fileUrl FROM file_nodes WHERE fileUrl IS NOT NULL').all();
    for (const node of nodes) dbFilesMap.set(node.fileUrl, { table: 'file_nodes', id: node.id });
    const messages = db.prepare('SELECT id, fileUrl FROM messages WHERE fileUrl IS NOT NULL').all();
    for (const msg of messages) dbFilesMap.set(msg.fileUrl, { table: 'messages', id: msg.id });
    const users = db.prepare('SELECT userId, avatarUrl FROM users WHERE avatarUrl IS NOT NULL').all();
    for (const user of users) dbFilesMap.set(user.avatarUrl, { table: 'users', id: user.userId });

    try {
        const noteAttachments = notesDb.prepare('SELECT id, fileUrl FROM note_attachments WHERE fileUrl IS NOT NULL').all();
        for (const att of noteAttachments) {
            dbFilesMap.set(att.fileUrl, { table: 'note_attachments', id: att.id });
        }
    } catch (err) {
        console.error('读取 notes.db 失败:', err);
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
        try {
            await fs.access(localPath);
        } catch (err) {
            results.missingFiles.push({ 
                fileUrl: dbUrl, 
                error: err.message, 
                table: info.table, 
                id: info.id 
            });
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
        if (table === 'file_nodes') {
            db.prepare('DELETE FROM file_nodes WHERE id = ?').run(Number(id));
        } else if (table === 'messages') {
            db.prepare('DELETE FROM messages WHERE id = ?').run(Number(id));
        } else if (table === 'users') {
            db.prepare('UPDATE users SET avatarUrl = ? WHERE userId = ?').run(DEFAULT_AVATAR_URL, Number(id));
        } else if (table === 'note_attachments') {
            notesDb.prepare('DELETE FROM note_attachments WHERE id = ?').run(Number(id));
        } else {
            return res.status(400).json({ success: false, message: '不支持的表' });
        }
        logToFile(`[清理] 已删除缺失文件记录: ${table} ID=${id}, 路径=${fileUrl}`);
        res.json({ success: true });
    } catch (err) {
        console.error('删除缺失记录失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 文件清理申请管理 ==========
const CLEAN_REQUESTS_DIR = path.join(__dirname, '../clean_requests');
if (!fsSync.existsSync(CLEAN_REQUESTS_DIR)) {
    fsSync.mkdirSync(CLEAN_REQUESTS_DIR, { recursive: true });
}

router.post('/api/admin/clean-request', isAdmin, (req, res) => {
    const { type, items } = req.body;
    if (!type || !items || !items.length) {
        return res.status(400).json({ success: false, message: '缺少参数' });
    }

    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const filename = `clean_${type}_${timestamp}.txt`;
    const filePath = path.join(CLEAN_REQUESTS_DIR, filename);

    let content = `时间: ${now.toLocaleString()}\n操作类型: ${type === 'orphan' ? '删除孤儿文件' : '删除缺失记录'}\n确定删除: 否\n\n`;
    if (type === 'orphan') {
        content += `待删除文件:\n`;
        for (const item of items) {
            content += `  - ${item.relativePath} (${item.size} bytes)\n`;
        }
    } else {
        content += `待删除记录:\n`;
        for (const item of items) {
            content += `  - 表: ${item.table}, ID: ${item.id}, 路径: ${item.fileUrl}\n`;
        }
    }
    content += `\n请确认后，将 "确定删除: 否" 改为 "确定删除: 是" 以执行。`;

    fsSync.writeFileSync(filePath, content, 'utf8');
    logToFile(`[清理申请] 管理员 ${req.session.userId} 创建申请文件 ${filename}`);
    res.json({ success: true, message: '清理申请已创建，请等待管理员审核。', filename });
});

router.get('/api/admin/clean-requests', isAdmin, (req, res) => {
    try {
        const files = fsSync.readdirSync(CLEAN_REQUESTS_DIR);
        const list = files.filter(f => f.startsWith('clean_') && f.endsWith('.txt')).map(f => {
            const filePath = path.join(CLEAN_REQUESTS_DIR, f);
            const content = fsSync.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            const statusLine = lines.find(l => l.includes('确定删除:'));
            const isApproved = statusLine ? statusLine.includes('是') : false;
            const typeLine = lines.find(l => l.includes('操作类型:'));
            const type = typeLine ? typeLine.replace('操作类型:', '').trim() : '未知';
            return { filename: f, isApproved, type, content };
        });
        res.json({ success: true, list });
    } catch (err) {
        console.error('获取清理申请文件列表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/api/admin/apply-clean-requests', isAdmin, async (req, res) => {
    try {
        const files = fsSync.readdirSync(CLEAN_REQUESTS_DIR);
        let executed = 0, failed = 0, results = [];
        for (const f of files) {
            if (!f.startsWith('clean_') || !f.endsWith('.txt')) continue;
            const filePath = path.join(CLEAN_REQUESTS_DIR, f);
            const content = fsSync.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            const statusLine = lines.find(l => l.includes('确定删除:'));
            if (!statusLine || !statusLine.includes('是')) continue;
            const typeLine = lines.find(l => l.includes('操作类型:'));
            const type = typeLine ? typeLine.replace('操作类型:', '').trim() : '';
            if (!type) continue;

            let success = true;
            let errorMsg = '';
            try {
                if (type === '删除孤儿文件') {
                    const pathLines = content.match(/- .*?\((.*?)\)/g);
                    if (pathLines) {
                        for (const line of pathLines) {
                            const match = line.match(/- (.*?) \(/);
                            if (match) {
                                const relativePath = match[1].trim();
                                const uploadBase = path.join(__dirname, '../uploads');
                                const safeFilePath = safePath(uploadBase, relativePath);
                                if (safeFilePath.startsWith(path.join(uploadBase, 'avatars'))) {
                                    continue;
                                }
                                try {
                                    await fs.unlink(safeFilePath);
                                    logToFile(`[清理申请] 已删除孤儿文件: ${relativePath}`);
                                } catch (err) {
                                    logToFile(`[清理申请] 删除文件失败: ${relativePath}, ${err.message}`);
                                }
                            }
                        }
                    }
                } else if (type === '删除缺失记录') {
                    const recordLines = content.match(/- 表: (.*?), ID: (\d+), 路径: (.*?)(?:\n|$)/g);
                    if (recordLines) {
                        for (const line of recordLines) {
                            const match = line.match(/- 表: (.*?), ID: (\d+), 路径: (.*?)(?:\n|$)/);
                            if (match) {
                                const table = match[1].trim();
                                const id = parseInt(match[2]);
                                const fileUrl = match[3].trim();
                                if (table === 'file_nodes') {
                                    db.prepare('DELETE FROM file_nodes WHERE id = ?').run(id);
                                } else if (table === 'messages') {
                                    db.prepare('DELETE FROM messages WHERE id = ?').run(id);
                                } else if (table === 'users') {
                                    db.prepare('UPDATE users SET avatarUrl = ? WHERE userId = ?').run(DEFAULT_AVATAR_URL, id);
                                } else if (table === 'note_attachments') {
                                    notesDb.prepare('DELETE FROM note_attachments WHERE id = ?').run(id);
                                } else {
                                    continue;
                                }
                                logToFile(`[清理申请] 已删除缺失记录: ${table} ID=${id}`);
                            }
                        }
                    }
                } else {
                    success = false;
                    errorMsg = '未知操作类型';
                }
            } catch (err) {
                success = false;
                errorMsg = err.message;
            }

            if (success) {
                executed++;
                results.push({ file: f, success: true });
                const newName = f.replace('.txt', '_executed.txt');
                fsSync.renameSync(filePath, path.join(CLEAN_REQUESTS_DIR, newName));
            } else {
                failed++;
                results.push({ file: f, success: false, error: errorMsg });
            }
        }
        res.json({ success: true, executed, failed, results });
    } catch (err) {
        console.error('应用清理申请失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 数据库管理 ==========
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

// ========== 数据库修改申请管理 ==========
const MODIFY_REQUESTS_DIR = path.join(__dirname, '../modify_requests');
if (!fsSync.existsSync(MODIFY_REQUESTS_DIR)) {
    fsSync.mkdirSync(MODIFY_REQUESTS_DIR, { recursive: true });
}

router.post('/api/admin/db/request-modify', isAdmin, (req, res) => {
    const { sql } = req.body;
    if (!sql) {
        return res.status(400).json({ success: false, message: 'SQL 语句不能为空' });
    }
    const upperSql = sql.trim().toUpperCase();
    if (upperSql.startsWith('DROP') || upperSql.startsWith('TRUNCATE') || upperSql.startsWith('ALTER')) {
        return res.status(400).json({ success: false, message: '不允许执行 DROP/TRUNCATE/ALTER 操作' });
    }

    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const filename = `modify_${timestamp}.txt`;
    const filePath = path.join(MODIFY_REQUESTS_DIR, filename);
    const content = `时间: ${now.toLocaleString()}\n申请内容: ${sql}\n确定修改: 否\n`;
    fsSync.writeFileSync(filePath, content, 'utf8');
    logToFile(`[数据库修改申请] 管理员 ${req.session.userId} 创建申请文件 ${filename}`);
    res.json({ success: true, message: '申请已创建，请等待管理员审核（修改文件中的"确定修改"为"是"）。', filename });
});

router.get('/api/admin/db/modify-files', isAdmin, (req, res) => {
    try {
        const files = fsSync.readdirSync(MODIFY_REQUESTS_DIR);
        const list = files.filter(f => f.startsWith('modify_') && f.endsWith('.txt')).map(f => {
            const filePath = path.join(MODIFY_REQUESTS_DIR, f);
            const content = fsSync.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            const statusLine = lines.find(l => l.includes('确定修改:'));
            const isApproved = statusLine ? statusLine.includes('是') : false;
            const sqlLine = lines.find(l => l.includes('申请内容:'));
            const sql = sqlLine ? sqlLine.replace('申请内容:', '').trim() : '';
            return { filename: f, isApproved, sql, content };
        });
        res.json({ success: true, list });
    } catch (err) {
        console.error('获取修改文件列表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/api/admin/db/apply-modify', isAdmin, (req, res) => {
    try {
        const files = fsSync.readdirSync(MODIFY_REQUESTS_DIR);
        let executed = 0, failed = 0, results = [];
        for (const f of files) {
            if (!f.startsWith('modify_') || !f.endsWith('.txt')) continue;
            const filePath = path.join(MODIFY_REQUESTS_DIR, f);
            const content = fsSync.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            const statusLine = lines.find(l => l.includes('确定修改:'));
            if (!statusLine || !statusLine.includes('是')) continue;
            const sqlLine = lines.find(l => l.includes('申请内容:'));
            if (!sqlLine) continue;
            const sql = sqlLine.replace('申请内容:', '').trim();
            try {
                const upperSql = sql.trim().toUpperCase();
                if (upperSql.startsWith('UPDATE') || upperSql.startsWith('INSERT') || upperSql.startsWith('DELETE')) {
                    const result = db.prepare(sql).run();
                    executed++;
                    results.push({ file: f, success: true, changes: result.changes });
                    const newName = f.replace('.txt', '_executed.txt');
                    fsSync.renameSync(filePath, path.join(MODIFY_REQUESTS_DIR, newName));
                    logToFile(`[数据库修改] 管理员执行修改文件 ${f}，影响 ${result.changes} 行`);
                } else {
                    failed++;
                    results.push({ file: f, success: false, error: '不支持的SQL类型，只允许 UPDATE/INSERT/DELETE' });
                }
            } catch (err) {
                failed++;
                results.push({ file: f, success: false, error: err.message });
                logToFile(`[数据库修改] 执行文件 ${f} 失败: ${err.message}`);
            }
        }
        res.json({ success: true, executed, failed, results });
    } catch (err) {
        console.error('应用修改失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 重启服务器 ==========
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

// ========== 测试路由 ==========
router.get('/api/admin/test', isAdmin, (req, res) => {
    res.json({ success: true, message: 'Admin route works!' });
});

module.exports = router;