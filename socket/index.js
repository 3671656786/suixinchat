// socket/index.js
const { Server } = require('socket.io');
const db = require('../db/connection');
const { logToFile } = require('../utils/logger');
const { startHeartbeat } = require('./heartbeat');

let io = null;
const onlineUsers = new Map();

function broadcastOnlineUsers() {
    if (!io) return;
    const usersList = [];
    for (let [uid, info] of onlineUsers.entries()) {
        usersList.push({ userId: uid, username: info.username, avatarUrl: info.avatarUrl, status: info.status });
    }
    io.to('global').emit('online users status', usersList);
}

function addOnlineUser(userId, userInfo) {
    if (onlineUsers.has(userId)) {
        const existing = onlineUsers.get(userId);
        existing.sockets.add(userInfo.socketId);
        existing.status = userInfo.status || existing.status;
        existing.lastSaveTime = new Date();
        if (existing.disconnectTimer) clearTimeout(existing.disconnectTimer);
        onlineUsers.set(userId, existing);
        return existing;
    } else {
        const newUser = {
            sockets: new Set([userInfo.socketId]),
            status: userInfo.status || 'chat',
            username: userInfo.username,
            avatarUrl: userInfo.avatarUrl,
            loginTime: new Date(),
            lastSaveTime: new Date(),
            disconnectTimer: null
        };
        onlineUsers.set(userId, newUser);
        return newUser;
    }
}

function removeOnlineUser(userId, socketId) {
    const info = onlineUsers.get(userId);
    if (!info) return false;
    info.sockets.delete(socketId);
    if (info.sockets.size === 0) {
        onlineUsers.delete(userId);
        return true;
    }
    return false;
}

function updateUserStatus(userId, status) {
    const info = onlineUsers.get(userId);
    if (info) {
        info.status = status;
        onlineUsers.set(userId, info);
        broadcastOnlineUsers();
        return true;
    }
    return false;
}

function initSocket(server, sessionMiddleware) {
    io = new Server(server, {
        allowEIO3: true,
        transports: ['websocket', 'polling']
    });

    io.use((socket, next) => {
        sessionMiddleware(socket.request, {}, next);
    });

    io.on('connection', async (socket) => {
        const userId = socket.request.session.userId;
        if (!userId) {
            socket.disconnect();
            return;
        }

        let user;
        try {
            user = db.prepare('SELECT userId, username, avatarUrl, role FROM users WHERE userId = ?').get(userId);
            if (!user) {
                socket.disconnect();
                return;
            }
        } catch (err) {
            socket.disconnect();
            return;
        }

        if (user.role === 'admin') {
            socket.join('admin');
            console.log(`[Socket] 管理员 ${user.username} (${userId}) 已加入 admin 房间`);
        }

        addOnlineUser(userId, {
            socketId: socket.id,
            status: 'chat',
            username: user.username,
            avatarUrl: user.avatarUrl
        });
        socket.user = { ...user, heartbeatActive: false };
        socket.join('global');
        broadcastOnlineUsers();

        startHeartbeat(socket, userId, onlineUsers, db, broadcastOnlineUsers);

        const chatHandler = require('./chatHandler');
        const privateHandler = require('./privateHandler');
        const statusHandler = require('./statusHandler');

        chatHandler(socket, io, onlineUsers, db, logToFile);
        privateHandler(socket, io, onlineUsers, db);
        statusHandler(socket, io, onlineUsers, db, addOnlineUser, removeOnlineUser, updateUserStatus, broadcastOnlineUsers);
    });

    return io;
}

function getIO() {
    return io;
}

module.exports = {
    initSocket,
    getIO,
    onlineUsers,
    broadcastOnlineUsers,
    addOnlineUser,
    removeOnlineUser,
    updateUserStatus
};