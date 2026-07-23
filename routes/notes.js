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

// 上传笔记附件（仅管理员）
router.post('/api/notes/upload', isLoggedIn, checkNotesBan, (req, res, next) => {
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(req.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false, message: '仅管理员可上传附件' });
    next();
}, multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } }).array('files', 10), (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, message: '未上传文件' });
    // 验证每个文件内容
    for (const file of req.files) {
        const validation = validateFileType(file.path, file.mimetype);
        if (!validation.valid) {
            for (const f of req.files) {
                try { fs.unlinkSync(f.path); } catch(e) {}
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

// 获取所有笔记
router.get('/api/notes', isLoggedIn, checkNotesBan, (req, res) => {
    try {
        const notes = db.prepare(`
            SELECT n.*, u.username as creatorName 
            FROM notes n 
            LEFT JOIN users u ON n.createdBy = u.userId 
            ORDER BY n.createdAt DESC
        `).all();
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
    const { title, content, attachments } = req.body;
    if (!title) return res.status(400).json({ success: false, message: '标题不能为空' });
    const result = db.prepare(`INSERT INTO notes (title, content, createdBy, createdAt, updatedAt)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(title, content || '', req.userId);
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
    const { title, content, attachments } = req.body;
    const noteId = req.params.id;
    if (!title) return res.status(400).json({ success: false, message: '标题不能为空' });
    const oldAttachments = db.prepare('SELECT fileUrl FROM note_attachments WHERE noteId = ?').all(noteId);
    for (const att of oldAttachments) {
        const filePath = path.join(__dirname, '../', att.fileUrl);
        try { fs.unlinkSync(filePath); } catch(e) {}
    }
    db.prepare('DELETE FROM note_attachments WHERE noteId = ?').run(noteId);
    db.prepare(`UPDATE notes SET title = ?, content = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`).run(title, content || '', noteId);
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

// 下载/预览附件（实时记录实际传输字节）
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
    // 检查同名文件
    const duplicate = db.prepare('SELECT id FROM note_attachments WHERE noteId = ? AND fileName = ? AND id != ?').get(att.noteId, cleanName, attachmentId);
    if (duplicate) return res.status(400).json({ success: false, message: '该笔记中已存在同名文件' });
    db.prepare('UPDATE note_attachments SET fileName = ? WHERE id = ?').run(cleanName, attachmentId);
    logToFile(`[云笔记] 管理员 ${user.username} 重命名附件 ID:${attachmentId}，原文件名:${att.fileName}，新文件名:${cleanName}`);
    res.json({ success: true });
});

module.exports = router;