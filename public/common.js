// public/common.js
(function() {
    'use strict';

    // ========== Socket 心跳管理 ==========
    let commonSocket = null;
    
    function attachHeartbeat(sock) {
        if (!sock) return;
        
        if (sock.connected) {
            commonSocket = sock;
            sock.on('ping', function() {
                if (sock && sock.connected) {
                    sock.emit('pong');
                }
            });
        } else {
            sock.once('connect', function() {
                commonSocket = sock;
                sock.on('ping', function() {
                    if (sock && sock.connected) {
                        sock.emit('pong');
                    }
                });
            });
        }
    }
    
    window.__attachHeartbeat = attachHeartbeat;
    
    window.addEventListener('load', function() {
        setTimeout(function() {
            if (window.socket) {
                attachHeartbeat(window.socket);
            }
        }, 1000);
    });
    
    window.addEventListener('beforeunload', function() {
        if (window.socket && window.socket.connected) {
            window.socket.emit('leave');
        }
    });

    // ========== 全局工具函数 - 直接挂载到 window ==========
    
    // escapeHtml - HTML 转义
    window.escapeHtml = function escapeHtml(text) {
        if (!text) return '';
        var e = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return text.replace(/[&<>"']/g, function(m) {
            return e[m];
        });
    };

    // formatFileSize - 文件大小格式化
    window.formatFileSize = function formatFileSize(bytes) {
        if (!bytes) return '0 B';
        var k = 1024;
        var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // formatTime - 时间格式化
    window.formatTime = function formatTime(timestamp) {
        var date = new Date(timestamp);
        var now = new Date();
        var diff = now - date;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
        return date.toLocaleDateString();
    };

    // apiRequest - API 请求函数
    window.apiRequest = function apiRequest(url, method, body) {
        return fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: body ? JSON.stringify(body) : undefined
        }).then(function(res) {
            return res.json();
        });
    };

    console.log('[common.js] 已加载全局工具函数');
})();

// ========== 二次保险：确保所有全局函数在页面加载后仍然可用 ==========
// 有些浏览器可能在 DOM 加载完成后才执行上面的 IIFE
// 这里再次确保它们挂载到 window
(function ensureGlobals() {
    if (typeof window.escapeHtml !== 'function') {
        window.escapeHtml = function(text) {
            if (!text) return '';
            var e = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
            return text.replace(/[&<>"']/g, function(m) { return e[m]; });
        };
    }
    if (typeof window.apiRequest !== 'function') {
        window.apiRequest = function(url, method, body) {
            return fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: body ? JSON.stringify(body) : undefined
            }).then(function(res) { return res.json(); });
        };
    }
    if (typeof window.formatFileSize !== 'function') {
        window.formatFileSize = function(bytes) {
            if (!bytes) return '0 B';
            var k = 1024;
            var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            var i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };
    }
    if (typeof window.formatTime !== 'function') {
        window.formatTime = function(timestamp) {
            var date = new Date(timestamp);
            var now = new Date();
            var diff = now - date;
            if (diff < 60000) return '刚刚';
            if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
            if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
            return date.toLocaleDateString();
        };
    }
})();