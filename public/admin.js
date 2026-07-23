let socket = null;
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

function escapeHtml(text) {
    if (!text) return '';
    var e = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
    return text.replace(/[&<>"']/g, function(m) { return e[m]; });
}

// 用户管理
async function loadUsers() {
    const res = await apiRequest('/api/admin/users', 'GET');
    if (res.success) {
        const container = document.getElementById('userList');
        container.innerHTML = '';
        res.users.forEach(user => {
            const div = document.createElement('div');
            div.className = 'user-item';
            div.innerHTML = `
                <div>
                    <img src="${escapeHtml(user.avatarUrl || 'https://api.dicebear.com/7.x/avataaars/svg?seed=default')}" style="width:32px;height:32px;border-radius:50%;vertical-align:middle;margin-right:8px;">
                    <strong>${escapeHtml(user.username)}</strong> (ID: ${user.userId}) - ${user.role === 'admin' ? '管理员' : '普通用户'}
                    ${user.email ? `<span style="color:#999;"> (${escapeHtml(user.email)})</span>` : ''}
                </div>
                <div>
                    ${user.role !== 'admin' ? `<button class="kick-btn" data-id="${user.userId}">踢出</button>` : ''}
                    ${user.role !== 'admin' ? `<button class="ban-btn" data-id="${user.userId}" data-name="${escapeHtml(user.username)}">🔒 封禁</button>` : ''}
                </div>
            `;
            container.appendChild(div);
        });
        document.querySelectorAll('.kick-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('确定踢出该用户？')) {
                    const res = await apiRequest('/api/admin/kick', 'POST', { userId: btn.dataset.id });
                    if (res.success) { alert('已踢出'); loadUsers(); }
                    else alert(res.message);
                }
            });
        });
        document.querySelectorAll('.ban-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const userId = btn.dataset.id;
                const username = btn.dataset.name;
                await showBanModal(userId, username);
            });
        });
    }
}

// 封禁模态框
async function showBanModal(userId, username) {
    const res = await apiRequest(`/api/admin/bans/user/${userId}`, 'GET');
    const userBans = res.bans || [];
    const banModal = document.getElementById('banModal');
    document.getElementById('banUserInfo').innerHTML = `<strong>用户：${escapeHtml(username)} (ID: ${userId})</strong>`;
    
    let bansHtml = '';
    const typeNames = {
        login: '登录封禁',
        chat: '聊天封禁',
        files_upload: '网盘上传封禁',
        files_download: '网盘下载封禁',
        notes: '云笔记封禁',
        all: '全部封禁'
    };
    for (const ban of userBans) {
        bansHtml += `<div>${typeNames[ban.ban_type] || ban.ban_type} - ${ban.reason || '无原因'} ${ban.expires_at ? '到期：' + new Date(ban.expires_at).toLocaleString() : '永久'} 
            <button class="remove-ban-btn" data-user="${userId}" data-type="${ban.ban_type}">解除</button></div>`;
    }
    document.getElementById('existingBansList').innerHTML = bansHtml || '暂无封禁';
    banModal.style.display = 'flex';
    
    document.querySelectorAll('.remove-ban-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const uid = btn.dataset.user;
            const type = btn.dataset.type;
            await fetch(`/api/admin/bans/${uid}/${type}`, { method: 'DELETE', credentials: 'include' });
            showBanModal(uid, username);
        });
    });
    
    document.getElementById('saveBanBtn').onclick = async () => {
        const banType = document.getElementById('banType').value;
        const reason = document.getElementById('banReason').value;
        const expiresAt = document.getElementById('banExpiresAt').value;
        const res = await apiRequest('/api/admin/bans', 'POST', { userId, banType, reason, expiresAt: expiresAt || null });
        if (res.success) {
            alert('封禁已保存');
            showBanModal(userId, username);
        } else alert('保存失败：' + res.message);
    };
    document.getElementById('cancelBanBtn').onclick = () => banModal.style.display = 'none';
}

// 邮箱黑名单管理
document.getElementById('emailBlacklistBtn')?.addEventListener('click', async () => {
    const modal = document.getElementById('emailBlacklistModal');
    const list = await apiRequest('/api/admin/email-blacklist', 'GET');
    let html = '<ul style="max-height:200px; overflow-y:auto;">';
    (list.list || []).forEach(item => {
        html += `<li>${escapeHtml(item.email)} - ${item.reason || ''} <button class="remove-email" data-email="${item.email}">删除</button></li>`;
    });
    html += '</ul>';
    document.getElementById('blacklistList').innerHTML = html;
    modal.style.display = 'flex';
    
    document.querySelectorAll('.remove-email').forEach(btn => {
        btn.addEventListener('click', async () => {
            await fetch(`/api/admin/email-blacklist/${encodeURIComponent(btn.dataset.email)}`, { method: 'DELETE', credentials: 'include' });
            const newList = await apiRequest('/api/admin/email-blacklist', 'GET');
            let newHtml = '<ul>';
            (newList.list || []).forEach(item => {
                newHtml += `<li>${escapeHtml(item.email)} - ${item.reason || ''} <button class="remove-email" data-email="${item.email}">删除</button></li>`;
            });
            newHtml += '</ul>';
            document.getElementById('blacklistList').innerHTML = newHtml;
            document.querySelectorAll('.remove-email').forEach(btn2 => {
                btn2.addEventListener('click', async () => {
                    await fetch(`/api/admin/email-blacklist/${encodeURIComponent(btn2.dataset.email)}`, { method: 'DELETE', credentials: 'include' });
                    btn2.closest('li').remove();
                });
            });
        });
    });
    
    document.getElementById('addBlacklistBtn').onclick = async () => {
        const email = document.getElementById('blacklistEmail').value;
        const reason = document.getElementById('blacklistReason').value;
        if (!email) return alert('请输入邮箱');
        await apiRequest('/api/admin/email-blacklist', 'POST', { email, reason });
        document.getElementById('blacklistEmail').value = '';
        document.getElementById('blacklistReason').value = '';
        const newList = await apiRequest('/api/admin/email-blacklist', 'GET');
        let newHtml = '<ul>';
        (newList.list || []).forEach(item => {
            newHtml += `<li>${escapeHtml(item.email)} - ${item.reason || ''} <button class="remove-email" data-email="${item.email}">删除</button></li>`;
        });
        newHtml += '</ul>';
        document.getElementById('blacklistList').innerHTML = newHtml;
    };
    
    document.getElementById('closeBlacklistBtn').onclick = () => modal.style.display = 'none';
});

// 协议管理
async function loadAgreementForEdit() {
    const res = await fetch('/api/agreement');
    const data = await res.json();
    if (data.success) {
        document.getElementById('agreementEditContent').value = data.content;
    } else {
        alert('加载协议失败');
    }
}

document.getElementById('manageAgreementBtn')?.addEventListener('click', async () => {
    const modal = document.getElementById('agreementManageModal');
    await loadAgreementForEdit();
    modal.style.display = 'flex';
});

document.getElementById('cancelAgreementBtn')?.addEventListener('click', () => {
    document.getElementById('agreementManageModal').style.display = 'none';
});

document.getElementById('saveAgreementBtn')?.addEventListener('click', async () => {
    const content = document.getElementById('agreementEditContent').value;
    if (!content) {
        alert('协议内容不能为空');
        return;
    }
    const res = await apiRequest('/api/admin/agreement', 'POST', { content });
    if (res.success) {
        alert('协议已更新');
        document.getElementById('agreementManageModal').style.display = 'none';
    } else {
        alert('保存失败：' + res.message);
    }
});

// 消息管理
async function loadMessages() {
    const res = await apiRequest('/api/admin/messages', 'GET');
    if (res.success) {
        const container = document.getElementById('messageList');
        container.innerHTML = '';
        res.messages.forEach(msg => {
            const div = document.createElement('div');
            div.className = 'message-item';
            div.innerHTML = `
                <div><strong>${escapeHtml(msg.username)}</strong> ${new Date(msg.timestamp).toLocaleString()}<br>${escapeHtml(msg.content) || (msg.fileName ? `[文件] ${escapeHtml(msg.fileName)}` : '')}</div>
                <button class="delete-msg-btn" data-id="${msg.id}">删除</button>
            `;
            container.appendChild(div);
        });
        document.querySelectorAll('.delete-msg-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('删除该消息？')) {
                    const res = await apiRequest('/api/admin/deleteMessage', 'POST', { messageId: btn.dataset.id });
                    if (res.success) { alert('已删除'); loadMessages(); }
                    else alert(res.message);
                }
            });
        });
    }
}

// 公告管理
async function loadAnnouncements() {
    const res = await apiRequest('/api/announcements', 'GET');
    if (res.success) {
        const container = document.getElementById('announcementList');
        container.innerHTML = '';
        res.announcements.forEach(ann => {
            const div = document.createElement('div');
            div.className = 'announcement-item';
            div.innerHTML = `
                <strong>${escapeHtml(ann.publisherName)}</strong> ${new Date(ann.timestamp).toLocaleString()}<br>
                ${escapeHtml(ann.content)}
                <button class="delete-announcement-btn" data-id="${ann.id}" style="margin-left:12px; background:var(--danger); color:white; border:none; padding:2px 8px; border-radius:12px; cursor:pointer;">删除</button>
            `;
            container.appendChild(div);
        });
        document.querySelectorAll('.delete-announcement-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                if (confirm('删除公告？')) {
                    await fetch(`/api/announcements/${id}`, { method: 'DELETE', credentials: 'include' });
                    loadAnnouncements();
                }
            });
        });
    }
}

document.getElementById('publishAnnouncementBtn').addEventListener('click', async () => {
    const content = document.getElementById('announcementContent').value;
    if (!content) return;
    const res = await apiRequest('/api/announcements', 'POST', { content });
    if (res.success) {
        alert('公告已发布');
        document.getElementById('announcementContent').value = '';
        loadAnnouncements();
    } else alert(res.message);
});

// 邮件公告
const emailTargetSelect = document.getElementById('emailTarget');
const singleEmailInput = document.getElementById('singleEmail');
if (emailTargetSelect) {
    emailTargetSelect.addEventListener('change', () => {
        singleEmailInput.style.display = emailTargetSelect.value === 'single' ? 'block' : 'none';
    });
}
document.getElementById('sendEmailBtn')?.addEventListener('click', async () => {
    const target = emailTargetSelect.value;
    const subject = document.getElementById('emailSubject').value.trim();
    const message = document.getElementById('emailMessage').value.trim();
    if (!subject || !message) {
        alert('请填写主题和内容');
        return;
    }
    let emailTarget = null;
    if (target === 'single') {
        emailTarget = singleEmailInput.value.trim();
        if (!emailTarget || !emailTarget.includes('@')) {
            alert('请输入有效的邮箱地址');
            return;
        }
    } else {
        emailTarget = 'all';
    }
    try {
        const res = await fetch('/api/admin/send-email-announcement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ target: emailTarget, subject, message })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('emailResult').innerHTML = `<span style="color:green;">${data.message}</span>`;
            document.getElementById('emailSubject').value = '';
            document.getElementById('emailMessage').value = '';
            if (target === 'single') singleEmailInput.value = '';
        } else {
            document.getElementById('emailResult').innerHTML = `<span style="color:red;">发送失败：${data.message}</span>`;
        }
    } catch (err) {
        document.getElementById('emailResult').innerHTML = `<span style="color:red;">网络错误：${err.message}</span>`;
    }
});

// 服务器日志
async function loadLogs() {
    const res = await apiRequest('/api/admin/logs', 'GET');
    const container = document.getElementById('logsContent');
    if (res.success && res.logs) {
        container.innerText = res.logs.join('\n');
    } else {
        container.innerText = '加载失败或暂无日志';
    }
}
document.getElementById('refreshLogsBtn')?.addEventListener('click', loadLogs);

// 在线时长统计
async function loadStats() {
    const res = await apiRequest('/api/admin/online-stats', 'GET');
    const container = document.getElementById('statsContent');
    if (res.success && res.stats) {
        if (res.stats.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:#999;">暂无数据</div>';
            return;
        }
        let html = '<table class="stats-table"><thead><tr><th>用户名</th><th>总在线时长</th><th>会话次数</th></tr></thead><tbody>';
        res.stats.forEach(stat => {
            const hours = Math.floor(stat.totalSeconds / 3600);
            const minutes = Math.floor((stat.totalSeconds % 3600) / 60);
            html += `<tr><td style="padding:8px;">${escapeHtml(stat.username)}</td><td style="padding:8px;">${hours}小时${minutes}分钟</td><td style="padding:8px;">${stat.sessionCount}</td></tr>`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    } else {
        container.innerHTML = '加载失败';
    }
}
document.getElementById('refreshStatsBtn')?.addEventListener('click', loadStats);

// 流量统计
async function loadTrafficStats(startDate = '', endDate = '') {
    let url = '/api/admin/traffic-stats';
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (params.toString()) url += '?' + params.toString();
    
    const res = await apiRequest(url, 'GET');
    const container = document.getElementById('trafficStatsContent');
    if (!res.success || !res.stats || res.stats.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#999;">暂无流量数据</div>';
        return;
    }
    let html = '<table class="stats-table"><thead><tr><th>用户名</th><th>上传流量</th><th>下载流量</th><th>总流量</th></tr></thead><tbody>';
    res.stats.forEach(stat => {
        const uploadMB = (stat.total_upload_bytes / 1024 / 1024).toFixed(2);
        const downloadMB = (stat.total_download_bytes / 1024 / 1024).toFixed(2);
        const totalMB = (stat.total_upload_bytes + stat.total_download_bytes) / 1024 / 1024;
        html += `<tr><td style="padding:8px;">${escapeHtml(stat.username)}</td><td style="padding:8px;">${uploadMB} MB</td><td style="padding:8px;">${downloadMB} MB</td><td style="padding:8px;">${totalMB.toFixed(2)} MB</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

document.getElementById('filterTrafficBtn')?.addEventListener('click', () => {
    const start = document.getElementById('trafficStartDate').value;
    const end = document.getElementById('trafficEndDate').value;
    loadTrafficStats(start, end);
});
document.getElementById('resetTrafficBtn')?.addEventListener('click', () => {
    document.getElementById('trafficStartDate').value = '';
    document.getElementById('trafficEndDate').value = '';
    loadTrafficStats();
});

// 全局存储容量
async function loadGlobalStorage() {
    const res = await apiRequest('/api/admin/global-storage', 'GET');
    const container = document.getElementById('globalStorageInfo');
    if (!container) return;
    if (res.success && res.data) {
        const usedGB = res.data.usedGB;
        const maxGB = res.data.maxGB;
        const percent = res.data.percent.toFixed(1);
        container.innerHTML = `
            <div style="background:#f9f9f9; padding:12px; border-radius:16px;">
                <div>已用容量：${usedGB} GB / ${maxGB} GB (${percent}%)</div>
                <div style="background:#e0e0e0; border-radius:8px; margin-top:8px; height:8px;">
                    <div style="width:${percent}%; background:var(--primary); height:8px; border-radius:8px;"></div>
                </div>
            </div>
        `;
    } else {
        container.innerHTML = '<div style="color:#999;">加载失败</div>';
    }
}

// 报表配置
async function loadReportConfig() {
    const res = await apiRequest('/api/admin/report/config', 'GET');
    if (res.success && res.config) {
        document.getElementById('reportEnabled').checked = res.config.enabled === 1;
        document.getElementById('reportCron').value = res.config.cron || '';
        document.getElementById('reportEmails').value = res.config.emails || '';
        const dataTypes = res.config.data_types || [];
        document.querySelectorAll('#reportDataTypes input[type="checkbox"]').forEach(cb => {
            cb.checked = dataTypes.includes(cb.value);
        });
    }
}

document.getElementById('saveReportConfigBtn')?.addEventListener('click', async () => {
    const enabled = document.getElementById('reportEnabled').checked;
    const cron = document.getElementById('reportCron').value.trim();
    const emails = document.getElementById('reportEmails').value.trim();
    const dataTypes = Array.from(document.querySelectorAll('#reportDataTypes input[type="checkbox"]:checked')).map(cb => cb.value);
    if (!cron) {
        alert('请填写 Cron 表达式');
        return;
    }
    if (!emails) {
        alert('请填写收件邮箱');
        return;
    }
    const res = await apiRequest('/api/admin/report/config', 'POST', { enabled, cron, emails, data_types: dataTypes });
    if (res.success) {
        document.getElementById('reportMsg').innerHTML = '<span style="color:green;">配置保存成功，定时任务已更新。</span>';
        setTimeout(() => document.getElementById('reportMsg').innerHTML = '', 3000);
    } else {
        alert('保存失败：' + res.message);
    }
});

async function previewReport() {
    const dataTypes = Array.from(document.querySelectorAll('#reportDataTypes input[type="checkbox"]:checked')).map(cb => cb.value);
    if (dataTypes.length === 0) {
        document.getElementById('previewContent').innerHTML = '<div style="color:#999;">请至少选择一项数据类型</div>';
        return;
    }
    try {
        const res = await apiRequest('/api/admin/report/preview', 'POST', { data_types: dataTypes });
        if (res.success && res.data) {
            let html = '';
            if (res.data.users) {
                html += `<h5>👥 用户统计</h5><ul><li>总用户：${res.data.users.totalUsers}</li><li>近7天新增：${res.data.users.newUsersWeek}</li></ul>`;
            }
            if (res.data.messages) {
                html += `<h5>💬 消息统计</h5><ul><li>总消息：${res.data.messages.totalMessages}</li><li>今日：${res.data.messages.todayMessages}</li></ul>`;
            }
            if (res.data.files) {
                html += `<h5>📁 文件统计</h5><ul><li>总文件数：${res.data.files.totalFiles}</li><li>总空间：${res.data.files.totalSizeMB} MB</li></ul>`;
            }
            if (res.data.online && res.data.online.length) {
                html += `<h5>⏱️ 在线时长排行</h5><table style="width:100%; border-collapse:collapse;"><thead><tr><th>用户名</th><th>小时</th></tr></thead><tbody>`;
                for (const u of res.data.online.slice(0, 10)) {
                    html += `<tr><td style="padding:6px;">${escapeHtml(u.username)}</td><td style="padding:6px;">${u.hours}</td></tr>`;
                }
                html += `</tbody></table>`;
            }
            if (res.data.traffic) {
                html += `<h5>📈 流量统计</h5><ul><li>上传：${res.data.traffic.uploadMB} MB</li><li>下载：${res.data.traffic.downloadMB} MB</li></ul>`;
            }
            document.getElementById('previewContent').innerHTML = html || '<div style="color:#999;">无数据</div>';
        } else {
            document.getElementById('previewContent').innerHTML = '<div style="color:red;">预览失败</div>';
        }
    } catch (err) {
        document.getElementById('previewContent').innerHTML = '<div style="color:red;">预览失败</div>';
    }
}

document.getElementById('previewReportBtn')?.addEventListener('click', previewReport);

document.getElementById('sendReportNowBtn')?.addEventListener('click', async () => {
    const dataTypes = Array.from(document.querySelectorAll('#reportDataTypes input[type="checkbox"]:checked')).map(cb => cb.value);
    if (dataTypes.length === 0) {
        alert('请至少选择一项数据类型');
        return;
    }
    if (!confirm('确定立即发送当前数据报表到配置的邮箱吗？')) return;
    const res = await apiRequest('/api/admin/report/send', 'POST', { data_types: dataTypes });
    if (res.success) {
        alert(res.message);
    } else {
        alert('发送失败：' + res.message);
    }
});

// 重启服务器
async function restartServer() {
    if (!confirm('⚠️ 确定重启服务器？所有用户将收到通知。')) return;
    const res = await fetch('/api/admin/restart', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (data.success) {
        alert('服务器即将重启，倒计时10秒...');
    } else {
        alert('重启命令发送失败');
    }
}
document.getElementById('restartServerBtn')?.addEventListener('click', restartServer);
document.getElementById('cleanFilesBtn')?.addEventListener('click', () => {
    window.location.href = '/clean-files';
});
document.getElementById('dbManagerBtn')?.addEventListener('click', () => {
    window.location.href = '/db-manager';
});
document.getElementById('logoutAdminBtn')?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/';
});

// 标签页切换
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.admin-tab').forEach(tabDiv => tabDiv.classList.remove('active'));
        document.getElementById(`${tab}Tab`).classList.add('active');
        if (tab === 'users') loadUsers();
        else if (tab === 'messages') loadMessages();
        else if (tab === 'announcements') loadAnnouncements();
        else if (tab === 'email') { /* 无需加载数据 */ }
        else if (tab === 'logs') loadLogs();
        else if (tab === 'stats') {
            loadStats();
            loadTrafficStats();
            loadGlobalStorage();
        }
        else if (tab === 'report') loadReportConfig();
    });
});

// 初始化
(async () => {
    const res = await fetch('/api/me', { credentials: 'include' });
    const data = await res.json();
    if (!data.success || data.user.role !== 'admin') {
        alert('无权限访问');
        window.location.href = '/';
        return;
    }
    currentUser = data.user;
    loadUsers();
    loadMessages();
    loadAnnouncements();
    loadLogs();
    loadStats();
    loadTrafficStats();
    loadGlobalStorage();
    loadReportConfig();
    socket = io({ withCredentials: true });
    window.socket = socket;
    socket.on('kicked', () => { window.location.href = '/'; });
})();