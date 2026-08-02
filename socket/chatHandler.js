// socket/chatHandler.js
const path = require('path');
const fs = require('fs').promises;
const { replaceEmojis } = require('../utils/helpers');
const { RECALLED_DIR } = require('../config');
const db = require('../db/connection');
const { safePath } = require('../utils/safePath');

const UPLOAD_BASE = path.join(__dirname, '../uploads');
const MAX_MESSAGE_LENGTH = 2000;
const MESSAGE_RATE_LIMIT_MS = 300;
const userLastMessageTime = new Map();

function updateGlobalUsedBytesAtomically(delta) {
    const deltaInt = parseInt(delta);
    const stmt = db.prepare(`UPDATE system_config SET value = CAST(value AS INTEGER) + ?, updated_at = datetime('now') WHERE key = ?`);
    stmt.run(deltaInt, 'total_upload_bytes');
}

function isChatBanned(userId) {
    const now = new Date().toISOString();
    const ban = db.prepare(`
        SELECT * FROM user_bans 
        WHERE user_id = ? AND (ban_type = ? OR ban_type = 'all')
        AND (expires_at IS NULL OR expires_at > ?)
        LIMIT 1
    `).get(userId, 'chat', now);
    return !!ban;
}

function checkRateLimit(userId) {
    const now = Date.now();
    const lastTime = userLastMessageTime.get(userId);
    if (lastTime && (now - lastTime) < MESSAGE_RATE_LIMIT_MS) return false;
    userLastMessageTime.set(userId, now);
    return true;
}

module.exports = (socket, io, onlineUsers, db, logToFile) => {
    const userId = socket.user.userId;
    const user = socket.user;

    socket.on('join chat', () => {
        socket.join('chatroom');
        const recentMessages = db.prepare('SELECT * FROM messages WHERE groupId = 0 ORDER BY timestamp ASC LIMIT 50').all();
        socket.emit('history messages', recentMessages);
        socket.broadcast.to('chatroom').emit('system message', `${user.username} 进入了聊天室`);
    });

    socket.on('chat message', async (rawContent, replyToId = null) => {
        if (!socket.rooms.has('chatroom')) return;
        if (isChatBanned(userId)) {
            socket.emit('system message', '您已被限制使用聊天功能');
            return;
        }
        if (rawContent && rawContent.length > MAX_MESSAGE_LENGTH) {
            socket.emit('system message', `消息内容不能超过 ${MAX_MESSAGE_LENGTH} 个字符`);
            return;
        }
        if (!checkRateLimit(userId)) {
            socket.emit('system message', '消息发送过于频繁，请稍后再试');
            return;
        }

        const content = replaceEmojis(rawContent);
        const timestamp = new Date().toISOString();
        let replyToUsername = null, replyToContent = null;
        if (replyToId) {
            const repliedMsg = db.prepare('SELECT username, content FROM messages WHERE id = ?').get(replyToId);
            if (repliedMsg) {
                replyToUsername = repliedMsg.username;
                replyToContent = repliedMsg.content ? repliedMsg.content.substring(0, 100) : '[文件]';
            }
        }
        const result = db.prepare(
            `INSERT INTO messages (userId, username, avatarUrl, content, timestamp, replyToId, replyToUsername, replyToContent, groupId) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(user.userId, user.username, user.avatarUrl, content, timestamp, replyToId, replyToUsername, replyToContent, 0);

        const newMsg = {
            id: result.lastInsertRowid,
            userId: user.userId,
            username: user.username,
            avatarUrl: user.avatarUrl,
            content,
            timestamp,
            replyToId,
            replyTo: replyToId ? { username: replyToUsername, content: replyToContent } : null
        };
        io.to('chatroom').emit('new message', newMsg);
        db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)').run(result.lastInsertRowid, userId);
    });

    socket.on('file message', async ({ fileUrl, fileName, fileType }) => {
        if (!socket.rooms.has('chatroom')) return;
        if (isChatBanned(userId)) {
            socket.emit('system message', '您已被限制使用聊天功能');
            return;
        }
        if (!checkRateLimit(userId)) {
            socket.emit('system message', '消息发送过于频繁，请稍后再试');
            return;
        }

        const timestamp = new Date().toISOString();
        const result = db.prepare(`INSERT INTO messages (userId, username, avatarUrl, fileUrl, fileName, fileType, timestamp, groupId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(user.userId, user.username, user.avatarUrl, fileUrl, fileName, fileType, timestamp, 0);
        const newMsg = {
            id: result.lastInsertRowid,
            userId: user.userId,
            username: user.username,
            avatarUrl: user.avatarUrl,
            content: '',
            fileUrl,
            fileName,
            fileType,
            timestamp
        };
        io.to('chatroom').emit('new message', newMsg);
        db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)').run(result.lastInsertRowid, userId);
    });

    socket.on('recall message', async (messageId) => {
        if (!socket.rooms.has('chatroom')) return;
        const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(messageId));
        if (!msg) return;
        if (msg.userId !== userId && user.role !== 'admin') {
            socket.emit('system message', '无权撤回此消息');
            return;
        }
        const msgTime = new Date(msg.timestamp);
        if ((new Date() - msgTime) > 120000 && user.role !== 'admin') {
            socket.emit('system message', '只能撤回2分钟内的消息');
            return;
        }
        if (msg.fileUrl) {
            try {
                const originalSafePath = safePath(UPLOAD_BASE, msg.fileUrl);
                await fs.access(originalSafePath);
                const originalFileName = msg.fileName || path.basename(msg.fileUrl);
                const now = new Date();
                const recallTime = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
                const newFilePath = path.join(RECALLED_DIR, `${recallTime}_${userId}_${originalFileName}`);
                await fs.rename(originalSafePath, newFilePath);
                logToFile(`[撤回] ${user.username} 撤回消息 ${messageId}，文件移至 ${newFilePath}`);

                const uploader = db.prepare('SELECT role FROM users WHERE userId = ?').get(msg.userId);
                if (uploader && uploader.role === 'user') {
                    updateGlobalUsedBytesAtomically(-(msg.fileSize || 0));
                }
            } catch (err) { console.error('移动文件失败:', err); }
        }
        db.prepare('DELETE FROM message_reads WHERE message_id = ?').run(Number(messageId));
        db.prepare('DELETE FROM messages WHERE id = ?').run(Number(messageId));
        io.to('chatroom').emit('message recalled', { messageId });
    });

    socket.on('mark messages read', (messageIds) => {
        const stmt = db.prepare('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)');
        for (const msgId of messageIds) {
            stmt.run(msgId, userId);
        }
    });

    // ========== 群聊功能 ==========

    socket.on('join group room', (groupId) => {
        const member = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
        if (!member) {
            socket.emit('system message', '您不在该群中');
            return;
        }
        socket.join(`group:${groupId}`);
    });

    socket.on('leave group room', (groupId) => {
        socket.leave(`group:${groupId}`);
    });

    socket.on('group message', async ({ groupId, content, replyToId = null }) => {
        const member = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
        if (!member) { socket.emit('system message', '您不在该群中'); return; }
        if (isChatBanned(userId)) { socket.emit('system message', '您已被限制使用聊天功能'); return; }
        if (content && content.length > MAX_MESSAGE_LENGTH) { socket.emit('system message', `消息不能超过${MAX_MESSAGE_LENGTH}字`); return; }
        if (!checkRateLimit(userId)) { socket.emit('system message', '发送过于频繁'); return; }

        const cleanContent = replaceEmojis(content);
        const timestamp = new Date().toISOString();
        let replyToUsername = null, replyToContent = null;
        if (replyToId) {
            const m = db.prepare('SELECT username, content FROM messages WHERE id = ? AND groupId = ?').get(replyToId, groupId);
            if (m) { replyToUsername = m.username; replyToContent = m.content ? m.content.substring(0, 100) : '[文件]'; }
        }

        const result = db.prepare(
            `INSERT INTO messages (userId, username, avatarUrl, content, timestamp, replyToId, replyToUsername, replyToContent, groupId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(user.userId, user.username, user.avatarUrl, cleanContent, timestamp, replyToId, replyToUsername, replyToContent, groupId);

        io.to(`group:${groupId}`).emit('new group message', {
            id: result.lastInsertRowid, userId: user.userId, username: user.username,
            avatarUrl: user.avatarUrl, content: cleanContent, timestamp, groupId,
            replyToId, replyTo: replyToId ? { username: replyToUsername, content: replyToContent } : null
        });
    });

    socket.on('group file message', async ({ groupId, fileUrl, fileName, fileType }) => {
        const member = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
        if (!member) { socket.emit('system message', '您不在该群中'); return; }
        if (isChatBanned(userId)) { socket.emit('system message', '您已被限制'); return; }
        if (!checkRateLimit(userId)) { socket.emit('system message', '发送过于频繁'); return; }

        const timestamp = new Date().toISOString();
        const result = db.prepare(
            `INSERT INTO messages (userId, username, avatarUrl, fileUrl, fileName, fileType, timestamp, groupId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(user.userId, user.username, user.avatarUrl, fileUrl, fileName, fileType, timestamp, groupId);

        io.to(`group:${groupId}`).emit('new group message', {
            id: result.lastInsertRowid, userId: user.userId, username: user.username,
            avatarUrl: user.avatarUrl, content: '', fileUrl, fileName, fileType, timestamp, groupId
        });
    });

    socket.on('recall group message', async ({ groupId, messageId }) => {
        const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND groupId = ?').get(Number(messageId), groupId);
        if (!msg) return;
        const member = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
        const isOwnerOrAdmin = member && (member.role === 'owner' || member.role === 'admin');
        if (msg.userId !== userId && user.role !== 'admin' && !isOwnerOrAdmin) {
            socket.emit('system message', '无权撤回');
            return;
        }
        const msgTime = new Date(msg.timestamp);
        if ((new Date() - msgTime) > 120000 && user.role !== 'admin' && !isOwnerOrAdmin) {
            socket.emit('system message', '只能撤回2分钟内消息');
            return;
        }

        if (msg.fileUrl) {
            try {
                const originalSafePath = safePath(UPLOAD_BASE, msg.fileUrl);
                await fs.access(originalSafePath);
                const stat = await fs.stat(originalSafePath);
                const fileSize = stat.size;
                const now = new Date();
                const rt = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
                const fileName = msg.fileName || path.basename(msg.fileUrl);
                await fs.rename(originalSafePath, path.join(RECALLED_DIR, `${rt}_${userId}_${fileName}`));

                const uploader = db.prepare('SELECT role FROM users WHERE userId = ?').get(msg.userId);
                if (uploader && uploader.role === 'user' && fileSize > 0) {
                    updateGlobalUsedBytesAtomically(-fileSize);
                }
            } catch (err) { console.error('移动文件失败:', err); }
        }
        db.prepare('DELETE FROM message_reads WHERE message_id = ?').run(Number(messageId));
        db.prepare('DELETE FROM messages WHERE id = ?').run(Number(messageId));
        io.to(`group:${groupId}`).emit('group message recalled', { messageId, groupId });
    });
};