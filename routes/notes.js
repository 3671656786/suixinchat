// routes/notes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { PassThrough } = require('stream');
const notesDb = require('../db/notesConnection');
const mainDb = require('../db/connection');
const { storage, fileFilter } = require('../config/multer');
const { logToFile } = require('../utils/logger');
const { isLoggedIn } = require('../middleware/auth');
const { checkNotesBan } = require('../middleware/banCheck');
const { validateFileType } = require('../utils/fileValidator');

// ========== 辅助函数：循环获取所有子文件夹ID（避免递归堆栈溢出） ==========
function getAllSubFolderIds(parentId) {
    const allIds = [];
    const queue = [parentId];
    while (queue.length > 0) {
        const currentId = queue.shift();
        const children = notesDb.prepare('SELECT id FROM note_folders WHERE parentId = ?').all(currentId);
        for (const child of children) {
            allIds.push(child.id);
            queue.push(child.id);
        }
    }
    return allIds;
}

// ========== 修复：验证文件路径安全性（移除前导斜杠，防止路径解析错误） ==========
function isPathSafe(fileUrl) {
    if (!fileUrl || typeof fileUrl !== 'string') return false;
    try {
        // 去除前导斜杠，确保是相对路径（兼容 Windows/Linux/macOS）
        let relative = fileUrl.replace(/^\/+/, '').replace(/\\/g, '/');
        // 防止路径遍历攻击
        const normalized = path.normalize(relative);
        if (normalized.startsWith('..') || normalized.includes('../')) {
            return false;
        }
        const fullPath = path.resolve(__dirname, '../', normalized);
        const uploadsDir = path.resolve(__dirname, '../uploads/notes_files');
        return fullPath.startsWith(uploadsDir);
    } catch (err) {
        return false;
    }
}

// ========== 辅助函数：验证 ID 是否有效 ==========
function isValidId(id) {
    return id !== undefined && id !== null && !isNaN(parseInt(id)) && parseInt(id) > 0;
}

// ========== 笔记文件夹管理 ==========

router.get('/api/note-folders', isLoggedIn, checkNotesBan, (req, res) => {
    try {
        const folders = notesDb.prepare('SELECT * FROM note_folders ORDER BY parentId, name').all();
        res.json({ success: true, folders });
    } catch (err) {
        console.error('获取文件夹失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/api/note-folders', isLoggedIn, checkNotesBan, (req, res) => {
    const userId = req.userId;
    const user = mainDb.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '仅管理员可创建文件夹' });
    }
    const { name, parentId = 0 } = req.body;
    if (!name || name.trim().length === 0) {
        return res.status(400).json({ success: false, message: '文件夹名称不能为空' });
    }
    if (name.length > 50) {
        return res.status(400).json({ success: false, message: '名称不能超过50个字符' });
    }
    // 验证父文件夹是否存在（如果 parentId !== 0）
    if (parentId !== 0) {
        const parentFolder = notesDb.prepare('SELECT id FROM note_folders WHERE id = ?').get(parentId);
        if (!parentFolder) {
            return res.status(400).json({ success: false, message: '父文件夹不存在' });
        }
    }
    try {
        const existing = notesDb.prepare('SELECT id FROM note_folders WHERE parentId = ? AND name = ?').get(parentId, name.trim());
        if (existing) {
            return res.status(400).json({ success: false, message: '该位置已存在同名文件夹' });
        }
        const result = notesDb.prepare('INSERT INTO note_folders (name, parentId, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, datetime("now"), datetime("now"))').run(name.trim(), parentId, userId);
        const folder = notesDb.prepare('SELECT * FROM note_folders WHERE id = ?').get(result.lastInsertRowid);
        logToFile(`[笔记] 用户 ${userId} 创建文件夹: ${name}`);
        res.json({ success: true, folder });
    } catch (err) {
        console.error('创建文件夹失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/api/note-folders/:id', isLoggedIn, checkNotesBan, (req, res) => {
    const userId = req.userId;
    const user = mainDb.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '仅管理员可操作' });
    }
    const folderId = parseInt(req.params.id);
    if (!isValidId(folderId)) {
        return res.status(400).json({ success: false, message: '无效的文件夹ID' });
    }
    const { name } = req.body;
    if (!name || name.trim().length === 0) {
        return res.status(400).json({ success: false, message: '文件夹名称不能为空' });
    }
    try {
        const folder = notesDb.prepare('SELECT * FROM note_folders WHERE id = ?').get(folderId);
        if (!folder) {
            return res.status(404).json({ success: false, message: '文件夹不存在' });
        }
        const existing = notesDb.prepare('SELECT id FROM note_folders WHERE parentId = ? AND name = ? AND id != ?')
            .get(folder.parentId, name.trim(), folderId);
        if (existing) {
            return res.status(400).json({ success: false, message: '该位置已存在同名文件夹' });
        }
        notesDb.prepare('UPDATE note_folders SET name = ?, updatedAt = datetime("now") WHERE id = ?').run(name.trim(), folderId);
        logToFile(`[笔记] 用户 ${userId} 重命名文件夹 ${folderId} -> ${name}`);
        res.json({ success: true });
    } catch (err) {
        console.error('重命名文件夹失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 删除文件夹（递归 + 事务 + 循环 + 安全异步删除） ==========
router.delete('/api/note-folders/:id', isLoggedIn, checkNotesBan, async (req, res) => {
    const userId = req.userId;
    const user = mainDb.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '仅管理员可操作' });
    }
    const folderId = parseInt(req.params.id);
    if (!isValidId(folderId)) {
        return res.status(400).json({ success: false, message: '无效的文件夹ID' });
    }
    try {
        const folder = notesDb.prepare('SELECT * FROM note_folders WHERE id = ?').get(folderId);
        if (!folder) {
            return res.status(404).json({ success: false, message: '文件夹不存在' });
        }
        if (folderId === 0) {
            return res.status(400).json({ success: false, message: '不能删除根目录' });
        }

        // 获取所有子文件夹ID（循环，避免递归堆栈溢出）
        const allSubIds = getAllSubFolderIds(folderId);
        const allFolderIds = [folderId, ...allSubIds];

        // 收集所有需要删除的笔记ID
        const folderPlaceholders = allFolderIds.map(() => '?').join(',');
        let allNoteIds = [];
        if (allFolderIds.length > 0) {
            const notes = notesDb.prepare(`SELECT id FROM notes WHERE folderId IN (${folderPlaceholders})`).all(...allFolderIds);
            allNoteIds = notes.map(n => n.id);
        }

        // 收集所有需要删除的附件路径
        let allFileUrls = [];
        if (allNoteIds.length > 0) {
            const notePlaceholders = allNoteIds.map(() => '?').join(',');
            const atts = notesDb.prepare(`SELECT fileUrl FROM note_attachments WHERE noteId IN (${notePlaceholders})`).all(...allNoteIds);
            allFileUrls = atts.map(a => a.fileUrl);
        }

        // 开始事务
        notesDb.exec('BEGIN TRANSACTION');

        // 删除附件记录
        if (allNoteIds.length > 0) {
            const notePlaceholders = allNoteIds.map(() => '?').join(',');
            notesDb.prepare(`DELETE FROM note_attachments WHERE noteId IN (${notePlaceholders})`).run(...allNoteIds);
        }
        // 删除笔记
        if (allNoteIds.length > 0) {
            const notePlaceholders = allNoteIds.map(() => '?').join(',');
            notesDb.prepare(`DELETE FROM notes WHERE id IN (${notePlaceholders})`).run(...allNoteIds);
        }
        // 删除文件夹（包括所有子文件夹）
        const fPlaceholders = allFolderIds.map(() => '?').join(',');
        notesDb.prepare(`DELETE FROM note_folders WHERE id IN (${fPlaceholders})`).run(...allFolderIds);

        // 提交事务
        notesDb.exec('COMMIT');

        // 事务成功后，异步删除物理文件（带安全保护）
        if (allFileUrls.length > 0) {
            setImmediate(() => {
                (async () => {
                    try {
                        for (const fileUrl of allFileUrls) {
                            if (!isPathSafe(fileUrl)) {
                                console.warn(`[删除文件夹] 跳过非法路径: ${fileUrl}`);
                                continue;
                            }
                            const filePath = path.join(__dirname, '../', fileUrl.replace(/^\/+/, ''));
                            try {
                                await fs.unlink(filePath);
                            } catch (err) {
                                console.warn(`[删除文件夹] 删除物理文件失败: ${filePath}`, err.message);
                            }
                        }
                    } catch (err) {
                        console.error('[删除文件夹] 异步删除文件过程中发生异常:', err);
                    }
                })();
            });
        }

        logToFile(`[笔记] 用户 ${userId} 删除文件夹 ${folderId}，包含 ${allFolderIds.length} 个文件夹，${allNoteIds.length} 个笔记`);
        res.json({ success: true });
    } catch (err) {
        notesDb.exec('ROLLBACK');
        console.error('删除文件夹失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 移动笔记（使用事务） ==========
router.put('/api/notes/:id/move', isLoggedIn, checkNotesBan, (req, res) => {
    const userId = req.userId;
    const user = mainDb.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '仅管理员可操作' });
    }
    const noteId = parseInt(req.params.id);
    if (!isValidId(noteId)) {
        return res.status(400).json({ success: false, message: '无效的笔记ID' });
    }
    const { folderId = 0 } = req.body;
    if (folderId !== 0 && !isValidId(folderId)) {
        return res.status(400).json({ success: false, message: '无效的文件夹ID' });
    }
    try {
        const note = notesDb.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
        if (!note) {
            return res.status(404).json({ success: false, message: '笔记不存在' });
        }
        if (folderId !== 0) {
            const folder = notesDb.prepare('SELECT id FROM note_folders WHERE id = ?').get(folderId);
            if (!folder) {
                return res.status(404).json({ success: false, message: '目标文件夹不存在' });
            }
        }
        notesDb.exec('BEGIN TRANSACTION');
        notesDb.prepare('UPDATE notes SET folderId = ?, updatedAt = datetime("now") WHERE id = ?').run(folderId, noteId);
        notesDb.exec('COMMIT');
        logToFile(`[笔记] 用户 ${userId} 移动笔记 ${noteId} 到文件夹 ${folderId}`);
        res.json({ success: true });
    } catch (err) {
        notesDb.exec('ROLLBACK');
        console.error('移动笔记失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 笔记 CRUD ==========

// 上传附件
router.post('/api/notes/upload', isLoggedIn, checkNotesBan, (req, res, next) => {
    const user = mainDb.prepare('SELECT role FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false, message: '仅管理员可上传附件' });
    next();
}, multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } }).array('files'), (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, message: '未上传文件' });
    for (const file of req.files) {
        const validation = validateFileType(file.path, file.mimetype);
        if (!validation.valid) {
            for (const f of req.files) {
                try { fsSync.unlinkSync(f.path); } catch(e) {}
            }
            return res.status(400).json({ success: false, message: `文件 "${file.originalname}" 类型验证失败：${validation.reason}` });
        }
    }
    const attachments = req.files.map(file => ({
        fileUrl: `/uploads/notes_files/${file.filename}`,
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size
    }));
    const user = mainDb.prepare('SELECT username FROM users WHERE userId = ?').get(req.userId);
    
    // 批量插入流量记录（使用事务）
    try {
        mainDb.exec('BEGIN TRANSACTION');
        for (const file of req.files) {
            mainDb.prepare(`INSERT INTO user_traffic (user_id, type, bytes, path) VALUES (?, 'upload', ?, ?)`).run(req.userId, file.size, file.originalname);
        }
        mainDb.exec('COMMIT');
    } catch (err) {
        mainDb.exec('ROLLBACK');
        console.error('记录流量失败:', err);
        // 不阻断上传，只记录日志
    }
    
    logToFile(`[云笔记] 管理员 ${user.username} 上传附件 ${attachments.length} 个文件`);
    res.json({ success: true, attachments });
});

// 清理临时附件
router.post('/api/notes/cleanup-temp', isLoggedIn, async (req, res) => {
    const user = mainDb.prepare('SELECT role FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const { fileUrl } = req.body;
    if (!fileUrl) return res.status(400).json({ success: false, message: '缺少文件路径' });
    
    if (!isPathSafe(fileUrl)) {
        return res.status(400).json({ success: false, message: '非法文件路径' });
    }
    
    const filePath = path.join(__dirname, '../', fileUrl.replace(/^\/+/, ''));
    try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        logToFile(`[云笔记] 清理临时附件: ${fileUrl}`);
        res.json({ success: true, message: '文件已删除' });
    } catch (err) {
        if (err.code === 'ENOENT') {
            res.json({ success: true, message: '文件不存在，无需清理' });
        } else {
            console.error(`[云笔记] 清理临时附件失败: ${fileUrl}`, err);
            res.status(500).json({ success: false, message: '删除文件失败' });
        }
    }
});

// ========== GET /api/notes（优化查询 + 分页限制 + 参数验证） ==========
router.get('/api/notes', isLoggedIn, checkNotesBan, (req, res) => {
    const { folderId, limit = 200 } = req.query;
    // 验证 limit
    let parsedLimit = parseInt(limit);
    if (isNaN(parsedLimit) || parsedLimit < 1) parsedLimit = 200;
    if (parsedLimit > 500) parsedLimit = 500;

    try {
        let sql = `
            SELECT 
                id, title, content, createdBy, folderId,
                createdAt, updatedAt
            FROM notes
            WHERE 1=1
        `;
        const params = [];
        if (folderId !== undefined && folderId !== '' && folderId !== 'null') {
            const fid = parseInt(folderId);
            if (!isNaN(fid) && fid >= 0) {
                sql += ' AND folderId = ?';
                params.push(fid);
            }
        }
        sql += ' ORDER BY updatedAt DESC LIMIT ?';
        params.push(parsedLimit);

        const notes = notesDb.prepare(sql).all(...params);

        // 批量获取创建者用户名
        const userIds = notes.map(n => n.createdBy).filter(id => id !== null && id !== undefined);
        const userMap = {};
        if (userIds.length > 0) {
            const placeholders = userIds.map(() => '?').join(',');
            const userSql = `SELECT userId, username FROM users WHERE userId IN (${placeholders})`;
            const users = mainDb.prepare(userSql).all(...userIds);
            for (const u of users) {
                userMap[u.userId] = u.username;
            }
        }

        // 批量查询附件（分块，避免 IN 子句过长）
        if (notes.length > 0) {
            const noteIds = notes.map(n => n.id);
            const allAttachments = [];
            const chunkSize = 100;
            for (let i = 0; i < noteIds.length; i += chunkSize) {
                const chunk = noteIds.slice(i, i + chunkSize);
                const placeholders = chunk.map(() => '?').join(',');
                const attachSql = `SELECT * FROM note_attachments WHERE noteId IN (${placeholders})`;
                const chunkAtts = notesDb.prepare(attachSql).all(...chunk);
                allAttachments.push(...chunkAtts);
            }
            
            // 按 noteId 分组
            const attachMap = {};
            for (const att of allAttachments) {
                if (!attachMap[att.noteId]) attachMap[att.noteId] = [];
                attachMap[att.noteId].push(att);
            }
            for (const note of notes) {
                note.creatorName = userMap[note.createdBy] || '未知用户';
                note.attachments = attachMap[note.id] || [];
            }
        } else {
            res.json({ success: true, notes: [] });
            return;
        }

        res.json({ success: true, notes });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 创建笔记（事务 + 附件验证 + folderId 验证） ==========
router.post('/api/notes', isLoggedIn, checkNotesBan, (req, res) => {
    const user = mainDb.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const { title, content, attachments, folderId = 0 } = req.body;
    if (!title) return res.status(400).json({ success: false, message: '标题不能为空' });

    // 验证 folderId
    if (folderId !== 0) {
        if (!isValidId(folderId)) {
            return res.status(400).json({ success: false, message: '无效的文件夹ID' });
        }
        const folder = notesDb.prepare('SELECT id FROM note_folders WHERE id = ?').get(folderId);
        if (!folder) {
            return res.status(400).json({ success: false, message: '目标文件夹不存在' });
        }
    }

    try {
        notesDb.exec('BEGIN TRANSACTION');

        const result = notesDb.prepare(`INSERT INTO notes (title, content, createdBy, folderId, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`).run(title, content || '', req.userId, folderId);
        const noteId = result.lastInsertRowid;

        // 插入附件（验证数据）
        let attachCount = 0;
        if (attachments && attachments.length) {
            const stmt = notesDb.prepare(`INSERT INTO note_attachments (noteId, fileUrl, fileName, fileType, fileSize, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))`);
            for (const att of attachments) {
                if (!att.fileUrl || !att.fileName || !isPathSafe(att.fileUrl)) {
                    console.warn('[创建笔记] 跳过无效附件:', att);
                    continue;
                }
                stmt.run(noteId, att.fileUrl, att.fileName, att.fileType || null, att.fileSize || 0);
                attachCount++;
            }
        }

        notesDb.exec('COMMIT');
        logToFile(`[云笔记] 管理员 ${user.username} 创建笔记 ID:${noteId}，标题:${title}，附件数:${attachCount}`);
        res.json({ success: true });
    } catch (err) {
        notesDb.exec('ROLLBACK');
        console.error('创建笔记失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 更新笔记（async + 附件替换策略 + 事务） ==========
router.put('/api/notes/:id', isLoggedIn, checkNotesBan, async (req, res) => {
    const user = mainDb.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const { title, content, attachments, folderId } = req.body;
    const noteId = parseInt(req.params.id);
    if (!isValidId(noteId)) {
        return res.status(400).json({ success: false, message: '无效的笔记ID' });
    }
    if (!title) return res.status(400).json({ success: false, message: '标题不能为空' });

    // 验证 folderId（如果提供）
    if (folderId !== undefined && folderId !== 0) {
        if (!isValidId(folderId)) {
            return res.status(400).json({ success: false, message: '无效的文件夹ID' });
        }
        const folder = notesDb.prepare('SELECT id FROM note_folders WHERE id = ?').get(folderId);
        if (!folder) {
            return res.status(400).json({ success: false, message: '目标文件夹不存在' });
        }
    }

    // 检查笔记是否存在
    const existingNote = notesDb.prepare('SELECT id FROM notes WHERE id = ?').get(noteId);
    if (!existingNote) {
        return res.status(404).json({ success: false, message: '笔记不存在' });
    }

    try {
        let oldFileUrls = [];
        let shouldProcessAttachments = false;
        let isClearAttachments = false;

        // 判断 attachments 字段是否提供
        if (attachments !== undefined) {
            shouldProcessAttachments = true;
            if (Array.isArray(attachments) && attachments.length === 0) {
                isClearAttachments = true;
            }
            // 收集旧附件路径
            const oldAtts = notesDb.prepare('SELECT fileUrl FROM note_attachments WHERE noteId = ?').all(noteId);
            oldFileUrls = oldAtts.map(a => a.fileUrl);
        }

        notesDb.exec('BEGIN TRANSACTION');

        // 1. 更新笔记基本信息
        let updateFields = 'title = ?, content = ?, updatedAt = datetime("now")';
        const params = [title, content || ''];
        if (folderId !== undefined) {
            updateFields += ', folderId = ?';
            params.push(parseInt(folderId));
        }
        params.push(noteId);
        notesDb.prepare(`UPDATE notes SET ${updateFields} WHERE id = ?`).run(...params);

        // 2. 处理附件
        let newAttachCount = 0;
        if (shouldProcessAttachments) {
            // 删除旧附件记录（数据库）
            notesDb.prepare('DELETE FROM note_attachments WHERE noteId = ?').run(noteId);

            // 插入新附件
            if (attachments && attachments.length) {
                const stmt = notesDb.prepare(`INSERT INTO note_attachments (noteId, fileUrl, fileName, fileType, fileSize, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))`);
                for (const att of attachments) {
                    if (!att.fileUrl || !att.fileName || !isPathSafe(att.fileUrl)) {
                        console.warn('[更新笔记] 跳过无效附件:', att);
                        continue;
                    }
                    stmt.run(noteId, att.fileUrl, att.fileName, att.fileType || null, att.fileSize || 0);
                    newAttachCount++;
                }
            }
        }

        notesDb.exec('COMMIT');

        // 3. 事务提交成功后，删除旧物理文件
        if (shouldProcessAttachments && oldFileUrls.length > 0) {
            await Promise.all(oldFileUrls.map(async (fileUrl) => {
                if (!isPathSafe(fileUrl)) {
                    console.warn(`[更新笔记] 跳过非法路径: ${fileUrl}`);
                    return;
                }
                const filePath = path.join(__dirname, '../', fileUrl.replace(/^\/+/, ''));
                try {
                    await fs.unlink(filePath);
                } catch (err) {
                    console.warn(`[更新笔记] 删除物理文件失败: ${filePath}`, err.message);
                }
            }));
        }

        const action = isClearAttachments ? '清空' : (shouldProcessAttachments ? '替换' : '保留');
        logToFile(`[云笔记] 管理员 ${user.username} 更新笔记 ID:${noteId}，标题:${title}，附件操作:${action}，新附件数:${newAttachCount}`);
        res.json({ success: true });
    } catch (err) {
        notesDb.exec('ROLLBACK');
        console.error('更新笔记失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 删除笔记 ==========
router.delete('/api/notes/:id', isLoggedIn, checkNotesBan, async (req, res) => {
    const user = mainDb.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const noteId = parseInt(req.params.id);
    if (!isValidId(noteId)) {
        return res.status(400).json({ success: false, message: '无效的笔记ID' });
    }
    try {
        // 获取附件路径
        const attachments = notesDb.prepare('SELECT fileUrl FROM note_attachments WHERE noteId = ?').all(noteId);
        const fileUrls = attachments.map(a => a.fileUrl);

        notesDb.exec('BEGIN TRANSACTION');
        notesDb.prepare('DELETE FROM note_attachments WHERE noteId = ?').run(noteId);
        notesDb.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
        notesDb.exec('COMMIT');

        // 删除物理文件
        if (fileUrls.length > 0) {
            await Promise.all(fileUrls.map(async (fileUrl) => {
                if (!isPathSafe(fileUrl)) {
                    console.warn(`[删除笔记] 跳过非法路径: ${fileUrl}`);
                    return;
                }
                const filePath = path.join(__dirname, '../', fileUrl.replace(/^\/+/, ''));
                try {
                    await fs.unlink(filePath);
                } catch (err) {
                    console.warn(`[删除笔记] 删除物理文件失败: ${filePath}`, err.message);
                }
            }));
        }

        logToFile(`[云笔记] 管理员 ${user.username} 删除笔记 ID:${noteId}`);
        res.json({ success: true });
    } catch (err) {
        notesDb.exec('ROLLBACK');
        console.error('删除笔记失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 删除单个附件 ==========
router.delete('/api/notes/attachment/:id', isLoggedIn, checkNotesBan, async (req, res) => {
    const user = mainDb.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const attachmentId = parseInt(req.params.id);
    if (!isValidId(attachmentId)) {
        return res.status(400).json({ success: false, message: '无效的附件ID' });
    }
    try {
        const att = notesDb.prepare('SELECT fileUrl, fileName, noteId FROM note_attachments WHERE id = ?').get(attachmentId);
        if (!att) return res.status(404).json({ success: false, message: '附件不存在' });

        if (!isPathSafe(att.fileUrl)) {
            return res.status(400).json({ success: false, message: '非法文件路径' });
        }

        const filePath = path.join(__dirname, '../', att.fileUrl.replace(/^\/+/, ''));
        notesDb.exec('BEGIN TRANSACTION');
        notesDb.prepare('DELETE FROM note_attachments WHERE id = ?').run(attachmentId);
        notesDb.exec('COMMIT');

        try {
            await fs.unlink(filePath);
        } catch (err) {
            console.warn(`[删除附件] 删除物理文件失败: ${filePath}`, err.message);
        }

        logToFile(`[云笔记] 管理员 ${user.username} 删除附件 ID:${attachmentId}，文件名:${att.fileName}，所属笔记:${att.noteId}`);
        res.json({ success: true });
    } catch (err) {
        notesDb.exec('ROLLBACK');
        console.error('删除附件失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 下载/预览附件 ==========
router.get('/api/notes/download/:id', isLoggedIn, checkNotesBan, async (req, res) => {
    const attachmentId = parseInt(req.params.id);
    if (!isValidId(attachmentId)) {
        return res.status(400).json({ success: false, message: '无效的附件ID' });
    }
    const att = notesDb.prepare('SELECT fileUrl, fileName, fileType, fileSize FROM note_attachments WHERE id = ?').get(attachmentId);
    if (!att) return res.status(404).json({ success: false, message: '附件不存在' });
    
    if (!isPathSafe(att.fileUrl)) {
        return res.status(400).json({ success: false, message: '非法文件路径' });
    }
    
    const filePath = path.join(__dirname, '../', att.fileUrl.replace(/^\/+/, ''));
    try {
        await fs.access(filePath);
        const user = mainDb.prepare('SELECT username FROM users WHERE userId = ?').get(req.userId);
        const disposition = req.query.preview === 'true' ? 'inline' : 'attachment';
        let contentType = att.fileType || 'application/octet-stream';
        if (contentType.startsWith('text/') || att.fileName.match(/\.(txt|md|js|css|html|json|xml)$/i)) {
            contentType = 'text/plain; charset=utf-8';
        }
        res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(att.fileName)}`);
        res.setHeader('Content-Type', contentType);
        
        // 直接 pipe，减少内存占用
        const readStream = fsSync.createReadStream(filePath);
        let bytesTransferred = 0, recorded = false;
        const finishRecord = () => {
            if (recorded) return;
            recorded = true;
            try {
                mainDb.prepare(`INSERT INTO user_traffic (user_id, type, bytes, path) VALUES (?, 'download', ?, ?)`).run(req.userId, bytesTransferred, att.fileUrl);
                logToFile(`[云笔记] 用户 ${user.username} ${disposition === 'inline' ? '预览' : '下载'}附件 ID:${attachmentId}，文件名:${att.fileName}，实际传输 ${bytesTransferred} / ${att.fileSize} bytes`);
            } catch (err) {
                console.error('[下载附件] 记录流量失败:', err);
            }
        };
        readStream.on('data', (chunk) => { bytesTransferred += chunk.length; });
        readStream.on('end', finishRecord);
        readStream.on('error', finishRecord);
        res.on('finish', finishRecord);
        res.on('close', finishRecord);
        readStream.pipe(res);
    } catch (err) {
        console.error(`附件不存在: ${filePath}`, err);
        res.status(500).json({ success: false, message: '文件不存在' });
    }
});

// ========== 重命名附件 ==========
router.put('/api/notes/attachment/rename/:id', isLoggedIn, checkNotesBan, async (req, res) => {
    const user = mainDb.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const attachmentId = parseInt(req.params.id);
    if (!isValidId(attachmentId)) {
        return res.status(400).json({ success: false, message: '无效的附件ID' });
    }
    const { newFileName } = req.body;
    if (!newFileName || newFileName.trim() === '') return res.status(400).json({ success: false, message: '新文件名不能为空' });
    const cleanName = newFileName.trim();
    const att = notesDb.prepare('SELECT fileName, noteId FROM note_attachments WHERE id = ?').get(attachmentId);
    if (!att) return res.status(404).json({ success: false, message: '附件不存在' });
    const duplicate = notesDb.prepare('SELECT id FROM note_attachments WHERE noteId = ? AND fileName = ? AND id != ?').get(att.noteId, cleanName, attachmentId);
    if (duplicate) return res.status(400).json({ success: false, message: '该笔记中已存在同名文件' });
    notesDb.prepare('UPDATE note_attachments SET fileName = ? WHERE id = ?').run(cleanName, attachmentId);
    logToFile(`[云笔记] 管理员 ${user.username} 重命名附件 ID:${attachmentId}，原文件名:${att.fileName}，新文件名:${cleanName}`);
    res.json({ success: true });
});

module.exports = router;