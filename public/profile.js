// public/profile.js
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

// ========== 状态 ==========
var currentUser = null;
var socket = null;
var changeEmailMode = false;
var DEFAULT_AVATAR_URL = 'https://api.dicebear.com/7.x/avataaars/svg?seed=default';
var avatarPresets = [
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Leo',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Mia'
];
var selectedAvatar = '';

// ========== DOM 引用 ==========
var usernameInput = document.getElementById('username');
var emailInput = document.getElementById('email');
var oldPasswordInput = document.getElementById('oldPassword');
var newPasswordInput = document.getElementById('newPassword');
var confirmPasswordInput = document.getElementById('confirmPassword');
var currentAvatarImg = document.getElementById('currentAvatar');
var avatarSelectArea = document.getElementById('avatarSelectArea');
var avatarUpload = document.getElementById('avatarUpload');
var saveProfileBtn = document.getElementById('saveProfileBtn');
var profileMsg = document.getElementById('profileMsg');
var changeEmailBtn = document.getElementById('changeEmailBtn');
var newEmailGroup = document.getElementById('newEmailGroup');
var newEmailInput = document.getElementById('newEmail');
var emailVerifyCodeInput = document.getElementById('emailVerifyCode');
var sendEmailCodeBtn = document.getElementById('sendEmailCodeBtn');
var cancelChangeEmailBtn = document.getElementById('cancelChangeEmailBtn');
var confirmChangeEmailBtn = document.getElementById('confirmChangeEmailBtn');
var receiveEmailCheckbox = document.getElementById('receiveEmailAnnouncements');

// ========== 头像选项渲染 ==========
function renderAvatarOptions(selectedUrl) {
    var container = avatarSelectArea;
    container.innerHTML = '';
    for (var i = 0; i < avatarPresets.length; i++) {
        var url = avatarPresets[i];
        var img = document.createElement('img');
        img.src = url;
        img.className = 'preset-avatar';
        if (url === selectedUrl) img.classList.add('selected');
        img.addEventListener('click', function() {
            selectedAvatar = this.src;
            renderAvatarOptions(selectedAvatar);
            currentAvatarImg.src = selectedAvatar;
        });
        container.appendChild(img);
    }
    var customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = '或输入图片URL';
    customInput.style.cssText = 'width:100%; margin-top:8px; padding:8px; border-radius:20px; border:1px solid #ddd;';
    customInput.value = selectedUrl && avatarPresets.indexOf(selectedUrl) === -1 ? selectedUrl : '';
    customInput.addEventListener('input', function(e) {
        selectedAvatar = e.target.value;
        currentAvatarImg.src = selectedAvatar;
        renderAvatarOptions(selectedAvatar);
    });
    container.appendChild(customInput);
}

// ========== 加载个人信息 ==========
async function loadProfile() {
    var res = await window.apiRequest('/api/me', 'GET');
    if (!res.success) {
        window.location.href = '/';
        return;
    }
    currentUser = res.user;
    usernameInput.value = currentUser.username || '';
    emailInput.value = currentUser.email || '';
    currentAvatarImg.src = currentUser.avatarUrl || DEFAULT_AVATAR_URL;
    selectedAvatar = currentUser.avatarUrl || DEFAULT_AVATAR_URL;
    renderAvatarOptions(selectedAvatar);
    // 加载邮件公告接收设置
    if (receiveEmailCheckbox) {
        receiveEmailCheckbox.checked = currentUser.receive_email_announcements === 1;
    }
    var hiddenUsername = document.getElementById('hiddenUsername');
    if (hiddenUsername) hiddenUsername.value = currentUser.username || '';
}

// ========== 头像上传 ==========
avatarUpload.addEventListener('change', async function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var formData = new FormData();
    formData.append('avatar', file);
    try {
        var res = await fetch('/api/uploadAvatar', {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        var data = await res.json();
        if (data.success) {
            currentUser.avatarUrl = data.avatarUrl;
            currentAvatarImg.src = data.avatarUrl;
            alert('头像已更新');
        } else {
            alert('上传失败：' + (data.message || '未知错误'));
        }
    } catch (err) {
        alert('上传失败：' + err.message);
    }
    avatarUpload.value = '';
});

// ========== 更换邮箱 ==========
changeEmailBtn.addEventListener('click', function() {
    if (!changeEmailMode) {
        newEmailGroup.style.display = 'block';
        changeEmailMode = true;
        changeEmailBtn.innerText = '取消更换';
    } else {
        newEmailGroup.style.display = 'none';
        changeEmailMode = false;
        changeEmailBtn.innerText = '📧 更换邮箱';
        newEmailInput.value = '';
        emailVerifyCodeInput.value = '';
    }
});

cancelChangeEmailBtn.addEventListener('click', function() {
    newEmailGroup.style.display = 'none';
    changeEmailMode = false;
    changeEmailBtn.innerText = '📧 更换邮箱';
    newEmailInput.value = '';
    emailVerifyCodeInput.value = '';
});

sendEmailCodeBtn.addEventListener('click', async function() {
    var newEmail = newEmailInput.value.trim();
    if (!newEmail) {
        alert('请填写新邮箱');
        return;
    }
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
        alert('邮箱格式不正确');
        return;
    }
    try {
        var res = await window.apiRequest('/api/send-change-email-code', 'POST', { newEmail: newEmail });
        if (res.success) {
            alert('验证码已发送至新邮箱');
        } else {
            alert('发送失败：' + res.message);
        }
    } catch (err) {
        alert('发送失败：' + err.message);
    }
});

confirmChangeEmailBtn.addEventListener('click', async function() {
    var newEmail = newEmailInput.value.trim();
    var code = emailVerifyCodeInput.value.trim();
    if (!newEmail || !code) {
        alert('请填写新邮箱和验证码');
        return;
    }
    try {
        var res = await window.apiRequest('/api/change-email', 'POST', { newEmail: newEmail, verificationCode: code });
        if (res.success) {
            alert('邮箱已更新，请重新登录');
            window.location.href = '/';
        } else {
            alert('更换失败：' + res.message);
        }
    } catch (err) {
        alert('更换失败：' + err.message);
    }
});

// ========== 保存个人信息 ==========
saveProfileBtn.addEventListener('click', async function() {
    var username = usernameInput.value.trim();
    var oldPassword = oldPasswordInput.value;
    var newPassword = newPasswordInput.value;
    var confirmPassword = confirmPasswordInput.value;
    var receiveEmailAnnouncements = receiveEmailCheckbox ? receiveEmailCheckbox.checked : true;

    // 修改密码
    if (oldPassword || newPassword || confirmPassword) {
        if (!oldPassword || !newPassword || !confirmPassword) {
            profileMsg.innerText = '请完整填写密码修改字段';
            return;
        }
        if (newPassword !== confirmPassword) {
            profileMsg.innerText = '两次输入的新密码不一致';
            return;
        }
        if (newPassword.length < 6) {
            profileMsg.innerText = '新密码长度至少6位';
            return;
        }
        try {
            var pwdRes = await window.apiRequest('/api/changePassword', 'POST', { oldPassword: oldPassword, newPassword: newPassword });
            if (!pwdRes.success) {
                profileMsg.innerText = pwdRes.message;
                return;
            } else {
                alert('密码修改成功');
                oldPasswordInput.value = '';
                newPasswordInput.value = '';
                confirmPasswordInput.value = '';
            }
        } catch (err) {
            profileMsg.innerText = '修改密码失败：' + err.message;
            return;
        }
    }

    // 更新用户资料（用户名 + 邮件公告设置）
    try {
        var updatePayload = { username: username, receiveEmailAnnouncements: receiveEmailAnnouncements };
        var updateRes = await window.apiRequest('/api/updateProfile', 'POST', updatePayload);
        if (updateRes.success) {
            currentUser = updateRes.user;
            usernameInput.value = currentUser.username || '';
            if (receiveEmailCheckbox) {
                receiveEmailCheckbox.checked = currentUser.receive_email_announcements === 1;
            }
            alert('资料已更新');
            profileMsg.innerText = '修改成功';
            setTimeout(function() { profileMsg.innerText = ''; }, 3000);
        } else {
            profileMsg.innerText = updateRes.message || '更新失败';
        }
    } catch (err) {
        profileMsg.innerText = '更新失败：' + err.message;
    }
});

// ========== Socket 连接 ==========
function initSocket() {
    socket = io({ withCredentials: true });
    window.socket = socket;
    socket.on('connect', function() {
        socket.emit('update status', 'profile');
    });
    socket.on('online users status', function(users) {
        var container = document.getElementById('onlineList');
        var countSpan = document.getElementById('onlineCount');
        if (!container) return;
        container.innerHTML = '';
        countSpan.innerText = users.length;
        for (var i = 0; i < users.length; i++) {
            var u = users[i];
            var div = document.createElement('div');
            div.className = 'online-user';
            var statusIcon = u.status === 'chat' ? '💬' : (u.status === 'files' ? '📁' : '📝');
            var av = u.avatarUrl || DEFAULT_AVATAR_URL;
            div.innerHTML = '<img src="' + window.escapeHtml(av) + '"><span>' + window.escapeHtml(u.username) + ' ' + statusIcon + '</span>';
            container.appendChild(div);
        }
    });
    socket.on('kicked', function(reason) {
        alert(reason);
        window.location.href = '/';
    });
}

// ========== 初始化 ==========
loadProfile();
initSocket();