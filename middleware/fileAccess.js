// middleware/fileAccess.js
const db = require('../db/connection');

function getUserRootId(userId) {
    const uid = Number(userId);
    let folder = db.prepare('SELECT id FROM file_nodes WHERE name = ? AND parentId = 0 AND isFolder = 1').get(`user_${uid}`);
    if (!folder) {
        const result = db.prepare('INSERT INTO file_nodes (name, parentId, isFolder) VALUES (?, ?, ?)').run(`user_${uid}`, 0, 1);
        folder = { id: result.lastInsertRowid };
    }
    return Number(folder.id);
}

// 修复：循环实现代替递归，避免深层目录导致调用栈溢出
function isUnderUserRoot(nodeId, userRootId) {
    let currentId = Number(nodeId);
    const urid = Number(userRootId);
    const visited = new Set();
    while (currentId !== urid) {
        if (visited.has(currentId)) return false; // 防循环引用
        visited.add(currentId);
        const node = db.prepare('SELECT parentId FROM file_nodes WHERE id = ?').get(currentId);
        if (!node) return false;
        if (node.parentId === 0) return false;
        currentId = Number(node.parentId);
    }
    return true;
}

function checkFileAccess(req, res, next) {
    const userId = req.session.userId;
    if (!userId) {
        return res.status(401).json({ success: false, message: '未登录' });
    }
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    const isAdmin = user && user.role === 'admin';
    req.isAdmin = isAdmin;
    req.userId = userId;
    req.userRootId = getUserRootId(userId);
    next();
}

module.exports = { checkFileAccess, getUserRootId, isUnderUserRoot };