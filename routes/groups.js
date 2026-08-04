// routes/groups.js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { isLoggedIn } = require('../middleware/auth');
const { getIO, onlineUsers } = require('../socket');
const { logToFile } = require('../utils/logger');

// ========== 配置 ==========
const config = {
    MAX_GROUP_NAME_LENGTH: parseInt(process.env.MAX_GROUP_NAME_LENGTH) || 20,
    MAX_GROUP_DESC_LENGTH: parseInt(process.env.MAX_GROUP_DESC_LENGTH) || 100,
    MAX_MESSAGES_LIMIT: parseInt(process.env.MAX_MESSAGES_LIMIT) || 100,
    DEFAULT_MESSAGES_LIMIT: parseInt(process.env.DEFAULT_MESSAGES_LIMIT) || 50,
    MAX_REASON_LENGTH: parseInt(process.env.MAX_REASON_LENGTH) || 255,
    SOCKET_CACHE_TTL: parseInt(process.env.SOCKET_CACHE_TTL) || 5000,
    MAX_CACHE_SIZE: parseInt(process.env.MAX_CACHE_SIZE) || 1000
};

const ALLOWED_UPDATE_FIELDS = ['name', 'description', 'avatar', 'join_approval', 'allow_join'];

// ========== 辅助函数 ==========

function getUserRole(groupId, userId) {
    try {
        const member = db.prepare('SELECT role FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
        return member ? member.role : null;
    } catch (err) {
        console.error('[getUserRole] 错误:', err);
        return null;
    }
}

function isGroupOwner(groupId, userId) {
    try {
        const group = db.prepare('SELECT ownerId FROM chat_groups WHERE id = ?').get(groupId);
        return group ? group.ownerId === userId : false;
    } catch (err) {
        console.error('[isGroupOwner] 错误:', err);
        return false;
    }
}

function isUserBanned(groupId, userId) {
    try {
        const ban = db.prepare('SELECT 1 FROM group_ban_list WHERE group_id = ? AND user_id = ?').get(groupId, userId);
        return !!ban;
    } catch (err) {
        console.error('[isUserBanned] 错误:', err);
        return false;
    }
}

function canManageGroup(groupId, userId) {
    const role = getUserRole(groupId, userId);
    return role === 'owner' || role === 'admin';
}

function isUserInGroup(groupId, userId) {
    try {
        const member = db.prepare('SELECT 1 FROM group_members WHERE groupId = ? AND userId = ?').get(groupId, userId);
        return !!member;
    } catch (err) {
        console.error('[isUserInGroup] 错误:', err);
        return false;
    }
}

// ========== Socket 缓存 ==========
const socketCache = new Map();

function getUserSockets(userId) {
    try {
        const cacheKey = `sockets_${userId}`;
        if (socketCache.has(cacheKey)) {
            const cached = socketCache.get(cacheKey);
            if (Date.now() - cached.timestamp < config.SOCKET_CACHE_TTL) {
                return cached.sockets;
            }
            socketCache.delete(cacheKey);
        }

        const info = onlineUsers.get(userId);
        if (!info || !info.sockets) return [];
        
        const io = getIO();
        if (!io) return [];
        
        const result = [];
        for (const socketId of info.sockets) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
                result.push(socket);
            }
        }
        
        if (socketCache.size >= config.MAX_CACHE_SIZE) {
            const entries = Array.from(socketCache.entries());
            const toDelete = Math.floor(config.MAX_CACHE_SIZE * 0.1);
            for (let i = 0; i < toDelete && i < entries.length; i++) {
                socketCache.delete(entries[i][0]);
            }
        }
        
        socketCache.set(cacheKey, {
            sockets: result,
            timestamp: Date.now()
        });
        
        return result;
    } catch (err) {
        console.error('[getUserSockets] 错误:', err);
        return [];
    }
}

function cleanupUserGroupRooms(userId, groupId) {
    try {
        const io = getIO();
        if (!io) return;
        const sockets = getUserSockets(userId);
        for (const socket of sockets) {
            if (groupId) {
                socket.leave(`group:${groupId}`);
            } else {
                const rooms = Array.from(socket.rooms || []);
                for (const room of rooms) {
                    if (room.startsWith('group:')) {
                        socket.leave(room);
                    }
                }
            }
        }
        socketCache.delete(`sockets_${userId}`);
    } catch (err) {
        console.error('[cleanupUserGroupRooms] 错误:', err);
    }
}

// ========== 事务 ==========
const deleteGroupTransaction = db.transaction((groupId) => {
    const results = { messages: 0, bans: 0, requests: 0, members: 0, group: 0 };
    try {
        results.messages = db.prepare('DELETE FROM messages WHERE groupId = ?').run(groupId).changes;
        results.bans = db.prepare('DELETE FROM group_ban_list WHERE group_id = ?').run(groupId).changes;
        results.requests = db.prepare('DELETE FROM group_join_requests WHERE group_id = ?').run(groupId).changes;
        results.members = db.prepare('DELETE FROM group_members WHERE groupId = ?').run(groupId).changes;
        results.group = db.prepare('DELETE FROM chat_groups WHERE id = ?').run(groupId).changes;
        return results;
    } catch (err) {
        console.error('[deleteGroupTransaction] 错误:', err);
        throw new Error(`删除群数据失败: ${err.message}`);
    }
});

// ========== 获取群消息 ==========
function getGroupMessages(groupId, limit, before) {
    try {
        let parsedLimit = parseInt(limit, 10);
        if (isNaN(parsedLimit) || parsedLimit < 1) parsedLimit = config.DEFAULT_MESSAGES_LIMIT;
        if (parsedLimit > config.MAX_MESSAGES_LIMIT) parsedLimit = config.MAX_MESSAGES_LIMIT;
        
        let sql = 'SELECT * FROM messages WHERE groupId = ?';
        const params = [groupId];
        
        if (before) {
            if (!/^\d+$/.test(String(before))) {
                throw new Error('before参数必须是数字');
            }
            const beforeId = parseInt(before, 10);
            if (beforeId > 0 && beforeId < Number.MAX_SAFE_INTEGER) {
                sql += ' AND id < ?';
                params.push(beforeId);
            }
        }
        
        sql += ' ORDER BY id DESC LIMIT ?';
        params.push(parsedLimit);
        
        const messages = db.prepare(sql).all(...params);
        messages.reverse();
        return messages;
    } catch (err) {
        console.error('[getGroupMessages] 错误:', err);
        throw err;
    }
}

function validateUpdateField(update) {
    const match = update.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*\?$/);
    if (!match) return null;
    const field = match[1];
    return ALLOWED_UPDATE_FIELDS.includes(field) ? field : null;
}

function createGroupWithTransaction(name, description, avatar, userId) {
    const transaction = db.transaction((name, description, avatar, userId) => {
        const stmt = db.prepare('INSERT INTO chat_groups (name, description, ownerId, avatar, join_approval, allow_join) VALUES (?, ?, ?, ?, ?, ?)');
        const result = stmt.run(name, description, userId, avatar, 0, 1);
        const groupId = result.lastInsertRowid;
        
        if (!groupId) {
            throw new Error('创建群失败：无法获取群ID');
        }
        
        const memberStmt = db.prepare('INSERT INTO group_members (groupId, userId, role) VALUES (?, ?, ?)');
        memberStmt.run(groupId, userId, 'owner');
        
        return groupId;
    });
    
    try {
        return transaction(name, description, avatar, userId);
    } catch (err) {
        console.error('[createGroupWithTransaction] 错误:', err);
        throw err;
    }
}

// ========== 路由 ==========

router.get('/api/groups', isLoggedIn, (req, res) => {
    try {
        const groups = db.prepare(`
            SELECT g.*, gm.role as myRole,
                   COUNT(DISTINCT gm2.userId) as memberCount,
                   COUNT(DISTINCT r.id) as pendingRequests
            FROM chat_groups g
            JOIN group_members gm ON gm.groupId = g.id AND gm.userId = ?
            LEFT JOIN group_members gm2 ON gm2.groupId = g.id
            LEFT JOIN group_join_requests r ON r.group_id = g.id AND r.status = 'pending'
            WHERE gm.userId = ?
            GROUP BY g.id
            ORDER BY g.createdAt DESC
        `).all(req.userId, req.userId);
        res.json({ success: true, groups });
    } catch (err) {
        console.error('获取群列表失败:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

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

router.get('/api/groups/discover', isLoggedIn, (req, res) => {
    try {
        const groups = db.prepare(`
            SELECT g.*, COUNT(DISTINCT gm.userId) as memberCount
            FROM chat_groups g
            LEFT JOIN group_members gm ON gm.groupId = g.id
            WHERE g.allow_join = 1
            AND NOT EXISTS (
                SELECT 1 FROM group_members gm2 
                WHERE gm2.groupId = g.id AND gm2.userId = ?
            )
            GROUP BY g.id
            ORDER BY g.createdAt DESC
            LIMIT 50
        `).all(req.userId);
        res.json({ success: true, groups });
    } catch (err) {
        console.error('发现群列表失败:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

router.post('/api/groups', isLoggedIn, (req, res) => {
    const { name, description, avatar } = req.body;
    const userId = req.userId;

    if (!userId) {
        return res.status(401).json({ success: false, message: '用户未登录' });
    }

    if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > config.MAX_GROUP_NAME_LENGTH) {
        return res.status(400).json({ 
            success: false, 
            message: `群名称长度应为1-${config.MAX_GROUP_NAME_LENGTH}个字符` 
        });
    }

    const groupName = name.trim();
    const groupDesc = (description && typeof description === 'string') ? description.trim().slice(0, config.MAX_GROUP_DESC_LENGTH) : '';
    const groupAvatar = avatar || null;

    try {
        const groupId = createGroupWithTransaction(groupName, groupDesc, groupAvatar, userId);

        const io = getIO();
        if (io) {
            const sockets = getUserSockets(userId);
            for (const socket of sockets) {
                socket.join(`group:${groupId}`);
                console.log(`[群创建] 用户 ${userId} 加入群房间 ${groupId}`);
            }
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
        console.error('[创建群] 错误:', err);
        logToFile(`[创建群] 错误: ${err.message}`);
        res.status(500).json({ 
            success: false, 
            message: '创建群失败，请稍后重试' 
        });
    }
});

router.post('/api/groups/:id/request-join', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;
    const { reason } = req.body;

    if (!userId) {
        return res.status(401).json({ success: false, message: '用户未登录' });
    }

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
            const safeReason = (reason || '').slice(0, config.MAX_REASON_LENGTH);
            try {
                const result = db.prepare(`
                    INSERT OR IGNORE INTO group_join_requests (group_id, user_id, reason, status) 
                    VALUES (?, ?, ?, 'pending')
                `).run(groupId, userId, safeReason);
                
                if (result.changes === 0) {
                    return res.status(400).json({ 
                        success: false, 
                        message: '您已提交申请或申请正在处理中' 
                    });
                }
            } catch (err) {
                return res.status(400).json({ 
                    success: false, 
                    message: '您已提交过申请，请等待审批' 
                });
            }

            const io = getIO();
            if (io) {
                const admins = db.prepare('SELECT userId FROM group_members WHERE groupId = ? AND role IN ("owner", "admin")').all(groupId);
                for (const admin of admins) {
                    const sockets = getUserSockets(admin.userId);
                    for (const socket of sockets) {
                        socket.emit('new_group_join_request', {
                            groupId: groupId,
                            groupName: group.name,
                            userId: userId,
                            username: req.user?.username || '用户',
                            reason: safeReason
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
                const sockets = getUserSockets(userId);
                for (const socket of sockets) {
                    socket.join(`group:${groupId}`);
                }
                io.to(`group:${groupId}`).emit('system message', `用户 ${req.user?.username || '用户'} 加入了群聊`);
            }

            logToFile(`[加入群] 用户 ${userId} 直接加入群 ${groupId}`);
            res.json({ success: true, message: '已加入群' });
        }
    } catch (err) {
        console.error('[申请加入群] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败，请稍后重试' });
    }
});

router.post('/api/groups/:id/approve-request', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;
    const { requestId, approve } = req.body;

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
                const sockets = getUserSockets(request.user_id);
                for (const socket of sockets) {
                    socket.join(`group:${groupId}`);
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
        res.status(500).json({ success: false, message: '操作失败，请稍后重试' });
    }
});

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
            const sockets = getUserSockets(userId);
            for (const socket of sockets) {
                socket.join(`group:${groupId}`);
            }
            io.to(`group:${groupId}`).emit('system message', `用户 ${req.user?.username || '用户'} 加入了群聊`);
        }

        res.json({ success: true, message: '已加入群' });
    } catch (err) {
        console.error('[加入群] 错误:', err);
        res.status(500).json({ success: false, message: '加入失败，请稍后重试' });
    }
});

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
                const results = deleteGroupTransaction(groupId);
                
                const io = getIO();
                if (io) {
                    io.to(`group:${groupId}`).emit('group_disbanded', { groupId });
                }
                cleanupUserGroupRooms(userId, groupId);
                logToFile(`[退出群] 用户 ${userId} 解散群 ${groupId}，删除数据: ${JSON.stringify(results)}`);
                return res.json({ success: true, message: '群已解散' });
            }
        }

        db.prepare('DELETE FROM group_members WHERE groupId = ? AND userId = ?').run(groupId, userId);

        const io = getIO();
        if (io) {
            cleanupUserGroupRooms(userId, groupId);
            io.to(`group:${groupId}`).emit('system message', `用户 ${req.user?.username || '用户'} 退出了群聊`);
        }

        res.json({ success: true, message: '已退出群' });
    } catch (err) {
        console.error('[退出群] 错误:', err);
        res.status(500).json({ success: false, message: '退出失败，请稍后重试' });
    }
});

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
        res.status(500).json({ success: false, message: '操作失败，请稍后重试' });
    }
});

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
            cleanupUserGroupRooms(targetUserId, groupId);
            const sockets = getUserSockets(targetUserId);
            for (const socket of sockets) {
                socket.emit('system message', '您已被踢出群聊');
            }
            io.to(`group:${groupId}`).emit('system message', `用户 ${targetUserId} 已被踢出群聊`);
        }

        res.json({ success: true, message: '已踢出' });
    } catch (err) {
        console.error('[踢出成员] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败，请稍后重试' });
    }
});

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
                cleanupUserGroupRooms(m.userId, groupId);
                const sockets = getUserSockets(m.userId);
                for (const socket of sockets) {
                    socket.emit('system message', '您所在的群已被解散');
                }
            }
            io.to(`group:${groupId}`).emit('group_disbanded', { groupId });
        }

        const results = deleteGroupTransaction(groupId);

        logToFile(`[解散群] 用户 ${userId} 解散群 ${groupId}，删除数据: ${JSON.stringify(results)}`);
        res.json({ success: true, message: '群已解散' });
    } catch (err) {
        console.error('[解散群] 错误:', err);
        res.status(500).json({ success: false, message: '解散失败，请稍后重试' });
    }
});

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
            if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > config.MAX_GROUP_NAME_LENGTH) {
                return res.status(400).json({ 
                    success: false, 
                    message: `群名称长度应为1-${config.MAX_GROUP_NAME_LENGTH}个字符` 
                });
            }
            updates.push('name = ?');
            params.push(name.trim());
        }

        if (description !== undefined) {
            updates.push('description = ?');
            params.push(typeof description === 'string' ? description.trim().slice(0, config.MAX_GROUP_DESC_LENGTH) : '');
        }

        if (avatar !== undefined) {
            updates.push('avatar = ?');
            params.push(avatar || null);
        }

        if (joinApproval !== undefined) {
            if (typeof joinApproval !== 'boolean' && typeof joinApproval !== 'number') {
                return res.status(400).json({ success: false, message: 'joinApproval 必须是布尔值' });
            }
            updates.push('join_approval = ?');
            params.push(joinApproval ? 1 : 0);
        }

        if (allowJoin !== undefined) {
            if (typeof allowJoin !== 'boolean' && typeof allowJoin !== 'number') {
                return res.status(400).json({ success: false, message: 'allowJoin 必须是布尔值' });
            }
            updates.push('allow_join = ?');
            params.push(allowJoin ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: '没有需要更新的字段' });
        }

        for (const update of updates) {
            const field = validateUpdateField(update);
            if (!field) {
                return res.status(400).json({ success: false, message: '无效的更新字段格式' });
            }
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
        res.status(500).json({ success: false, message: '操作失败，请稍后重试' });
    }
});

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
            .run(groupId, targetUserId, (reason || '').slice(0, config.MAX_REASON_LENGTH));

        if (isUserInGroup(groupId, targetUserId)) {
            db.prepare('DELETE FROM group_members WHERE groupId = ? AND userId = ?').run(groupId, targetUserId);

            const io = getIO();
            if (io) {
                cleanupUserGroupRooms(targetUserId, groupId);
                const sockets = getUserSockets(targetUserId);
                for (const socket of sockets) {
                    socket.emit('system message', '您已被群主拉黑并移出群聊');
                }
                io.to(`group:${groupId}`).emit('system message', `用户 ${targetUserId} 已被加入黑名单并移出群聊`);
            }
        }

        logToFile(`[群黑名单] 用户 ${userId} 将 ${targetUserId} 加入群 ${groupId} 黑名单`);
        res.json({ success: true, message: '已加入黑名单' });
    } catch (err) {
        console.error('[添加黑名单] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败，请稍后重试' });
    }
});

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
        res.status(500).json({ success: false, message: '操作失败，请稍后重试' });
    }
});

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

            const inviteReason = `邀请人: ${req.user?.username || userId}`.slice(0, config.MAX_REASON_LENGTH);
            
            try {
                const result = db.prepare(`
                    INSERT OR IGNORE INTO group_join_requests (group_id, user_id, reason, status) 
                    VALUES (?, ?, ?, 'pending')
                `).run(groupId, targetUserId, inviteReason);
                
                if (result.changes === 0) {
                    return res.status(400).json({ success: false, message: '邀请失败，请稍后重试' });
                }
            } catch (err) {
                return res.status(400).json({ success: false, message: '邀请失败，请稍后重试' });
            }

            const io = getIO();
            if (io) {
                const admins = db.prepare('SELECT userId FROM group_members WHERE groupId = ? AND role IN ("owner", "admin")').all(groupId);
                for (const admin of admins) {
                    const sockets = getUserSockets(admin.userId);
                    for (const socket of sockets) {
                        socket.emit('new_group_join_request', {
                            groupId: groupId,
                            groupName: group.name,
                            userId: targetUserId,
                            username: req.user?.username || '用户',
                            reason: inviteReason
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
                const sockets = getUserSockets(targetUserId);
                for (const socket of sockets) {
                    socket.join(`group:${groupId}`);
                    socket.emit('system message', `您被 ${req.user?.username || '用户'} 邀请加入了群聊`);
                }
                io.to(`group:${groupId}`).emit('system message', `用户 ${targetUserId} 被 ${req.user?.username || '用户'} 邀请加入了群聊`);
            }

            logToFile(`[群邀请] 用户 ${userId} 邀请 ${targetUserId} 加入群 ${groupId}`);
            res.json({ success: true, message: '邀请成功，用户已加入群' });
        }
    } catch (err) {
        console.error('[邀请用户] 错误:', err);
        res.status(500).json({ success: false, message: '操作失败，请稍后重试' });
    }
});

router.get('/api/groups/:id/messages', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const { limit = config.DEFAULT_MESSAGES_LIMIT, before } = req.query;
    const userId = req.userId;

    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }

    try {
        if (!isUserInGroup(groupId, userId)) {
            return res.status(403).json({ success: false, message: '不在群中' });
        }

        const messages = getGroupMessages(groupId, limit, before);
        res.json({ success: true, messages });
    } catch (err) {
        console.error('[获取群消息] 错误:', err);
        if (err.message.includes('before参数必须是数字')) {
            return res.status(400).json({ success: false, message: 'before参数必须是数字' });
        }
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

router.post('/api/groups/:id/transfer', isLoggedIn, (req, res) => {
    const groupId = Number(req.params.id);
    const userId = req.userId;
    const { newOwnerId } = req.body;

    if (!groupId || isNaN(groupId)) {
        return res.status(400).json({ success: false, message: '无效的群ID' });
    }
    if (!newOwnerId || typeof newOwnerId !== 'number') {
        return res.status(400).json({ success: false, message: '无效的新群主ID' });
    }

    try {
        if (!isGroupOwner(groupId, userId)) {
            return res.status(403).json({ success: false, message: '只有群主可以转让群' });
        }

        if (!isUserInGroup(groupId, newOwnerId)) {
            return res.status(400).json({ success: false, message: '新群主必须在群中' });
        }

        if (userId === newOwnerId) {
            return res.status(400).json({ success: false, message: '不能转让给自己' });
        }

        if (isUserBanned(groupId, newOwnerId)) {
            return res.status(400).json({ success: false, message: '目标用户已被拉黑' });
        }

        const transferTransaction = db.transaction((groupId, userId, newOwnerId) => {
            db.prepare('UPDATE chat_groups SET ownerId = ? WHERE id = ?').run(newOwnerId, groupId);
            db.prepare('UPDATE group_members SET role = ? WHERE groupId = ? AND userId = ?').run('admin', groupId, userId);
            db.prepare('UPDATE group_members SET role = ? WHERE groupId = ? AND userId = ?').run('owner', groupId, newOwnerId);
        });

        transferTransaction(groupId, userId, newOwnerId);

        const io = getIO();
        if (io) {
            io.to(`group:${groupId}`).emit('group_transferred', {
                groupId,
                oldOwnerId: userId,
                newOwnerId: newOwnerId
            });
            io.to(`group:${groupId}`).emit('system message', `群主已转让给用户 ${newOwnerId}`);
        }

        logToFile(`[转让群主] 用户 ${userId} 将群 ${groupId} 转让给 ${newOwnerId}`);
        res.json({ success: true, message: '群主已转让' });
    } catch (err) {
        console.error('[转让群主] 错误:', err);
        res.status(500).json({ success: false, message: '转让失败，请稍后重试' });
    }
});

// ========== 数据库索引（异步初始化） ==========
function ensureIndexes() {
    try {
        const indexes = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='index' AND name IN (
                'idx_group_members_group_user',
                'idx_messages_group_id',
                'idx_group_join_requests_group_user_status',
                'idx_group_ban_list_group_user'
            )
        `).all();
        
        const existingIndexes = new Set(indexes.map(i => i.name));
        const requiredIndexes = [
            'idx_group_members_group_user',
            'idx_messages_group_id',
            'idx_group_join_requests_group_user_status',
            'idx_group_ban_list_group_user'
        ];
        
        for (const idx of requiredIndexes) {
            if (!existingIndexes.has(idx)) {
                const sql = getIndexSQL(idx);
                if (sql) {
                    db.exec(sql);
                }
            }
        }
        console.log('✅ 群聊索引已确保');
    } catch (err) {
        console.error('❌ 创建群聊索引失败:', err);
    }
}

function getIndexSQL(indexName) {
    const indexMap = {
        'idx_group_members_group_user': 'CREATE INDEX idx_group_members_group_user ON group_members(groupId, userId)',
        'idx_messages_group_id': 'CREATE INDEX idx_messages_group_id ON messages(groupId, id)',
        'idx_group_join_requests_group_user_status': 'CREATE INDEX idx_group_join_requests_group_user_status ON group_join_requests(group_id, user_id, status)',
        'idx_group_ban_list_group_user': 'CREATE INDEX idx_group_ban_list_group_user ON group_ban_list(group_id, user_id)'
    };
    return indexMap[indexName] || null;
}

// ========== 异步等待数据库就绪后执行索引初始化 ==========
(async function initIndexes() {
    try {
        await db._waitReady();
        ensureIndexes();
    } catch (err) {
        console.error('❌ 创建群聊索引失败:', err);
    }
})();

module.exports = router;