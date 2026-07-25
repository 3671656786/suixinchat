// public/operations.js
// ========== 安全 Fallback：确保全局函数可用 ==========
(function ensureGlobals() {
    if (typeof window.escapeHtml !== 'function') {
        window.escapeHtml = function(text) {
            if (!text) return '';
            var e = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
            return text.replace(/[&<>"']/g, function(m) { return e[m]; });
        };
    }
})();

async function loadOperationsData() {
    var container = document.getElementById('operationsContent');
    if (!container) return;
    container.innerHTML = '<div class="loading">加载中...</div>';
    
    try {
        var res = await fetch('/api/operations/stats', { credentials: 'include' });
        var data = await res.json();
        
        if (!data.success) {
            container.innerHTML = '<div class="error">❌ ' + (data.message || '加载失败') + '</div>';
            return;
        }
        
        var stats = data.data;
        var html = '';
        
        // 用户统计
        html += '<div class="stats-card"><h3>👥 用户统计</h3><div class="stats-grid"><div class="stat-item"><div class="stat-number">' + stats.users.totalUsers + '</div><div class="stat-label">总注册用户</div></div><div class="stat-item"><div class="stat-number">' + stats.users.newUsersWeek + '</div><div class="stat-label">近7天新增</div></div></div></div>';
        
        // 消息统计
        html += '<div class="stats-card"><h3>💬 消息统计</h3><div class="stats-grid"><div class="stat-item"><div class="stat-number">' + stats.messages.totalMessages + '</div><div class="stat-label">历史消息总数</div></div><div class="stat-item"><div class="stat-number">' + stats.messages.todayMessages + '</div><div class="stat-label">今日消息数</div></div></div></div>';
        
        // 文件统计
        html += '<div class="stats-card"><h3>📁 文件统计</h3><div class="stats-grid"><div class="stat-item"><div class="stat-number">' + stats.files.totalFiles + '</div><div class="stat-label">总文件数</div></div><div class="stat-item"><div class="stat-number">' + stats.files.totalSizeMB + ' MB</div><div class="stat-label">总占用空间</div></div></div></div>';
        
        // 在线时长排行
        html += '<div class="stats-card"><h3>⏱️ 在线时长排行（Top 10）</h3>';
        if (stats.online && stats.online.length) {
            html += '<table class="stats-table"><thead><tr><th>用户名</th><th>总在线时长（小时）</th></tr></thead><tbody>';
            for (var i = 0; i < stats.online.length; i++) {
                var u = stats.online[i];
                html += '<tr><td style="padding:8px;">' + window.escapeHtml(u.username) + '</td><td style="padding:8px;">' + u.hours + '</td></tr>';
            }
            html += '</tbody></table>';
        } else {
            html += '<p style="color:#999;">暂无数据</p>';
        }
        html += '</div>';
        
        // 流量统计
        html += '<div class="stats-card"><h3>📈 流量统计</h3><div class="stats-grid"><div class="stat-item"><div class="stat-number">' + stats.traffic.uploadMB + ' MB</div><div class="stat-label">总上传流量</div></div><div class="stat-item"><div class="stat-number">' + stats.traffic.downloadMB + ' MB</div><div class="stat-label">总下载流量</div></div></div></div>';
        
        // 全局网盘容量
        if (stats.globalStorage) {
            var gs = stats.globalStorage;
            var barColor = gs.percent > 80 ? '#e53935' : (gs.percent > 60 ? '#ff9800' : '#07c160');
            html += '<div class="stats-card"><h3>📦 全局网盘容量（普通用户总和）</h3><div class="stats-grid"><div class="stat-item"><div class="stat-number">' + gs.usedGB + ' GB</div><div class="stat-label">已用容量</div></div><div class="stat-item"><div class="stat-number">' + gs.maxGB + ' GB</div><div class="stat-label">总容量</div></div></div><div style="margin-top:12px; background:#e0e0e0; border-radius:8px; height:8px; overflow:hidden;"><div style="width:' + Math.min(gs.percent, 100) + '%; background:' + barColor + '; height:8px; border-radius:8px;"></div></div><div style="text-align:right; font-size:12px; color:' + barColor + '; margin-top:4px;">' + gs.percent.toFixed(1) + '%</div></div>';
        }
        
        // 封禁统计
        if (stats.banned) {
            html += '<div class="stats-card"><h3>🔒 封禁统计</h3><div class="stats-grid"><div class="stat-item"><div class="stat-number">' + stats.banned.count + '</div><div class="stat-label">当前被封禁用户</div></div></div></div>';
        }
        
        container.innerHTML = html;
    } catch (err) {
        console.error('加载运营数据失败:', err);
        container.innerHTML = '<div class="error">网络错误，请稍后重试</div>';
    }
}

// 页面加载完成后执行
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadOperationsData);
} else {
    loadOperationsData();
}