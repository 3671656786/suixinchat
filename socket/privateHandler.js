// socket/privateHandler.js
const db = require('../db/connection');

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
    const userId = socket.user.userId;
    const user = socket.user;
    
    socket.on('join private room', (targetUserId) => {
        const roomId = [userId, targetUserId].sort().join('-');
        socket.join(roomId);
    });
    
    // #1-中 修复：私聊消息添加封禁检查
    socket.on('private message', async ({ toUserId, content }) => {
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
        const roomId = [userId, toUserId].sort().join('-');
        const timestamp = new Date().toISOString();
        try {
            const stmt = db.prepare(`INSERT INTO private_messages (from_user, to_user, content, timestamp) VALUES (?, ?, ?, ?)`);
            const info = stmt.run(userId, toUserId, content, timestamp);
            const msg = { id: info.lastInsertRowid, from_user: userId, to_user: toUserId, content, timestamp, username: user.username };
            io.to(roomId).emit('private message', msg);
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
        const roomId = [userId, toUserId].sort().join('-');
        const timestamp = new Date().toISOString();
        try {
            const stmt = db.prepare(`INSERT INTO private_messages (from_user, to_user, fileUrl, fileName, fileType, timestamp) VALUES (?, ?, ?, ?, ?, ?)`);
            const info = stmt.run(userId, toUserId, fileUrl, fileName, fileType, timestamp);
            const msg = { id: info.lastInsertRowid, from_user: userId, to_user: toUserId, content: '', fileUrl, fileName, fileType, timestamp, username: user.username };
            io.to(roomId).emit('private message', msg);
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