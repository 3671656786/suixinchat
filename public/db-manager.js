// public/db-manager.js
let currentUser = null;

// ========== 辅助函数 ==========
function escapeHtml(text) {
    if (!text) return '';
    var e = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
    return text.replace(/[&<>"']/g, function(m) { return e[m]; });
}

async function apiRequest(url, method, body) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
}

// ========== 查询标签页 ==========
async function loadTables() {
    const res = await apiRequest('/api/admin/db/tables', 'GET');
    if (res.success) {
        const container = document.getElementById('tableList');
        container.innerHTML = '';
        res.tables.forEach(tbl => {
            const btn = document.createElement('button');
            btn.textContent = tbl.name;
            btn.addEventListener('click', () => {
                document.querySelectorAll('#tableList button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                loadTableData(tbl.name);
            });
            container.appendChild(btn);
        });
        if (res.tables.length) loadTableData(res.tables[0].name);
    }
}

async function loadTableData(table) {
    const res = await apiRequest(`/api/admin/db/data?table=${table}&limit=100`, 'GET');
    if (res.success && res.rows) {
        renderTable(res.rows);
    } else {
        document.getElementById('tableData').innerHTML = '<div>无数据</div>';
    }
}

function renderTable(rows) {
    if (!rows || rows.length === 0) {
        document.getElementById('tableData').innerHTML = '<div>无数据</div>';
        return;
    }
    const keys = Object.keys(rows[0]);
    let html = '<table><thead><tr>';
    keys.forEach(k => html += `<th>${escapeHtml(k)}</th>`);
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
        html += '<tr>';
        keys.forEach(k => {
            let val = row[k];
            if (val === null) val = 'NULL';
            else if (typeof val === 'object') val = JSON.stringify(val);
            html += `<td>${escapeHtml(String(val))}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('tableData').innerHTML = html;
}

document.getElementById('executeQueryBtn').addEventListener('click', async () => {
    const sql = document.getElementById('sqlInput').value.trim();
    if (!sql) return;
    const res = await apiRequest('/api/admin/db/query', 'POST', { sql });
    if (res.success) {
        renderTable(res.rows);
    } else {
        alert(res.message || '查询失败');
    }
});

// ========== 修改申请标签页 ==========
async function loadModifyFiles() {
    const container = document.getElementById('modifyFileList');
    const res = await apiRequest('/api/admin/db/modify-files', 'GET');
    if (res.success) {
        if (res.list.length === 0) {
            container.innerHTML = '<div style="color:#999; padding:12px;">暂无申请文件</div>';
            return;
        }
        let html = '';
        res.list.forEach(item => {
            let statusText = item.isApproved ? '已批准' : '待审批';
            let badgeClass = item.isApproved ? 'badge-approved' : 'badge-pending';
            // 如果文件名包含 _executed，标记为已执行
            if (item.filename.includes('_executed')) {
                statusText = '已执行';
                badgeClass = 'badge-executed';
            }
            html += `<div class="status-item">
                <span>${escapeHtml(item.filename)}</span>
                <span><span class="${badgeClass}">${statusText}</span></span>
                <span style="font-size:12px;color:#666;">${escapeHtml(item.sql.substring(0, 50))}</span>
            </div>`;
        });
        container.innerHTML = html;
    } else {
        container.innerHTML = '<div style="color:red;">加载失败</div>';
    }
}

// 申请修改
document.getElementById('requestModifyBtn').addEventListener('click', async () => {
    const sql = document.getElementById('modifySql').value.trim();
    if (!sql) { alert('请输入 SQL 语句'); return; }
    const res = await apiRequest('/api/admin/db/request-modify', 'POST', { sql });
    const resultDiv = document.getElementById('modifyResult');
    if (res.success) {
        resultDiv.innerHTML = `<span style="color:green;">✅ ${res.message}，文件名: ${res.filename}</span>`;
        document.getElementById('modifySql').value = '';
        loadModifyFiles();
    } else {
        resultDiv.innerHTML = `<span style="color:red;">❌ ${res.message}</span>`;
    }
});

// 刷新列表
document.getElementById('refreshModifyFilesBtn').addEventListener('click', loadModifyFiles);

// 应用已批准修改
document.getElementById('applyModifyBtn').addEventListener('click', async () => {
    if (!confirm('确定要执行所有已批准的修改吗？此操作不可撤销！')) return;
    const res = await apiRequest('/api/admin/db/apply-modify', 'POST');
    const resultDiv = document.getElementById('applyResult');
    if (res.success) {
        let msg = `成功执行 ${res.executed} 个，失败 ${res.failed} 个。`;
        if (res.results && res.results.length) {
            msg += '<br>详情：<br>';
            res.results.forEach(r => {
                msg += `${r.file}: ${r.success ? '✅ 成功' : '❌ 失败 ' + r.error}<br>`;
            });
        }
        resultDiv.innerHTML = `<div style="color:${res.failed > 0 ? 'orange' : 'green'};">${msg}</div>`;
        loadModifyFiles();
    } else {
        resultDiv.innerHTML = `<span style="color:red;">❌ ${res.message}</span>`;
    }
});

// ========== 标签页切换 ==========
document.querySelectorAll('.db-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.db-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.db-tab').forEach(t => t.classList.remove('active'));
        document.getElementById(tab + 'Tab').classList.add('active');
        if (tab === 'modify') {
            loadModifyFiles();
        }
    });
});

// ========== 退出 ==========
document.getElementById('logoutDbBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/';
});

// ========== 初始化 ==========
(async () => {
    const res = await fetch('/api/me', { credentials: 'include' });
    const data = await res.json();
    if (!data.success || data.user.role !== 'admin') {
        alert('请使用管理员账号登录');
        window.location.href = '/';
        return;
    }
    currentUser = data.user;
    await loadTables();
    // 默认不加载修改列表，切换标签时加载
})();