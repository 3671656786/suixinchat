let currentUser = null, socket = null, changeEmailMode = false;
const DEFAULT_AVATAR_URL = 'https://api.dicebear.com/7.x/avataaars/svg?seed=default';
const avatarPresets = [
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Leo',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Mia'
];
let selectedAvatar = '';

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

function renderAvatarOptions(selectedUrl) {
    const container = document.getElementById('avatarSelectArea');
    container.innerHTML = '';
    avatarPresets.forEach(url => {
        const img = document.createElement('img');
        img.src = url;
        img.className = 'preset-avatar';
        if (url === selectedUrl) img.classList.add('selected');
        img.addEventListener('click', () => {
            selectedAvatar = url;
            renderAvatarOptions(selectedAvatar);
            document.getElementById('currentAvatar').src = url;
        });
        container.appendChild(img);
    });
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = '或输入图片URL';
    customInput.style.width = '100%';
    customInput.style.marginTop = '8px';
    customInput.style.padding = '8px';
    customInput.style.borderRadius = '20px';
    customInput.style.border = '1px solid #ddd';
    customInput.value = selectedUrl && !avatarPresets.includes(selectedUrl) ? selectedUrl : '';
    customInput.addEventListener('input', (e) => {
        selectedAvatar = e.target.value;
        document.getElementById('currentAvatar').src = selectedAvatar;
        renderAvatarOptions(selectedAvatar);
    });
    container.appendChild(customInput);
}

async function loadProfile() {
    const res = await fetch('/api/me', { credentials: 'include' });
    const data = await res.json();
    if (!data.success) {
        window.location.href = '/';
        return;
    }
    currentUser = data.user;
    document.getElementById('username').value = currentUser.username;
    document.getElementById('email').value = currentUser.email || '';
    document.getElementById('currentAvatar').src = currentUser.avatarUrl || DEFAULT_AVATAR_URL;
    selectedAvatar = currentUser.avatarUrl || DEFAULT_AVATAR_URL;
    renderAvatarOptions(selectedAvatar);
    const hiddenUsername = document.getElementById('hiddenUsername');
    if (hiddenUsername) hiddenUsername.value = currentUser.username;
}

document.getElementById('avatarUpload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('avatar', file);
    const res = await fetch('/api/uploadAvatar', {
        method: 'POST',
        credentials: 'include',
        body: formData
    });
    const data = await res.json();
    if (data.success) {
        currentUser.avatarUrl = data.avatarUrl;
        document.getElementById('currentAvatar').src = data.avatarUrl;
        alert('头像已更新');
    } else {
        alert('上传失败');
    }
});

document.getElementById('changeEmailBtn').addEventListener('click', () => {
    const newEmailGroup = document.getElementById('newEmailGroup');
    if (!changeEmailMode) {
        newEmailGroup.style.display = 'block';
        changeEmailMode = true;
        document.getElementById('changeEmailBtn').innerText = '取消更换';
    } else {
        newEmailGroup.style.display = 'none';
        changeEmailMode = false;
        document.getElementById('changeEmailBtn').innerText = '📧 更换邮箱';
        document.getElementById('newEmail').value = '';
        document.getElementById('emailVerifyCode').value = '';
    }
});

document.getElementById('cancelChangeEmailBtn')?.addEventListener('click', () => {
    document.getElementById('newEmailGroup').style.display = 'none';
    changeEmailMode = false;
    document.getElementById('changeEmailBtn').innerText = '📧 更换邮箱';
    document.getElementById('newEmail').value = '';
    document.getElementById('emailVerifyCode').value = '';
});

document.getElementById('sendEmailCodeBtn').addEventListener('click', async () => {
    const newEmail = document.getElementById('newEmail').value.trim();
    if (!newEmail) {
        alert('请填写新邮箱');
        return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
        alert('邮箱格式不正确');
        return;
    }
    const res = await fetch('/api/send-change-email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newEmail })
    });
    const data = await res.json();
    if (data.success) {
        alert('验证码已发送至新邮箱');
    } else {
        alert('发送失败：' + data.message);
    }
});

document.getElementById('confirmChangeEmailBtn').addEventListener('click', async () => {
    const newEmail = document.getElementById('newEmail').value.trim();
    const code = document.getElementById('emailVerifyCode').value.trim();
    if (!newEmail || !code) {
        alert('请填写新邮箱和验证码');
        return;
    }
    const res = await fetch('/api/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newEmail, verificationCode: code })
    });
    const data = await res.json();
    if (data.success) {
        alert('邮箱已更新，请重新登录');
        window.location.href = '/';
    } else {
        alert('更换失败：' + data.message);
    }
});

document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const username = document.getElementById('username').value.trim();
    const oldPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const msgDiv = document.getElementById('profileMsg');
    
    if (oldPassword || newPassword || confirmPassword) {
        if (!oldPassword || !newPassword || !confirmPassword) {
            msgDiv.innerText = '请完整填写密码修改字段';
            return;
        }
        if (newPassword !== confirmPassword) {
            msgDiv.innerText = '两次输入的新密码不一致';
            return;
        }
        const pwdRes = await apiRequest('/api/changePassword', 'POST', { oldPassword, newPassword });
        if (!pwdRes.success) {
            msgDiv.innerText = pwdRes.message;
            return;
        } else {
            alert('密码修改成功');
            document.getElementById('oldPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
        }
    }
    
    if (username !== currentUser.username) {
        const updateRes = await apiRequest('/api/updateProfile', 'POST', { username });
        if (updateRes.success) {
            currentUser = updateRes.user;
            document.getElementById('username').value = currentUser.username;
            alert('基本信息已更新');
        } else {
            msgDiv.innerText = updateRes.message;
            return;
        }
    }
    
    msgDiv.innerText = '修改成功';
    setTimeout(() => msgDiv.innerText = '', 3000);
});

function initSocket() {
    socket = io({ withCredentials: true });
    window.socket = socket;
    socket.on('connect', () => socket.emit('update status', 'profile'));
    socket.on('online users status', (users) => {
        const container = document.getElementById('onlineList');
        const countSpan = document.getElementById('onlineCount');
        if (!container) return;
        container.innerHTML = '';
        countSpan.innerText = users.length;
        users.forEach(u => {
            const div = document.createElement('div');
            div.className = 'online-user';
            const statusIcon = u.status === 'chat' ? '💬' : (u.status === 'files' ? '📁' : '📝');
            const av = u.avatarUrl || DEFAULT_AVATAR_URL;
            div.innerHTML = `<img src="${escapeHtml(av)}"><span>${escapeHtml(u.username)} ${statusIcon}</span>`;
            container.appendChild(div);
        });
    });
    socket.on('kicked', (reason) => {
        alert(reason);
        window.location.href = '/';
    });
}

loadProfile();
initSocket();