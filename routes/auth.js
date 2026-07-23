// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db/connection');
const { sendMail } = require('../utils/email');
const { generateVerificationCode, getClientIp } = require('../utils/helpers');
const { logToFile } = require('../utils/logger');
const { DEFAULT_AVATAR_URL } = require('../config');
const { isLoggedIn, checkRegisterLimit } = require('../middleware/auth');

// 获取当前协议版本
function getCurrentAgreementVersion() {
    const version = db.prepare('SELECT version FROM agreement_version WHERE id = 1').get();
    return version ? version.version : 1;
}

// 验证码发送频率限制（内存存储，重启后重置）
const verificationCooldowns = new Map();

// 发送注册验证码（带频率限制）
router.post('/api/send-verification-code', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: '邮箱不能为空' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: '邮箱格式不正确' });
    
    // 频率限制：同一邮箱 60 秒内最多 1 次
    const cooldownKey = `email:${email}`;
    const lastSent = verificationCooldowns.get(cooldownKey);
    if (lastSent && (Date.now() - lastSent) < 60000) {
        return res.status(429).json({ success: false, message: '验证码发送过于频繁，请 60 秒后再试' });
    }
    // 同一 IP 60 秒内最多 1 次
    const ip = getClientIp(req);
    const ipKey = `ip:${ip}`;
    const lastIpSent = verificationCooldowns.get(ipKey);
    if (lastIpSent && (Date.now() - lastIpSent) < 60000) {
        return res.status(429).json({ success: false, message: '验证码发送过于频繁，请 60 秒后再试' });
    }
    
    const blacklisted = db.prepare('SELECT * FROM email_blacklist WHERE email = ?').get(email);
    if (blacklisted) return res.status(400).json({ success: false, message: '该邮箱已被禁止注册' });
    
    const existingUser = db.prepare('SELECT userId FROM users WHERE email = ?').get(email);
    if (existingUser) return res.status(400).json({ success: false, message: '该邮箱已注册' });
    
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    try {
        db.prepare('DELETE FROM email_verifications WHERE email = ?').run(email);
        db.prepare('INSERT INTO email_verifications (email, code, expires_at) VALUES (?, ?, ?)').run(email, code, expiresAt);
        await sendMail(email, '随心聊 - 验证码', `<p>您的验证码是：<strong>${code}</strong></p><p>10分钟内有效。</p>`);
        verificationCooldowns.set(`email:${email}`, Date.now());
        verificationCooldowns.set(`ip:${ip}`, Date.now());
        res.json({ success: true, message: '验证码已发送' });
    } catch (err) {
        console.error('发送验证码失败:', err);
        res.status(500).json({ success: false, message: '发送失败，请稍后重试' });
    }
});

// 注册
router.post('/api/register', checkRegisterLimit, async (req, res) => {
    const { username, password, email, verificationCode, avatarUrl } = req.body;
    if (!username || !password || !email || !verificationCode) {
        return res.json({ success: false, message: '用户名、密码、邮箱和验证码不能为空' });
    }
    const cleanUsername = username.trim();
    if (cleanUsername.length < 2 || cleanUsername.length > 20) {
        return res.json({ success: false, message: '用户名长度应为2-20个字符' });
    }
    
    const blacklisted = db.prepare('SELECT * FROM email_blacklist WHERE email = ?').get(email);
    if (blacklisted) return res.json({ success: false, message: '该邮箱已被禁止注册' });
    
    // 验证码尝试频率限制：同一邮箱每10秒最多3次验证
    const attemptCooldownKey = `verify:${email}`;
    const attemptData = verificationCooldowns.get(attemptCooldownKey) || { count: 0, time: Date.now() };
    if (Date.now() - attemptData.time < 10000) {
        if (attemptData.count >= 3) {
            return res.json({ success: false, message: '验证码验证过于频繁，请10秒后再试' });
        }
        attemptData.count++;
    } else {
        attemptData.count = 1;
        attemptData.time = Date.now();
    }
    verificationCooldowns.set(attemptCooldownKey, attemptData);
    
    const now = new Date().toISOString();
    const record = db.prepare('SELECT * FROM email_verifications WHERE email = ? AND code = ? AND expires_at > ?').get(email, verificationCode, now);
    if (!record) return res.json({ success: false, message: '验证码无效或已过期' });
    
    const existingUser = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername);
    if (existingUser) return res.json({ success: false, message: '用户名已存在' });
    const existingEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (existingEmail) return res.json({ success: false, message: '邮箱已注册' });
    
    const avatar = avatarUrl || DEFAULT_AVATAR_URL;
    // 验证头像 URL 安全：只允许 http/https 或 data: URI
    if (!avatar.match(/^(https?:\/\/|data:image\/)/i) && avatar !== DEFAULT_AVATAR_URL) {
        return res.json({ success: false, message: '头像URL格式无效，仅支持http/https或data:image' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const currentVersion = getCurrentAgreementVersion();
    const result = db.prepare(`INSERT INTO users (username, password, email, avatarUrl, agreed_agreement_version, agreed_agreement_at) 
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(cleanUsername, hashedPassword, email, avatar, currentVersion);
    const userId = result.lastInsertRowid;
    const ip = getClientIp(req);
    db.prepare('INSERT INTO reg_attempts (ip) VALUES (?)').run(ip);
    req.session.userId = userId;
    db.prepare('DELETE FROM email_verifications WHERE email = ?').run(email);
    logToFile(`新用户注册: ${cleanUsername} (${userId})`);
    res.json({ success: true, user: { userId, username: cleanUsername, avatarUrl: avatar, role: 'user' } });
});

// 登录
router.post('/api/login', async (req, res) => {
    const { account, password } = req.body;
    if (!account || !password) return res.json({ success: false, message: '账号和密码不能为空' });
    let user;
    if (account.includes('@')) {
        user = db.prepare('SELECT * FROM users WHERE email = ?').get(account);
    } else {
        user = db.prepare('SELECT * FROM users WHERE username = ?').get(account);
    }
    if (!user) return res.json({ success: false, message: '账号或密码错误' });
    
    let isValid = false;
    if (user.password.startsWith('$2b$')) {
        isValid = await bcrypt.compare(password, user.password);
    } else {
        isValid = (password === user.password);
        if (isValid) {
            const hashed = await bcrypt.hash(password, 10);
            db.prepare('UPDATE users SET password = ? WHERE userId = ?').run(hashed, user.userId);
            logToFile(`用户 ${user.username} 的密码已升级为 bcrypt 哈希`);
        }
    }
    if (!isValid) return res.json({ success: false, message: '账号或密码错误' });

    // 检查登录封禁
    const now = new Date().toISOString();
    const ban = db.prepare(`SELECT * FROM user_bans WHERE user_id = ? AND ban_type IN ('login', 'all') AND (expires_at IS NULL OR expires_at > ?)`).get(user.userId, now);
    if (ban) return res.json({ success: false, message: '您的账号已被封禁，无法登录', banned: true });

    req.session.userId = user.userId;
    logToFile(`用户登录: ${user.username} (${user.userId})`);
    res.json({ 
        success: true, 
        user: { userId: user.userId, username: user.username, avatarUrl: user.avatarUrl, role: user.role },
        needAgree: true
    });
});

// 同意协议
router.post('/api/agree-agreement', isLoggedIn, (req, res) => {
    const userId = req.userId;
    const currentVersion = getCurrentAgreementVersion();
    db.prepare('UPDATE users SET agreed_agreement_version = ?, agreed_agreement_at = CURRENT_TIMESTAMP WHERE userId = ?').run(currentVersion, userId);
    res.json({ success: true });
});

// 找回密码 - 发送验证码
router.post('/api/forgot-password/send-code', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: '邮箱不能为空' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ success: false, message: '邮箱格式不正确' });
    const user = db.prepare('SELECT userId FROM users WHERE email = ?').get(email);
    if (!user) return res.status(404).json({ success: false, message: '该邮箱未注册' });
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    try {
        db.prepare('DELETE FROM email_verifications WHERE email = ?').run(email);
        db.prepare('INSERT INTO email_verifications (email, code, expires_at) VALUES (?, ?, ?)').run(email, code, expiresAt);
        await sendMail(email, '随心聊 - 密码重置验证码', `<p>您的密码重置验证码是：<strong>${code}</strong></p><p>10分钟内有效。</p>`);
        res.json({ success: true, message: '验证码已发送至您的邮箱' });
    } catch (err) {
        console.error('发送验证码失败:', err);
        res.status(500).json({ success: false, message: '发送失败，请稍后重试' });
    }
});

// 重置密码
router.post('/api/reset-password', async (req, res) => {
    const { email, verificationCode, newPassword } = req.body;
    if (!email || !verificationCode || !newPassword) return res.status(400).json({ success: false, message: '请完整填写信息' });
    if (newPassword.length < 6) return res.status(400).json({ success: false, message: '密码长度至少6位' });
    // 验证码尝试频率限制
    const attemptKey = `reset:${email}`;
    const attemptData = verificationCooldowns.get(attemptKey) || { count: 0, time: Date.now() };
    if (Date.now() - attemptData.time < 10000) {
        if (attemptData.count >= 3) {
            return res.status(429).json({ success: false, message: '验证过于频繁，请10秒后再试' });
        }
        attemptData.count++;
    } else {
        attemptData.count = 1;
        attemptData.time = Date.now();
    }
    verificationCooldowns.set(attemptKey, attemptData);
    const now = new Date().toISOString();
    const record = db.prepare('SELECT * FROM email_verifications WHERE email = ? AND code = ? AND expires_at > ?').get(email, verificationCode, now);
    if (!record) return res.status(400).json({ success: false, message: '验证码无效或已过期' });
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hashedPassword, email);
    db.prepare('DELETE FROM email_verifications WHERE email = ?').run(email);
    res.json({ success: true, message: '密码已重置，请使用新密码登录' });
});

// 更换邮箱验证码
router.post('/api/send-change-email-code', isLoggedIn, async (req, res) => {
    const userId = req.userId;
    const { newEmail } = req.body;
    if (!newEmail) return res.status(400).json({ success: false, message: '新邮箱不能为空' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) return res.status(400).json({ success: false, message: '邮箱格式不正确' });
    
    const existingUser = db.prepare('SELECT userId FROM users WHERE email = ?').get(newEmail);
    if (existingUser && existingUser.userId !== userId) return res.status(400).json({ success: false, message: '该邮箱已被其他用户使用' });
    
    const blacklisted = db.prepare('SELECT * FROM email_blacklist WHERE email = ?').get(newEmail);
    if (blacklisted) return res.status(400).json({ success: false, message: '该邮箱已被禁止使用' });
    
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    try {
        db.prepare('DELETE FROM email_verifications WHERE email = ?').run(newEmail);
        db.prepare('INSERT INTO email_verifications (email, code, expires_at) VALUES (?, ?, ?)').run(newEmail, code, expiresAt);
        await sendMail(newEmail, '随心聊 - 更换邮箱验证码', `<p>您的验证码是：<strong>${code}</strong></p><p>10分钟内有效。</p><p>如果您没有申请更换邮箱，请忽略此邮件。</p>`);
        res.json({ success: true, message: '验证码已发送至新邮箱' });
    } catch (err) {
        console.error('发送验证码失败:', err);
        res.status(500).json({ success: false, message: '发送失败，请稍后重试' });
    }
});

// 确认更换邮箱
router.post('/api/change-email', isLoggedIn, async (req, res) => {
    const userId = req.userId;
    const { newEmail, verificationCode } = req.body;
    if (!newEmail || !verificationCode) return res.status(400).json({ success: false, message: '请填写新邮箱和验证码' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) return res.status(400).json({ success: false, message: '邮箱格式不正确' });
    
    // 验证码验证频率限制
    const changeAttemptKey = `change_email:${userId}`;
    const changeAttempt = verificationCooldowns.get(changeAttemptKey) || { count: 0, time: Date.now() };
    if (Date.now() - changeAttempt.time < 10000) {
        if (changeAttempt.count >= 3) {
            return res.status(429).json({ success: false, message: '验证过于频繁，请10秒后再试' });
        }
        changeAttempt.count++;
    } else {
        changeAttempt.count = 1;
        changeAttempt.time = Date.now();
    }
    verificationCooldowns.set(changeAttemptKey, changeAttempt);
    
    const now = new Date().toISOString();
    const record = db.prepare('SELECT * FROM email_verifications WHERE email = ? AND code = ? AND expires_at > ?').get(newEmail, verificationCode, now);
    if (!record) return res.status(400).json({ success: false, message: '验证码无效或已过期' });
    
    const existingUser = db.prepare('SELECT userId FROM users WHERE email = ? AND userId != ?').get(newEmail, userId);
    if (existingUser) return res.status(400).json({ success: false, message: '该邮箱已被其他用户使用' });
    
    const blacklisted = db.prepare('SELECT * FROM email_blacklist WHERE email = ?').get(newEmail);
    if (blacklisted) return res.status(400).json({ success: false, message: '该邮箱已被禁止使用' });
    
    db.prepare('UPDATE users SET email = ? WHERE userId = ?').run(newEmail, userId);
    db.prepare('DELETE FROM email_verifications WHERE email = ?').run(newEmail);
    logToFile(`用户 ${userId} 更换邮箱为 ${newEmail}`);
    res.json({ success: true, message: '邮箱已更新' });
});

module.exports = router;