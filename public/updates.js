// public/updates.js
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
            var isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
            var options = {
                method: method,
                credentials: 'include'
            };
            if (isFormData) {
                options.body = body;
            } else {
                options.headers = { 'Content-Type': 'application/json' };
                options.body = body ? JSON.stringify(body) : undefined;
            }
            return fetch(url, options).then(function(res) { return res.json(); });
        };
    }
})();

// ========== 状态 ==========
var currentUser = null;
var isAdmin = false;
var updates = [];
var socket = null;

// DOM 引用
var updatesList = document.getElementById('updatesList');
var createBtn = document.getElementById('createUpdateBtn');
var refreshBtn = document.getElementById('refreshBtn');
var filterBtn = document.getElementById('filterBtn');
var resetFilterBtn = document.getElementById('resetFilterBtn');
var filterStartDate = document.getElementById('filterStartDate');
var filterEndDate = document.getElementById('filterEndDate');

// 模态框
var createModal = document.getElementById('createModal');
var modalTitle = document.getElementById('modalTitle');
var updateVersion = document.getElementById('updateVersion');
var updateTitle = document.getElementById('updateTitle');
var updateContent = document.getElementById('updateContent');
var sendEmailCheck = document.getElementById('sendEmailCheck');
var emailSettings = document.getElementById('emailSettings');
var emailTarget = document.getElementById('emailTarget');
var userSelectArea = document.getElementById('userSelectArea');
var emailUserSelect = document.getElementById('emailUserSelect');
var progressArea = document.getElementById('progressArea');
var progressFill = document.getElementById('progressFill');
var progressText = document.getElementById('progressText');
var closeModalBtn = document.getElementById('closeModalBtn');
var cancelBtn = document.getElementById('cancelBtn');
var submitBtn = document.getElementById('submitBtn');

// 详情模态框
var detailModal = document.getElementById('detailModal');
var detailTitle = document.getElementById('detailTitle');
var detailContent = document.getElementById('detailContent');
var closeDetailBtn = document.getElementById('closeDetailBtn');
var closeDetailBtn2 = document.getElementById('closeDetailBtn2');

var isSubmitting = false;

// ========== 加载更新公告列表 ==========
function loadUpdates(startDate, endDate) {
    var url = '/api/updates';
    var params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (params.toString()) url += '?' + params.toString();

    updatesList.innerHTML = '<div style="text-align:center;color:#999;padding:40px;">加载中...</div>';

    window.apiRequest(url, 'GET').then(function(res) {
        if (res.success) {
            updates = res.updates;
            renderUpdates(updates);
        } else {
            updatesList.innerHTML = '<div style="text-align:center;color:#e53935;padding:40px;">加载失败：' + window.escapeHtml(res.message) + '</div>';
        }
    }).catch(function(err) {
        updatesList.innerHTML = '<div style="text-align:center;color:#e53935;padding:40px;">加载失败：' + window.escapeHtml(err.message) + '</div>';
    });
}

// ========== 渲染更新公告列表 ==========
function renderUpdates(updates) {
    if (!updates || updates.length === 0) {
        updatesList.innerHTML = '<div class="update-empty">📢 暂无更新公告</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < updates.length; i++) {
        var u = updates[i];
        var sentStatus = u.is_sent === 1 ? '<span class="badge-sent">📧 已发送邮件</span>' : '<span class="badge-unsent">📧 未发送邮件</span>';
        html += '<div class="update-item" data-id="' + u.id + '">';
        html += '  <div class="update-header">';
        html += '    <div><span class="update-version">v' + window.escapeHtml(u.version) + '</span> ' + sentStatus + '</div>';
        html += '    <div class="update-time">' + new Date(u.created_at).toLocaleString() + '</div>';
        html += '  </div>';
        html += '  <div class="update-title">' + window.escapeHtml(u.title) + '</div>';
        // 修复 #73：按 Unicode 码点截断，避免截断中文字符导致乱码
        var contentStr = String(u.content || '');
        var previewContent;
        if (contentStr.length > 300) {
            previewContent = Array.from(contentStr).slice(0, 300).join('') + '...';
        } else {
            previewContent = contentStr;
        }
        html += '  <div class="update-content">' + window.escapeHtml(previewContent) + '</div>';
        html += '  <div class="update-actions">';
        html += '    <button class="btn-secondary view-detail" data-id="' + u.id + '">📖 查看全文</button>';
        if (isAdmin) {
            html += '    <button class="delete-update" data-id="' + u.id + '" style="background:var(--danger);color:white;border:none;padding:6px 14px;border-radius:20px;cursor:pointer;">🗑️ 删除</button>';
        }
        html += '  </div>';
        html += '</div>';
    }
    updatesList.innerHTML = html;

    // 查看详情
    document.querySelectorAll('.view-detail').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var id = parseInt(this.dataset.id);
            var update = updates.find(function(u) { return u.id === id; });
            if (update) showDetail(update);
        });
    });

    // 删除（仅管理员）
    if (isAdmin) {
        document.querySelectorAll('.delete-update').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = parseInt(this.dataset.id);
                if (confirm('确定删除此公告吗？')) {
                    window.apiRequest('/api/updates/' + id, 'DELETE').then(function(res) {
                        if (res.success) {
                            loadUpdates(filterStartDate.value, filterEndDate.value);
                        } else {
                            alert('删除失败：' + res.message);
                        }
                    });
                }
            });
        });
    }
}

// ========== 查看详情 ==========
function showDetail(update) {
    detailTitle.textContent = '📢 ' + window.escapeHtml(update.title) + ' (v' + window.escapeHtml(update.version) + ')';
    detailContent.textContent = update.content;
    detailModal.style.display = 'flex';
}

closeDetailBtn.addEventListener('click', function() { detailModal.style.display = 'none'; });
closeDetailBtn2.addEventListener('click', function() { detailModal.style.display = 'none'; });
detailModal.addEventListener('click', function(e) {
    if (e.target === detailModal) detailModal.style.display = 'none';
});

// ========== 创建/编辑公告 ==========
createBtn.addEventListener('click', function() {
    if (!isAdmin) return;
    openCreateModal();
});

function openCreateModal(editData) {
    // 获取模板
    window.apiRequest('/api/updates/template', 'GET').then(function(res) {
        if (res.success) {
            updateVersion.value = 'v' + res.version;
            if (!editData) {
                updateTitle.value = '';
                updateContent.value = res.template;
            } else {
                updateTitle.value = editData.title;
                updateContent.value = editData.content;
            }
            modalTitle.textContent = editData ? '✏️ 编辑公告' : '📝 发布更新公告';
            // 重置状态
            sendEmailCheck.checked = false;
            emailSettings.style.display = 'none';
            progressArea.style.display = 'none';
            progressFill.style.width = '0%';
            progressText.textContent = '';
            isSubmitting = false;
            submitBtn.textContent = '🚀 发布公告';
            submitBtn.disabled = false;
            // 加载用户列表
            loadUserOptions();
            createModal.style.display = 'flex';
        } else {
            alert('获取模板失败：' + res.message);
        }
    }).catch(function(err) {
        alert('获取模板失败：' + err.message);
    });
}

// ========== 加载用户选项 ==========
function loadUserOptions() {
    window.apiRequest('/api/admin/users', 'GET').then(function(res) {
        if (res.success) {
            var html = '';
            res.users.forEach(function(user) {
                if (user.email && user.email.trim() !== '') {
                    var disabled = user.receive_email_announcements === 0 ? ' style="opacity:0.5;"' : '';
                    var label = user.username + ' (' + user.email + ')' + (user.receive_email_announcements === 0 ? ' [已拒绝]' : '');
                    html += '<option value="' + user.userId + '"' + disabled + '>' + window.escapeHtml(label) + '</option>';
                }
            });
            emailUserSelect.innerHTML = html;
        }
    });
}

// ========== 邮件设置切换 ==========
sendEmailCheck.addEventListener('change', function() {
    emailSettings.style.display = this.checked ? 'block' : 'none';
});

emailTarget.addEventListener('change', function() {
    userSelectArea.style.display = this.value === 'users' ? 'block' : 'none';
});

// ========== 关闭模态框 ==========
function closeModal() {
    createModal.style.display = 'none';
    progressArea.style.display = 'none';
    progressFill.style.width = '0%';
    progressText.textContent = '';
    isSubmitting = false;
    submitBtn.textContent = '🚀 发布公告';
    submitBtn.disabled = false;
}
closeModalBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);
createModal.addEventListener('click', function(e) {
    if (e.target === createModal) closeModal();
});

// ========== 提交公告 ==========
submitBtn.addEventListener('click', function() {
    if (isSubmitting) return;
    var title = updateTitle.value.trim();
    var content = updateContent.value.trim();
    if (!title) {
        alert('请输入标题');
        return;
    }
    if (!content) {
        alert('请输入内容');
        return;
    }

    var sendEmail = sendEmailCheck.checked;
    var payload = {
        title: title,
        content: content,
        sendEmail: sendEmail
    };

    if (sendEmail) {
        var target = emailTarget.value;
        if (target === 'users') {
            var selected = Array.from(emailUserSelect.selectedOptions).map(function(opt) { return parseInt(opt.value); });
            if (selected.length === 0) {
                alert('请至少选择一个用户');
                return;
            }
            payload.emailTarget = 'users';
            payload.userIds = selected;
        } else {
            payload.emailTarget = 'all';
        }
    }

    isSubmitting = true;
    submitBtn.textContent = '⏳ 发布中...';
    submitBtn.disabled = true;

    // 显示进度区域
    if (sendEmail) {
        progressArea.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = '正在发布公告...';
    }

    window.apiRequest('/api/updates', 'POST', payload).then(function(res) {
        if (res.success) {
            if (res.total && res.total > 0) {
                // 邮件发送中，等待 Socket 进度
                progressText.textContent = '公告已创建，正在发送邮件 (0/' + res.total + ')...';
                // 轮询检查进度（通过 Socket 接收）
            } else {
                alert('公告发布成功！');
                closeModal();
                loadUpdates(filterStartDate.value, filterEndDate.value);
                isSubmitting = false;
                submitBtn.textContent = '🚀 发布公告';
                submitBtn.disabled = false;
            }
        } else {
            alert('发布失败：' + res.message);
            isSubmitting = false;
            submitBtn.textContent = '🚀 发布公告';
            submitBtn.disabled = false;
            progressArea.style.display = 'none';
        }
    }).catch(function(err) {
        alert('发布失败：' + err.message);
        isSubmitting = false;
        submitBtn.textContent = '🚀 发布公告';
        submitBtn.disabled = false;
        progressArea.style.display = 'none';
    });
});

// ========== Socket 接收邮件进度 ==========
function initSocket() {
    if (typeof io === 'undefined') return;
    socket = io({ withCredentials: true });
    window.socket = socket;

    socket.on('update_email_progress', function(data) {
        var percent = (data.sent / data.total * 100).toFixed(1);
        progressFill.style.width = percent + '%';
        progressText.textContent = '已发送 ' + data.sent + ' / ' + data.total + ' 封（成功：' + data.success + '，失败：' + data.fail + '）当前：' + data.currentEmail;
    });

    socket.on('update_email_complete', function(data) {
        progressFill.style.width = '100%';
        progressText.textContent = '✅ 发送完成！成功：' + data.success + '，失败：' + data.fail + '，总计：' + data.total;
        alert('公告发布完成！邮件发送：成功 ' + data.success + ' 封，失败 ' + data.fail + ' 封');
        closeModal();
        loadUpdates(filterStartDate.value, filterEndDate.value);
        isSubmitting = false;
        submitBtn.textContent = '🚀 发布公告';
        submitBtn.disabled = false;
        setTimeout(function() {
            progressArea.style.display = 'none';
            progressFill.style.width = '0%';
        }, 5000);
    });

    socket.on('kicked', function(reason) {
        alert(reason);
        window.location.href = '/';
    });
}

// ========== 筛选 ==========
filterBtn.addEventListener('click', function() {
    loadUpdates(filterStartDate.value, filterEndDate.value);
});

resetFilterBtn.addEventListener('click', function() {
    filterStartDate.value = '';
    filterEndDate.value = '';
    loadUpdates();
});

refreshBtn.addEventListener('click', function() {
    loadUpdates(filterStartDate.value, filterEndDate.value);
});

// ========== 初始化 ==========
(function init() {
    fetch('/api/me', { credentials: 'include' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (!data.success) {
                window.location.href = '/';
                return;
            }
            currentUser = data.user;
            isAdmin = currentUser.role === 'admin';
            if (isAdmin) {
                createBtn.classList.remove('hidden');
            }
            initSocket();
            loadUpdates();
        })
        .catch(function(err) {
            console.error('[updates] 初始化失败:', err);
            window.location.href = '/';
        });
})();