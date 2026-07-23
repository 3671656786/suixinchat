async function loadAnnouncements() {
    const res = await fetch('/api/announcements', { credentials: 'include' });
    const data = await res.json();
    const container = document.getElementById('announcementsList');
    if (!data.success || data.announcements.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#999;">暂无公告</div>';
        return;
    }
    let html = '';
    data.announcements.forEach(ann => {
        const formattedContent = escapeHtml(ann.content).replace(/\n/g, '<br>');
        html += `
            <div class="announcement-item">
                <div class="announcement-title">📢 ${escapeHtml(ann.publisherName)} 发布</div>
                <div class="announcement-meta">${new Date(ann.timestamp).toLocaleString()}</div>
                <div>${formattedContent}</div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}

loadAnnouncements();