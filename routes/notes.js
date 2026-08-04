// routes/notes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const notesDb = require('../db/notesConnection');
const mainDb = require('../db/connection');
const { storage, fileFilter } = require('../config/multer');
const { logToFile } = require('../utils/logger');
const { isLoggedIn } = require('../middleware/auth');
const { checkNotesBan } = require('../middleware/banCheck');
const { validateFileType } = require('../utils/fileValidator');

// ========== 调试模式 ==========
const DEBUG_PATH = process.env.NODE_ENV === 'development';

// ========== 辅助函数：循环获取所有子文件夹ID（防死循环） ==========
function getAllSubFolderIds(parentId) {
    const allIds = [];
    const queue = [parentId];
    const visited = new Set();
    while (queue.length > 0) {
        const currentId = queue.shift();
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        const children = notesDb.prepare('SELECT id FROM note_folders WHERE parentId = ?').all(currentId);
        for (const child of children) {
            if (!visited.has(child.id)) {
                allIds.push(child.id);
                queue.push(child.id);
            }
        }
    }
    return allIds;
}

// ========== 核心：统一的路径处理 ==========
const UPLOADS_NOTES_DIR = path.resolve(__dirname, '../uploads/notes_files');

function getSafeFilePath(fileUrl) {
    if (!fileUrl || typeof fileUrl !== 'string') {
        logToFile(`[路径安全] 无效的 fileUrl: ${fileUrl}`);
        return null;
    }

    try {
        let filename = fileUrl;

        // 去除前导斜杠
        filename = filename.replace(/^\/+/, '');

        // 如果路径包含 uploads/notes_files/，提取其后的部分
        const prefixPattern = /^(uploads\/notes_files\/)/i;
        if (prefixPattern.test(filename)) {
            filename = filename.replace(prefixPattern, '');
        }

        // 如果路径包含 notes_files/，提取其后的部分
        const shortPattern = /^(notes_files\/)/i;
        if (shortPattern.test(filename)) {
            filename = filename.replace(shortPattern, '');
        }

        // 防止路径遍历
        if (filename.includes('..')) {
            logToFile(`[路径安全] 检测到路径遍历: ${fileUrl}`);
            return null;
        }

        if (!filename) {
            logToFile(`[路径安全] 空文件名: ${fileUrl}`);
            return null;
        }

        const fullPath = path.join(UPLOADS_NOTES_DIR, filename);

        // 确保路径在 uploads/notes_files 目录下
        const relativeCheck = path.relative(UPLOADS_NOTES_DIR, fullPath);
        if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
            logToFile(`[路径安全] 路径逃逸检测: ${fileUrl} -> ${fullPath}`);
            return null;
        }

        if (DEBUG_PATH) {
            logToFile(`[路径安全] 解析成功: ${fileUrl} -> ${fullPath}`);
        }
        return fullPath;
    } catch (err) {
        logToFile(`[路径安全] 解析失败: ${fileUrl}, 错误: ${err.message}`);
        return null;
    }
}

function isPathSafe(fileUrl) {
    return getSafeFilePath(fileUrl) !== null;
}

// ========== 辅助函数：验证 ID 是否有效 ==========
function isValidId(id) {
    return id !== undefined && id !== null && !isNaN(parseInt(id)) && parseInt(id) > 0;
}

// ========== 辅助函数：检查文件是否被 Markdown 引用 ==========
function isFileReferencedInContent(content, fileUrl) {
    if (!content || !fileUrl) return false;
    try {
        const cleanUrl = fileUrl.split('?')[0].split('#')[0];
        const escapedUrl = cleanUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
            new RegExp(`!\\[.*?\\]\\(${escapedUrl}(\\s.*?)?\\)`),
            new RegExp(`\\[.*?\\]\\(${escapedUrl}(\\s.*?)?\\)`),
            new RegExp(`<img[^>]*src=["']${escapedUrl}["'][^>]*>`),
            new RegExp(`<video[^>]*src=["']${escapedUrl}["'][^>]*>`),
            new RegExp(`<source[^>]*src=["']${escapedUrl}["'][^>]*>`),
            new RegExp(`src=["']${escapedUrl}["']`)
        ];
        return patterns.some(p => p.test(content));
    } catch (err) {
        return false;
    }
}

// ========== 安全删除文件 ==========
async function safeDeleteFile(filePath, fileUrl, context) {
    try {
        await fs.unlink(filePath);
        logToFile(`[${context}] 删除物理文件成功: ${fileUrl}`);
        return { success: true, fileUrl, deleted: true };
    } catch (err) {
        if (err.code === 'ENOENT') {
            logToFile(`[${context}] 物理文件不存在（已删除）: ${fileUrl}`);
            return { success: true, fileUrl, deleted: false, reason: '文件不存在' };
        }
        logToFile(`[${context}] 删除物理文件失败: ${fileUrl}, 错误: ${err.message}`);
        return { success: false, fileUrl, reason: err.message };
    }
}

// ========== 安全删除多个文件 ==========
async function safeDeleteFiles(fileUrls, context) {
    const results = [];
    for (const fileUrl of fileUrls) {
        const filePath = getSafeFilePath(fileUrl);
        if (!filePath) {
            logToFile(`[${context}] 跳过非法路径: ${fileUrl}`);
            results.push({ fileUrl, success: false, reason: '非法路径' });
            continue;
        }
        const result = await safeDeleteFile(filePath, fileUrl, context);
        results.push(result);
    }
    return results;
}

// ========== 辅助函数：记录流量 ==========
function recordTraffic(userId, type, bytes, path, options = {}) {
    const { ignoreErrors = true } = options;
    try {
        mainDb.prepare(`INSERT INTO user_traffic (user_id, type, bytes, path) VALUES (?, ?, ?, ?)`)
            .run(userId, type, bytes, path);
    } catch (err) {
        console.error('[流量记录] 失败:', err);
        logToFile(`[流量记录] 失败: userId=${userId}, type=${type}, bytes=${bytes}, error=${err.message}`);
        if (!ignoreErrors) throw err;
    }
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

// ========== 删除文件夹 ==========
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

        const allSubIds = getAllSubFolderIds(folderId);
        const allFolderIds = [folderId, ...allSubIds];

        if (allFolderIds.length === 0) {
            return res.json({ success: true, message: '没有需要删除的文件夹' });
        }

        let allNoteIds = [];
        let allFileUrls = [];

        const folderPlaceholders = allFolderIds.map(() => '?').join(',');
        const notes = notesDb.prepare(`SELECT id FROM notes WHERE folderId IN (${folderPlaceholders})`).all(...allFolderIds);
        allNoteIds = notes.map(n => n.id);

        if (allNoteIds.length > 0) {
            const notePlaceholders = allNoteIds.map(() => '?').join(',');
            const atts = notesDb.prepare(`SELECT fileUrl FROM note_attachments WHERE noteId IN (${notePlaceholders})`).all(...allNoteIds);
            allFileUrls = atts.map(a => a.fileUrl);
        }

        notesDb.exec('BEGIN TRANSACTION');

        if (allNoteIds.length > 0) {
            const notePlaceholders = allNoteIds.map(() => '?').join(',');
            notesDb.prepare(`DELETE FROM note_attachments WHERE noteId IN (${notePlaceholders})`).run(...allNoteIds);
        }
        if (allNoteIds.length > 0) {
            const notePlaceholders = allNoteIds.map(() => '?').join(',');
            notesDb.prepare(`DELETE FROM notes WHERE id IN (${notePlaceholders})`).run(...allNoteIds);
        }
        if (allFolderIds.length > 0) {
            const fPlaceholders = allFolderIds.map(() => '?').join(',');
            notesDb.prepare(`DELETE FROM note_folders WHERE id IN (${fPlaceholders})`).run(...allFolderIds);
        }

        notesDb.exec('COMMIT');

        if (allFileUrls.length > 0) {
            setImmediate(async () => {
                await safeDeleteFiles(allFileUrls, '删除文件夹');
            });
        }

        logToFile(`[笔记] 用户 ${userId} 删除文件夹 ${folderId}，包含 ${allFolderIds.length} 个文件夹，${allNoteIds.length} 个笔记`);
        res.json({ success: true });
    } catch (err) {
        try { notesDb.exec('ROLLBACK'); } catch (rollbackErr) {
            console.error('[删除文件夹] ROLLBACK 失败:', rollbackErr);
        }
        console.error('删除文件夹失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 移动笔记 ==========
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
        try { notesDb.exec('ROLLBACK'); } catch (rollbackErr) {}
        console.error('移动笔记失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 笔记 CRUD ==========

// 上传附件（支持图片和视频）
router.post('/api/notes/upload', isLoggedIn, checkNotesBan, (req, res, next) => {
    const user = mainDb.prepare('SELECT role FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false, message: '仅管理员可上传附件' });
    next();
}, multer({ storage, fileFilter, limits: { fileSize: 200 * 1024 * 1024 } }).array('files'), (req, res) => {
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

    for (const file of req.files) {
        recordTraffic(req.userId, 'upload', file.size, file.originalname);
    }

    logToFile(`[云笔记] 管理员 ${user.username} 上传附件 ${attachments.length} 个文件`);
    res.json({ success: true, attachments });
});

// 清理临时附件
router.post('/api/notes/cleanup-temp', isLoggedIn, checkNotesBan, async (req, res) => {
    const user = mainDb.prepare('SELECT role FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const { fileUrl } = req.body;
    if (!fileUrl) return res.status(400).json({ success: false, message: '缺少文件路径' });

    const filePath = getSafeFilePath(fileUrl);
    if (!filePath) {
        return res.status(400).json({ success: false, message: '非法文件路径' });
    }

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

// ========== GET /api/notes ==========
router.get('/api/notes', isLoggedIn, checkNotesBan, (req, res) => {
    const { folderId, limit = 200 } = req.query;
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

        if (notes.length > 0) {
            const noteIds = notes.map(n => n.id);
            const attachMap = {};
            const chunkSize = 100;
            for (let i = 0; i < noteIds.length; i += chunkSize) {
                const chunk = noteIds.slice(i, i + chunkSize);
                const placeholders = chunk.map(() => '?').join(',');
                const attachSql = `SELECT * FROM note_attachments WHERE noteId IN (${placeholders})`;
                const chunkAtts = notesDb.prepare(attachSql).all(...chunk);
                for (const att of chunkAtts) {
                    if (!attachMap[att.noteId]) attachMap[att.noteId] = [];
                    attachMap[att.noteId].push(att);
                }
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

// ========== 创建笔记 ==========
router.post('/api/notes', isLoggedIn, checkNotesBan, (req, res) => {
    const user = mainDb.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const { title, content, attachments, folderId = 0 } = req.body;
    if (!title) return res.status(400).json({ success: false, message: '标题不能为空' });

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

        let attachCount = 0;
        if (attachments && attachments.length) {
            const stmt = notesDb.prepare(`INSERT INTO note_attachments (noteId, fileUrl, fileName, fileType, fileSize, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))`);
            for (const att of attachments) {
                if (!att.fileUrl || !att.fileName || !isPathSafe(att.fileUrl)) {
                    logToFile(`[创建笔记] 跳过无效附件: ${JSON.stringify(att)}`);
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
        try { notesDb.exec('ROLLBACK'); } catch (rollbackErr) {}
        console.error('创建笔记失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 更新笔记（修复：保留所有旧附件） ==========
router.put('/api/notes/:id', isLoggedIn, checkNotesBan, async (req, res) => {
    const user = mainDb.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const { title, content, attachments, folderId } = req.body;
    const noteId = parseInt(req.params.id);
    if (!isValidId(noteId)) {
        return res.status(400).json({ success: false, message: '无效的笔记ID' });
    }
    if (!title) return res.status(400).json({ success: false, message: '标题不能为空' });

    if (folderId !== undefined && folderId !== 0) {
        if (!isValidId(folderId)) {
            return res.status(400).json({ success: false, message: '无效的文件夹ID' });
        }
        const folder = notesDb.prepare('SELECT id FROM note_folders WHERE id = ?').get(folderId);
        if (!folder) {
            return res.status(400).json({ success: false, message: '目标文件夹不存在' });
        }
    }

    const existingNote = notesDb.prepare('SELECT id FROM notes WHERE id = ?').get(noteId);
    if (!existingNote) {
        return res.status(404).json({ success: false, message: '笔记不存在' });
    }

    try {
        notesDb.exec('BEGIN TRANSACTION');

        // 更新笔记基本信息
        let updateFields = 'title = ?, content = ?, updatedAt = datetime("now")';
        const params = [title, content || ''];
        if (folderId !== undefined) {
            updateFields += ', folderId = ?';
            params.push(parseInt(folderId));
        }
        params.push(noteId);
        notesDb.prepare(`UPDATE notes SET ${updateFields} WHERE id = ?`).run(...params);

        // ========== 修复：保留所有旧附件 ==========
        // 获取当前笔记的所有旧附件
        const oldAtts = notesDb.prepare('SELECT fileUrl, fileName, fileType, fileSize FROM note_attachments WHERE noteId = ?').all(noteId);
        const oldFileUrls = oldAtts.map(a => a.fileUrl);

        // 构建新附件的 URL 集合（用于去重）
        const newFileUrls = new Set();
        if (attachments && attachments.length) {
            for (const att of attachments) {
                if (att.fileUrl && isPathSafe(att.fileUrl)) {
                    newFileUrls.add(att.fileUrl);
                }
            }
        }

        // 找出需要删除的附件：在新附件列表中不存在的旧附件
        const filesToDelete = [];
        const filesToKeep = [];

        for (const att of oldAtts) {
            if (newFileUrls.has(att.fileUrl)) {
                filesToKeep.push(att);
            } else {
                // 检查是否被 Markdown 引用（保护引用文件）
                if (isFileReferencedInContent(content, att.fileUrl)) {
                    filesToKeep.push(att);
                    logToFile(`[更新笔记] 文件被Markdown引用，保留: ${att.fileUrl}`);
                } else {
                    filesToDelete.push(att.fileUrl);
                }
            }
        }

        // 清空旧附件，然后重新插入所有需要保留的附件
        notesDb.prepare('DELETE FROM note_attachments WHERE noteId = ?').run(noteId);

        let newAttachCount = 0;

        // 1. 保留被引用的旧附件
        if (filesToKeep.length > 0) {
            const keepStmt = notesDb.prepare(`INSERT INTO note_attachments (noteId, fileUrl, fileName, fileType, fileSize, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))`);
            for (const att of filesToKeep) {
                keepStmt.run(noteId, att.fileUrl, att.fileName, att.fileType, att.fileSize);
                newAttachCount++;
            }
            logToFile(`[更新笔记] 保留 ${filesToKeep.length} 个旧附件`);
        }

        // 2. 插入新附件（去重）
        if (attachments && attachments.length) {
            const stmt = notesDb.prepare(`INSERT INTO note_attachments (noteId, fileUrl, fileName, fileType, fileSize, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))`);
            for (const att of attachments) {
                if (!att.fileUrl || !att.fileName || !isPathSafe(att.fileUrl)) {
                    logToFile(`[更新笔记] 跳过无效附件: ${JSON.stringify(att)}`);
                    continue;
                }
                // 避免重复插入已被保留的附件
                const alreadyKept = filesToKeep.some(k => k.fileUrl === att.fileUrl);
                if (alreadyKept) {
                    continue;
                }
                stmt.run(noteId, att.fileUrl, att.fileName, att.fileType || null, att.fileSize || 0);
                newAttachCount++;
            }
        }

        notesDb.exec('COMMIT');

        // 3. 删除未被引用的旧文件（异步）
        if (filesToDelete.length > 0) {
            logToFile(`[更新笔记] 准备删除 ${filesToDelete.length} 个未被引用的旧文件`);
            setImmediate(async () => {
                await safeDeleteFiles(filesToDelete, '更新笔记');
            });
        }

        const action = attachments !== undefined ? (attachments.length === 0 ? '清空' : '更新') : '保留';
        logToFile(`[云笔记] 管理员 ${user.username} 更新笔记 ID:${noteId}，标题:${title}，附件操作:${action}，新附件数:${newAttachCount}`);
        res.json({ success: true });
    } catch (err) {
        try { notesDb.exec('ROLLBACK'); } catch (rollbackErr) {}
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
        const attachments = notesDb.prepare('SELECT fileUrl FROM note_attachments WHERE noteId = ?').all(noteId);
        const fileUrls = attachments.map(a => a.fileUrl);

        notesDb.exec('BEGIN TRANSACTION');
        notesDb.prepare('DELETE FROM note_attachments WHERE noteId = ?').run(noteId);
        notesDb.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
        notesDb.exec('COMMIT');

        if (fileUrls.length > 0) {
            setImmediate(async () => {
                await safeDeleteFiles(fileUrls, '删除笔记');
            });
        }

        logToFile(`[云笔记] 管理员 ${user.username} 删除笔记 ID:${noteId}`);
        res.json({ success: true });
    } catch (err) {
        try { notesDb.exec('ROLLBACK'); } catch (rollbackErr) {}
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

        const filePath = getSafeFilePath(att.fileUrl);
        if (!filePath) {
            return res.status(400).json({ success: false, message: '非法文件路径' });
        }

        notesDb.exec('BEGIN TRANSACTION');
        notesDb.prepare('DELETE FROM note_attachments WHERE id = ?').run(attachmentId);
        notesDb.exec('COMMIT');

        const result = await safeDeleteFile(filePath, att.fileUrl, '删除附件');

        logToFile(`[云笔记] 管理员 ${user.username} 删除附件 ID:${attachmentId}，文件名:${att.fileName}，所属笔记:${att.noteId}，文件删除状态: ${result.success}`);
        res.json({ success: true });
    } catch (err) {
        try { notesDb.exec('ROLLBACK'); } catch (rollbackErr) {}
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

    const filePath = getSafeFilePath(att.fileUrl);
    if (!filePath) {
        logToFile(`[下载附件] 路径解析失败: ${att.fileUrl}`);
        return res.status(400).json({
            success: false,
            message: '文件路径无效，请重新上传附件',
            fileMissing: true,
            attachmentId: attachmentId
        });
    }

    try {
        let fileStat;
        try {
            fileStat = await fs.stat(filePath);
            logToFile(`[下载附件] 文件存在: ${filePath}, 大小: ${fileStat.size}`);
        } catch (err) {
            if (err.code === 'ENOENT') {
                logToFile(`[下载附件] 文件不存在: ${filePath}`);
                return res.status(404).json({
                    success: false,
                    message: '文件已被删除或丢失，请重新上传',
                    fileMissing: true,
                    attachmentId: attachmentId,
                    fileUrl: att.fileUrl
                });
            }
            logToFile(`[下载附件] 访问文件失败: ${filePath}, 错误: ${err.message}`);
            return res.status(500).json({
                success: false,
                message: '服务器错误，无法访问文件'
            });
        }

        const user = mainDb.prepare('SELECT username FROM users WHERE userId = ?').get(req.userId);
        const disposition = req.query.preview === 'true' ? 'inline' : 'attachment';

        const safeFilename = att.fileName.replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '_');
        const encodedFilename = encodeURIComponent(att.fileName)
            .replace(/['()]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase());

        res.setHeader('Content-Disposition',
            `${disposition}; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`);

        res.setHeader('Content-Length', fileStat.size);

        let contentType = att.fileType || 'application/octet-stream';
        if (contentType.startsWith('text/') || att.fileName.match(/\.(txt|md|js|css|html|json|xml)$/i)) {
            contentType = 'text/plain; charset=utf-8';
        }
        res.setHeader('Content-Type', contentType);

        const readStream = fsSync.createReadStream(filePath);
        let bytesTransferred = 0, recorded = false;
        const finishRecord = () => {
            if (recorded) return;
            recorded = true;
            if (bytesTransferred > 0) {
                recordTraffic(req.userId, 'download', bytesTransferred, att.fileUrl);
                logToFile(`[云笔记] 用户 ${user.username} ${disposition === 'inline' ? '预览' : '下载'}附件 ID:${attachmentId}，文件名:${att.fileName}，实际传输 ${bytesTransferred} / ${fileStat.size} bytes`);
            }
        };
        readStream.on('data', (chunk) => { bytesTransferred += chunk.length; });
        readStream.on('end', finishRecord);
        readStream.on('error', (err) => {
            if (!res.headersSent) {
                res.status(500).json({ success: false, message: '读取文件失败' });
            }
            finishRecord();
        });
        res.on('finish', finishRecord);
        res.on('close', finishRecord);
        readStream.pipe(res);
    } catch (err) {
        console.error(`下载附件失败: ${att.fileUrl}`, err);
        res.status(500).json({ success: false, message: '服务器错误' });
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

// ========== 清理孤立的附件记录（管理员工具） ==========
router.post('/api/notes/cleanup-orphan-attachments', isLoggedIn, checkNotesBan, async (req, res) => {
    const user = mainDb.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });

    try {
        const allAttachments = notesDb.prepare('SELECT id, fileUrl, fileName, noteId FROM note_attachments').all();
        const orphanAttachments = [];
        const fileMissingAttachments = [];

        for (const att of allAttachments) {
            const note = notesDb.prepare('SELECT id FROM notes WHERE id = ?').get(att.noteId);
            if (!note) {
                orphanAttachments.push(att);
                continue;
            }

            const filePath = getSafeFilePath(att.fileUrl);
            if (filePath) {
                try {
                    await fs.access(filePath);
                } catch (err) {
                    if (err.code === 'ENOENT') {
                        fileMissingAttachments.push(att);
                    }
                }
            } else {
                fileMissingAttachments.push(att);
            }
        }

        let deletedCount = 0;
        if (orphanAttachments.length > 0) {
            notesDb.exec('BEGIN TRANSACTION');
            for (const att of orphanAttachments) {
                notesDb.prepare('DELETE FROM note_attachments WHERE id = ?').run(att.id);
                deletedCount++;
            }
            notesDb.exec('COMMIT');
        }

        res.json({
            success: true,
            orphanCount: orphanAttachments.length,
            deletedCount: deletedCount,
            fileMissingCount: fileMissingAttachments.length,
            fileMissing: fileMissingAttachments.map(a => ({ id: a.id, fileName: a.fileName, noteId: a.noteId }))
        });
    } catch (err) {
        try { notesDb.exec('ROLLBACK'); } catch (rollbackErr) {}
        console.error('清理孤立附件失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 标记缺失附件（管理员工具） ==========
router.post('/api/notes/attachment/:id/mark-missing', isLoggedIn, checkNotesBan, async (req, res) => {
    const user = mainDb.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const attachmentId = parseInt(req.params.id);
    if (!isValidId(attachmentId)) {
        return res.status(400).json({ success: false, message: '无效的附件ID' });
    }

    try {
        const att = notesDb.prepare('SELECT fileUrl, fileName, noteId FROM note_attachments WHERE id = ?').get(attachmentId);
        if (!att) return res.status(404).json({ success: false, message: '附件不存在' });

        const filePath = getSafeFilePath(att.fileUrl);
        let fileExists = false;
        if (filePath) {
            try {
                await fs.access(filePath);
                fileExists = true;
            } catch (err) {
                // 文件不存在
            }
        }

        if (fileExists) {
            return res.status(400).json({ success: false, message: '文件存在，无需标记' });
        }

        notesDb.exec('BEGIN TRANSACTION');
        notesDb.prepare('DELETE FROM note_attachments WHERE id = ?').run(attachmentId);
        notesDb.exec('COMMIT');

        logToFile(`[云笔记] 管理员 ${user.username} 标记并删除缺失附件 ID:${attachmentId}，文件名:${att.fileName}，所属笔记:${att.noteId}`);
        res.json({ success: true, message: '已删除缺失的附件记录' });
    } catch (err) {
        try { notesDb.exec('ROLLBACK'); } catch (rollbackErr) {}
        console.error('标记缺失附件失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;