// middleware/admin.js
const db = require('../db/connection');

function isAdmin(req, res, next) {
    const userId = req.session.userId;
    if (!userId) {
        return res.status(401).json({ success: false, message: '未登录' });
    }
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '无权限' });
    }
    next();
}

module.exports = { isAdmin };