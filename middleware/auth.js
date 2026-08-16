// middleware/auth.js
const db = require('../db/connection');
const { getClientIp } = require('../utils/helpers');

function isLoggedIn(req, res, next) {
    const userId = req.session.userId;
    if (!userId) {
        return res.status(401).json({ success: false, message: '未登录' });
    }
    // 修复 #13：同时加载完整用户信息到 req.user，供路由使用（如用户名、角色）
    const user = db.prepare('SELECT userId, username, avatarUrl, role, email FROM users WHERE userId = ?').get(userId);
    if (!user) {
        return res.status(401).json({ success: false, message: '用户不存在' });
    }
    req.userId = userId;
    req.user = user;
    next();
}

// 注册限制中间件
function checkRegisterLimit(req, res, next) {
    const ip = getClientIp(req);
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const count = db.prepare(`SELECT COUNT(*) as count FROM reg_attempts WHERE ip = ? AND attempt_time > ?`).get(ip, oneHourAgo);
    if (count.count >= 3) {
        return res.json({ success: false, message: '注册过于频繁，请稍后再试' });
    }
    next();
}

module.exports = { isLoggedIn, checkRegisterLimit };