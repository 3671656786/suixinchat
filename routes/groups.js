// routes/groups.js - 完整修复版
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { isLoggedIn } = require('../middleware/auth');
const { getIO, onlineUsers } = require('../socket');
const { logToFile } = require('../utils/logger');

// ========== 辅助函数 ==========
function getUserRole(groupId, userId) {
    const member = db.prepare('SELECT role FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
    return member ? member.role : null;
}

function isGroupOwner(groupId, userId) {
    const group = db.prepare('SELECT ownerId FROM chat_groups WHERE id = ?').get(groupId);
    return group && group.ownerId === userId;
}

function isUserBanned(groupId, userId) {
    const ban = db.prepare('SELECT 1 FROM group_ban_list WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    return !!ban;
}

function canManageGroup(groupId, userId) {
    const role = getUserRole(groupId, userId);
    return role === 'owner' || role === 'admin';
}

function isUserInGroup(groupId, userId) {
    const member = db.prepare('SELECT 1 FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
    return !!member;
}

// ========== 获取我的群列表 ==========
router.get('/api/groups', isLoggedIn, (req, res) => {
    try {
        const groups = db.prepare(`
            SELECT g.*, gm.role as myRole,
                   (SELECT COUNT(*) FROM group_members WHERE groupId = g.id) as memberCount,
                   (SELECT COUNT(*) FROM group_join_requests WHERE group_id = g.id AND status = 'pending') as pendingRequests
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

// ========== 获取群信息 ==========
router.get('/api/groups/:id/info', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;

    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }

    try {
        if (!isUserInGroup(groupId, userId)) {
            return res.status(403).json({ success: false, message: '您不在该群中' });
        }

        const group = db.prepare(`
            SELECT g.*,
                   (SELECT COUNT(*) FROM group_members WHERE groupId = g.id) as memberCount,
                   (SELECT COUNT(*) FROM group_join_requests WHERE group_id = g.id AND status = 'pending') as pendingRequests
            FROM chat_groups g
            WHERE g.id = ?
        `).get(groupId);

        if (!group) {
            return res.status(404).json({ success: false, message: '群不存在' });
        }

        const role = getUserRole(groupId, userId);
        group.myRole = role;

        res.json({ success: true, group });
    } catch (err) {
        console.error('获取群信息失败:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ========== 发现可加入的群 ==========
router.get('/api/groups/discover', isLoggedIn, (req, res) => {
    try {
        const groups = db.prepare(`
            SELECT g.*,
                   (SELECT COUNT(*) FROM group_members WHERE groupId = g.id) as memberCount
            FROM chat_groups g
            WHERE g.id NOT IN (SELECT groupId FROM group_members WHERE userId = ?)
            AND g.allow_join = 1
            ORDER BY g.createdAt DESC LIMIT 50
        `).all(req.userId);
        res.json({ success: true, groups });
    } catch (err) {
        console.error('发现群列表失败:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ========== 创建群 ==========
router.post('/api/groups', isLoggedIn, (req, res) => {
    const { name, description, avatar } = req.body;
    const userId = req.userId;

    if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 20) {
        return res.status(400).json({ success: false, message: '群名称长度应为1-20个字符' });
    }

    if (!userId || typeof userId !== 'number') {
        return res.status(401).json({ success: false, message: '用户未登录或会话已过期' });
    }

    const groupName = name.trim();
    const groupDesc = (description && typeof description === 'string') ? description.trim() : '';
    const groupAvatar = avatar || null;

    try {
        const stmt = db.prepare('INSERT INTO chat_groups (name, description, ownerId, avatar, join_approval, allow_join) VALUES (?, ?, ?, ?, ?, ?)');
        const result = stmt.run(groupName, groupDesc, userId, groupAvatar, 0, 1);

        const groupId = result.lastInsertRowid;
        if (!groupId || typeof groupId !== 'number') {
            console.error('[创建群] 获取群ID失败:', result);
            return res.status(500).json({ success: false, message: '创建群失败，无法获取群ID' });
        }

        const memberStmt = db.prepare('INSERT INTO group_members (groupId, userId, role) VALUES (?, ?, ?)');
        memberStmt.run(groupId, userId, 'owner');

        // ========== 修复 #1: 确保创建者加入Socket房间 ==========
        const io = getIO();
        if (io) {
            // 方法1: 通过 onlineUsers 获取所有该用户的Socket连接
            const userInfo = onlineUsers.get(userId);
            let joinedCount = 0;
            if (userInfo && userInfo.sockets) {
                for (const socketId of userInfo.sockets) {
                    const socket = io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.join(`group:${groupId}`);
                        joinedCount++;
                        console.log(`[群创建] 用户 ${userId} 加入群房间 ${groupId} (socket: ${socketId})`);
                    }
                }
            }
            console.log(`[群创建] 用户 ${userId} 共加入 ${joinedCount} 个socket到群房间 ${groupId}`);
            
            // 方法2: 广播群创建事件给所有在线用户（刷新群列表）
            io.emit('group_created', { 
                groupId, 
                name: groupName, 
                ownerId: userId,
                timestamp: new Date().toISOString()
            });
        }

        const group = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(groupId);
        if (!group) {
            return res.status(500).json({ success: false, message: '群创建成功但获取信息失败' });
        }

        logToFile(`[创建群] 用户 ${userId} 创建群 ${groupId} (${groupName})`);

        res.json({
            success: true,
            group: {
                ...group,
                myRole: 'owner',
                memberCount: 1,
                pendingRequests: 0
            }
        });
    } catch (err) {
        console.error('[创建群] 数据库错误:', err);
        res.status(500).json({ success: false, message: '创建群失败: ' + err.message });
    }
});

// ========== 申请加入群 ==========
router.post('/api/groups/:id/request-join', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;
    const { reason } = req.body;

    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }

    try {
        const group = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(groupId);
        if (!group) {
            return res.status(404).json({ success: false, message: '群不存在' });
        }

        if (isUserInGroup(groupId, userId)) {
            return res.status(400).json({ success: false, message: '您已在群中' });
        }

        if (isUserBanned(groupId, userId)) {
            return res.status(403).json({ success: false, message: '您已被该群拉黑，无法申请加入' });
        }

        if (group.allow_join === 0) {
            return res.status(403).json({ success: false, message: '该群暂不允许加入' });
        }

        if (group.join_approval === 1) {
            const existing = db.prepare('SELECT * FROM group_join_requests WHERE group_id = ? AND user_id = ? AND status = "pending"').get(groupId, userId);
            if (existing) {
                return res.status(400).json({ success: false, message: '您已提交申请，请等待审批' });
            }

            db.prepare('INSERT INTO group_join_requests (group_id, user_id, reason, status) VALUES (?, ?, ?, ?)')
                .run(groupId, userId, reason || '', 'pending');

            const io = getIO();
            if (io) {
                const admins = db.prepare('SELECT userId FROM group_members WHERE groupId = ? AND role IN ("owner", "admin")').all(groupId);
                for (const admin of admins) {
                    const sockets = onlineUsers.get(admin.userId)?.sockets || [];
                    for (const socketId of sockets) {
                        io.to(socketId).emit('new_group_join_request', {
                            groupId: groupId,
                            groupName: group.name,
                            userId: userId,
                            username: req.user?.username || '用户',
                            reason: reason || ''
                        });
                    }
                }
            }

            logToFile(`[群申请] 用户 ${userId} 申请加入群 ${groupId}`);
            res.json({ success: true, message: '申请已提交，请等待群主或管理员审批' });
        } else {
            db.prepare('INSERT INTO group_members (groupId, userId, role) VALUES (?, ?, ?)').run(groupId, userId, 'member');

            const io = getIO();
            if (io) {
                const userSockets = onlineUsers.get(userId)?.sockets || [];
                for (const socketId of userSockets) {
                    const socket = io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.join(`group:${groupId}`);
                    }
                }
                io.to(`group:${groupId}`).emit('system message', `用户 ${req.user?.username || '用户'} 加入了群聊`);
            }

            logToFile(`[加入群] 用户 ${userId} 直接加入群 ${groupId}`);
            res.json({ success: true, message: '已加入群' });
        }
    } catch (err) {
        console.error('[申请加入群] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败: ' + err.message });
    }
});

// ========== 审批加入申请 ==========
router.post('/api/groups/:id/approve-request', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;
    const { requestId, approve, rejectReason } = req.body;

    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }

    try {
        const group = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(groupId);
        if (!group) {
            return res.status(404).json({ success: false, message: '群不存在' });
        }

        const role = getUserRole(groupId, userId);
        if (!role || (role !== 'owner' && role !== 'admin')) {
            return res.status(403).json({ success: false, message: '无权限审批' });
        }

        const request = db.prepare('SELECT * FROM group_join_requests WHERE id = ? AND group_id = ? AND status = "pending"').get(requestId, groupId);
        if (!request) {
            return res.status(404).json({ success: false, message: '申请不存在或已处理' });
        }

        if (approve) {
            if (isUserBanned(groupId, request.user_id)) {
                db.prepare('UPDATE group_join_requests SET status = ?, processed_at = datetime("now"), processed_by = ? WHERE id = ?')
                    .run('rejected', userId, requestId);
                return res.status(400).json({ success: false, message: '用户已被拉黑，无法加入' });
            }

            db.prepare('INSERT OR IGNORE INTO group_members (groupId, userId, role) VALUES (?, ?, ?)').run(groupId, request.user_id, 'member');
            db.prepare('UPDATE group_join_requests SET status = ?, processed_at = datetime("now"), processed_by = ? WHERE id = ?')
                .run('approved', userId, requestId);

            const io = getIO();
            if (io) {
                const userSockets = onlineUsers.get(request.user_id)?.sockets || [];
                for (const socketId of userSockets) {
                    const socket = io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.join(`group:${groupId}`);
                    }
                }
                io.to(`group:${groupId}`).emit('system message', `新成员 ${request.user_id} 已加入群聊`);
            }

            logToFile(`[群审批] 用户 ${userId} 批准 ${request.user_id} 加入群 ${groupId}`);
            res.json({ success: true, message: '已批准加入' });
        } else {
            db.prepare('UPDATE group_join_requests SET status = ?, processed_at = datetime("now"), processed_by = ? WHERE id = ?')
                .run('rejected', userId, requestId);

            const io = getIO();
            if (io) {
                io.to(`group:${groupId}`).emit('system message', `加入申请已被拒绝`);
            }

            logToFile(`[群审批] 用户 ${userId} 拒绝 ${request.user_id} 加入群 ${groupId}`);
            res.json({ success: true, message: '已拒绝申请' });
        }
    } catch (err) {
        console.error('[审批加入申请] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败: ' + err.message });
    }
});

// ========== 获取群加入申请列表 ==========
router.get('/api/groups/:id/requests', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;

    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }

    try {
        const role = getUserRole(groupId, userId);
        if (!role || (role !== 'owner' && role !== 'admin')) {
            return res.status(403).json({ success: false, message: '无权限查看' });
        }

        const requests = db.prepare(`
            SELECT r.*, u.username, u.avatarUrl
            FROM group_join_requests r
            LEFT JOIN users u ON r.user_id = u.userId
            WHERE r.group_id = ? AND r.status = 'pending'
            ORDER BY r.requested_at ASC
        `).all(groupId);

        res.json({ success: true, requests });
    } catch (err) {
        console.error('获取加入申请列表失败:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ========== 加入群（不需要审批时） ==========
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

        if (isUserInGroup(groupId, userId)) {
            return res.status(400).json({ success: false, message: '已在群中' });
        }

        if (isUserBanned(groupId, userId)) {
            return res.status(403).json({ success: false, message: '您已被该群拉黑' });
        }

        if (group.allow_join === 0) {
            return res.status(403).json({ success: false, message: '该群暂不允许加入' });
        }

        if (group.join_approval === 1) {
            return res.status(403).json({
                success: false,
                message: '该群需要申请加入，请使用申请接口',
                needApproval: true
            });
        }

        db.prepare('INSERT INTO group_members (groupId, userId, role) VALUES (?, ?, ?)').run(groupId, userId, 'member');

        const io = getIO();
        if (io) {
            const userSockets = onlineUsers.get(userId)?.sockets || [];
            for (const socketId of userSockets) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.join(`group:${groupId}`);
                }
            }
            io.to(`group:${groupId}`).emit('system message', `用户 ${req.user?.username || '用户'} 加入了群聊`);
        }

        res.json({ success: true, message: '已加入群' });
    } catch (err) {
        console.error('[加入群] 错误:', err);
        res.status(500).json({ success: false, message: '加入失败: ' + err.message });
    }
});

// ========== 退出群 ==========
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
            const otherMembers = db.prepare('SELECT COUNT(*) as count FROM group_members WHERE groupId = ? AND userId != ?').get(groupId, userId);
            if (otherMembers.count > 0) {
                return res.status(400).json({ success: false, message: '群主不能退出，请先转让群主或解散群' });
            } else {
                db.prepare('DELETE FROM group_members WHERE groupId = ?').run(groupId);
                db.prepare('DELETE FROM chat_groups WHERE id = ?').run(groupId);
                const io = getIO();
                if (io) {
                    io.to(`group:${groupId}`).emit('group_disbanded', { groupId });
                }
                return res.json({ success: true, message: '群已解散' });
            }
        }

        db.prepare('DELETE FROM group_members WHERE groupId = ? AND userId = ?').run(groupId, userId);

        const io = getIO();
        if (io) {
            const userSockets = onlineUsers.get(userId)?.sockets || [];
            for (const socketId of userSockets) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.leave(`group:${groupId}`);
                }
            }
            io.to(`group:${groupId}`).emit('system message', `用户 ${req.user?.username || '用户'} 退出了群聊`);
        }

        res.json({ success: true, message: '已退出群' });
    } catch (err) {
        console.error('[退出群] 错误:', err);
        res.status(500).json({ success: false, message: '退出失败: ' + err.message });
    }
});

// ========== 获取群成员 ==========
router.get('/api/groups/:id/members', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);

    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }

    try {
        if (!isUserInGroup(groupId, req.userId)) {
            return res.status(403).json({ success: false, message: '您不在该群中' });
        }

        const members = db.prepare(`
            SELECT gm.userId, gm.role, gm.joinedAt, u.username, u.avatarUrl
            FROM group_members gm
            JOIN users u ON u.userId = gm.userId
            WHERE gm.groupId = ?
            ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, gm.joinedAt ASC
        `).all(groupId);

        const banned = db.prepare(`
            SELECT b.user_id, b.banned_at, b.reason, u.username
            FROM group_ban_list b
            LEFT JOIN users u ON b.user_id = u.userId
            WHERE b.group_id = ?
        `).all(groupId);

        res.json({ success: true, members, banned });
    } catch (err) {
        console.error('[获取群成员] 错误:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ========== 设置/取消管理员 ==========
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
        if (!isGroupOwner(groupId, userId)) {
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

        const io = getIO();
        if (io) {
            io.to(`group:${groupId}`).emit('system message', `用户 ${targetUserId} 已被${role === 'admin' ? '设为' : '取消'}管理员`);
        }

        res.json({ success: true, message: role === 'admin' ? '已设为管理员' : '已取消管理员' });
    } catch (err) {
        console.error('[设置角色] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败: ' + err.message });
    }
});

// ========== 踢出成员 ==========
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

        const io = getIO();
        if (io) {
            const targetSockets = onlineUsers.get(targetUserId)?.sockets || [];
            for (const socketId of targetSockets) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    // 离开群组房间
                    socket.leave(`group:${groupId}`);
                    socket.emit('system message', '您已被踢出群聊');
                }
            }
            io.to(`group:${groupId}`).emit('system message', `用户 ${targetUserId} 已被踢出群聊`);
        }

        res.json({ success: true, message: '已踢出' });
    } catch (err) {
        console.error('[踢出成员] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败: ' + err.message });
    }
});

// ========== 解散群 ==========
router.delete('/api/groups/:id', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;

    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }

    try {
        const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
        const member = db.prepare('SELECT * FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);

        if (!member || (member.role !== 'owner' && user?.role !== 'admin')) {
            return res.status(403).json({ success: false, message: '无权限解散群' });
        }

        const members = db.prepare('SELECT userId FROM group_members WHERE groupId = ?').all(groupId);
        const io = getIO();

        if (io) {
            for (const m of members) {
                const sockets = onlineUsers.get(m.userId)?.sockets || [];
                for (const socketId of sockets) {
                    const socket = io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.leave(`group:${groupId}`);
                        socket.emit('system message', '您所在的群已被解散');
                    }
                }
            }
            io.to(`group:${groupId}`).emit('group_disbanded', { groupId });
        }

        db.prepare('DELETE FROM messages WHERE groupId = ?').run(groupId);
        db.prepare('DELETE FROM group_ban_list WHERE group_id = ?').run(groupId);
        db.prepare('DELETE FROM group_join_requests WHERE group_id = ?').run(groupId);
        db.prepare('DELETE FROM group_members WHERE groupId = ?').run(groupId);
        db.prepare('DELETE FROM chat_groups WHERE id = ?').run(groupId);

        logToFile(`[解散群] 用户 ${userId} 解散群 ${groupId}`);
        res.json({ success: true, message: '群已解散' });
    } catch (err) {
        console.error('[解散群] 错误:', err);
        res.status(500).json({ success: false, message: '解散失败: ' + err.message });
    }
});

// ========== 更新群设置 ==========
router.put('/api/groups/:id/settings', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;
    const { name, description, avatar, joinApproval, allowJoin } = req.body;

    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }

    try {
        const group = db.prepare('SELECT ownerId FROM chat_groups WHERE id = ?').get(groupId);
        if (!group || group.ownerId !== userId) {
            return res.status(403).json({ success: false, message: '仅群主可修改群设置' });
        }

        const updates = [];
        const params = [];

        if (name !== undefined) {
            if (name.trim().length < 1 || name.trim().length > 20) {
                return res.status(400).json({ success: false, message: '群名称长度应为1-20个字符' });
            }
            updates.push('name = ?');
            params.push(name.trim());
        }

        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description.trim() || '');
        }

        if (avatar !== undefined) {
            updates.push('avatar = ?');
            params.push(avatar || null);
        }

        if (joinApproval !== undefined) {
            updates.push('join_approval = ?');
            params.push(joinApproval ? 1 : 0);
        }

        if (allowJoin !== undefined) {
            updates.push('allow_join = ?');
            params.push(allowJoin ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: '没有需要更新的字段' });
        }

        params.push(groupId);
        const sql = `UPDATE chat_groups SET ${updates.join(', ')} WHERE id = ?`;
        const result = db.prepare(sql).run(...params);
        
        if (result.changes === 0) {
            return res.status(404).json({ success: false, message: '群不存在或无需更新' });
        }

        const updatedGroup = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(groupId);

        const io = getIO();
        if (io) {
            io.to(`group:${groupId}`).emit('group_settings_changed', {
                groupId: groupId,
                settings: updatedGroup
            });
        }

        logToFile(`[群设置] 用户 ${userId} 更新群 ${groupId} 设置`);
        res.json({ success: true, group: updatedGroup });
    } catch (err) {
        console.error('[更新群设置] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败: ' + err.message });
    }
});

// ========== 群黑名单管理 ==========
router.post('/api/groups/:id/ban', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;
    const { targetUserId, reason } = req.body;

    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }
    if (!targetUserId || typeof targetUserId !== 'number') {
        return res.status(400).json({ success: false, message: '无效的目标用户' });
    }

    try {
        const group = db.prepare('SELECT ownerId FROM chat_groups WHERE id = ?').get(groupId);
        if (!group || group.ownerId !== userId) {
            return res.status(403).json({ success: false, message: '仅群主可管理黑名单' });
        }

        if (group.ownerId === targetUserId) {
            return res.status(400).json({ success: false, message: '不能拉黑群主' });
        }

        const existing = db.prepare('SELECT 1 FROM group_ban_list WHERE group_id = ? AND user_id = ?').get(groupId, targetUserId);
        if (existing) {
            return res.status(400).json({ success: false, message: '用户已在黑名单中' });
        }

        db.prepare('INSERT INTO group_ban_list (group_id, user_id, reason) VALUES (?, ?, ?)')
            .run(groupId, targetUserId, reason || '');

        if (isUserInGroup(groupId, targetUserId)) {
            db.prepare('DELETE FROM group_members WHERE groupId = ? AND userId = ?').run(groupId, targetUserId);

            const io = getIO();
            if (io) {
                const targetSockets = onlineUsers.get(targetUserId)?.sockets || [];
                for (const socketId of targetSockets) {
                    const socket = io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.leave(`group:${groupId}`);
                        socket.emit('system message', '您已被群主拉黑并移出群聊');
                    }
                }
                io.to(`group:${groupId}`).emit('system message', `用户 ${targetUserId} 已被加入黑名单并移出群聊`);
            }
        }

        logToFile(`[群黑名单] 用户 ${userId} 将 ${targetUserId} 加入群 ${groupId} 黑名单`);
        res.json({ success: true, message: '已加入黑名单' });
    } catch (err) {
        console.error('[添加黑名单] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败: ' + err.message });
    }
});

// ========== 移除黑名单 ==========
router.delete('/api/groups/:id/ban/:targetUserId', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;
    const targetUserId = Number(req.params.targetUserId);

    if (!groupId || isNaN(groupId) || !targetUserId || isNaN(targetUserId)) {
        return res.status(400).json({ success: false, message: '无效的参数' });
    }

    try {
        const group = db.prepare('SELECT ownerId FROM chat_groups WHERE id = ?').get(groupId);
        if (!group || group.ownerId !== userId) {
            return res.status(403).json({ success: false, message: '仅群主可管理黑名单' });
        }

        const result = db.prepare('DELETE FROM group_ban_list WHERE group_id = ? AND user_id = ?').run(groupId, targetUserId);
        if (result.changes === 0) {
            return res.status(404).json({ success: false, message: '用户不在黑名单中' });
        }

        logToFile(`[群黑名单] 用户 ${userId} 将 ${targetUserId} 移出群 ${groupId} 黑名单`);
        res.json({ success: true, message: '已移出黑名单' });
    } catch (err) {
        console.error('[移除黑名单] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败: ' + err.message });
    }
});

// ========== 邀请用户加入群 ==========
router.post('/api/groups/:id/invite', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;
    const { targetUserId } = req.body;

    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }
    if (!targetUserId || typeof targetUserId !== 'number') {
        return res.status(400).json({ success: false, message: '无效的目标用户' });
    }

    try {
        const group = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(groupId);
        if (!group) {
            return res.status(404).json({ success: false, message: '群不存在' });
        }

        if (!isUserInGroup(groupId, userId)) {
            return res.status(403).json({ success: false, message: '您不在该群中' });
        }

        if (isUserInGroup(groupId, targetUserId)) {
            return res.status(400).json({ success: false, message: '用户已在群中' });
        }

        if (isUserBanned(groupId, targetUserId)) {
            return res.status(403).json({ success: false, message: '该用户已被拉黑，无法邀请' });
        }

        if (group.allow_join === 0) {
            return res.status(403).json({ success: false, message: '该群暂不允许加入' });
        }

        if (group.join_approval === 1) {
            const existing = db.prepare('SELECT * FROM group_join_requests WHERE group_id = ? AND user_id = ? AND status = "pending"').get(groupId, targetUserId);
            if (existing) {
                return res.status(400).json({ success: false, message: '该用户已有待审批的申请' });
            }

            db.prepare('INSERT INTO group_join_requests (group_id, user_id, reason, status) VALUES (?, ?, ?, ?)')
                .run(groupId, targetUserId, `邀请人: ${req.user?.username || userId}`, 'pending');

            const io = getIO();
            if (io) {
                const admins = db.prepare('SELECT userId FROM group_members WHERE groupId = ? AND role IN ("owner", "admin")').all(groupId);
                for (const admin of admins) {
                    const sockets = onlineUsers.get(admin.userId)?.sockets || [];
                    for (const socketId of sockets) {
                        io.to(socketId).emit('new_group_join_request', {
                            groupId: groupId,
                            groupName: group.name,
                            userId: targetUserId,
                            username: req.user?.username || '用户',
                            reason: `邀请人: ${req.user?.username || userId}`
                        });
                    }
                }
            }

            logToFile(`[群邀请] 用户 ${userId} 邀请 ${targetUserId} 加入群 ${groupId}，等待审批`);
            res.json({ success: true, message: '邀请已发送，等待群主或管理员审批' });
        } else {
            db.prepare('INSERT INTO group_members (groupId, userId, role) VALUES (?, ?, ?)').run(groupId, targetUserId, 'member');

            const io = getIO();
            if (io) {
                const targetSockets = onlineUsers.get(targetUserId)?.sockets || [];
                for (const socketId of targetSockets) {
                    const socket = io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.join(`group:${groupId}`);
                        socket.emit('system message', `您被 ${req.user?.username || '用户'} 邀请加入了群聊`);
                    }
                }
                io.to(`group:${groupId}`).emit('system message', `用户 ${targetUserId} 被 ${req.user?.username || '用户'} 邀请加入了群聊`);
            }

            logToFile(`[群邀请] 用户 ${userId} 邀请 ${targetUserId} 加入群 ${groupId}`);
            res.json({ success: true, message: '邀请成功，用户已加入群' });
        }
    } catch (err) {
        console.error('[邀请用户] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败: ' + err.message });
    }
});

// ========== 获取群消息 ==========
router.get('/api/groups/:id/messages', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const { limit = 50, before } = req.query;
    const userId = req.userId;

    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }

    try {
        if (!isUserInGroup(groupId, userId)) {
            return res.status(403).json({ success: false, message: '不在群中' });
        }

        let parsedLimit = parseInt(limit);
        if (isNaN(parsedLimit) || parsedLimit < 1) parsedLimit = 50;
        if (parsedLimit > 100) parsedLimit = 100; // 限制最大100条

        // ========== 修复 N3: 优化群消息历史加载性能 ==========
        // 使用子查询先获取最近的消息ID，再反转顺序，避免全量加载
        let sql = `
            SELECT * FROM (
                SELECT * FROM messages 
                WHERE groupId = ?
        `;
        const params = [groupId];
        if (before) {
            sql += ' AND id < ?';
            params.push(Number(before));
        }
        sql += ` ORDER BY id DESC LIMIT ? 
            ) ORDER BY id ASC`;
        params.push(parsedLimit);

        const messages = db.prepare(sql).all(...params);
        res.json({ success: true, messages });
    } catch (err) {
        console.error('[获取群消息] 错误:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

module.exports = router;