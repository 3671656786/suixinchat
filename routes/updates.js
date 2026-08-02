// routes/updates.js
const express = require('express');
const router = express.Router();
const db = require('../db/updatesConnection');
const mainDb = require('../db/connection');
const { isLoggedIn } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');
const { sendMail } = require('../utils/email');
const { logToFile } = require('../utils/logger');
const { getIO } = require('../socket');

// ========== 获取当前最大版本号 ==========
function getNextVersion() {
    const row = db.prepare('SELECT version FROM updates ORDER BY id DESC LIMIT 1').get();
    if (!row) return '0.1';
    const parts = row.version.split('.');
    const major = parseInt(parts[0]) || 0;
    const minor = parseInt(parts[1]) || 0;
    return `${major}.${minor + 1}`;
}

// ========== 生成公告模板 ==========
function generateTemplate(version) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return `${dateStr} 更新公告 (v${version})\n\n1. \n2. \n3. \n\n...`;
}

// ========== 获取更新公告列表（支持时间筛选） ==========
router.get('/api/updates', isLoggedIn, (req, res) => {
    const { startDate, endDate, limit = 50 } = req.query;
    try {
        // 直接返回 created_at，不加时区转换（服务器时区已设为 Asia/Shanghai）
        let sql = 'SELECT id, version, title, content, created_at, is_sent FROM updates WHERE 1=1';
        const params = [];
        if (startDate) {
            sql += ' AND date(created_at) >= date(?)';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND date(created_at) <= date(?)';
            params.push(endDate);
        }
        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        const updates = db.prepare(sql).all(...params);
        res.json({ success: true, updates });
    } catch (err) {
        console.error('获取更新公告失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 获取最近三天的更新公告（用于首次登录弹窗） ==========
router.get('/api/updates/recent', isLoggedIn, (req, res) => {
    const userId = req.userId;
    try {
        // 直接返回 created_at，不加时区转换
        const updates = db.prepare(`
            SELECT id, version, title, content, created_at, is_sent 
            FROM updates 
            WHERE date(created_at) >= date('now', '-3 days')
            ORDER BY created_at DESC
        `).all();

        const readIds = [];
        for (const u of updates) {
            const read = db.prepare('SELECT 1 FROM user_read_updates WHERE user_id = ? AND update_id = ?').get(userId, u.id);
            if (read) readIds.push(u.id);
        }
        const unreadUpdates = updates.filter(u => !readIds.includes(u.id));
        res.json({ success: true, updates: unreadUpdates });
    } catch (err) {
        console.error('获取最近更新公告失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 标记公告为已读 ==========
router.post('/api/updates/read', isLoggedIn, (req, res) => {
    const userId = req.userId;
    const { updateId } = req.body;
    if (!updateId) return res.status(400).json({ success: false, message: '缺少公告ID' });
    try {
        db.prepare('INSERT OR IGNORE INTO user_read_updates (user_id, update_id, read_at) VALUES (?, ?, datetime("now"))').run(userId, updateId);
        res.json({ success: true });
    } catch (err) {
        console.error('标记已读失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 创建更新公告（仅管理员） ==========
router.post('/api/updates', isAdmin, async (req, res) => {
    const { title, content, sendEmail, emailTarget, userIds } = req.body;

    if (!title || !content) {
        return res.status(400).json({ success: false, message: '标题和内容不能为空' });
    }

    try {
        const version = getNextVersion();
        // datetime('now') 使用服务器时区（已设为 Asia/Shanghai）
        const result = db.prepare(`
            INSERT INTO updates (version, title, content, created_at, is_sent)
            VALUES (?, ?, ?, datetime('now'), ?)
        `).run(version, title, content, sendEmail ? 1 : 0);

        const updateId = result.lastInsertRowid;
        logToFile(`[更新公告] 管理员创建公告 v${version}: ${title}`);

        if (sendEmail) {
            let emailList = [];

            if (emailTarget === 'all') {
                const users = mainDb.prepare('SELECT userId, username, email FROM users WHERE email IS NOT NULL AND email != "" AND receive_email_announcements = 1').all();
                emailList = users.map(u => ({ email: u.email, userId: u.userId, username: u.username }));
            } else if (emailTarget === 'users' && userIds && userIds.length > 0) {
                const placeholders = userIds.map(() => '?').join(',');
                const sql = `SELECT userId, username, email FROM users WHERE userId IN (${placeholders}) AND email IS NOT NULL AND email != "" AND receive_email_announcements = 1`;
                const users = mainDb.prepare(sql).all(...userIds);
                emailList = users.map(u => ({ email: u.email, userId: u.userId, username: u.username }));
            }

            if (emailList.length > 0) {
                res.json({
                    success: true,
                    updateId: updateId,
                    version: version,
                    total: emailList.length,
                    message: '公告已创建，邮件发送中...'
                });

                (async function sendEmails() {
                    let successCount = 0;
                    let failCount = 0;
                    const io = getIO();

                    for (let i = 0; i < emailList.length; i++) {
                        const recipient = emailList[i];
                        const email = recipient.email;
                        const username = recipient.username || '用户';

                        try {
                            const mailContent = `
                                <h2>📢 ${title}</h2>
                                <p><strong>版本：</strong>v${version}</p>
                                <hr>
                                <p>${content.replace(/\n/g, '<br>')}</p>
                                <hr>
                                <p style="color:#999; font-size:12px;">此邮件由随心聊系统自动发送，请勿回复。</p>
                            `;
                            await sendMail(email, `【随心聊】${title}`, mailContent);
                            successCount++;
                            logToFile(`[更新公告邮件] 已发送至 ${email} (${i + 1}/${emailList.length})`);
                        } catch (err) {
                            failCount++;
                            console.error(`[更新公告邮件] 发送失败 ${email}:`, err);
                        }

                        if (io) {
                            io.to('admin').emit('update_email_progress', {
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

                    logToFile(`[更新公告邮件] 发送完成：成功 ${successCount}，失败 ${failCount}`);
                    if (io) {
                        io.to('admin').emit('update_email_complete', {
                            success: successCount,
                            fail: failCount,
                            total: emailList.length
                        });
                    }
                })();
            } else {
                res.json({ success: true, updateId: updateId, version: version, message: '公告已创建，无邮件发送' });
            }
        } else {
            res.json({ success: true, updateId: updateId, version: version, message: '公告已创建' });
        }
    } catch (err) {
        console.error('创建更新公告失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 获取公告模板 ==========
router.get('/api/updates/template', isAdmin, (req, res) => {
    try {
        const version = getNextVersion();
        const template = generateTemplate(version);
        res.json({ success: true, version, template });
    } catch (err) {
        console.error('获取模板失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 删除更新公告（仅管理员） ==========
router.delete('/api/updates/:id', isAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const update = db.prepare('SELECT version, title FROM updates WHERE id = ?').get(id);
        if (!update) return res.status(404).json({ success: false, message: '公告不存在' });
        db.prepare('DELETE FROM user_read_updates WHERE update_id = ?').run(id);
        db.prepare('DELETE FROM updates WHERE id = ?').run(id);
        logToFile(`[更新公告] 管理员删除公告 v${update.version}: ${update.title}`);
        res.json({ success: true });
    } catch (err) {
        console.error('删除更新公告失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;