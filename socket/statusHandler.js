// socket/statusHandler.js
const db = require('../db/connection');

function saveUserDuration(userId, currentTime, onlineUsers) {
    const info = onlineUsers.get(userId);
    if (!info || !info.lastSaveTime) return;
    const start = new Date(info.lastSaveTime);
    const end = currentTime;
    const duration = Math.floor((end - start) / 1000);
    if (duration > 0) {
        db.prepare(`INSERT INTO user_sessions (userId, loginTime, logoutTime, duration) VALUES (?, ?, ?, ?)`)
            .run(userId, start.toISOString(), end.toISOString(), duration);
    }
    info.lastSaveTime = currentTime;
    onlineUsers.set(userId, info);
}

module.exports = (socket, io, onlineUsers, db, addOnlineUser, removeOnlineUser, updateUserStatus, broadcastOnlineUsers) => {
    const userId = socket.user.userId;
    const user = socket.user;
    
    socket.on('update status', (status) => {
        updateUserStatus(userId, status);
    });
    
    socket.on('leave', () => {
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
        const info = onlineUsers.get(userId);
        if (!info) return;
        
        const disconnectTimer = setTimeout(() => {
            const currentInfo = onlineUsers.get(userId);
            if (currentInfo && currentInfo.sockets.size > 0) {
                return;
            }
            if (currentInfo) {
                const now = new Date();
                saveUserDuration(userId, now, onlineUsers);
                onlineUsers.delete(userId);
                broadcastOnlineUsers();
            }
            if (socket.rooms && socket.rooms.has('chatroom')) {
                socket.broadcast.to('chatroom').emit('system message', `${user.username} 离开了聊天室`);
            }
        }, 15000);
        
        info.disconnectTimer = disconnectTimer;
        onlineUsers.set(userId, info);
    });
};