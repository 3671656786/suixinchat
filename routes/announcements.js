// routes/announcements.js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { isLoggedIn } = require('../middleware/auth');
const { getIO } = require('../socket');

router.get('/api/announcements', (req, res) => {
    try {
        const announcements = db.prepare('SELECT * FROM announcements ORDER BY timestamp DESC LIMIT 20').all();
        res.json({ success: true, announcements });
    } catch (err) {
        res.json({ success: false });
    }
});

router.post('/api/announcements', isLoggedIn, (req, res) => {
    const userId = req.userId;
    const user = db.prepare('SELECT role, username FROM users WHERE userId = ?').get(userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    const { content } = req.body;
    if (!content) return res.status(400).json({ success: false, message: '内容不能为空' });
    try {
        db.prepare('INSERT INTO announcements (content, publisherId, publisherName) VALUES (?, ?, ?)').run(content, userId, user.username);
        const newAnnouncement = { content, publisherName: user.username, timestamp: new Date().toISOString() };
        const io = getIO();
        if (io) io.to('chatroom').emit('new announcement', newAnnouncement);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/api/announcements/:id', isLoggedIn, (req, res) => {
    const userId = req.userId;
    const user = db.prepare('SELECT role FROM users WHERE userId = ?').get(userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
    const id = req.params.id;
    db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
    res.json({ success: true });
});

module.exports = router;