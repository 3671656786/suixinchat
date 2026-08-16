// socket/privateHandler.js
const db = require('../db/connection');
const { replaceEmojis } = require('../utils/helpers');
const { MAX_MESSAGE_LENGTH } = require('../config');

const MAX_PRIVATE_LENGTH = MAX_MESSAGE_LENGTH || 2000;

// 检查私聊封禁
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

module.exports = (socket, io, onlineUsers, db) => {
    // 修复 #12：防御 socket.user 缺失导致的崩溃
    if (!socket.user) {
        socket.disconnect(true);
        return;
    }
    const userId = socket.user.userId;
    const user = socket.user;
    
    socket.on('join private room', (targetUserId) => {
        const roomId = [userId, targetUserId].sort().join('-');
        // 统一房间名前缀（与 admin 踢人清理、statusHandler 房间清理逻辑一致）
        socket.join(`private:${roomId}`);
    });
    
    // #1-中 修复：私聊消息添加封禁检查
    socket.on('private message', async ({ toUserId, content }) => {
        // 检查发送者是否被封禁聊天
        if (isChatBanned(userId)) {
            socket.emit('system message', '您已被限制使用聊天功能');
            return;
        }
        
        // 修复 #8/#66：私聊消息长度限制
        if (typeof content !== 'string' || !content.trim()) {
            socket.emit('system message', '消息内容不能为空');
            return;
        }
        if (content.length > MAX_PRIVATE_LENGTH) {
            socket.emit('system message', `消息内容不能超过 ${MAX_PRIVATE_LENGTH} 个字符`);
            return;
        }

        const fromUser = db.prepare('SELECT userId FROM users WHERE userId = ?').get(userId);
        const toUser = db.prepare('SELECT userId FROM users WHERE userId = ?').get(toUserId);
        if (!fromUser || !toUser) {
            socket.emit('system message', '发送失败：用户不存在');
            return;
        }
        // 修复 #11：检查接收方封禁状态，被封禁用户不再接收私聊消息
        if (isChatBanned(toUserId)) {
            socket.emit('system message', '对方已被限制使用聊天功能，无法发送私聊消息');
            return;
        }
        const roomId = [userId, toUserId].sort().join('-');
        const timestamp = new Date().toISOString();
        // 修复 #9/#67：私聊消息应用 Emoji 替换，与公共聊天室体验一致
        const cleanContent = replaceEmojis(content);
        try {
            const stmt = db.prepare(`INSERT INTO private_messages (from_user, to_user, content, timestamp) VALUES (?, ?, ?, ?)`);
            const info = stmt.run(userId, toUserId, cleanContent, timestamp);
            const msg = { id: info.lastInsertRowid, from_user: userId, to_user: toUserId, content: cleanContent, timestamp, username: user.username };
            io.to(`private:${roomId}`).emit('private message', msg);
            // 通知接收方所有在线设备
            const targetInfo = onlineUsers.get(toUserId);
            if (targetInfo) {
                for (const sid of targetInfo.sockets) {
                    io.to(sid).emit('new private message', { from: userId, message: msg, fromUsername: user.username });
                }
            }
        } catch (err) {
            console.error('发送私聊失败:', err);
            socket.emit('system message', '发送失败：数据库错误');
        }
    });
    
    // #1-中 修复：私聊文件消息添加封禁检查
    socket.on('private file message', async ({ toUserId, fileUrl, fileName, fileType }) => {
        // 检查发送者是否被封禁聊天
        if (isChatBanned(userId)) {
            socket.emit('system message', '您已被限制使用聊天功能');
            return;
        }
        
        const fromUser = db.prepare('SELECT userId FROM users WHERE userId = ?').get(userId);
        const toUser = db.prepare('SELECT userId FROM users WHERE userId = ?').get(toUserId);
        if (!fromUser || !toUser) {
            socket.emit('system message', '发送失败：用户不存在');
            return;
        }
        // 修复 #11：检查接收方封禁状态
        if (isChatBanned(toUserId)) {
            socket.emit('system message', '对方已被限制使用聊天功能，无法发送私聊文件');
            return;
        }
        const roomId = [userId, toUserId].sort().join('-');
        const timestamp = new Date().toISOString();
        try {
            const stmt = db.prepare(`INSERT INTO private_messages (from_user, to_user, fileUrl, fileName, fileType, timestamp) VALUES (?, ?, ?, ?, ?, ?)`);
            const info = stmt.run(userId, toUserId, fileUrl, fileName, fileType, timestamp);
            const msg = { id: info.lastInsertRowid, from_user: userId, to_user: toUserId, content: '', fileUrl, fileName, fileType, timestamp, username: user.username };
            io.to(`private:${roomId}`).emit('private message', msg);
            const targetInfo = onlineUsers.get(toUserId);
            if (targetInfo) {
                for (const sid of targetInfo.sockets) {
                    io.to(sid).emit('new private message', { from: userId, message: msg, fromUsername: user.username, isFile: true });
                }
            }
        } catch (err) {
            console.error('发送私聊文件失败:', err);
            socket.emit('system message', '发送失败：数据库错误');
        }
    });
    
    socket.on('mark private read', (fromUserId) => {
        db.prepare(`UPDATE private_messages SET is_read = 1 WHERE from_user = ? AND to_user = ? AND is_read = 0`).run(fromUserId, userId);
    });
};
