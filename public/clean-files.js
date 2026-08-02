// public/clean-files.js
let scanResults = null;

// ========== 确保全局函数可用 ==========
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
            var options = {
                method: method,
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            };
            if (body) options.body = JSON.stringify(body);
            return fetch(url, options).then(function(res) { return res.json(); });
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
})();

// ========== 标签页切换 ==========
document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(function(tc) { tc.classList.remove('active'); });
        document.getElementById(tab + 'Tab').classList.add('active');
        if (tab === 'requests') {
            loadRequests();
        }
    });
});

// ========== 扫描 ==========
async function loadScan() {
    try {
        if (typeof window.apiRequest !== 'function') {
            console.warn('[clean-files] apiRequest 不可用，等待重试...');
            await new Promise(function(resolve) { setTimeout(resolve, 300); });
            if (typeof window.apiRequest !== 'function') {
                throw new Error('apiRequest 函数不可用，请刷新页面重试');
            }
        }
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
            '<div>' +
            '<button class="request-btn" data-path="' + window.escapeHtml(file.relativePath) + '" data-size="' + file.size + '">📝 申请删除</button>' +
            '</div>' +
            '</div>';
    }
    container.innerHTML = html;
    // 绑定申请按钮事件
    document.querySelectorAll('#orphanFilesList .request-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var path = btn.dataset.path;
            var size = btn.dataset.size;
            if (confirm('申请删除孤儿文件：' + path + ' (确定后需等待管理员审批)？')) {
                requestClean('orphan', [{ relativePath: path, size: size }]);
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
            '<div>' +
            '<button class="request-missing-btn" data-table="' + file.table + '" data-id="' + file.id + '" data-url="' + window.escapeHtml(file.fileUrl) + '">📝 申请删除记录</button>' +
            '</div>' +
            '</div>';
    }
    container.innerHTML = html;
    document.querySelectorAll('#missingFilesList .request-missing-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var table = btn.dataset.table;
            var id = btn.dataset.id;
            var url = btn.dataset.url;
            if (confirm('申请删除缺失记录：表 ' + table + ', ID ' + id + ' (确定后需等待管理员审批)？')) {
                requestClean('missing', [{ table: table, id: parseInt(id), fileUrl: url }]);
            }
        });
    });
}

// ========== 申请清理 ==========
async function requestClean(type, items) {
    try {
        var res = await window.apiRequest('/api/admin/clean-request', 'POST', { type: type, items: items });
        if (res.success) {
            alert('申请已提交，文件已生成：' + res.filename + '\n请手动编辑文件将“确定删除”改为“是”后，再点击“应用已批准的清理”。');
        } else {
            alert('申请失败：' + res.message);
        }
    } catch (err) {
        alert('申请失败：' + err.message);
    }
}

// ========== 批量申请 ==========
document.getElementById('requestAllOrphansBtn')?.addEventListener('click', function() {
    if (!scanResults || scanResults.orphanFiles.length === 0) {
        alert('没有孤儿文件可申请删除');
        return;
    }
    if (confirm('确定要申请删除全部 ' + scanResults.orphanFiles.length + ' 个孤儿文件吗？')) {
        var items = scanResults.orphanFiles.map(function(f) {
            return { relativePath: f.relativePath, size: f.size };
        });
        requestClean('orphan', items);
    }
});

document.getElementById('requestAllMissingBtn')?.addEventListener('click', function() {
    if (!scanResults || scanResults.missingFiles.length === 0) {
        alert('没有缺失记录可申请删除');
        return;
    }
    if (confirm('确定要申请删除全部 ' + scanResults.missingFiles.length + ' 条缺失记录吗？')) {
        var items = scanResults.missingFiles.map(function(f) {
            return { table: f.table, id: f.id, fileUrl: f.fileUrl };
        });
        requestClean('missing', items);
    }
});

// ========== 申请列表管理 ==========
async function loadRequests() {
    var container = document.getElementById('requestList');
    container.innerHTML = '加载中...';
    try {
        var res = await window.apiRequest('/api/admin/clean-requests', 'GET');
        if (res.success) {
            if (res.list.length === 0) {
                container.innerHTML = '<div style="padding:12px; text-align:center; color:#999;">暂无清理申请</div>';
                return;
            }
            var html = '';
            for (var i = 0; i < res.list.length; i++) {
                var item = res.list[i];
                var statusText = item.isApproved ? '已批准' : '待审批';
                var badgeClass = item.isApproved ? 'badge-approved' : 'badge-pending';
                if (item.filename.includes('_executed')) {
                    statusText = '已执行';
                    badgeClass = 'badge-executed';
                }
                html += '<div class="request-item">' +
                    '<span>' + window.escapeHtml(item.filename) + '</span>' +
                    '<span><span class="' + badgeClass + '">' + statusText + '</span></span>' +
                    '<span style="font-size:12px;color:#666;">' + window.escapeHtml(item.type) + '</span>' +
                    '</div>';
            }
            container.innerHTML = html;
        } else {
            container.innerHTML = '<div style="color:red;">加载失败：' + window.escapeHtml(res.message) + '</div>';
        }
    } catch (err) {
        container.innerHTML = '<div style="color:red;">加载失败</div>';
    }
}

document.getElementById('refreshRequestsBtn')?.addEventListener('click', loadRequests);

document.getElementById('applyApprovedBtn')?.addEventListener('click', async function() {
    if (!confirm('确定要执行所有已批准的清理操作吗？此操作不可撤销！')) return;
    var resultDiv = document.getElementById('applyResult');
    resultDiv.innerHTML = '正在执行...';
    try {
        var res = await window.apiRequest('/api/admin/apply-clean-requests', 'POST');
        if (res.success) {
            var msg = '成功执行 ' + res.executed + ' 个，失败 ' + res.failed + ' 个。';
            if (res.results && res.results.length) {
                msg += '<br>详情：<br>';
                res.results.forEach(function(r) {
                    msg += (r.success ? '✅ ' : '❌ ') + r.file + (r.error ? ' - ' + r.error : '') + '<br>';
                });
            }
            resultDiv.innerHTML = '<div style="color:' + (res.failed > 0 ? 'orange' : 'green') + ';">' + msg + '</div>';
            loadRequests();
            loadScan(); // 刷新扫描结果
        } else {
            resultDiv.innerHTML = '<span style="color:red;">执行失败：' + res.message + '</span>';
        }
    } catch (err) {
        resultDiv.innerHTML = '<span style="color:red;">执行失败：' + err.message + '</span>';
    }
});

// ========== 初始化 ==========
(function init() {
    fetch('/api/me', { credentials: 'include' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (!data.success || data.user.role !== 'admin') {
                alert('请使用管理员账号登录');
                window.location.href = '/';
                return;
            }
            setTimeout(function() {
                loadScan();
                // 默认不加载申请列表，切换到申请标签时加载
            }, 200);
        })
        .catch(function(err) {
            console.error('[clean-files] 初始化失败:', err);
            window.location.href = '/';
        });
})();