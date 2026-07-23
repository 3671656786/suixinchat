let scanResults = null;

async function loadScan() {
    const res = await fetch('/api/admin/scan-files', { credentials: 'include' });
    const data = await res.json();
    if (data.success) {
        scanResults = data.results;
        renderStats();
        renderOrphanFiles();
        renderMissingFiles();
    } else {
        alert('扫描失败: ' + (data.message || '未知错误'));
    }
}

function renderStats() {
    const statsDiv = document.getElementById('stats');
    statsDiv.innerHTML = `
        <strong>本地文件总数:</strong> ${scanResults.totalLocal}<br>
        <strong>数据库记录文件总数:</strong> ${scanResults.totalDb}<br>
        <strong>孤儿文件?</strong> ${scanResults.orphanFiles.length}<br>
        <strong>缺失文件?</strong> ${scanResults.missingFiles.length}
    `;
}

function renderOrphanFiles() {
    const container = document.getElementById('orphanFilesList');
    if (scanResults.orphanFiles.length === 0) {
        container.innerHTML = '<div style="padding:12px; text-align:center; color:#999;">无孤儿文?/div>';
        return;
    }
    let html = '';
    scanResults.orphanFiles.forEach(file => {
        html += `
            <div class="file-item">
                <span>${escapeHtml(file.relativePath)} (${formatSize(file.size)})</span>
                <button class="delete-btn" data-path="${file.relativePath}">删除</button>
            </div>
        `;
    });
    container.innerHTML = html;
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const path = btn.dataset.path;
            if (confirm(`确定删除文件 ${path} 吗？`)) {
                const res = await fetch('/api/admin/clean-orphan-files', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ files: [path] })
                });
                const data = await res.json();
                if (data.success) {
                    alert(`已删?${data.deleted} 个文件`);
                    loadScan();
                } else alert('删除失败');
            }
        });
    });
}

function renderMissingFiles() {
    const container = document.getElementById('missingFilesList');
    if (scanResults.missingFiles.length === 0) {
        container.innerHTML = '<div style="padding:12px; text-align:center; color:#999;">无缺失文?/div>';
        return;
    }
    let html = '';
    scanResults.missingFiles.forEach(file => {
        html += `
            <div class="file-item">
                <span>${escapeHtml(file.fileUrl)} - ${escapeHtml(file.error)}</span>
                <button class="delete-record-btn" data-url="${file.fileUrl}" data-table="${file.table}" data-id="${file.id}">删除记录</button>
            </div>
        `;
    });
    container.innerHTML = html;
    document.querySelectorAll('.delete-record-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const url = btn.dataset.url;
            const table = btn.dataset.table;
            const id = btn.dataset.id;
            if (confirm(`确定删除数据库中的记录吗？文件已不存在，仅删除记录。\n路径?{url}`)) {
                const res = await fetch('/api/admin/delete-missing-record', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ fileUrl: url, table: table, id: id })
                });
                const data = await res.json();
                if (data.success) {
                    alert('记录已删除');
                    loadScan();
                } else alert('删除失败' + data.message);
            }
        });
    });
}

document.getElementById('deleteAllOrphansBtn').addEventListener('click', async () => {
    if (!scanResults || scanResults.orphanFiles.length === 0) {
        alert('没有孤儿文件可删除');
        return;
    }
    const paths = scanResults.orphanFiles.map(f => f.relativePath);
    if (confirm(`确定删除全部 ${paths.length} 个孤儿文件吗？不可恢复！`)) {
        const res = await fetch('/api/admin/clean-orphan-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ files: paths })
        });
        const data = await res.json();
        if (data.success) {
            alert(`已删?${data.deleted} 个文件，失败 ${data.errors.length} 个`);
            loadScan();
        } else alert('操作失败');
    }
});

function escapeHtml(text) {
    if (!text) return '';
    var e = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
    return text.replace(/[&<>"']/g, function(m) { return e[m]; });
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

(async () => {
    const res = await fetch('/api/me', { credentials: 'include' });
    const data = await res.json();
    if (!data.success || data.user.role !== 'admin') {
        alert('请使用管理员账号登录');
        window.location.href = '/';
        return;
    }
    await loadScan();
})();