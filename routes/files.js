// routes/files.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { PassThrough } = require('stream');
const db = require('../db/connection');
const { storage, fileFilter } = require('../config/multer');
const { FILE_SIZE_LIMITS, DEFAULT_CAPACITY } = require('../config');
const { logToFile } = require('../utils/logger');
const { isLoggedIn } = require('../middleware/auth');
const { checkFilesUploadBan, checkFilesDownloadBan } = require('../middleware/banCheck');
const { checkFileAccess, getUserRootId, isUnderUserRoot } = require('../middleware/fileAccess');
const { safePath } = require('../utils/safePath');
const { validateFileType } = require('../utils/fileValidator');

const UPLOAD_BASE = path.join(__dirname, '../uploads');

// ---------- 全局容量辅助函数 ----------
function getGlobalUsedBytes() {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get('total_upload_bytes');
    return row ? parseInt(row.value) : 0;
}

function updateGlobalUsedBytesAtomically(delta) {
    const deltaInt = parseInt(delta);
    const stmt = db.prepare(`UPDATE system_config SET value = CAST(value AS INTEGER) + ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?`);
    stmt.run(deltaInt, 'total_upload_bytes');
    return getGlobalUsedBytes();
}

// 修复 #72：DEFAULT_CAPACITY.global 为 0 时不再错误回退到 10GB
function getGlobalMaxBytes() {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get('max_global_upload_bytes');
    if (row) {
        const val = parseInt(row.value);
        if (!isNaN(val)) return val;
    }
    const fallback = (DEFAULT_CAPACITY.global !== undefined && DEFAULT_CAPACITY.global > 0)
        ? DEFAULT_CAPACITY.global
        : 10 * 1024 * 1024 * 1024;
    return fallback;
}

// 修复 #20：单文件大小限制从 system_config 读取（管理员后台可调整）
function getMaxFileSizeBytes() {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get('max_file_size_bytes');
    if (row) {
        const val = parseInt(row.value);
        if (!isNaN(val) && val > 0) return val;
    }
    return 50 * 1024 * 1024;
}

// ---------- 用户容量辅助函数 ----------
// 修复 #21：递归统计用户根目录下所有子文件夹中的文件，避免只统计一级目录
function getUserUsedBytes(userId) {
    const userRootId = getUserRootId(userId);
    const allIds = [userRootId];
    const queue = [userRootId];
    const visited = new Set();
    while (queue.length > 0) {
        const cur = queue.shift();
        if (visited.has(cur)) continue;
        visited.add(cur);
        const childFolders = db.prepare('SELECT id FROM file_nodes WHERE parentId = ? AND isFolder = 1').all(cur);
        for (const c of childFolders) {
            if (!visited.has(c.id)) {
                allIds.push(c.id);
                queue.push(c.id);
            }
        }
    }
    const placeholders = allIds.map(() => '?').join(',');
    const row = db.prepare(`SELECT COALESCE(SUM(fileSize), 0) as total FROM file_nodes WHERE parentId IN (${placeholders}) AND isFolder = 0`).get(...allIds);
    return row.total || 0;
}

// 修复：递归收集文件夹的所有后代文件夹 ID（不含自身），用于深度删除
function getAllDescendantFolderIds(folderId) {
    const allIds = [];
    const queue = [folderId];
    const visited = new Set();
    while (queue.length > 0) {
        const cur = queue.shift();
        if (visited.has(cur)) continue;
        visited.add(cur);
        const childFolders = db.prepare('SELECT id FROM file_nodes WHERE parentId = ? AND isFolder = 1').all(cur);
        for (const c of childFolders) {
            if (!visited.has(c.id)) {
                allIds.push(c.id);
                queue.push(c.id);
            }
        }
    }
    return allIds;
}

// 修复：删除文件夹树（含所有深度的子文件与子文件夹），返回扣减的总容量
async function deleteFolderTree(folderId) {
    let deletedSize = 0;
    const allFolderIds = getAllDescendantFolderIds(folderId);
    // 对当前文件夹及其所有后代文件夹：删除直属文件（物理 + 记录）并累计容量
    for (const fid of [folderId, ...allFolderIds]) {
        const files = db.prepare('SELECT * FROM file_nodes WHERE parentId = ? AND isFolder = 0').all(fid);
        for (const f of files) {
            if (!f.fileUrl) continue;
            const uploader = db.prepare('SELECT role FROM users WHERE userId = ?').get(f.uploaderId);
            if (uploader && uploader.role === 'user') deletedSize += f.fileSize || 0;
            try {
                const safeFilePath = safePath(UPLOAD_BASE, f.fileUrl);
                if (safeFilePath) await fs.unlink(safeFilePath);
            } catch (e) { /* 文件不存在或路径非法不影响删除流程 */ }
        }
        db.prepare('DELETE FROM file_nodes WHERE parentId = ? AND isFolder = 0').run(fid);
    }
    // 删除所有后代文件夹记录（当前文件夹由调用方删除）
    if (allFolderIds.length > 0) {
        const placeholders = allFolderIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM file_nodes WHERE id IN (${placeholders})`).run(...allFolderIds);
    }
    return deletedSize;
}

function getUserMaxBytes(userId) {
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    if (user && user.role === 'admin') {
        return Infinity;
    }
    const customRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('user_capacity_' + userId);
    if (customRow) {
        const customBytes = parseInt(customRow.value);
        if (customBytes > 0) {
            return customBytes;
        }
    }
    const defaultRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('user_default_capacity_bytes');
    const defaultBytes = defaultRow ? parseInt(defaultRow.value) : (DEFAULT_CAPACITY.user || 100 * 1024 * 1024);
    return defaultBytes;
}

// ---------- 修复 #8: 带锁的容量检查 ----------
let capacityLock = Promise.resolve();

// 修复 #17：容量锁在失败后能够恢复，不会永久失效
class CapacityError extends Error {}

function withCapacityLock(fn) {
    const result = capacityLock.then(() => fn());
    // 无论成功失败，链上始终接一个已恢复的 Promise，避免后续任务被 rejected 阻塞
    capacityLock = result.catch((err) => {
        console.error('[容量锁] 执行失败:', err.message || err);
    });
    return result;
}

// ---------- 获取存储信息 ----------
router.get('/api/user/storage', isLoggedIn, async (req, res) => {
    try {
        const userId = req.userId;
        const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
        if (user && user.role === 'admin') {
            const globalUsed = getGlobalUsedBytes();
            const globalMax = getGlobalMaxBytes();
            return res.json({
                success: true,
                unlimited: true,
                globalUsed,
                globalMax,
                globalUsedGB: (globalUsed / 1024 / 1024 / 1024).toFixed(2),
                globalMaxGB: (globalMax / 1024 / 1024 / 1024).toFixed(0)
            });
        }
        const personalUsed = getUserUsedBytes(userId);
        const personalMax = getUserMaxBytes(userId);
        const globalUsed = getGlobalUsedBytes();
        const globalMax = getGlobalMaxBytes();
        res.json({
            success: true,
            personalUsed,
            personalMax,
            personalUsedMB: (personalUsed / 1024 / 1024).toFixed(2),
            personalMaxMB: (personalMax / 1024 / 1024).toFixed(0),
            globalUsed,
            globalMax,
            globalUsedGB: (globalUsed / 1024 / 1024 / 1024).toFixed(2),
            globalMaxGB: (globalMax / 1024 / 1024 / 1024).toFixed(0)
        });
    } catch (err) {
        console.error('/api/user/storage error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 获取文件列表
router.get('/api/file/list', isLoggedIn, checkFileAccess, (req, res) => {
    const { parentId } = req.query;
    let targetParentId = parseInt(parentId) || 0;
    const isAdmin = req.isAdmin;
    const userRootId = req.userRootId;
    try {
        const items = db.prepare(`
            SELECT f.*
            FROM file_nodes f
            WHERE f.parentId = ?
            ORDER BY f.isFolder DESC, f.name ASC
        `).all(targetParentId);
        for (let item of items) {
            if (isAdmin) item.canWrite = true;
            else {
                if (item.isFolder) item.canWrite = (item.id === userRootId) || isUnderUserRoot(item.id, userRootId);
                else item.canWrite = (item.parentId === userRootId) || isUnderUserRoot(item.parentId, userRootId);
            }
        }
        res.json({ success: true, items });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 获取星标文件
router.get('/api/file/starred', isLoggedIn, checkFileAccess, (req, res) => {
    const userId = req.userId;
    try {
        // 修复 #70：管理员可查看所有用户的星标文件，普通用户只看自己的
        let items;
        if (req.isAdmin) {
            items = db.prepare(`
                SELECT f.*, u.username as uploaderName2
                FROM file_nodes f
                LEFT JOIN users u ON f.uploaderId = u.userId
                WHERE f.starred = 1
                ORDER BY f.updatedAt DESC
            `).all();
        } else {
            items = db.prepare(`
                SELECT f.*
                FROM file_nodes f
                WHERE f.starred = 1 AND f.uploaderId = ?
                ORDER BY f.updatedAt DESC
            `).all(userId);
        }
        for (let item of items) item.canWrite = true;
        res.json({ success: true, items });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 获取文件/文件夹信息
router.get('/api/file/info/:id', isLoggedIn, checkFileAccess, (req, res) => {
    const id = req.params.id;
    try {
        const item = db.prepare('SELECT id, name, parentId, isFolder FROM file_nodes WHERE id = ?').get(Number(id));
        if (!item) return res.status(404).json({ success: false, message: '文件不存在' });
        let canWrite = false;
        if (req.isAdmin) canWrite = true;
        else {
            if (item.isFolder) canWrite = (item.id === req.userRootId) || isUnderUserRoot(item.id, req.userRootId);
            else canWrite = (item.parentId === req.userRootId) || isUnderUserRoot(item.parentId, req.userRootId);
        }
        item.canWrite = canWrite;
        res.json({ success: true, item });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ========== 创建文件夹（修复 N7: 允许用户在自己的根目录下创建文件夹） ==========
router.post('/api/file/folder', isLoggedIn, checkFilesUploadBan, checkFileAccess, (req, res) => {
    const { name, parentId } = req.body;
    const userId = req.userId;
    if (!name) return res.status(400).json({ success: false, message: '文件夹名称不能为空' });
    
    let targetParentId = parseInt(parentId) || 0;
    const userRootId = req.userRootId;
    const isAdmin = req.isAdmin;

    try {
        // 检查权限：管理员可以创建在任何位置，普通用户只能在自己的根目录下创建
        if (!isAdmin) {
            if (targetParentId !== userRootId && !isUnderUserRoot(targetParentId, userRootId)) {
                return res.status(403).json({ success: false, message: '无权限在此位置创建文件夹' });
            }
            // 普通用户只能创建一级文件夹（在根目录下）
            if (targetParentId !== userRootId) {
                return res.status(403).json({ success: false, message: '普通用户只能在根目录下创建文件夹' });
            }
        }

        const existing = db.prepare('SELECT * FROM file_nodes WHERE parentId = ? AND name = ?').get(targetParentId, name);
        if (existing) return res.status(400).json({ success: false, message: '同名文件夹已存在' });
        
        // 修复 #18：使用查询到的真实用户名
        const creator = db.prepare('SELECT username FROM users WHERE userId = ?').get(userId);
        db.prepare('INSERT INTO file_nodes (name, parentId, isFolder, uploaderId, uploaderName, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
            .run(name, targetParentId, 1, userId, creator ? creator.username : 'user');
        
        logToFile(`[网盘] 用户 ${userId} 创建文件夹: ${name} (parentId: ${targetParentId})`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ========== 上传文件（修复 #8: 带锁的容量检查） ==========
router.post('/api/file/upload', isLoggedIn, checkFilesUploadBan, checkFileAccess, (req, res, next) => {
    const userId = req.userId;
    const isAdmin = req.isAdmin;
    // 修复 #20：单文件大小限制从数据库配置读取，管理员后台修改实时生效
    const limit = isAdmin ? FILE_SIZE_LIMITS.admin : getMaxFileSizeBytes();
    const uploadSingle = multer({ storage, fileFilter, limits: { fileSize: limit } }).single('file');
    uploadSingle(req, res, (err) => {
        if (err) {
            if (err.code === 'FILE_TOO_LARGE') {
                return res.status(413).json({ success: false, message: `文件过大，${isAdmin ? '管理员最大1GB' : `最大${Math.floor(limit / 1024 / 1024)}MB`}` });
            }
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: '未上传文件' });
    
    const validation = validateFileType(req.file.path, req.file.mimetype);
    if (!validation.valid) {
        try { fsSync.unlinkSync(req.file.path); } catch(e) {}
        return res.status(400).json({ success: false, message: '文件类型验证失败：' + validation.reason });
    }
    
    const userId = req.userId;
    const isAdmin = req.isAdmin;
    const user = db.prepare('SELECT username, role FROM users WHERE userId = ?').get(userId);
    let { parentId } = req.body;
    let targetParentId = parseInt(parentId) || 0;

    // 检查目录权限（非管理员）
    if (!isAdmin) {
        const userRootId = req.userRootId;
        if (targetParentId !== userRootId && !isUnderUserRoot(targetParentId, userRootId)) {
            try { fsSync.unlinkSync(req.file.path); } catch(e) {}
            return res.status(403).json({ success: false, message: '无权限上传到此目录' });
        }
    }

    // ========== 修复 #8: 使用锁进行容量检查 ==========
    try {
        await withCapacityLock(async () => {
            if (!isAdmin) {
                // 检查个人容量
                const personalUsed = getUserUsedBytes(userId);
                const personalMax = getUserMaxBytes(userId);
                if (personalUsed + req.file.size > personalMax) {
                    throw new CapacityError(`个人网盘容量已达上限 ${(personalMax / 1024 / 1024).toFixed(0)}MB，无法上传`);
                }
                // 检查全局容量
                const globalUsed = getGlobalUsedBytes();
                const globalMax = getGlobalMaxBytes();
                if (globalUsed + req.file.size > globalMax) {
                    throw new CapacityError('普通用户上传总容量已达上限，无法继续上传');
                }
            }

            const fileUrl = `/uploads/public_files/${req.file.filename}`;
            // 修复 #18：使用查询到的真实用户名，而不是 req.user?.username
            db.prepare(`INSERT INTO file_nodes (name, parentId, isFolder, fileUrl, fileType, fileSize, originalName, uploaderId, uploaderName, createdAt, updatedAt)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(
                req.file.originalname, targetParentId, 0, fileUrl, req.file.mimetype, req.file.size, req.file.originalname, userId, user.username);

            db.prepare(`INSERT INTO user_traffic (user_id, type, bytes, path) VALUES (?, 'upload', ?, ?)`).run(userId, req.file.size, req.file.originalname);

            if (!isAdmin) {
                updateGlobalUsedBytesAtomically(req.file.size);
            }

            logToFile(`[网盘上传] 用户 ${user.username} 上传文件: ${req.file.originalname} (${req.file.size} bytes)`);
        });
        
        res.json({ success: true });
    } catch (err) {
        // 上传失败，删除已上传的文件
        try { fsSync.unlinkSync(req.file.path); } catch(e) {}
        // 修复 #71：使用自定义错误类型判断容量错误，避免误判其他错误
        if (err instanceof CapacityError) {
            return res.status(413).json({ success: false, message: err.message });
        }
        console.error(err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 重命名文件/文件夹
router.put('/api/file/rename/:id', isLoggedIn, checkFilesUploadBan, checkFileAccess, (req, res) => {
    const { newName } = req.body;
    const id = req.params.id;
    if (!newName) return res.status(400).json({ success: false, message: '新名称不能为空' });
    try {
        const item = db.prepare('SELECT * FROM file_nodes WHERE id = ?').get(Number(id));
        if (!item) return res.status(404).json({ success: false, message: '文件不存在' });
        if (!req.isAdmin) {
            let canWrite = false;
            if (item.isFolder) canWrite = (item.id === req.userRootId) || isUnderUserRoot(item.id, req.userRootId);
            else canWrite = (item.parentId === req.userRootId) || isUnderUserRoot(item.parentId, req.userRootId);
            if (!canWrite) return res.status(403).json({ success: false, message: '无权限修改' });
        }
        const existing = db.prepare('SELECT * FROM file_nodes WHERE parentId = ? AND name = ? AND id != ?').get(item.parentId, newName, Number(id));
        if (existing) return res.status(400).json({ success: false, message: '同名文件已存在' });
        db.prepare('UPDATE file_nodes SET name = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(newName, Number(id));
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 删除文件/文件夹
router.delete('/api/file/:id', isLoggedIn, checkFilesUploadBan, checkFileAccess, async (req, res) => {
    const id = req.params.id;
    try {
        const item = db.prepare('SELECT * FROM file_nodes WHERE id = ?').get(Number(id));
        if (!item) return res.status(404).json({ success: false, message: '文件不存在' });
        if (!req.isAdmin) {
            let canWrite = false;
            if (item.isFolder) canWrite = (item.id === req.userRootId) || isUnderUserRoot(item.id, req.userRootId);
            else canWrite = (item.parentId === req.userRootId) || isUnderUserRoot(item.parentId, req.userRootId);
            if (!canWrite) return res.status(403).json({ success: false, message: '无权限删除' });
        }

        let deletedSize = 0;
        if (!item.isFolder && item.fileUrl) {
            const uploader = db.prepare('SELECT role FROM users WHERE userId = ?').get(item.uploaderId);
            if (uploader && uploader.role === 'user') {
                deletedSize = item.fileSize || 0;
            }
            try {
                const safeFilePath = safePath(UPLOAD_BASE, item.fileUrl);
                if (safeFilePath) await fs.unlink(safeFilePath);
            } catch (e) {}
        }

        // 修复：文件夹删除支持任意深度（递归删除所有子文件/子文件夹并扣减容量）
        if (item.isFolder) {
            deletedSize += await deleteFolderTree(Number(id));
        }

        db.prepare('DELETE FROM file_nodes WHERE id = ?').run(Number(id));

        if (deletedSize > 0) {
            updateGlobalUsedBytesAtomically(-deletedSize);
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 下载/预览文件
router.get('/api/file/download/:id', isLoggedIn, checkFilesDownloadBan, checkFileAccess, async (req, res) => {
    const id = req.params.id;
    const isPreview = req.query.preview === 'true';
    try {
        const item = db.prepare('SELECT * FROM file_nodes WHERE id = ? AND isFolder = 0').get(Number(id));
        if (!item) return res.status(404).json({ success: false, message: '文件不存在' });

        db.prepare('UPDATE file_nodes SET downloadCount = downloadCount + 1 WHERE id = ?').run(Number(id));
        const safeFilePath = safePath(UPLOAD_BASE, item.fileUrl);
        await fs.access(safeFilePath);
        const user = db.prepare('SELECT username FROM users WHERE userId = ?').get(req.userId);

        const disposition = isPreview ? 'inline' : 'attachment';
        let contentType = item.fileType || 'application/octet-stream';
        if (contentType.startsWith('text/') || item.name.match(/\.(txt|md|js|css|html|json|xml)$/i)) {
            contentType = 'text/plain; charset=utf-8';
        }
        res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(item.originalName)}`);
        res.setHeader('Content-Type', contentType);

        const readStream = fsSync.createReadStream(safeFilePath);
        const passThrough = new PassThrough();
        let bytesTransferred = 0, recorded = false;
        passThrough.on('data', (chunk) => { bytesTransferred += chunk.length; });
        const finishRecord = () => {
            if (recorded) return;
            recorded = true;
            db.prepare(`INSERT INTO user_traffic (user_id, type, bytes, path) VALUES (?, 'download', ?, ?)`).run(req.userId, bytesTransferred, item.fileUrl);
            logToFile(`[网盘下载] 用户 ${user.username} ${isPreview ? '预览' : '下载'}文件: ${item.name} (ID: ${id})，实际传输 ${bytesTransferred} / ${item.fileSize} bytes`);
        };
        passThrough.on('finish', finishRecord);
        passThrough.on('error', finishRecord);
        res.on('finish', finishRecord);
        res.on('close', finishRecord);
        readStream.pipe(passThrough).pipe(res);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '文件不存在或服务器错误' });
    }
});

// 星标/取消星标
router.post('/api/file/star/:id', isLoggedIn, checkFilesUploadBan, checkFileAccess, (req, res) => {
    const id = req.params.id;
    const { starred } = req.body;
    try {
        // 修复：星标操作前检查文件归属（管理员可操作任意文件，普通用户仅限自己文件树内）
        const item = db.prepare('SELECT * FROM file_nodes WHERE id = ?').get(Number(id));
        if (!item) return res.status(404).json({ success: false, message: '文件不存在' });
        if (!req.isAdmin) {
            let canAccess = false;
            if (item.isFolder) canAccess = (item.id === req.userRootId) || isUnderUserRoot(item.id, req.userRootId);
            else canAccess = (item.parentId === req.userRootId) || isUnderUserRoot(item.parentId, req.userRootId);
            if (!canAccess) return res.status(403).json({ success: false, message: '无权限操作该文件' });
        }
        db.prepare('UPDATE file_nodes SET starred = ? WHERE id = ?').run(starred ? 1 : 0, Number(id));
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 批量删除
router.post('/api/file/batch-delete', isLoggedIn, checkFilesUploadBan, checkFileAccess, async (req, res) => {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ success: false });
    try {
        let totalDeletedSize = 0;
        for (const id of ids) {
            const item = db.prepare('SELECT * FROM file_nodes WHERE id = ?').get(Number(id));
            if (!item) continue;
            if (!req.isAdmin) {
                let canWrite = false;
                if (item.isFolder) canWrite = (item.id === req.userRootId) || isUnderUserRoot(item.id, req.userRootId);
                else canWrite = (item.parentId === req.userRootId) || isUnderUserRoot(item.parentId, req.userRootId);
                if (!canWrite) return res.status(403).json({ success: false, message: '无权限删除某些文件' });
            }

            if (!item.isFolder && item.fileUrl) {
                const uploader = db.prepare('SELECT role FROM users WHERE userId = ?').get(item.uploaderId);
                if (uploader && uploader.role === 'user') {
                    totalDeletedSize += item.fileSize || 0;
                }
                try {
                    const safeFilePath = safePath(UPLOAD_BASE, item.fileUrl);
                    if (safeFilePath) await fs.unlink(safeFilePath);
                } catch (e) {}
            }

            // 修复：批量删除文件夹时同样递归删除任意深度的子内容
            if (item.isFolder) {
                totalDeletedSize += await deleteFolderTree(Number(id));
            }
            db.prepare('DELETE FROM file_nodes WHERE id = ?').run(Number(id));
        }

        if (totalDeletedSize > 0) {
            updateGlobalUsedBytesAtomically(-totalDeletedSize);
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 批量移动
router.post('/api/file/batch-move', isLoggedIn, checkFilesUploadBan, checkFileAccess, (req, res) => {
    const { ids, targetParentId } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ success: false });
    // 修复：目标目录参数规范化
    const targetId = parseInt(targetParentId);
    if (isNaN(targetId) || targetId < 0) return res.status(400).json({ success: false, message: '目标目录无效' });
    try {
        for (const id of ids) {
            const item = db.prepare('SELECT * FROM file_nodes WHERE id = ?').get(Number(id));
            if (!item) continue;
            if (!req.isAdmin) {
                let canWrite = false;
                if (item.isFolder) canWrite = (item.id === req.userRootId) || isUnderUserRoot(item.id, req.userRootId);
                else canWrite = (item.parentId === req.userRootId) || isUnderUserRoot(item.parentId, req.userRootId);
                if (!canWrite) return res.status(403).json({ success: false, message: '无权限移动某些文件' });
            }
            if (!req.isAdmin && targetId !== req.userRootId && !isUnderUserRoot(targetId, req.userRootId)) {
                return res.status(403).json({ success: false, message: '目标目录无权限' });
            }
            db.prepare('UPDATE file_nodes SET parentId = ? WHERE id = ?').run(targetId, Number(id));
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

module.exports = router;