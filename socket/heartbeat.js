// socket/heartbeat.js
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 40000;

function startHeartbeat(socket, userId, onlineUsers, db, broadcastOnlineUsers) {
    let lastPong = Date.now();
    let pingTimer = null;
    let timeoutTimer = null;
    
    const startPingInterval = () => {
        if (pingTimer) clearInterval(pingTimer);
        if (socket.connected) socket.emit('ping');
        pingTimer = setInterval(() => {
            if (socket.connected) socket.emit('ping');
        }, HEARTBEAT_INTERVAL);
    };
    
    const startTimeoutCheck = () => {
        if (timeoutTimer) clearInterval(timeoutTimer);
        timeoutTimer = setInterval(() => {
            if (Date.now() - lastPong > HEARTBEAT_TIMEOUT) {
                handleTimeout();
            }
        }, 5000);
    };
    
    const handleTimeout = () => {
        if (pingTimer) clearInterval(pingTimer);
        if (timeoutTimer) clearInterval(timeoutTimer);
        console.log(`用户 ${userId} 心跳超时（${HEARTBEAT_TIMEOUT}ms无响应），断开连接`);
        const info = onlineUsers.get(userId);
        if (info) {
            if (info.disconnectTimer) clearTimeout(info.disconnectTimer);
            const now = new Date();
            const start = info.lastSaveTime;
            const duration = Math.floor((now - start) / 1000);
            if (duration > 0) {
                db.prepare(`INSERT INTO user_sessions (userId, loginTime, logoutTime, duration) VALUES (?, ?, ?, ?)`)
                    .run(userId, start.toISOString(), now.toISOString(), duration);
            }
            onlineUsers.delete(userId);
            broadcastOnlineUsers();
        }
        socket.disconnect(true);
    };
    
    socket.on('pong', () => {
        lastPong = Date.now();
        if (!socket.user?.heartbeatActive) {
            socket.user.heartbeatActive = true;
        }
    });
    
    socket.once('pong', () => {
        lastPong = Date.now();
        socket.user.heartbeatActive = true;
        startPingInterval();
        startTimeoutCheck();
    });
    
    setTimeout(() => {
        if (!socket.user?.heartbeatActive && socket.connected) {
            socket.emit('ping');
        }
    }, 1000);
    
    socket.on('disconnect', () => {
        if (pingTimer) clearInterval(pingTimer);
        if (timeoutTimer) clearInterval(timeoutTimer);
    });
}

module.exports = { startHeartbeat };