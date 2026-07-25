// public/clean-files.js
// ============================================================
// 完全自包含 - 不依赖外部加载顺序
// ============================================================

// ========== 确保全局函数可用（内联 Fallback） ==========
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

// ========== 主要逻辑 ==========
var scanResults = null;

async function loadScan() {
    try {
        // 再次确保 apiRequest 可用
        if (typeof window.apiRequest !== 'function') {
            console.warn('[clean-files] apiRequest 不可用，等待重试...');
            await new Promise(function(resolve) { setTimeout(resolve, 300); });
            if (typeof window.apiRequest !== 'function') {
                throw new Error('apiRequest 函数不可用，请刷新页面重试');
            }
        }
        
        // 注意：window.apiRequest 已经返回解析后的 JSON 对象，不需要再 .json()
        var data = await window.apiRequest('/api/admin/scan-files', 'GET');
        if (data.success) {
            scanResults = data.results;
            renderStats();
            renderOrphanFiles();
            renderMissingFiles();
        } else {
            alert('扫描失败: ' + (data.message || '未知错误'));
        }
    } catch (err) {
        console.error('[clean-files] 加载失败:', err);
        document.getElementById('orphanFilesList').innerHTML = '<div style="padding:20px;text-align:center;color:#e53935;">加载失败：' + window.escapeHtml(err.message || '未知错误') + '</div>';
        document.getElementById('missingFilesList').innerHTML = '<div style="padding:20px;text-align:center;color:#e53935;">加载失败：' + window.escapeHtml(err.message || '未知错误') + '</div>';
    }
}

function renderStats() {
    var statsDiv = document.getElementById('stats');
    if (!statsDiv) return;
    statsDiv.innerHTML = 
        '<strong>本地文件总数:</strong> ' + scanResults.totalLocal + '<br>' +
        '<strong>数据库记录文件总数:</strong> ' + scanResults.totalDb + '<br>' +
        '<strong>孤儿文件数量:</strong> ' + scanResults.orphanFiles.length + '<br>' +
        '<strong>缺失文件数量:</strong> ' + scanResults.missingFiles.length;
}

function renderOrphanFiles() {
    var container = document.getElementById('orphanFilesList');
    if (!container) return;
    if (scanResults.orphanFiles.length === 0) {
        container.innerHTML = '<div style="padding:12px; text-align:center; color:#999;">✅ 无孤儿文件</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < scanResults.orphanFiles.length; i++) {
        var file = scanResults.orphanFiles[i];
        html += '<div class="file-item">' +
            '<span>' + window.escapeHtml(file.relativePath) + ' (' + window.formatFileSize(file.size) + ')</span>' +
            '<button class="delete-btn" data-path="' + window.escapeHtml(file.relativePath) + '">删除</button>' +
            '</div>';
    }
    container.innerHTML = html;
    
    document.querySelectorAll('.delete-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var path = btn.dataset.path;
            if (confirm('确定删除文件 ' + path + ' 吗？')) {
                window.apiRequest('/api/admin/clean-orphan-files', 'POST', { files: [path] })
                    .then(function(res) {
                        if (res.success) {
                            alert('已删除 ' + res.deleted + ' 个文件');
                            loadScan();
                        } else {
                            alert('删除失败');
                        }
                    })
                    .catch(function(err) {
                        alert('删除失败: ' + err.message);
                    });
            }
        });
    });
}

function renderMissingFiles() {
    var container = document.getElementById('missingFilesList');
    if (!container) return;
    if (scanResults.missingFiles.length === 0) {
        container.innerHTML = '<div style="padding:12px; text-align:center; color:#999;">✅ 无缺失文件</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < scanResults.missingFiles.length; i++) {
        var file = scanResults.missingFiles[i];
        html += '<div class="file-item">' +
            '<span>' + window.escapeHtml(file.fileUrl) + ' - ' + window.escapeHtml(file.error) + '</span>' +
            '<button class="delete-record-btn" data-url="' + window.escapeHtml(file.fileUrl) + '" data-table="' + window.escapeHtml(file.table) + '" data-id="' + file.id + '">删除记录</button>' +
            '</div>';
    }
    container.innerHTML = html;
    
    document.querySelectorAll('.delete-record-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var url = btn.dataset.url;
            var table = btn.dataset.table;
            var id = btn.dataset.id;
            if (confirm('确定删除数据库中的记录吗？文件已不存在，仅删除记录。\n路径: ' + url)) {
                window.apiRequest('/api/admin/delete-missing-record', 'POST', {
                    fileUrl: url,
                    table: table,
                    id: id
                }).then(function(res) {
                    if (res.success) {
                        alert('记录已删除');
                        loadScan();
                    } else {
                        alert('删除失败: ' + res.message);
                    }
                }).catch(function(err) {
                    alert('删除失败: ' + err.message);
                });
            }
        });
    });
}

// 删除所有孤儿文件
document.getElementById('deleteAllOrphansBtn')?.addEventListener('click', function() {
    if (!scanResults || scanResults.orphanFiles.length === 0) {
        alert('没有孤儿文件可删除');
        return;
    }
    var paths = scanResults.orphanFiles.map(function(f) { return f.relativePath; });
    if (confirm('确定删除全部 ' + paths.length + ' 个孤儿文件吗？不可恢复！')) {
        window.apiRequest('/api/admin/clean-orphan-files', 'POST', { files: paths })
            .then(function(res) {
                if (res.success) {
                    alert('已删除 ' + res.deleted + ' 个文件，失败 ' + res.errors.length + ' 个');
                    loadScan();
                } else {
                    alert('操作失败');
                }
            })
            .catch(function(err) {
                alert('操作失败: ' + err.message);
            });
    }
});

// ========== 页面初始化 ==========
(function init() {
    fetch('/api/me', { credentials: 'include' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (!data.success || data.user.role !== 'admin') {
                alert('请使用管理员账号登录');
                window.location.href = '/';
                return;
            }
            // 延迟加载，确保所有依赖就绪
            setTimeout(function() {
                loadScan();
            }, 200);
        })
        .catch(function(err) {
            console.error('[clean-files] 初始化失败:', err);
            window.location.href = '/';
        });
})();