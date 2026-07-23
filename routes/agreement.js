// routes/agreement.js
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { isAdmin } = require('../middleware/admin');

const AGREEMENT_FILE = path.join(__dirname, '../agreement.txt');

// 获取协议内容（所有用户可访问）
router.get('/api/agreement', async (req, res) => {
    try {
        let content = '';
        try {
            content = await fs.readFile(AGREEMENT_FILE, 'utf8');
        } catch (err) {
            content = `【随心聊用户协议】\n\n1. 尊重他人，文明聊天，不发布违法、色情、暴力、谩骂等内容。\n2. 请勿传播垃圾信息、广告或恶意刷屏。\n3. 保护个人隐私，不要随意泄露他人信息。\n4. 本平台有权对违规用户进行警告、封禁等处理。\n5. 如有任何疑问，请联系管理员。\n\n感谢您的使用！`;
        }
        res.json({ success: true, content });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 更新协议（仅管理员）
router.post('/api/admin/agreement', isAdmin, async (req, res) => {
    const { content } = req.body;
    if (content === undefined) {
        return res.status(400).json({ success: false, message: '内容不能为空' });
    }
    try {
        await fs.writeFile(AGREEMENT_FILE, content, 'utf8');
        res.json({ success: true, message: '协议已更新' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;