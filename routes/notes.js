// routes/notes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { PassThrough } = require('stream');
const db = require('../db/connection');
const { storage, fileFilter } = require('../config/multer');
const { logToFile } = require('../utils/logger');
const { isLoggedIn } = require('../middleware/auth');
const { checkNotesBan } = require('../middleware/banCheck');
const { validateFileType } = require('../utils/fileValidator');

// ========== 笔记文件夹管理 ==========

// 获取文件夹树（所有用户可见）
router.get('/api/note-folders', isLoggedIn, checkNotesBan, (req, res) => {
    try {
        const folders = db.prepare('SELECT * FROM note_folders ORDER BY parentId, name').all();
        res.json({ success: true, folders });
    } catch (err) {
        console.error('获取文件夹失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 创建文件夹（仅管理员）
router.post('/api/note-folders', isLoggedIn, checkNotesBan, (req, res) => {
    const userId = req.userId;
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
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
    try {
        const existing = db.prepare('SELECT id FROM note_folders WHERE parentId = ? AND name = ?').get(parentId, name.trim());
        if (existing) {
            return res.status(400).json({ success: false, message: '该位置已存在同名文件夹' });
        }
        const result = db.prepare('INSERT INTO note_folders (name, parentId, createdBy) VALUES (?, ?, ?)').run(name.trim(), parentId, userId);
        const folder = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(result.lastInsertRowid);
        logToFile(`[笔记] 用户 ${userId} 创建文件夹: ${name}`);
        res.json({ success: true, folder });
    } catch (err) {
        console.error('创建文件夹失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 重命名文件夹（仅管理员）
router.put('/api/note-folders/:id', isLoggedIn, checkNotesBan, (req, res) => {
    const userId = req.userId;
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '仅管理员可操作' });
    }
    const folderId = parseInt(req.params.id);
    const { name } = req.body;
    if (!name || name.trim().length === 0) {
        return res.status(400).json({ success: false, message: '文件夹名称不能为空' });
    }
    try {
        const folder = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(folderId);
        if (!folder) {
            return res.status(404).json({ success: false, message: '文件夹不存在' });
        }
        const existing = db.prepare('SELECT id FROM note_folders WHERE parentId = ? AND name = ? AND id != ?')
            .get(folder.parentId, name.trim(), folderId);
        if (existing) {
            return res.status(400).json({ success: false, message: '该位置已存在同名文件夹' });
        }
        db.prepare('UPDATE note_folders SET name = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(name.trim(), folderId);
        logToFile(`[笔记] 用户 ${userId} 重命名文件夹 ${folderId} -> ${name}`);
        res.json({ success: true });
    } catch (err) {
        console.error('重命名文件夹失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 删除文件夹（仅管理员，异步操作）
router.delete('/api/note-folders/:id', isLoggedIn, checkNotesBan, async (req, res) => {
    const userId = req.userId;
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '仅管理员可操作' });
    }
    const folderId = parseInt(req.params.id);
    try {
        const folder = db.prepare('SELECT * FROM note_folders WHERE id = ?').get(folderId);
        if (!folder) {
            return res.status(404).json({ success: false, message: '文件夹不存在' });
        }
        if (folderId === 0) {
            return res.status(400).json({ success: false, message: '不能删除根目录' });
        }
        // 获取所有子文件夹ID（最多两层）
        const childFolders = db.prepare('SELECT id FROM note_folders WHERE parentId = ?').all(folderId);
        const allIds = [folderId];
        for (const cf of childFolders) {
            allIds.push(cf.id);
            const sub = db.prepare('SELECT id FROM note_folders WHERE parentId = ?').all(cf.id);
            for (const s of sub) allIds.push(s.id);
        }
        const placeholders = allIds.map(() => '?').join(',');
        if (placeholders) {
            const notes = db.prepare(`SELECT id FROM notes WHERE folderId IN (${placeholders})`).all(...allIds);
            for (const note of notes) {
                const atts = db.prepare('SELECT fileUrl FROM note_attachments WHERE noteId = ?').all(note.id);
                for (const att of atts) {
                    const filePath = path.join(__dirname, '../', att.fileUrl);
                    try { await fs.unlink(filePath); } catch (e) {}
                }
                db.prepare('DELETE FROM note_attachments WHERE noteId = ?').run(note.id);
            }
            db.prepare(`DELETE FROM notes WHERE folderId IN (${placeholders})`).run(...allIds);
            db.prepare(`DELETE FROM note_folders WHERE id IN (${placeholders})`).run(...allIds);
        }
        logToFile(`[笔记] 用户 ${userId} 删除文件夹 ${folderId}`);
        res.json({ success: true });
    } catch (err) {
        console.error('删除文件夹失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 移动笔记到文件夹（仅管理员）
router.put('/api/notes/:id/move', isLoggedIn, checkNotesBan, (req, res) => {
    const userId = req.userId;
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '仅管理员可操作' });
    }
    const noteId = parseInt(req.params.id);
    const { folderId = 0 } = req.body;
    try {
        const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
        if (!note) {
            return res.status(404).json({ success: false, message: '笔记不存在' });
        }
        if (folderId !== 0) {
            const folder = db.prepare('SELECT id FROM note_folders WHERE id = ?').get(folderId);
            if (!folder) {
                return res.status(404).json({ success: false, message: '目标文件夹不存在' });
            }
        }
        db.prepare('UPDATE notes SET folderId = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(folderId, noteId);
        logToFile(`[笔记] 用户 ${userId} 移动笔记 ${noteId} 到文件夹 ${folderId}`);
        res.json({ success: true });
    } catch (err) {
        console.error('移动笔记失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 笔记 CRUD ==========

// 上传笔记附件（仅管理员）
router.post('/api/notes/upload', isLoggedIn, checkNotesBan, (req, res, next) => {
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(req.userId);
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
    const user = db.prepare('SELECT username FROM users WHERE userId = ?').get(req.userId);
    for (const file of req.files) {
        db.prepare(`INSERT INTO user_traffic (user_id, type, bytes, path) VALUES (?, 'upload', ?, ?)`).run(req.userId, file.size, file.originalname);
    }
    logToFile(`[云笔记] 管理员 ${user.username} 上传附件 ${attachments.length} 个文件`);
    res.json({ success: true, attachments });
});

// 清理临时上传的附件
router.post('/api/notes/cleanup-temp', isLoggedIn, async (req, res) => {
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const { fileUrl } = req.body;
    if (!fileUrl) return res.status(400).json({ success: false });
    const filePath = path.join(__dirname, '../', fileUrl);
    try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        logToFile(`[云笔记] 清理临时附件: ${fileUrl}`);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: true });
    }
});

// 获取所有笔记（所有用户可见，支持按文件夹筛选）
router.get('/api/notes', isLoggedIn, checkNotesBan, (req, res) => {
    const { folderId } = req.query;
    try {
        let sql = `
            SELECT n.*, u.username as creatorName 
            FROM notes n 
            LEFT JOIN users u ON n.createdBy = u.userId 
            WHERE 1=1
        `;
        const params = [];
        if (folderId !== undefined && folderId !== '') {
            sql += ' AND n.folderId = ?';
            params.push(parseInt(folderId));
        }
        sql += ' ORDER BY n.updatedAt DESC';
        const notes = db.prepare(sql).all(...params);
        for (let note of notes) {
            note.attachments = db.prepare('SELECT * FROM note_attachments WHERE noteId = ?').all(note.id);
        }
        res.json({ success: true, notes });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// 创建笔记（仅管理员）
router.post('/api/notes', isLoggedIn, checkNotesBan, (req, res) => {
    const user = db.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const { title, content, attachments, folderId = 0 } = req.body;
    if (!title) return res.status(400).json({ success: false, message: '标题不能为空' });
    const result = db.prepare(`INSERT INTO notes (title, content, createdBy, folderId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(title, content || '', req.userId, folderId);
    const noteId = result.lastInsertRowid;
    let attachCount = 0;
    if (attachments && attachments.length) {
        const stmt = db.prepare(`INSERT INTO note_attachments (noteId, fileUrl, fileName, fileType, fileSize) VALUES (?, ?, ?, ?, ?)`);
        for (const att of attachments) {
            stmt.run(noteId, att.fileUrl, att.fileName, att.fileType, att.fileSize);
        }
        attachCount = attachments.length;
    }
    logToFile(`[云笔记] 管理员 ${user.username} 创建笔记 ID:${noteId}，标题:${title}，附件数:${attachCount}`);
    res.json({ success: true });
});

// 更新笔记（仅管理员）
router.put('/api/notes/:id', isLoggedIn, checkNotesBan, (req, res) => {
    const user = db.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const { title, content, attachments, folderId } = req.body;
    const noteId = req.params.id;
    if (!title) return res.status(400).json({ success: false, message: '标题不能为空' });
    // 删除旧附件
    const oldAttachments = db.prepare('SELECT fileUrl FROM note_attachments WHERE noteId = ?').all(noteId);
    for (const att of oldAttachments) {
        const filePath = path.join(__dirname, '../', att.fileUrl);
        try { fsSync.unlinkSync(filePath); } catch (e) {}
    }
    db.prepare('DELETE FROM note_attachments WHERE noteId = ?').run(noteId);
    let updateFields = 'title = ?, content = ?, updatedAt = CURRENT_TIMESTAMP';
    const params = [title, content || ''];
    if (folderId !== undefined) {
        updateFields += ', folderId = ?';
        params.push(parseInt(folderId));
    }
    params.push(noteId);
    db.prepare(`UPDATE notes SET ${updateFields} WHERE id = ?`).run(...params);
    let newAttCount = 0;
    if (attachments && attachments.length) {
        const stmt = db.prepare(`INSERT INTO note_attachments (noteId, fileUrl, fileName, fileType, fileSize) VALUES (?, ?, ?, ?, ?)`);
        for (const att of attachments) {
            stmt.run(noteId, att.fileUrl, att.fileName, att.fileType, att.fileSize);
        }
        newAttCount = attachments.length;
    }
    logToFile(`[云笔记] 管理员 ${user.username} 更新笔记 ID:${noteId}，标题:${title}，旧附件:${oldAttachments.length}，新附件:${newAttCount}`);
    res.json({ success: true });
});

// 删除笔记（仅管理员）
router.delete('/api/notes/:id', isLoggedIn, checkNotesBan, async (req, res) => {
    const user = db.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const noteId = req.params.id;
    const note = db.prepare('SELECT title FROM notes WHERE id = ?').get(noteId);
    const attachments = db.prepare('SELECT fileUrl FROM note_attachments WHERE noteId = ?').all(noteId);
    for (const att of attachments) {
        const filePath = path.join(__dirname, '../', att.fileUrl);
        try { await fs.unlink(filePath); } catch (e) {}
    }
    db.prepare('DELETE FROM note_attachments WHERE noteId = ?').run(noteId);
    db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
    logToFile(`[云笔记] 管理员 ${user.username} 删除笔记 ID:${noteId}，标题:${note.title}，附件数:${attachments.length}`);
    res.json({ success: true });
});

// 删除单个附件（仅管理员）
router.delete('/api/notes/attachment/:id', isLoggedIn, checkNotesBan, async (req, res) => {
    const user = db.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const attachmentId = req.params.id;
    const att = db.prepare('SELECT fileUrl, fileName, noteId FROM note_attachments WHERE id = ?').get(attachmentId);
    if (!att) return res.status(404).json({ success: false, message: '附件不存在' });
    const filePath = path.join(__dirname, '../', att.fileUrl);
    try { await fs.unlink(filePath); } catch (e) {}
    db.prepare('DELETE FROM note_attachments WHERE id = ?').run(attachmentId);
    logToFile(`[云笔记] 管理员 ${user.username} 删除附件 ID:${attachmentId}，文件名:${att.fileName}，所属笔记:${att.noteId}`);
    res.json({ success: true });
});

// 下载/预览附件
router.get('/api/notes/download/:id', isLoggedIn, checkNotesBan, async (req, res) => {
    const attachmentId = req.params.id;
    const att = db.prepare('SELECT fileUrl, fileName, fileType, fileSize FROM note_attachments WHERE id = ?').get(attachmentId);
    if (!att) return res.status(404).json({ success: false, message: '附件不存在' });
    const filePath = path.join(__dirname, '../', att.fileUrl);
    try {
        await fs.access(filePath);
        const user = db.prepare('SELECT username FROM users WHERE userId = ?').get(req.userId);
        const disposition = req.query.preview === 'true' ? 'inline' : 'attachment';
        let contentType = att.fileType || 'application/octet-stream';
        if (contentType.startsWith('text/') || att.fileName.match(/\.(txt|md|js|css|html|json|xml)$/i)) {
            contentType = 'text/plain; charset=utf-8';
        }
        res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(att.fileName)}`);
        res.setHeader('Content-Type', contentType);
        const readStream = fsSync.createReadStream(filePath);
        const passThrough = new PassThrough();
        let bytesTransferred = 0, recorded = false;
        passThrough.on('data', (chunk) => { bytesTransferred += chunk.length; });
        const finishRecord = () => {
            if (recorded) return;
            recorded = true;
            db.prepare(`INSERT INTO user_traffic (user_id, type, bytes, path) VALUES (?, 'download', ?, ?)`).run(req.userId, bytesTransferred, att.fileUrl);
            logToFile(`[云笔记] 用户 ${user.username} ${disposition === 'inline' ? '预览' : '下载'}附件 ID:${attachmentId}，文件名:${att.fileName}，实际传输 ${bytesTransferred} / ${att.fileSize} bytes`);
        };
        passThrough.on('finish', finishRecord);
        passThrough.on('error', finishRecord);
        res.on('finish', finishRecord);
        res.on('close', finishRecord);
        readStream.pipe(passThrough).pipe(res);
    } catch (err) {
        console.error(`附件不存在: ${filePath}`, err);
        res.status(500).json({ success: false, message: '文件不存在' });
    }
});

// 重命名附件（仅管理员）
router.put('/api/notes/attachment/rename/:id', isLoggedIn, checkNotesBan, async (req, res) => {
    const user = db.prepare('SELECT role, username FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false });
    const attachmentId = req.params.id;
    const { newFileName } = req.body;
    if (!newFileName || newFileName.trim() === '') return res.status(400).json({ success: false, message: '新文件名不能为空' });
    const cleanName = newFileName.trim();
    const att = db.prepare('SELECT fileName, noteId FROM note_attachments WHERE id = ?').get(attachmentId);
    if (!att) return res.status(404).json({ success: false, message: '附件不存在' });
    const duplicate = db.prepare('SELECT id FROM note_attachments WHERE noteId = ? AND fileName = ? AND id != ?').get(att.noteId, cleanName, attachmentId);
    if (duplicate) return res.status(400).json({ success: false, message: '该笔记中已存在同名文件' });
    db.prepare('UPDATE note_attachments SET fileName = ? WHERE id = ?').run(cleanName, attachmentId);
    logToFile(`[云笔记] 管理员 ${user.username} 重命名附件 ID:${attachmentId}，原文件名:${att.fileName}，新文件名:${cleanName}`);
    res.json({ success: true });
});

module.exports = router;