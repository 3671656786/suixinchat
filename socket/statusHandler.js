// socket/statusHandler.js
const db = require('../db/connection');

// 保存用户在线时长
function saveUserDuration(userId, currentTime, onlineUsers) {
    const info = onlineUsers.get(userId);
    if (!info || !info.lastSaveTime) return;
    const start = new Date(info.lastSaveTime);
    const end = currentTime;
    const duration = Math.floor((end - start) / 1000);
    if (duration > 0) {
        try {
            db.prepare(`INSERT INTO user_sessions (userId, loginTime, logoutTime, duration) VALUES (?, ?, ?, ?)`)
                .run(userId, start.toISOString(), end.toISOString(), duration);
        } catch (err) {
            console.error('[statusHandler] 保存用户时长失败:', err.message);
        }
    }
    info.lastSaveTime = currentTime;
    onlineUsers.set(userId, info);
}

module.exports = (socket, io, onlineUsers, db, addOnlineUser, removeOnlineUser, updateUserStatus, broadcastOnlineUsers) => {
    const userId = socket.user.userId;
    const user = socket.user;
    
    // 记录用户首次连接时间
    let firstConnectTime = Date.now();
    let isCleanupDone = false;

    // 清理用户房间
    function cleanupUserRooms(socketInstance) {
        try {
            if (!socketInstance || !socketInstance.rooms) return;
            const rooms = Array.from(socketInstance.rooms || []);
            for (const room of rooms) {
                if (room.startsWith('group:')) {
                    socketInstance.leave(room);
                }
                if (room.startsWith('private:')) {
                    socketInstance.leave(room);
                }
            }
        } catch (err) {
            console.error('[房间清理] 清理房间失败:', err);
        }
    }

    socket.on('update status', (status) => {
        updateUserStatus(userId, status);
    });
    
    socket.on('leave', () => {
        if (isCleanupDone) return;
        isCleanupDone = true;
        
        cleanupUserRooms(socket);
        
        const removed = removeOnlineUser(userId, socket.id);
        if (removed) {
            const now = new Date();
            saveUserDuration(userId, now, onlineUsers);
            broadcastOnlineUsers();
            if (socket.rooms.has('chatroom')) {
                socket.broadcast.to('chatroom').emit('system message', `${user.username} 离开了聊天室`);
            }
        }
        socket.disconnect(true);
    });
    
    socket.on('disconnect', async () => {
        if (isCleanupDone) return;
        
        const info = onlineUsers.get(userId);
        if (!info) return;
        
        // 清除之前的定时器
        if (info.disconnectTimer) {
            clearTimeout(info.disconnectTimer);
            info.disconnectTimer = null;
        }
        
        const disconnectTimer = setTimeout(() => {
            const currentInfo = onlineUsers.get(userId);
            if (!currentInfo) return;
            
            // 检查是否还有其他活跃的 socket
            if (currentInfo.sockets && currentInfo.sockets.size > 0) {
                // 还有活跃连接，不执行清理
                return;
            }
            
            // 修复 N10: 检查是否已经保存过时长，避免重复累加
            const now = new Date();
            const timeSinceLastSave = (now - currentInfo.lastSaveTime) / 1000;
            
            // 如果距离上次保存不到30秒，说明刚保存过，跳过
            if (timeSinceLastSave < 30) {
                console.log(`[statusHandler] 用户 ${userId} 时长已保存过，跳过重复保存`);
                onlineUsers.delete(userId);
                broadcastOnlineUsers();
                return;
            }
            
            saveUserDuration(userId, now, onlineUsers);
            
            // 清理所有房间
            if (currentInfo.sockets) {
                for (const sid of currentInfo.sockets) {
                    const sock = io.sockets.sockets.get(sid);
                    if (sock) {
                        cleanupUserRooms(sock);
                        if (sock.rooms.has('chatroom')) {
                            sock.broadcast.to('chatroom').emit('system message', `${user.username} 离开了聊天室`);
                        }
                    }
                }
            }
            
            onlineUsers.delete(userId);
            broadcastOnlineUsers();
            isCleanupDone = true;
        }, 15000);
        
        info.disconnectTimer = disconnectTimer;
        onlineUsers.set(userId, info);
    });
};