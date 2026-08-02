// public/index.js
let currentUser = null;
let isAuthMode = true;
let socket = null;
const DEFAULT_AVATAR_URL = 'https://api.dicebear.com/7.x/avataaars/svg?seed=default';

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
if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function(text) {
        if (!text) return '';
        var e = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
        return text.replace(/[&<>"']/g, function(m) { return e[m]; });
    };
}

const authPanel = document.getElementById('authPanel');
const mainApp = document.getElementById('mainApp');
const authTitle = document.getElementById('authTitle');
const authBtn = document.getElementById('authBtn');
const switchText = document.getElementById('switchText');
const authError = document.getElementById('authError');
const accountInput = document.getElementById('account');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const emailInput = document.getElementById('email');
const verificationCodeInput = document.getElementById('verificationCode');
const getCodeBtn = document.getElementById('getCodeBtn');
const accountGroup = document.getElementById('accountGroup');
const usernameGroup = document.getElementById('usernameGroup');
const emailGroup = document.getElementById('emailGroup');
const codeGroup = document.getElementById('codeGroup');
const avatarSelectArea = document.getElementById('avatarSelectArea');
const navAvatar = document.getElementById('navAvatar');
const navUsername = document.getElementById('navUsername');
const logoutMainBtn = document.getElementById('logoutMainBtn');

const avatarPresets = [
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Leo',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Mia'
];
let selectedAvatar = avatarPresets[0];

function renderAvatarOptions() {
    avatarSelectArea.innerHTML = '';
    avatarPresets.forEach(function(url) {
        var img = document.createElement('img');
        img.src = url;
        img.style.cssText = 'width:48px;height:48px;border-radius:50%;cursor:pointer;border:' + (url === selectedAvatar ? '2px solid #07c160' : '2px solid transparent');
        img.addEventListener('click', function() { selectedAvatar = url; renderAvatarOptions(); });
        avatarSelectArea.appendChild(img);
    });
    var customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = '或输入图片URL';
    customInput.style.cssText = 'width:100%;margin-top:8px;padding:8px;border-radius:20px;border:1px solid #ddd;';
    customInput.addEventListener('input', function(e) {
        selectedAvatar = e.target.value;
        renderAvatarOptions();
    });
    avatarSelectArea.appendChild(customInput);
}
renderAvatarOptions();

function toggleAuthMode() {
    isAuthMode = !isAuthMode;
    var agreeCheckbox = document.getElementById('agreeAgreement');
    if (isAuthMode) {
        authTitle.innerText = '登录账户';
        authBtn.innerText = '登录';
        switchText.innerText = '没有账号？立即注册';
        accountGroup.style.display = 'block';
        usernameGroup.style.display = 'none';
        emailGroup.style.display = 'none';
        codeGroup.style.display = 'none';
        document.getElementById('agreementGroup').style.display = 'none';
        if (agreeCheckbox) agreeCheckbox.required = false;
    } else {
        authTitle.innerText = '注册新账户';
        authBtn.innerText = '注册';
        switchText.innerText = '已有账号？去登录';
        accountGroup.style.display = 'none';
        usernameGroup.style.display = 'block';
        emailGroup.style.display = 'block';
        codeGroup.style.display = 'block';
        document.getElementById('agreementGroup').style.display = 'block';
        if (agreeCheckbox) agreeCheckbox.required = true;
    }
    authError.innerText = '';
}
switchText.addEventListener('click', toggleAuthMode);

async function showAgreementModal(showAgreeButton) {
    showAgreeButton = showAgreeButton || false;
    var modal = document.getElementById('agreementModal');
    var contentDiv = document.getElementById('agreementContent');
    var agreeBtn = document.getElementById('agreeProtocolBtn');
    contentDiv.innerHTML = '加载中...';
    modal.style.display = 'flex';
    if (agreeBtn) {
        agreeBtn.style.display = showAgreeButton ? 'inline-block' : 'none';
        if (showAgreeButton) {
            agreeBtn.onclick = function() {
                window.apiRequest('/api/agree-agreement', 'POST').then(function(res) {
                    if (res.success) { modal.style.display = 'none'; afterLogin(); }
                    else alert('同意协议失败，请重试');
                });
            };
        }
    }
    try {
        var res = await fetch('/api/agreement');
        var data = await res.json();
        contentDiv.innerText = data.success ? data.content : '协议加载失败';
    } catch (err) { contentDiv.innerText = '协议加载失败'; }
}
document.getElementById('showAgreementLink')?.addEventListener('click', function(e) { e.preventDefault(); showAgreementModal(false); });
document.getElementById('closeAgreementModalBtn')?.addEventListener('click', function() { document.getElementById('agreementModal').style.display = 'none'; });

var countdown = 0;
getCodeBtn.addEventListener('click', function() {
    if (countdown > 0) return;
    var email = emailInput.value.trim();
    if (!email) { alert('请填写邮箱'); return; }
    window.apiRequest('/api/send-verification-code', 'POST', { email: email }).then(function(res) {
        if (res.success) {
            alert('验证码已发送');
            countdown = 60;
            getCodeBtn.disabled = true;
            getCodeBtn.innerText = countdown + '秒后重试';
            var timer = setInterval(function() {
                countdown--;
                if (countdown <= 0) { clearInterval(timer); getCodeBtn.disabled = false; getCodeBtn.innerText = '获取验证码'; }
                else getCodeBtn.innerText = countdown + '秒后重试';
            }, 1000);
        } else alert(res.message);
    });
});

async function handleAuth() {
    if (isAuthMode) {
        var account = accountInput.value.trim();
        var password = passwordInput.value.trim();
        if (!account || !password) { authError.innerText = '账号和密码不能为空'; return; }
        var data = await window.apiRequest('/api/login', 'POST', { account: account, password: password });
        if (data.success) {
            currentUser = data.user;
            showAgreementModal(true);
        } else authError.innerText = data.message;
    } else {
        var username = usernameInput.value.trim();
        var password2 = passwordInput.value.trim();
        var email = emailInput.value.trim();
        var verificationCode = verificationCodeInput.value.trim();
        var agreeCheckbox = document.getElementById('agreeAgreement');
        if (!agreeCheckbox.checked) { authError.innerText = '请阅读并同意用户协议'; return; }
        if (!username || !password2 || !email || !verificationCode) { authError.innerText = '请填写所有字段'; return; }
        var data = await window.apiRequest('/api/register', 'POST', { username: username, password: password2, email: email, verificationCode: verificationCode, avatarUrl: selectedAvatar });
        if (data.success) { currentUser = data.user; afterLogin(); }
        else authError.innerText = data.message;
    }
}
authBtn.addEventListener('click', handleAuth);

// ========== 实时时钟 ==========
function updateClock() {
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var hours = String(now.getHours()).padStart(2, '0');
    var minutes = String(now.getMinutes()).padStart(2, '0');
    var seconds = String(now.getSeconds()).padStart(2, '0');
    var clockEl = document.getElementById('realTimeClock');
    if (clockEl) {
        clockEl.textContent = year + '年' + month + '月' + day + '日 ' + hours + ':' + minutes + ':' + seconds;
    }
}
setInterval(updateClock, 1000);

// ========== 更新公告弹窗 ==========
function checkRecentUpdates() {
    window.apiRequest('/api/updates/recent', 'GET').then(function(res) {
        if (res.success && res.updates && res.updates.length > 0) {
            showUpdatesPopup(res.updates);
        }
    }).catch(function(err) {
        console.error('检查更新公告失败:', err);
    });
}

function showUpdatesPopup(updates) {
    var overlay = document.getElementById('updatesPopupOverlay');
    var container = document.getElementById('popupUpdates');
    var html = '';
    for (var i = 0; i < updates.length; i++) {
        var u = updates[i];
        html += '<div style="background:#f9f9f9;border-radius:16px;padding:16px;margin-bottom:12px;border-left:4px solid #07c160;">';
        html += '  <div style="font-weight:bold;color:#07c160;">v' + window.escapeHtml(u.version) + ' - ' + window.escapeHtml(u.title) + '</div>';
        html += '  <div style="font-size:12px;color:#888;margin-bottom:8px;">' + new Date(u.created_at).toLocaleString() + '</div>';
        var preview = u.content.length > 200 ? u.content.substring(0, 200) + '...' : u.content;
        html += '  <div style="white-space:pre-wrap;font-size:14px;color:#333;">' + window.escapeHtml(preview) + '</div>';
        html += '  <div style="margin-top:8px;"><a href="/updates" style="color:#07c160;text-decoration:none;">查看全部 →</a></div>';
        html += '</div>';
    }
    container.innerHTML = html;
    overlay.style.display = 'flex';

    document.getElementById('closePopupBtn').onclick = function() {
        markUpdatesRead(updates);
        overlay.style.display = 'none';
    };
    overlay.onclick = function(e) {
        if (e.target === overlay) {
            markUpdatesRead(updates);
            overlay.style.display = 'none';
        }
    };
}

function markUpdatesRead(updates) {
    for (var i = 0; i < updates.length; i++) {
        window.apiRequest('/api/updates/read', 'POST', { updateId: updates[i].id }).catch(function() {});
    }
}

// ========== 登录后处理 ==========
function afterLogin() {
    navUsername.innerText = currentUser.username;
    navAvatar.src = currentUser.avatarUrl || DEFAULT_AVATAR_URL;
    navAvatar.onerror = function() { navAvatar.src = DEFAULT_AVATAR_URL; };
    if (currentUser.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(function(el) { el.classList.remove('hidden'); });
    } else {
        document.querySelectorAll('.admin-only').forEach(function(el) { el.classList.add('hidden'); });
    }
    authPanel.classList.add('hidden');
    mainApp.classList.remove('hidden');
    if (socket) socket.disconnect();
    socket = io({ withCredentials: true });
    window.socket = socket;
    socket.on('system message', function(msg) {
        if (msg.includes('服务器重启倒计时')) {
            var match = msg.match(/\d+/);
            if (match) showRestartOverlay(parseInt(match[0]));
        } else {
            alert('系统消息：' + msg);
        }
    });
    socket.on('kicked', function(reason) { alert(reason); logout(); });

    updateClock();
    checkRecentUpdates();
}

async function logout() {
    await window.apiRequest('/api/logout', 'POST');
    if (socket) socket.disconnect();
    currentUser = null;
    authPanel.classList.remove('hidden');
    mainApp.classList.add('hidden');
    accountInput.value = '';
    usernameInput.value = '';
    passwordInput.value = '';
    emailInput.value = '';
    verificationCodeInput.value = '';
    selectedAvatar = avatarPresets[0];
    renderAvatarOptions();
}
logoutMainBtn.addEventListener('click', logout);

var restartOverlay = null;
function showRestartOverlay(countdown) {
    if (restartOverlay) return;
    restartOverlay = document.createElement('div');
    restartOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10001;display:flex;justify-content:center;align-items:center;color:white;flex-direction:column;';
    restartOverlay.innerHTML = '<h2>🔄 服务器正在重启</h2><div id="restartCountdown" style="font-size:48px;">' + countdown + '</div><p>请稍候，页面将自动刷新...</p>';
    document.body.appendChild(restartOverlay);
    var timer = setInterval(function() {
        countdown--;
        var cd = document.getElementById('restartCountdown');
        if (cd) cd.innerText = countdown;
        if (countdown <= 0) { clearInterval(timer); window.location.reload(); }
    }, 1000);
}

// 忘记密码
var forgotLink = document.getElementById('forgotPasswordLink');
var forgotModal = document.getElementById('forgotModal');
var closeForgotModal = document.getElementById('closeForgotModal');
var resetEmail = document.getElementById('resetEmail');
var resetCode = document.getElementById('resetCode');
var resetNewPassword = document.getElementById('resetNewPassword');
var resetConfirmPassword = document.getElementById('resetConfirmPassword');
var sendResetCodeBtn = document.getElementById('sendResetCodeBtn');
var resetPasswordBtn = document.getElementById('resetPasswordBtn');
var resetMsg = document.getElementById('resetMsg');
var resetCountdown = 0;
var resetTimer = null;

forgotLink?.addEventListener('click', function() {
    forgotModal.style.display = 'flex';
    resetEmail.value = '';
    resetCode.value = '';
    resetNewPassword.value = '';
    resetConfirmPassword.value = '';
    resetMsg.innerText = '';
});
closeForgotModal?.addEventListener('click', function() { forgotModal.style.display = 'none'; });
sendResetCodeBtn?.addEventListener('click', function() {
    if (resetCountdown > 0) return;
    var email = resetEmail.value.trim();
    if (!email) { resetMsg.innerText = '请填写邮箱'; return; }
    window.apiRequest('/api/forgot-password/send-code', 'POST', { email: email }).then(function(res) {
        if (res.success) {
            alert('验证码已发送至邮箱');
            resetCountdown = 60;
            sendResetCodeBtn.disabled = true;
            sendResetCodeBtn.innerText = resetCountdown + '秒后重试';
            resetTimer = setInterval(function() {
                resetCountdown--;
                if (resetCountdown <= 0) { clearInterval(resetTimer); sendResetCodeBtn.disabled = false; sendResetCodeBtn.innerText = '获取验证码'; }
                else sendResetCodeBtn.innerText = resetCountdown + '秒后重试';
            }, 1000);
        } else resetMsg.innerText = res.message;
    }).catch(function(err) { resetMsg.innerText = '发送失败'; });
});
resetPasswordBtn?.addEventListener('click', function() {
    var email = resetEmail.value.trim();
    var code = resetCode.value.trim();
    var newPwd = resetNewPassword.value.trim();
    var confirmPwd = resetConfirmPassword.value.trim();
    if (!email || !code || !newPwd || !confirmPwd) { resetMsg.innerText = '请填写所有字段'; return; }
    if (newPwd !== confirmPwd) { resetMsg.innerText = '两次输入的新密码不一致'; return; }
    if (newPwd.length < 6) { resetMsg.innerText = '密码长度至少6位'; return; }
    window.apiRequest('/api/reset-password', 'POST', { email: email, verificationCode: code, newPassword: newPwd }).then(function(res) {
        if (res.success) { alert('密码重置成功，请登录'); forgotModal.style.display = 'none'; if (!isAuthMode) toggleAuthMode(); }
        else resetMsg.innerText = res.message;
    }).catch(function(err) { resetMsg.innerText = '网络错误'; });
});

(function init() {
    window.apiRequest('/api/me', 'GET').then(function(res) {
        if (res.success && res.user) { currentUser = res.user; afterLogin(); }
    });
})();