// public/common.js
(function() {
    'use strict';

    // ========== Socket 心跳管理 ==========
    let commonSocket = null;
    let heartbeatInterval = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;

    function attachHeartbeat(sock) {
        if (!sock) return;
        
        // 清除旧的定时器
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }

        // 设置心跳处理
        function setupHeartbeat() {
            if (!sock || !sock.connected) return;
            
            // 移除旧的监听器，防止重复绑定
            sock.off('ping');
            sock.off('pong');
            
            sock.on('ping', function() {
                if (sock && sock.connected) {
                    sock.emit('pong');
                    // 收到 ping 后重置重新连接计数
                    reconnectAttempts = 0;
                }
            });

            // 监听 pong 确认连接活跃
            sock.on('pong', function() {
                // 连接活跃，重置超时计数
                reconnectAttempts = 0;
            });
        }

        if (sock.connected) {
            commonSocket = sock;
            setupHeartbeat();
        } else {
            sock.once('connect', function() {
                commonSocket = sock;
                setupHeartbeat();
                reconnectAttempts = 0;
                console.log('[Socket] 心跳已建立连接');
            });
        }

        // 监听断开重连
        sock.on('disconnect', function(reason) {
            console.log('[Socket] 断开连接，原因:', reason);
            if (reason === 'io server disconnect' || reason === 'transport error') {
                reconnectAttempts++;
                if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                    console.log(`[Socket] 尝试重连 (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                    setTimeout(function() {
                        if (sock && !sock.connected) {
                            sock.connect();
                        }
                    }, 2000 * reconnectAttempts);
                } else {
                    console.log('[Socket] 重连失败，请刷新页面');
                }
            }
        });

        sock.on('connect_error', function(err) {
            console.log('[Socket] 连接错误:', err.message);
        });

        sock.on('reconnect', function(attempt) {
            console.log('[Socket] 重新连接成功，尝试次数:', attempt);
            reconnectAttempts = 0;
            // 重新设置心跳
            setTimeout(function() {
                if (sock && sock.connected) {
                    setupHeartbeat();
                }
            }, 500);
        });

        // 如果 socket 已存在，暴露给全局
        if (!window.__socketInitialized) {
            window.__socketInitialized = true;
        }
    }

    // ========== 暴露全局方法 ==========
    window.__attachHeartbeat = attachHeartbeat;

    // ========== 页面加载时自动绑定心跳 ==========
    window.addEventListener('load', function() {
        // 延迟执行，确保 socket 已经初始化
        setTimeout(function() {
            if (window.socket) {
                attachHeartbeat(window.socket);
            } else {
                // 监听 socket 创建
                const observer = new MutationObserver(function() {
                    if (window.socket) {
                        attachHeartbeat(window.socket);
                        observer.disconnect();
                    }
                });
                observer.observe(document.documentElement, { childList: true, subtree: true });
                // 超时后停止监听
                setTimeout(function() {
                    observer.disconnect();
                }, 10000);
            }
        }, 1000);
    });

    // ========== 页面卸载时清理 ==========
    window.addEventListener('beforeunload', function() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        if (window.socket && window.socket.connected) {
            window.socket.emit('leave');
            window.socket.disconnect();
        }
    });

    // ========== 全局工具函数 ==========

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

    // apiRequest - API 请求函数（带超时处理）
    window.apiRequest = function apiRequest(url, method, body, timeout) {
        timeout = timeout || 30000;
        var controller = new AbortController();
        var timeoutId = setTimeout(function() {
            controller.abort();
        }, timeout);

        var options = {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            signal: controller.signal
        };
        if (body) {
            options.body = JSON.stringify(body);
        }

        return fetch(url, options)
            .then(function(res) {
                clearTimeout(timeoutId);
                if (!res.ok) {
                    throw new Error('HTTP ' + res.status + ': ' + res.statusText);
                }
                return res.json();
            })
            .catch(function(err) {
                clearTimeout(timeoutId);
                if (err.name === 'AbortError') {
                    throw new Error('请求超时，请检查网络连接');
                }
                throw err;
            });
    };

    // isLoggedIn - 检查登录状态
    window.isLoggedIn = function isLoggedIn() {
        return window.currentUser !== null && window.currentUser !== undefined;
    };

    // getCurrentUser - 获取当前用户
    window.getCurrentUser = function getCurrentUser() {
        return window.currentUser;
    };

    console.log('[common.js] 已加载全局工具函数和心跳管理');
})();

// ========== 二次保险：确保所有全局函数可用 ==========
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
    if (typeof window.__attachHeartbeat !== 'function') {
        window.__attachHeartbeat = function(sock) {
            if (sock && sock.connected) {
                sock.on('ping', function() {
                    if (sock && sock.connected) {
                        sock.emit('pong');
                    }
                });
            } else if (sock) {
                sock.once('connect', function() {
                    sock.on('ping', function() {
                        if (sock && sock.connected) {
                            sock.emit('pong');
                        }
                    });
                });
            }
        };
    }
})();