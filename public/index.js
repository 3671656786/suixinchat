let currentUser = null;
let isAuthMode = true;
let socket = null;
const DEFAULT_AVATAR_URL = 'https://api.dicebear.com/7.x/avataaars/svg?seed=default';

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
    avatarPresets.forEach(url => {
        const img = document.createElement('img');
        img.src = url;
        img.style.width = '48px';
        img.style.height = '48px';
        img.style.borderRadius = '50%';
        img.style.cursor = 'pointer';
        img.style.border = url === selectedAvatar ? '2px solid #07c160' : '2px solid transparent';
        img.addEventListener('click', () => { selectedAvatar = url; renderAvatarOptions(); });
        avatarSelectArea.appendChild(img);
    });
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = '或输入图片URL';
    customInput.style.width = '100%';
    customInput.style.marginTop = '8px';
    customInput.style.padding = '8px';
    customInput.style.borderRadius = '20px';
    customInput.style.border = '1px solid #ddd';
    customInput.addEventListener('input', (e) => {
        selectedAvatar = e.target.value;
        renderAvatarOptions();
    });
    avatarSelectArea.appendChild(customInput);
}
renderAvatarOptions();

async function apiRequest(url, method, body) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: body ? JSON.stringify(body) : undefined });
    return res.json();
}

function toggleAuthMode() {
    isAuthMode = !isAuthMode;
    const agreeCheckbox = document.getElementById('agreeAgreement');
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

async function showAgreementModal(showAgreeButton = false) {
    const modal = document.getElementById('agreementModal');
    const contentDiv = document.getElementById('agreementContent');
    const agreeBtn = document.getElementById('agreeProtocolBtn');
    contentDiv.innerHTML = '加载中...';
    modal.style.display = 'flex';
    if (agreeBtn) {
        agreeBtn.style.display = showAgreeButton ? 'inline-block' : 'none';
        if (showAgreeButton) {
            agreeBtn.onclick = async () => {
                const res = await apiRequest('/api/agree-agreement', 'POST');
                if (res.success) { modal.style.display = 'none'; afterLogin(); }
                else alert('同意协议失败，请重试');
            };
        }
    }
    try {
        const res = await fetch('/api/agreement');
        const data = await res.json();
        contentDiv.innerText = data.success ? data.content : '协议加载失败';
    } catch (err) { contentDiv.innerText = '协议加载失败'; }
}
document.getElementById('showAgreementLink')?.addEventListener('click', (e) => { e.preventDefault(); showAgreementModal(false); });
document.getElementById('closeAgreementModalBtn')?.addEventListener('click', () => { document.getElementById('agreementModal').style.display = 'none'; });

let countdown = 0;
getCodeBtn.addEventListener('click', async () => {
    if (countdown > 0) return;
    const email = emailInput.value.trim();
    if (!email) { alert('请填写邮箱'); return; }
    const res = await apiRequest('/api/send-verification-code', 'POST', { email });
    if (res.success) {
        alert('验证码已发送');
        countdown = 60;
        getCodeBtn.disabled = true;
        getCodeBtn.innerText = `${countdown}秒后重试`;
        const timer = setInterval(() => {
            countdown--;
            if (countdown <= 0) { clearInterval(timer); getCodeBtn.disabled = false; getCodeBtn.innerText = '获取验证码'; }
            else getCodeBtn.innerText = `${countdown}秒后重试`;
        }, 1000);
    } else alert(res.message);
});

async function handleAuth() {
    if (isAuthMode) {
        const account = accountInput.value.trim();
        const password = passwordInput.value.trim();
        if (!account || !password) { authError.innerText = '账号和密码不能为空'; return; }
        const data = await apiRequest('/api/login', 'POST', { account, password });
        if (data.success) {
            currentUser = data.user;
            showAgreementModal(true);
        } else authError.innerText = data.message;
    } else {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        const email = emailInput.value.trim();
        const verificationCode = verificationCodeInput.value.trim();
        const agreeCheckbox = document.getElementById('agreeAgreement');
        if (!agreeCheckbox.checked) { authError.innerText = '请阅读并同意用户协议'; return; }
        if (!username || !password || !email || !verificationCode) { authError.innerText = '请填写所有字段'; return; }
        const data = await apiRequest('/api/register', 'POST', { username, password, email, verificationCode, avatarUrl: selectedAvatar });
        if (data.success) { currentUser = data.user; afterLogin(); }
        else authError.innerText = data.message;
    }
}
authBtn.addEventListener('click', handleAuth);

function afterLogin() {
    navUsername.innerText = currentUser.username;
    navAvatar.src = currentUser.avatarUrl || DEFAULT_AVATAR_URL;
    navAvatar.onerror = () => { navAvatar.src = DEFAULT_AVATAR_URL; };
    if (currentUser.role === 'admin') document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    else document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    authPanel.classList.add('hidden');
    mainApp.classList.remove('hidden');
    if (socket) socket.disconnect();
    socket = io({ withCredentials: true });
    window.socket = socket;
    socket.on('system message', (msg) => {
        if (msg.includes('服务器重启倒计时')) { const match = msg.match(/\d+/); if (match) showRestartOverlay(parseInt(match[0])); }
        else alert('系统消息：' + msg);
    });
    socket.on('kicked', (reason) => { alert(reason); logout(); });
}

async function logout() {
    await apiRequest('/api/logout', 'POST');
    if (socket) socket.disconnect();
    currentUser = null;
    authPanel.classList.remove('hidden');
    mainApp.classList.add('hidden');
    accountInput.value = ''; usernameInput.value = ''; passwordInput.value = ''; emailInput.value = ''; verificationCodeInput.value = '';
    selectedAvatar = avatarPresets[0];
    renderAvatarOptions();
}
logoutMainBtn.addEventListener('click', logout);

let restartOverlay = null;
function showRestartOverlay(countdown) {
    if (restartOverlay) return;
    restartOverlay = document.createElement('div');
    restartOverlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:10001; display:flex; justify-content:center; align-items:center; color:white; flex-direction:column;';
    restartOverlay.innerHTML = `<h2>🔄 服务器正在重启</h2><div id="restartCountdown" style="font-size:48px;">${countdown}</div><p>请稍候，页面将自动刷新...</p>`;
    document.body.appendChild(restartOverlay);
    let timer = setInterval(() => { countdown--; const cd = document.getElementById('restartCountdown'); if (cd) cd.innerText = countdown; if (countdown <= 0) { clearInterval(timer); window.location.reload(); } }, 1000);
}

// 忘记密码
const forgotLink = document.getElementById('forgotPasswordLink');
const forgotModal = document.getElementById('forgotModal');
const closeForgotModal = document.getElementById('closeForgotModal');
const resetEmail = document.getElementById('resetEmail');
const resetCode = document.getElementById('resetCode');
const resetNewPassword = document.getElementById('resetNewPassword');
const resetConfirmPassword = document.getElementById('resetConfirmPassword');
const sendResetCodeBtn = document.getElementById('sendResetCodeBtn');
const resetPasswordBtn = document.getElementById('resetPasswordBtn');
const resetMsg = document.getElementById('resetMsg');
let resetCountdown = 0, resetTimer = null;
forgotLink?.addEventListener('click', () => { forgotModal.style.display = 'flex'; resetEmail.value = ''; resetCode.value = ''; resetNewPassword.value = ''; resetConfirmPassword.value = ''; resetMsg.innerText = ''; });
closeForgotModal?.addEventListener('click', () => { forgotModal.style.display = 'none'; });
sendResetCodeBtn?.addEventListener('click', async () => {
    if (resetCountdown > 0) return;
    const email = resetEmail.value.trim();
    if (!email) { resetMsg.innerText = '请填写邮箱'; return; }
    try {
        const res = await fetch('/api/forgot-password/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email }) });
        const data = await res.json();
        if (data.success) {
            alert('验证码已发送至邮箱');
            resetCountdown = 60;
            sendResetCodeBtn.disabled = true;
            sendResetCodeBtn.innerText = `${resetCountdown}秒后重试`;
            resetTimer = setInterval(() => { resetCountdown--; if (resetCountdown <= 0) { clearInterval(resetTimer); sendResetCodeBtn.disabled = false; sendResetCodeBtn.innerText = '获取验证码'; } else sendResetCodeBtn.innerText = `${resetCountdown}秒后重试`; }, 1000);
        } else resetMsg.innerText = data.message;
    } catch (err) { resetMsg.innerText = '发送失败'; }
});
resetPasswordBtn?.addEventListener('click', async () => {
    const email = resetEmail.value.trim(), code = resetCode.value.trim(), newPwd = resetNewPassword.value.trim(), confirmPwd = resetConfirmPassword.value.trim();
    if (!email || !code || !newPwd || !confirmPwd) { resetMsg.innerText = '请填写所有字段'; return; }
    if (newPwd !== confirmPwd) { resetMsg.innerText = '两次输入的新密码不一致'; return; }
    if (newPwd.length < 6) { resetMsg.innerText = '密码长度至少6位'; return; }
    try {
        const res = await fetch('/api/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email, verificationCode: code, newPassword: newPwd }) });
        const data = await res.json();
        if (data.success) { alert('密码重置成功，请登录'); forgotModal.style.display = 'none'; if (!isAuthMode) toggleAuthMode(); }
        else resetMsg.innerText = data.message;
    } catch (err) { resetMsg.innerText = '网络错误'; }
});

(async () => {
    const res = await apiRequest('/api/me', 'GET');
    if (res.success && res.user) { currentUser = res.user; afterLogin(); }
})();