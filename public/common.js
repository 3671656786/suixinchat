(function() {
    let commonSocket = null;
    
    function attachHeartbeat(sock) {
        if (!sock || !sock.connected) {
            sock.once('connect', function() {
                commonSocket = sock;
                sock.on('ping', function() {
                    if (sock && sock.connected) {
                        sock.emit('pong');
                    }
                });
            });
        } else {
            commonSocket = sock;
            sock.on('ping', function() {
                if (sock && sock.connected) {
                    sock.emit('pong');
                }
            });
        }
    }
    
    window.__attachHeartbeat = attachHeartbeat;
    
    window.addEventListener('load', function() {
        setTimeout(function() {
            if (window.socket && window.socket.connected) {
                attachHeartbeat(window.socket);
            }
        }, 1000);
    });
    
    window.addEventListener('beforeunload', function() {
        if (window.socket && window.socket.connected) {
            window.socket.emit('leave');
        }
    });
})();