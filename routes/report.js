// routes/report.js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { isAdmin } = require('../middleware/admin');
const { sendMail } = require('../utils/email');
const { escapeHtml } = require('../utils/helpers');
const schedule = require('node-schedule');

let scheduledJob = null;

// 生成报表 HTML
async function generateReportHtml(dataTypes) {
    const now = new Date();
    let html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>随心聊数据报表</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>📊 随心聊数据报表</h2>
        <p>生成时间：${now.toLocaleString()}</p>
        <hr>
    `;
    
    if (dataTypes.includes('users')) {
        const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        let newUsersWeek = 0;
        try {
            const r = db.prepare(`SELECT COUNT(*) as count FROM users WHERE createdAt IS NOT NULL AND datetime(createdAt) >= datetime('now', '-7 days')`).get();
            newUsersWeek = r ? r.count : 0;
        } catch(e) {}
        html += `<h3>👥 用户统计</h3><ul><li>总注册用户数：${totalUsers}</li><li>近7天新增用户：${newUsersWeek}</li></ul>`;
    }
    
    if (dataTypes.includes('messages')) {
        const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
        const todayMessages = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE date(timestamp) = date('now')`).get().count;
        html += `<h3>💬 消息统计</h3><ul><li>历史消息总数：${totalMessages}</li><li>今日消息数：${todayMessages}</li></ul>`;
    }
    
    if (dataTypes.includes('files')) {
        const totalFiles = db.prepare('SELECT COUNT(*) as count FROM file_nodes WHERE isFolder = 0').get().count;
        const totalSize = db.prepare('SELECT SUM(fileSize) as total FROM file_nodes WHERE isFolder = 0').get().total || 0;
        const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
        html += `<h3>📁 文件统计</h3><ul><li>总文件数：${totalFiles}</li><li>总占用空间：${sizeMB} MB</li></ul>`;
    }
    
    if (dataTypes.includes('online')) {
        const allOnline = db.prepare(`
            SELECT u.username, COALESCE(SUM(s.duration), 0) as totalSeconds
            FROM users u
            LEFT JOIN user_sessions s ON u.userId = s.userId
            GROUP BY u.userId
            HAVING totalSeconds > 0
            ORDER BY totalSeconds DESC
        `).all();
        html += `<h3>⏱️ 在线时长统计</h3>`;
        if (allOnline.length === 0) {
            html += `<p>暂无在线时长数据</p>`;
        } else {
            html += `<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;"><thead><tr><th>用户名</th><th>总在线时长（小时）</th></tr></thead><tbody>`;
            for (const u of allOnline) {
                const hours = (u.totalSeconds / 3600).toFixed(1);
                html += `<tr><td style="padding:6px;">${escapeHtml(u.username)}</td><td style="padding:6px;">${hours}</td></tr>`;
            }
            html += `</tbody></table>`;
        }
    }
    
    if (dataTypes.includes('traffic')) {
        const totalUpload = db.prepare(`SELECT COALESCE(SUM(bytes), 0) as total FROM user_traffic WHERE type = 'upload'`).get().total;
        const totalDownload = db.prepare(`SELECT COALESCE(SUM(bytes), 0) as total FROM user_traffic WHERE type = 'download'`).get().total;
        const uploadMB = (totalUpload / 1024 / 1024).toFixed(2);
        const downloadMB = (totalDownload / 1024 / 1024).toFixed(2);
        html += `<h3>📈 流量统计</h3><ul><li>总上传流量：${uploadMB} MB</li><li>总下载流量：${downloadMB} MB</li></ul>`;
    }
    
    html += `<hr><p style="color:#999; margin-top:20px;">此邮件由随心聊系统自动发送，请勿回复。</p></body></html>`;
    return html;
}

// 获取报表配置
router.get('/api/admin/report/config', isAdmin, (req, res) => {
    try {
        const config = db.prepare('SELECT * FROM report_config WHERE id = 1').get();
        if (!config) return res.json({ success: false, message: '配置不存在' });
        config.data_types = config.data_types ? JSON.parse(config.data_types) : [];
        res.json({ success: true, config });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 更新报表配置
router.post('/api/admin/report/config', isAdmin, (req, res) => {
    const { enabled, cron, emails, data_types } = req.body;
    if (!cron || !emails) return res.status(400).json({ success: false, message: '请填写定时规则和收件邮箱' });
    const cronParts = cron.trim().split(' ');
    if (cronParts.length !== 5 && cronParts.length !== 6) {
        return res.status(400).json({ success: false, message: 'Cron 表达式格式错误，应为 5 或 6 段' });
    }
    const dataTypesJson = JSON.stringify(data_types || []);
    db.prepare(`UPDATE report_config SET enabled = ?, cron = ?, emails = ?, data_types = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
        .run(enabled ? 1 : 0, cron, emails, dataTypesJson);
    initReportSchedule();
    res.json({ success: true });
});

// 手动发送报表
router.post('/api/admin/report/send', isAdmin, async (req, res) => {
    try {
        const { data_types: customDataTypes } = req.body;
        const config = db.prepare('SELECT * FROM report_config WHERE id = 1').get();
        if (!config) return res.status(400).json({ success: false, message: '未配置报表' });
        let dataTypes = customDataTypes;
        if (!dataTypes || !dataTypes.length) {
            dataTypes = config.data_types ? JSON.parse(config.data_types) : [];
        }
        const emails = config.emails.split(',').map(e => e.trim());
        if (emails.length === 0) return res.status(400).json({ success: false, message: '未配置收件邮箱' });
        const reportHtml = await generateReportHtml(dataTypes);
        for (const email of emails) {
            await sendMail(email, `随心聊数据报表 - ${new Date().toLocaleString()}`, reportHtml);
        }
        res.json({ success: true, message: `报表已发送至 ${emails.join(', ')}` });
    } catch (err) {
        console.error('发送报表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 预览报表
router.post('/api/admin/report/preview', isAdmin, async (req, res) => {
    try {
        const { data_types } = req.body;
        const result = {};
        if (data_types.includes('users')) {
            const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
            let newUsersWeek = 0;
            try {
                const r = db.prepare(`SELECT COUNT(*) as count FROM users WHERE createdAt IS NOT NULL AND datetime(createdAt) >= datetime('now', '-7 days')`).get();
                newUsersWeek = r ? r.count : 0;
            } catch(e) {}
            result.users = { totalUsers, newUsersWeek };
        }
        if (data_types.includes('messages')) {
            const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
            const todayMessages = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE date(timestamp) = date('now')`).get().count;
            result.messages = { totalMessages, todayMessages };
        }
        if (data_types.includes('files')) {
            const totalFiles = db.prepare('SELECT COUNT(*) as count FROM file_nodes WHERE isFolder = 0').get().count;
            const totalSize = db.prepare('SELECT SUM(fileSize) as total FROM file_nodes WHERE isFolder = 0').get().total || 0;
            result.files = { totalFiles, totalSizeMB: (totalSize / 1024 / 1024).toFixed(2) };
        }
        if (data_types.includes('online')) {
            const onlineStats = db.prepare(`
                SELECT u.username, COALESCE(SUM(s.duration), 0) as totalSeconds
                FROM users u
                LEFT JOIN user_sessions s ON u.userId = s.userId
                GROUP BY u.userId
                HAVING totalSeconds > 0
                ORDER BY totalSeconds DESC
            `).all();
            result.online = onlineStats.map(u => ({ username: u.username, hours: (u.totalSeconds / 3600).toFixed(1) }));
        }
        if (data_types.includes('traffic')) {
            const totalUpload = db.prepare(`SELECT COALESCE(SUM(bytes), 0) as total FROM user_traffic WHERE type = 'upload'`).get().total;
            const totalDownload = db.prepare(`SELECT COALESCE(SUM(bytes), 0) as total FROM user_traffic WHERE type = 'download'`).get().total;
            result.traffic = { uploadMB: (totalUpload / 1024 / 1024).toFixed(2), downloadMB: (totalDownload / 1024 / 1024).toFixed(2) };
        }
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('预览报表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 初始化定时任务
function initReportSchedule() {
    if (scheduledJob) {
        scheduledJob.cancel();
        scheduledJob = null;
    }
    try {
        const config = db.prepare('SELECT * FROM report_config WHERE id = 1').get();
        if (!config || !config.enabled) return;
        const cron = config.cron;
        const emails = config.emails.split(',').map(e => e.trim());
        const dataTypes = config.data_types ? JSON.parse(config.data_types) : [];
        if (!cron || emails.length === 0 || dataTypes.length === 0) return;
        scheduledJob = schedule.scheduleJob(cron, async () => {
            console.log('执行定时报表任务');
            try {
                const reportHtml = await generateReportHtml(dataTypes);
                for (const email of emails) {
                    await sendMail(email, `随心聊数据报表 - ${new Date().toLocaleString()}`, reportHtml);
                }
                console.log('定时报表发送成功');
            } catch (err) {
                console.error('定时报表发送失败:', err);
            }
        });
        console.log(`定时报表已启动，cron: ${cron}`);
    } catch (err) {
        console.error('初始化定时报表失败:', err);
    }
}

module.exports = { router, initReportSchedule };