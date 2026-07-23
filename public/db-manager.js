let currentUser = null;

async function apiRequest(url, method, body) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
}

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
        document.getElementById('tableData').innerHTML = '<div>无数�?/div>';
    }
}

function renderTable(rows) {
    if (!rows || rows.length === 0) {
        document.getElementById('tableData').innerHTML = '<div>无数�?/div>';
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

document.getElementById('logoutDbBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/';
});

function escapeHtml(text) {
    if (!text) return '';
    var e = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
    return text.replace(/[&<>"']/g, function(m) { return e[m]; });
}

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
})();