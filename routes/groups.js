// routes/groups.js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { isLoggedIn } = require('../middleware/auth');
const { getIO, onlineUsers } = require('../socket');

// 获取我的群列表
router.get('/api/groups', isLoggedIn, (req, res) => {
    try {
        const groups = db.prepare(`
            SELECT g.*, gm.role as myRole,
                   (SELECT COUNT(*) FROM group_members WHERE groupId = g.id) as memberCount
            FROM chat_groups g
            JOIN group_members gm ON gm.groupId = g.id
            WHERE gm.userId = ?
            ORDER BY g.createdAt DESC
        `).all(req.userId);
        res.json({ success: true, groups });
    } catch (err) {
        console.error('获取群列表失败:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 发现可加入的群
router.get('/api/groups/discover', isLoggedIn, (req, res) => {
    try {
        const groups = db.prepare(`
            SELECT g.*,
                   (SELECT COUNT(*) FROM group_members WHERE groupId = g.id) as memberCount
            FROM chat_groups g
            WHERE g.id NOT IN (SELECT groupId FROM group_members WHERE userId = ?)
            ORDER BY g.createdAt DESC LIMIT 50
        `).all(req.userId);
        res.json({ success: true, groups });
    } catch (err) {
        console.error('发现群列表失败:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 创建群
router.post('/api/groups', isLoggedIn, (req, res) => {
    const { name, description } = req.body;
    
    // 参数验证
    if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 20) {
        return res.status(400).json({ success: false, message: '群名称长度应为1-20个字符' });
    }
    
    // 确保 userId 存在
    const userId = req.userId;
    if (!userId || typeof userId !== 'number') {
        console.error('[创建群] 用户ID无效:', userId);
        return res.status(401).json({ success: false, message: '用户未登录或会话已过期' });
    }
    
    const groupName = name.trim();
    const groupDesc = (description && typeof description === 'string') ? description.trim() : '';
    
    try {
        // 第一步：插入群组
        const stmt = db.prepare('INSERT INTO chat_groups (name, description, ownerId) VALUES (?, ?, ?)');
        const result = stmt.run(groupName, groupDesc, userId);
        
        // 检查是否成功获取 ID
        const groupId = result.lastInsertRowid;
        if (!groupId || typeof groupId !== 'number') {
            console.error('[创建群] 获取群ID失败:', result);
            return res.status(500).json({ success: false, message: '创建群失败，无法获取群ID' });
        }
        
        // 第二步：将创建者添加为群主
        const memberStmt = db.prepare('INSERT INTO group_members (groupId, userId, role) VALUES (?, ?, ?)');
        memberStmt.run(groupId, userId, 'owner');
        
        // 获取群信息
        const group = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(groupId);
        if (!group) {
            return res.status(500).json({ success: false, message: '群创建成功但获取信息失败' });
        }
        
        // 自动加入 Socket 房间
        const io = getIO();
        if (io) {
            const userSockets = onlineUsers.get(userId)?.sockets || [];
            for (const socketId of userSockets) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.join(`group:${groupId}`);
                }
            }
        }
        
        console.log(`[创建群] 用户 ${userId} 创建群 ${groupId} (${groupName})`);
        
        res.json({
            success: true,
            group: {
                ...group,
                myRole: 'owner',
                memberCount: 1
            }
        });
    } catch (err) {
        console.error('[创建群] 数据库错误:', err);
        res.status(500).json({ success: false, message: '创建群失败: ' + err.message });
    }
});

// 加入群
router.post('/api/groups/:id/join', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;
    
    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }
    
    try {
        const group = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(groupId);
        if (!group) {
            return res.status(404).json({ success: false, message: '群不存在' });
        }
        
        const already = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
        if (already) {
            return res.status(400).json({ success: false, message: '已在群中' });
        }
        
        db.prepare('INSERT INTO group_members (groupId, userId, role) VALUES (?, ?, ?)').run(groupId, userId, 'member');
        
        // 加入 Socket 房间
        const io = getIO();
        if (io) {
            const userSockets = onlineUsers.get(userId)?.sockets || [];
            for (const socketId of userSockets) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.join(`group:${groupId}`);
                }
            }
        }
        
        res.json({ success: true, message: '已加入群' });
    } catch (err) {
        console.error('[加入群] 错误:', err);
        res.status(500).json({ success: false, message: '加入失败: ' + err.message });
    }
});

// 退出群
router.post('/api/groups/:id/leave', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;
    
    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }
    
    try {
        const member = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
        if (!member) {
            return res.status(404).json({ success: false, message: '您不在该群中' });
        }
        if (member.role === 'owner') {
            return res.status(400).json({ success: false, message: '群主不能退出，请先转让群主' });
        }
        
        db.prepare('DELETE FROM group_members WHERE groupId = ? AND userId = ?').run(groupId, userId);
        
        // 退出 Socket 房间
        const io = getIO();
        if (io) {
            const userSockets = onlineUsers.get(userId)?.sockets || [];
            for (const socketId of userSockets) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.leave(`group:${groupId}`);
                }
            }
        }
        
        res.json({ success: true, message: '已退出群' });
    } catch (err) {
        console.error('[退出群] 错误:', err);
        res.status(500).json({ success: false, message: '退出失败: ' + err.message });
    }
});

// 获取群成员
router.get('/api/groups/:id/members', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    
    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }
    
    try {
        // 验证用户是否在群中
        const member = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, req.userId);
        if (!member) {
            return res.status(403).json({ success: false, message: '您不在该群中' });
        }
        
        const members = db.prepare(`
            SELECT gm.userId, gm.role, gm.joinedAt, u.username, u.avatarUrl
            FROM group_members gm
            JOIN users u ON u.userId = gm.userId
            WHERE gm.groupId = ?
            ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, gm.joinedAt ASC
        `).all(groupId);
        res.json({ success: true, members });
    } catch (err) {
        console.error('[获取群成员] 错误:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 设置/取消管理员（群主）
router.post('/api/groups/:id/set-role', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const { targetUserId, role } = req.body;
    const userId = req.userId;
    
    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }
    if (!targetUserId || typeof targetUserId !== 'number') {
        return res.status(400).json({ success: false, message: '无效的目标用户' });
    }
    if (!role || (role !== 'admin' && role !== 'member')) {
        return res.status(400).json({ success: false, message: '无效的角色' });
    }
    
    try {
        const me = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
        if (!me || me.role !== 'owner') {
            return res.status(403).json({ success: false, message: '仅群主可设置管理员' });
        }
        const target = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, targetUserId);
        if (!target) {
            return res.status(404).json({ success: false, message: '目标不在群中' });
        }
        if (target.role === 'owner') {
            return res.status(400).json({ success: false, message: '不能修改群主权限' });
        }
        
        db.prepare('UPDATE group_members SET role = ? WHERE groupId = ? AND userId = ?').run(role, groupId, targetUserId);
        res.json({ success: true, message: role === 'admin' ? '已设为管理员' : '已取消管理员' });
    } catch (err) {
        console.error('[设置角色] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败: ' + err.message });
    }
});

// 踢出成员
router.post('/api/groups/:id/kick', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const { targetUserId } = req.body;
    const userId = req.userId;
    
    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }
    if (!targetUserId || typeof targetUserId !== 'number') {
        return res.status(400).json({ success: false, message: '无效的目标用户' });
    }
    
    try {
        const me = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
        if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
            return res.status(403).json({ success: false, message: '无权限踢人' });
        }
        const target = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, targetUserId);
        if (!target) {
            return res.status(404).json({ success: false, message: '目标不在群中' });
        }
        if (target.role === 'owner') {
            return res.status(400).json({ success: false, message: '不能踢出群主' });
        }
        if (me.role === 'admin' && target.role === 'admin') {
            return res.status(400).json({ success: false, message: '管理员不能互踢' });
        }
        
        db.prepare('DELETE FROM group_members WHERE groupId = ? AND userId = ?').run(groupId, targetUserId);
        
        // 被踢用户退出 Socket 房间
        const io = getIO();
        if (io) {
            const targetSockets = onlineUsers.get(targetUserId)?.sockets || [];
            for (const socketId of targetSockets) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.leave(`group:${groupId}`);
                    socket.emit('system message', '您已被踢出群聊');
                }
            }
        }
        
        res.json({ success: true, message: '已踢出' });
    } catch (err) {
        console.error('[踢出成员] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败: ' + err.message });
    }
});

// 解散群
router.delete('/api/groups/:id', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;
    
    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }
    
    try {
        const me = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
        if (!me || me.role !== 'owner') {
            return res.status(403).json({ success: false, message: '仅群主可解散群' });
        }
        
        // 获取所有成员，通知他们退出房间
        const members = db.prepare('SELECT userId FROM group_members WHERE groupId = ?').all(groupId);
        const io = getIO();
        if (io) {
            for (const m of members) {
                const sockets = onlineUsers.get(m.userId)?.sockets || [];
                for (const socketId of sockets) {
                    const socket = io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.leave(`group:${groupId}`);
                        socket.emit('system message', '您所在的群已被群主解散');
                    }
                }
            }
        }
        
        db.prepare('DELETE FROM messages WHERE groupId = ?').run(groupId);
        db.prepare('DELETE FROM group_members WHERE groupId = ?').run(groupId);
        db.prepare('DELETE FROM chat_groups WHERE id = ?').run(groupId);
        
        res.json({ success: true, message: '群已解散' });
    } catch (err) {
        console.error('[解散群] 错误:', err);
        res.status(500).json({ success: false, message: '解散失败: ' + err.message });
    }
});

// 获取群消息
router.get('/api/groups/:id/messages', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const { limit = 50, before } = req.query;
    const userId = req.userId;
    
    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }
    
    try {
        const member = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
        if (!member) {
            return res.status(403).json({ success: false, message: '不在群中' });
        }
        
        let query = 'SELECT * FROM messages WHERE groupId = ?';
        const params = [groupId];
        if (before) {
            query += ' AND id < ?';
            params.push(Number(before));
        }
        query += ' ORDER BY id DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const messages = db.prepare(query).all(...params).reverse();
        res.json({ success: true, messages });
    } catch (err) {
        console.error('[获取群消息] 错误:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

module.exports = router;