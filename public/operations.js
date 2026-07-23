async function loadOperationsData() {
    const container = document.getElementById('operationsContent');
    container.innerHTML = '<div class="loading">加载�?..</div>';
    
    try {
        const res = await fetch('/api/operations/stats', { credentials: 'include' });
        const data = await res.json();
        
        if (!data.success) {
            container.innerHTML = `<div class="error">�?${data.message || '加载失败'}</div>`;
            return;
        }
        
        const stats = data.data;
        let html = '';
        
        // 用户统计
        html += `
            <div class="stats-card">
                <h3>👥 用户统计</h3>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-number">${stats.users.totalUsers}</div>
                        <div class="stat-label">总注册用�?/div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-number">${stats.users.newUsersWeek}</div>
                        <div class="stat-label">�?天新�?/div>
                    </div>
                </div>
            </div>
        `;
        
        // 消息统计
        html += `
            <div class="stats-card">
                <h3>💬 消息统计</h3>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-number">${stats.messages.totalMessages}</div>
                        <div class="stat-label">历史消息总数</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-number">${stats.messages.todayMessages}</div>
                        <div class="stat-label">今日消息�?/div>
                    </div>
                </div>
            </div>
        `;
        
        // 文件统计
        html += `
            <div class="stats-card">
                <h3>📁 文件统计</h3>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-number">${stats.files.totalFiles}</div>
                        <div class="stat-label">总文件数</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-number">${stats.files.totalSizeMB} MB</div>
                        <div class="stat-label">总占用空�?/div>
                    </div>
                </div>
            </div>
        `;
        
        // 在线时长排行
        html += `
            <div class="stats-card">
                <h3>⏱️ 在线时长排行（Top 10�?/h3>
                <table class="stats-table">
                    <thead><tr><th>用户�?/th><th>总在线时长（小时�?/th></tr></thead>
                    <tbody>
        `;
        if (stats.online && stats.online.length) {
            stats.online.forEach(u => {
                html += `<tr><td style="padding:8px;">${escapeHtml(u.username)}</td><td style="padding:8px;">${u.hours}</td></tr>`;
            });
        } else {
            html += `<tr><td colspan="2">暂无数据</td></tr>`;
        }
        html += `
                    </tbody>
                </table>
            </div>
        `;
        
        // 流量统计
        html += `
            <div class="stats-card">
                <h3>📈 流量统计</h3>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-number">${stats.traffic.uploadMB} MB</div>
                        <div class="stat-label">总上传流�?/div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-number">${stats.traffic.downloadMB} MB</div>
                        <div class="stat-label">总下载流�?/div>
                    </div>
                </div>
            </div>
        `;
        
        // 全局网盘容量
        if (stats.globalStorage) {
            html += `
                <div class="stats-card">
                    <h3>📦 全局网盘容量（普通用户总和�?/h3>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <div class="stat-number">${stats.globalStorage.usedGB} GB</div>
                            <div class="stat-label">已用容量</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-number">${stats.globalStorage.maxGB} GB</div>
                            <div class="stat-label">总容�?/div>
                        </div>
                    </div>
                    <div style="margin-top:12px; background:#e0e0e0; border-radius:8px; height:8px;">
                        <div style="width:${stats.globalStorage.percent}%; background:var(--primary); height:8px; border-radius:8px;"></div>
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html;
    } catch (err) {
        console.error('加载运营数据失败:', err);
        container.innerHTML = '<div class="error">网络错误，请稍后重试</div>';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    var e = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
    return text.replace(/[&<>"']/g, function(m) { return e[m]; });
}

loadOperationsData();