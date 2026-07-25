// public/admin.js - 第一部分
// ========== 安全 Fallback：确保全局函数可用 ==========
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
})();

var socket = null;
var currentUser = null;
var currentCapacityUserId = null;

// ========== 用户管理 ==========
async function loadUsers() {
    var res = await window.apiRequest('/api/admin/users', 'GET');
    if (res.success) {
        var container = document.getElementById('userList');
        container.innerHTML = '';
        res.users.forEach(function(user) {
            var div = document.createElement('div');
            div.className = 'user-item';
            div.innerHTML = '<div><img src="' + window.escapeHtml(user.avatarUrl || 'https://api.dicebear.com/7.x/avataaars/svg?seed=default') + '" style="width:32px;height:32px;border-radius:50%;vertical-align:middle;margin-right:8px;"><strong>' + window.escapeHtml(user.username) + '</strong> (ID: ' + user.userId + ') - ' + (user.role === 'admin' ? '管理员' : '普通用户') + (user.email ? '<span style="color:#999;"> (' + window.escapeHtml(user.email) + ')</span>' : '') + '</div><div>' + (user.role !== 'admin' ? '<button class="kick-btn" data-id="' + user.userId + '">踢出</button>' : '') + (user.role !== 'admin' ? '<button class="ban-btn" data-id="' + user.userId + '" data-name="' + window.escapeHtml(user.username) + '">🔒 封禁</button>' : '') + '</div>';
            container.appendChild(div);
        });
        document.querySelectorAll('.kick-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (confirm('确定踢出该用户？')) {
                    window.apiRequest('/api/admin/kick', 'POST', { userId: btn.dataset.id }).then(function(res) {
                        if (res.success) { alert('已踢出'); loadUsers(); }
                        else alert(res.message);
                    });
                }
            });
        });
        document.querySelectorAll('.ban-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                showBanModal(btn.dataset.id, btn.dataset.name);
            });
        });
    }
}

// ========== 封禁模态框 ==========
async function showBanModal(userId, username) {
    var res = await window.apiRequest('/api/admin/bans/user/' + userId, 'GET');
    var userBans = res.bans || [];
    var banModal = document.getElementById('banModal');
    document.getElementById('banUserInfo').innerHTML = '<strong>用户：' + window.escapeHtml(username) + ' (ID: ' + userId + ')</strong>';
    
    var bansHtml = '';
    var typeNames = { login: '登录封禁', chat: '聊天封禁', files_upload: '网盘上传封禁', files_download: '网盘下载封禁', notes: '云笔记封禁', all: '全部封禁' };
    for (var i = 0; i < userBans.length; i++) {
        var ban = userBans[i];
        bansHtml += '<div>' + (typeNames[ban.ban_type] || ban.ban_type) + ' - ' + (ban.reason || '无原因') + ' ' + (ban.expires_at ? '到期：' + new Date(ban.expires_at).toLocaleString() : '永久') + ' <button class="remove-ban-btn" data-user="' + userId + '" data-type="' + ban.ban_type + '">解除</button></div>';
    }
    document.getElementById('existingBansList').innerHTML = bansHtml || '暂无封禁';
    banModal.style.display = 'flex';
    
    document.querySelectorAll('.remove-ban-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var uid = btn.dataset.user;
            var type = btn.dataset.type;
            fetch('/api/admin/bans/' + uid + '/' + type, { method: 'DELETE', credentials: 'include' }).then(function() {
                showBanModal(uid, username);
            });
        });
    });
    
    document.getElementById('saveBanBtn').onclick = function() {
        var banType = document.getElementById('banType').value;
        var reason = document.getElementById('banReason').value;
        var expiresAt = document.getElementById('banExpiresAt').value;
        window.apiRequest('/api/admin/bans', 'POST', { userId: userId, banType: banType, reason: reason, expiresAt: expiresAt || null }).then(function(res) {
            if (res.success) {
                alert('封禁已保存');
                showBanModal(userId, username);
            } else alert('保存失败：' + res.message);
        });
    };
    document.getElementById('cancelBanBtn').onclick = function() { banModal.style.display = 'none'; };
}

// ========== 邮箱黑名单管理 ==========
document.getElementById('emailBlacklistBtn')?.addEventListener('click', function() {
    var modal = document.getElementById('emailBlacklistModal');
    window.apiRequest('/api/admin/email-blacklist', 'GET').then(function(list) {
        var html = '<ul style="max-height:200px; overflow-y:auto;">';
        (list.list || []).forEach(function(item) {
            html += '<li>' + window.escapeHtml(item.email) + ' - ' + (item.reason || '') + ' <button class="remove-email" data-email="' + item.email + '">删除</button></li>';
        });
        html += '</ul>';
        document.getElementById('blacklistList').innerHTML = html;
        modal.style.display = 'flex';
        
        document.querySelectorAll('.remove-email').forEach(function(btn) {
            btn.addEventListener('click', function() {
                fetch('/api/admin/email-blacklist/' + encodeURIComponent(btn.dataset.email), { method: 'DELETE', credentials: 'include' }).then(function() {
                    window.apiRequest('/api/admin/email-blacklist', 'GET').then(function(newList) {
                        var newHtml = '<ul>';
                        (newList.list || []).forEach(function(item) {
                            newHtml += '<li>' + window.escapeHtml(item.email) + ' - ' + (item.reason || '') + ' <button class="remove-email" data-email="' + item.email + '">删除</button></li>';
                        });
                        newHtml += '</ul>';
                        document.getElementById('blacklistList').innerHTML = newHtml;
                        document.querySelectorAll('.remove-email').forEach(function(btn2) {
                            btn2.addEventListener('click', function() {
                                fetch('/api/admin/email-blacklist/' + encodeURIComponent(btn2.dataset.email), { method: 'DELETE', credentials: 'include' });
                                btn2.closest('li').remove();
                            });
                        });
                    });
                });
            });
        });
    });
    
    document.getElementById('addBlacklistBtn').onclick = function() {
        var email = document.getElementById('blacklistEmail').value;
        var reason = document.getElementById('blacklistReason').value;
        if (!email) return alert('请输入邮箱');
        window.apiRequest('/api/admin/email-blacklist', 'POST', { email: email, reason: reason }).then(function() {
            document.getElementById('blacklistEmail').value = '';
            document.getElementById('blacklistReason').value = '';
            window.apiRequest('/api/admin/email-blacklist', 'GET').then(function(newList) {
                var newHtml = '<ul>';
                (newList.list || []).forEach(function(item) {
                    newHtml += '<li>' + window.escapeHtml(item.email) + ' - ' + (item.reason || '') + ' <button class="remove-email" data-email="' + item.email + '">删除</button></li>';
                });
                newHtml += '</ul>';
                document.getElementById('blacklistList').innerHTML = newHtml;
            });
        });
    };
    
    document.getElementById('closeBlacklistBtn').onclick = function() { modal.style.display = 'none'; };
});

// ========== 协议管理 ==========
async function loadAgreementForEdit() {
    var res = await fetch('/api/agreement');
    var data = await res.json();
    if (data.success) {
        document.getElementById('agreementEditContent').value = data.content;
    } else {
        alert('加载协议失败');
    }
}

document.getElementById('manageAgreementBtn')?.addEventListener('click', function() {
    var modal = document.getElementById('agreementManageModal');
    loadAgreementForEdit();
    modal.style.display = 'flex';
});

document.getElementById('cancelAgreementBtn')?.addEventListener('click', function() {
    document.getElementById('agreementManageModal').style.display = 'none';
});

document.getElementById('saveAgreementBtn')?.addEventListener('click', function() {
    var content = document.getElementById('agreementEditContent').value;
    if (!content) {
        alert('协议内容不能为空');
        return;
    }
    window.apiRequest('/api/admin/agreement', 'POST', { content: content }).then(function(res) {
        if (res.success) {
            alert('协议已更新');
            document.getElementById('agreementManageModal').style.display = 'none';
        } else {
            alert('保存失败：' + res.message);
        }
    });
});

// ========== 消息管理 ==========
async function loadMessages() {
    var res = await window.apiRequest('/api/admin/messages', 'GET');
    if (res.success) {
        var container = document.getElementById('messageList');
        container.innerHTML = '';
        res.messages.forEach(function(msg) {
            var div = document.createElement('div');
            div.className = 'message-item';
            div.innerHTML = '<div><strong>' + window.escapeHtml(msg.username) + '</strong> ' + new Date(msg.timestamp).toLocaleString() + '<br>' + (window.escapeHtml(msg.content) || (msg.fileName ? '[文件] ' + window.escapeHtml(msg.fileName) : '')) + '</div><button class="delete-msg-btn" data-id="' + msg.id + '">删除</button>';
            container.appendChild(div);
        });
        document.querySelectorAll('.delete-msg-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (confirm('删除该消息？')) {
                    window.apiRequest('/api/admin/deleteMessage', 'POST', { messageId: btn.dataset.id }).then(function(res) {
                        if (res.success) { alert('已删除'); loadMessages(); }
                        else alert(res.message);
                    });
                }
            });
        });
    }
}

// ========== 公告管理 ==========
async function loadAnnouncements() {
    var res = await window.apiRequest('/api/announcements', 'GET');
    if (res.success) {
        var container = document.getElementById('announcementList');
        container.innerHTML = '';
        res.announcements.forEach(function(ann) {
            var div = document.createElement('div');
            div.className = 'announcement-item';
            div.innerHTML = '<strong>' + window.escapeHtml(ann.publisherName) + '</strong> ' + new Date(ann.timestamp).toLocaleString() + '<br>' + window.escapeHtml(ann.content) + '<button class="delete-announcement-btn" data-id="' + ann.id + '" style="margin-left:12px; background:var(--danger); color:white; border:none; padding:2px 8px; border-radius:12px; cursor:pointer;">删除</button>';
            container.appendChild(div);
        });
        document.querySelectorAll('.delete-announcement-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = btn.dataset.id;
                if (confirm('删除公告？')) {
                    fetch('/api/announcements/' + id, { method: 'DELETE', credentials: 'include' }).then(function() {
                        loadAnnouncements();
                    });
                }
            });
        });
    }
}

document.getElementById('publishAnnouncementBtn').addEventListener('click', function() {
    var content = document.getElementById('announcementContent').value;
    if (!content) return;
    window.apiRequest('/api/announcements', 'POST', { content: content }).then(function(res) {
        if (res.success) {
            alert('公告已发布');
            document.getElementById('announcementContent').value = '';
            loadAnnouncements();
        } else alert(res.message);
    });
});

// ========== 邮件公告 ==========
var emailTargetSelect = document.getElementById('emailTarget');
var singleEmailInput = document.getElementById('singleEmail');
if (emailTargetSelect) {
    emailTargetSelect.addEventListener('change', function() {
        singleEmailInput.style.display = emailTargetSelect.value === 'single' ? 'block' : 'none';
    });
}
document.getElementById('sendEmailBtn')?.addEventListener('click', function() {
    var target = emailTargetSelect.value;
    var subject = document.getElementById('emailSubject').value.trim();
    var message = document.getElementById('emailMessage').value.trim();
    if (!subject || !message) {
        alert('请填写主题和内容');
        return;
    }
    var emailTarget = null;
    if (target === 'single') {
        emailTarget = singleEmailInput.value.trim();
        if (!emailTarget || !emailTarget.includes('@')) {
            alert('请输入有效的邮箱地址');
            return;
        }
    } else {
        emailTarget = 'all';
    }
    fetch('/api/admin/send-email-announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ target: emailTarget, subject: subject, message: message })
    }).then(function(res) { return res.json(); }).then(function(data) {
        if (data.success) {
            document.getElementById('emailResult').innerHTML = '<span style="color:green;">' + data.message + '</span>';
            document.getElementById('emailSubject').value = '';
            document.getElementById('emailMessage').value = '';
            if (target === 'single') singleEmailInput.value = '';
        } else {
            document.getElementById('emailResult').innerHTML = '<span style="color:red;">发送失败：' + data.message + '</span>';
        }
    }).catch(function(err) {
        document.getElementById('emailResult').innerHTML = '<span style="color:red;">网络错误：' + err.message + '</span>';
    });
});

// public/admin.js - 第二部分

// ========== 服务器日志 ==========
async function loadLogs() {
    var res = await window.apiRequest('/api/admin/logs', 'GET');
    var container = document.getElementById('logsContent');
    if (res.success && res.logs) {
        container.innerText = res.logs.join('\n');
    } else {
        container.innerText = '加载失败或暂无日志';
    }
}
document.getElementById('refreshLogsBtn')?.addEventListener('click', loadLogs);

// ========== 在线时长统计 ==========
async function loadStats() {
    var res = await window.apiRequest('/api/admin/online-stats', 'GET');
    var container = document.getElementById('statsContent');
    if (res.success && res.stats) {
        if (res.stats.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:#999;">暂无数据</div>';
            return;
        }
        var html = '<table class="stats-table"><thead><tr><th>用户名</th><th>总在线时长</th><th>会话次数</th></tr></thead><tbody>';
        res.stats.forEach(function(stat) {
            var hours = Math.floor(stat.totalSeconds / 3600);
            var minutes = Math.floor((stat.totalSeconds % 3600) / 60);
            html += '<tr><td style="padding:8px;">' + window.escapeHtml(stat.username) + '</td><td style="padding:8px;">' + hours + '小时' + minutes + '分钟</td><td style="padding:8px;">' + stat.sessionCount + '</td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    } else {
        container.innerHTML = '加载失败';
    }
}
document.getElementById('refreshStatsBtn')?.addEventListener('click', loadStats);

// ========== 流量统计 ==========
async function loadTrafficStats(startDate, endDate) {
    startDate = startDate || '';
    endDate = endDate || '';
    var url = '/api/admin/traffic-stats';
    var params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (params.toString()) url += '?' + params.toString();
    
    var res = await window.apiRequest(url, 'GET');
    var container = document.getElementById('trafficStatsContent');
    if (!res.success || !res.stats || res.stats.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#999;">暂无流量数据</div>';
        return;
    }
    var html = '<table class="stats-table"><thead><tr><th>用户名</th><th>上传流量</th><th>下载流量</th><th>总流量</th></tr></thead><tbody>';
    res.stats.forEach(function(stat) {
        var uploadMB = (stat.total_upload_bytes / 1024 / 1024).toFixed(2);
        var downloadMB = (stat.total_download_bytes / 1024 / 1024).toFixed(2);
        var totalMB = (stat.total_upload_bytes + stat.total_download_bytes) / 1024 / 1024;
        html += '<tr><td style="padding:8px;">' + window.escapeHtml(stat.username) + '</td><td style="padding:8px;">' + uploadMB + ' MB</td><td style="padding:8px;">' + downloadMB + ' MB</td><td style="padding:8px;">' + totalMB.toFixed(2) + ' MB</td></tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

document.getElementById('filterTrafficBtn')?.addEventListener('click', function() {
    var start = document.getElementById('trafficStartDate').value;
    var end = document.getElementById('trafficEndDate').value;
    loadTrafficStats(start, end);
});
document.getElementById('resetTrafficBtn')?.addEventListener('click', function() {
    document.getElementById('trafficStartDate').value = '';
    document.getElementById('trafficEndDate').value = '';
    loadTrafficStats();
});

// ========== 全局存储容量 ==========
async function loadGlobalStorage() {
    var res = await window.apiRequest('/api/admin/global-storage', 'GET');
    var container = document.getElementById('globalStorageInfo');
    if (!container) return;
    if (res.success && res.data) {
        var usedGB = res.data.usedGB;
        var maxGB = res.data.maxGB;
        var percent = res.data.percent.toFixed(1);
        container.innerHTML = '<div style="background:#f9f9f9; padding:12px; border-radius:16px;"><div>已用容量：' + usedGB + ' GB / ' + maxGB + ' GB (' + percent + '%)</div><div style="background:#e0e0e0; border-radius:8px; margin-top:8px; height:8px;"><div style="width:' + percent + '%; background:' + (percent > 80 ? '#e53935' : '#07c160') + '; height:8px; border-radius:8px;"></div></div></div>';
    } else {
        container.innerHTML = '<div style="color:#999;">加载失败</div>';
    }
}

// ========== 报表配置 ==========
async function loadReportConfig() {
    var res = await window.apiRequest('/api/admin/report/config', 'GET');
    if (res.success && res.config) {
        document.getElementById('reportEnabled').checked = res.config.enabled === 1;
        document.getElementById('reportCron').value = res.config.cron || '';
        document.getElementById('reportEmails').value = res.config.emails || '';
        var dataTypes = res.config.data_types || [];
        document.querySelectorAll('#reportDataTypes input[type="checkbox"]').forEach(function(cb) {
            cb.checked = dataTypes.includes(cb.value);
        });
    }
}

document.getElementById('saveReportConfigBtn')?.addEventListener('click', function() {
    var enabled = document.getElementById('reportEnabled').checked;
    var cron = document.getElementById('reportCron').value.trim();
    var emails = document.getElementById('reportEmails').value.trim();
    var dataTypes = Array.from(document.querySelectorAll('#reportDataTypes input[type="checkbox"]:checked')).map(function(cb) { return cb.value; });
    if (!cron) {
        alert('请填写 Cron 表达式');
        return;
    }
    if (!emails) {
        alert('请填写收件邮箱');
        return;
    }
    window.apiRequest('/api/admin/report/config', 'POST', { enabled: enabled, cron: cron, emails: emails, data_types: dataTypes }).then(function(res) {
        if (res.success) {
            document.getElementById('reportMsg').innerHTML = '<span style="color:green;">配置保存成功，定时任务已更新。</span>';
            setTimeout(function() { document.getElementById('reportMsg').innerHTML = ''; }, 3000);
        } else {
            alert('保存失败：' + res.message);
        }
    });
});

async function previewReport() {
    var dataTypes = Array.from(document.querySelectorAll('#reportDataTypes input[type="checkbox"]:checked')).map(function(cb) { return cb.value; });
    if (dataTypes.length === 0) {
        document.getElementById('previewContent').innerHTML = '<div style="color:#999;">请至少选择一项数据类型</div>';
        return;
    }
    try {
        var res = await window.apiRequest('/api/admin/report/preview', 'POST', { data_types: dataTypes });
        if (res.success && res.data) {
            var html = '';
            if (res.data.users) {
                html += '<h5>👥 用户统计</h5><ul><li>总用户：' + res.data.users.totalUsers + '</li><li>近7天新增：' + res.data.users.newUsersWeek + '</li></ul>';
            }
            if (res.data.messages) {
                html += '<h5>💬 消息统计</h5><ul><li>总消息：' + res.data.messages.totalMessages + '</li><li>今日：' + res.data.messages.todayMessages + '</li></ul>';
            }
            if (res.data.files) {
                html += '<h5>📁 文件统计</h5><ul><li>总文件数：' + res.data.files.totalFiles + '</li><li>总空间：' + res.data.files.totalSizeMB + ' MB</li></ul>';
            }
            if (res.data.online && res.data.online.length) {
                html += '<h5>⏱️ 在线时长排行</h5><table style="width:100%; border-collapse:collapse;"><thead><tr><th>用户名</th><th>小时</th></tr></thead><tbody>';
                for (var i = 0; i < res.data.online.slice(0, 10).length; i++) {
                    var u = res.data.online[i];
                    html += '<tr><td style="padding:6px;">' + window.escapeHtml(u.username) + '</td><td style="padding:6px;">' + u.hours + '</td></tr>';
                }
                html += '</tbody></table>';
            }
            if (res.data.traffic) {
                html += '<h5>📈 流量统计</h5><ul><li>上传：' + res.data.traffic.uploadMB + ' MB</li><li>下载：' + res.data.traffic.downloadMB + ' MB</li></ul>';
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

document.getElementById('sendReportNowBtn')?.addEventListener('click', function() {
    var dataTypes = Array.from(document.querySelectorAll('#reportDataTypes input[type="checkbox"]:checked')).map(function(cb) { return cb.value; });
    if (dataTypes.length === 0) {
        alert('请至少选择一项数据类型');
        return;
    }
    if (!confirm('确定立即发送当前数据报表到配置的邮箱吗？')) return;
    window.apiRequest('/api/admin/report/send', 'POST', { data_types: dataTypes }).then(function(res) {
        if (res.success) {
            alert(res.message);
        } else {
            alert('发送失败：' + res.message);
        }
    });
});

// ========== 容量管理 ==========

// 加载容量配置
async function loadCapacityConfig() {
    try {
        var res = await window.apiRequest('/api/admin/capacity/config', 'GET');
        if (res.success) {
            var data = res.data;
            // 全局容量
            var globalInfo = document.getElementById('globalCapacityInfo');
            if (globalInfo) {
                var percent = (data.used / data.globalMax) * 100;
                var barColor = percent > 80 ? '#e53935' : (percent > 60 ? '#ff9800' : '#07c160');
                globalInfo.innerHTML = 
                    '已用：<strong>' + data.usedGB + ' GB</strong> / 总容量：<strong>' + data.globalMaxGB + ' GB</strong> ' +
                    '（<span style="color:' + barColor + ';">' + percent.toFixed(1) + '%</span>）' +
                    '<div style="background:#e0e0e0; border-radius:8px; margin-top:8px; height:8px; overflow:hidden;">' +
                    '<div style="width:' + Math.min(percent, 100) + '%; background:' + barColor + '; height:8px; border-radius:8px;"></div></div>';
                document.getElementById('globalCapacityInput').value = parseFloat(data.globalMaxGB);
            }
            // 文件大小限制
            var fileLimitInfo = document.getElementById('fileSizeLimitInfo');
            if (fileLimitInfo) {
                fileLimitInfo.innerHTML = '当前限制：<strong>' + data.maxFileSizeMB + ' MB</strong>';
                document.getElementById('fileSizeLimitInput').value = data.maxFileSizeMB;
            }
        }
    } catch (err) {
        console.error('加载容量配置失败:', err);
        document.getElementById('globalCapacityInfo').innerHTML = '<span style="color:#e53935;">加载失败</span>';
        document.getElementById('fileSizeLimitInfo').innerHTML = '<span style="color:#e53935;">加载失败</span>';
    }
}

// 更新全局容量
document.getElementById('updateGlobalCapacityBtn')?.addEventListener('click', function() {
    var val = document.getElementById('globalCapacityInput').value.trim();
    if (!val || parseFloat(val) < 1) {
        alert('请输入有效的容量值（至少1GB）');
        return;
    }
    if (!confirm('确定将全局容量修改为 ' + val + ' GB 吗？')) return;
    window.apiRequest('/api/admin/capacity/global', 'POST', { maxGlobalGB: parseFloat(val) })
        .then(function(res) {
            if (res.success) {
                alert(res.message);
                loadCapacityConfig();
                loadUserCapacityList();
            } else {
                alert('更新失败：' + res.message);
            }
        });
});

// 更新文件大小限制
document.getElementById('updateFileSizeLimitBtn')?.addEventListener('click', function() {
    var val = document.getElementById('fileSizeLimitInput').value.trim();
    if (!val || parseFloat(val) < 1) {
        alert('请输入有效的文件大小（至少1MB）');
        return;
    }
    if (!confirm('确定将单文件大小限制修改为 ' + val + ' MB 吗？')) return;
    window.apiRequest('/api/admin/capacity/file-size', 'POST', { maxFileSizeMB: parseFloat(val) })
        .then(function(res) {
            if (res.success) {
                alert(res.message);
                loadCapacityConfig();
            } else {
                alert('更新失败：' + res.message);
            }
        });
});

// 加载用户容量列表
async function loadUserCapacityList() {
    var container = document.getElementById('userCapacityList');
    if (!container) return;
    try {
        var res = await window.apiRequest('/api/admin/capacity/users', 'GET');
        if (res.success) {
            var html = '<table class="stats-table"><thead><tr><th>用户</th><th>角色</th><th>已用容量</th><th>容量上限</th><th>状态</th></tr></thead><tbody>';
            var data = res.data;
            for (var i = 0; i < data.length; i++) {
                var u = data[i];
                var status = u.role === 'admin' ? '👑 无限制' : (u.isCustom ? '✏️ 自定义' : '📋 默认');
                var rowClass = u.role === 'admin' ? 'style="opacity:0.6;"' : 'style="cursor:pointer;"';
                var clickAttr = u.role === 'admin' ? '' : 'onclick="openUserCapacityModal(' + u.userId + ', \'' + window.escapeHtml(u.username) + '\', ' + u.maxMB + ')"';
                html += '<tr ' + rowClass + ' ' + clickAttr + '>' +
                    '<td style="padding:8px;">' + window.escapeHtml(u.username) + '</td>' +
                    '<td style="padding:8px;">' + (u.role === 'admin' ? '管理员' : '普通用户') + '</td>' +
                    '<td style="padding:8px;">' + u.usedMB + ' MB</td>' +
                    '<td style="padding:8px;">' + (u.role === 'admin' ? '∞' : u.maxMB + ' MB') + '</td>' +
                    '<td style="padding:8px;">' + status + '</td>' +
                    '</tr>';
            }
            html += '</tbody></table>';
            container.innerHTML = html;
        }
    } catch (err) {
        console.error('加载用户容量列表失败:', err);
        container.innerHTML = '<div style="color:#999; text-align:center; padding:20px;">加载失败</div>';
    }
}

// 打开修改用户容量模态框
window.openUserCapacityModal = function(userId, username, currentMaxMB) {
    var modal = document.getElementById('userCapacityModal');
    if (!modal) return;
    currentCapacityUserId = userId;
    document.getElementById('capacityUserInfo').innerHTML = 
        '<strong>' + window.escapeHtml(username) + '</strong> (ID: ' + userId + ')<br>' +
        '当前容量：<strong>' + currentMaxMB + ' MB</strong>';
    document.getElementById('userCapacityInput').value = currentMaxMB;
    modal.style.display = 'flex';
    
    document.getElementById('saveCapacityBtn').onclick = function() {
        var val = document.getElementById('userCapacityInput').value.trim();
        if (val === '' || parseFloat(val) === 0) {
            if (!confirm('确定将 ' + window.escapeHtml(username) + ' 的容量恢复为默认 100MB 吗？')) return;
            window.apiRequest('/api/admin/capacity/user', 'POST', { userId: userId, maxMB: null })
                .then(function(res) {
                    if (res.success) {
                        alert(res.message);
                        modal.style.display = 'none';
                        loadUserCapacityList();
                        loadCapacityConfig();
                    } else {
                        alert('操作失败：' + res.message);
                    }
                });
        } else if (parseFloat(val) > 0) {
            if (!confirm('确定将 ' + window.escapeHtml(username) + ' 的容量修改为 ' + val + ' MB 吗？')) return;
            window.apiRequest('/api/admin/capacity/user', 'POST', { userId: userId, maxMB: parseFloat(val) })
                .then(function(res) {
                    if (res.success) {
                        alert(res.message);
                        modal.style.display = 'none';
                        loadUserCapacityList();
                        loadCapacityConfig();
                    } else {
                        alert('操作失败：' + res.message);
                    }
                });
        } else {
            alert('请输入有效的容量值');
        }
    };
    
    document.getElementById('cancelCapacityBtn').onclick = function() {
        modal.style.display = 'none';
    };
};

// ========== 重启服务器 ==========
async function restartServer() {
    if (!confirm('⚠️ 确定重启服务器？所有用户将收到通知。')) return;
    var res = await fetch('/api/admin/restart', { method: 'POST', credentials: 'include' });
    var data = await res.json();
    if (data.success) {
        alert('服务器即将重启，倒计时10秒...');
    } else {
        alert('重启命令发送失败');
    }
}
document.getElementById('restartServerBtn')?.addEventListener('click', restartServer);
document.getElementById('cleanFilesBtn')?.addEventListener('click', function() {
    window.location.href = '/clean-files';
});
document.getElementById('dbManagerBtn')?.addEventListener('click', function() {
    window.location.href = '/db-manager';
});
document.getElementById('logoutAdminBtn')?.addEventListener('click', function() {
    fetch('/api/logout', { method: 'POST', credentials: 'include' }).then(function() {
        window.location.href = '/';
    });
});

// ========== 标签页切换 ==========
document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('.admin-tab').forEach(function(tabDiv) { tabDiv.classList.remove('active'); });
        var target = document.getElementById(tab + 'Tab');
        if (target) target.classList.add('active');
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
        else if (tab === 'capacity') {
            loadCapacityConfig();
            loadUserCapacityList();
        }
    });
});

// ========== 初始化 ==========
(function init() {
    fetch('/api/me', { credentials: 'include' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
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
            loadCapacityConfig();
            loadUserCapacityList();
            socket = io({ withCredentials: true });
            window.socket = socket;
            socket.on('kicked', function() { window.location.href = '/'; });
        })
        .catch(function(err) {
            console.error('[admin] 初始化失败:', err);
        });
})();