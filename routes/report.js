// routes/report.js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { isAdmin } = require('../middleware/admin');
const { sendMail } = require('../utils/email');
const { escapeHtml } = require('../utils/helpers');
const schedule = require('node-schedule');

let scheduledJob = null;

// ========== 获取系统设置 ==========
function getSystemSettings() {
    const settings = {};
    const configs = db.prepare('SELECT key, value FROM system_config').all();
    for (const row of configs) {
        settings[row.key] = row.value;
    }
    return settings;
}

// ========== 生成详细报表 HTML ==========
async function generateReportHtml(dataTypes) {
    const now = new Date();
    const settings = getSystemSettings();
    
    let html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>随心聊数据报表</title></head>
        <body style="font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; max-width: 900px; margin: 0 auto; background: #f5f7fa; color: #333;">
        <div style="background: white; border-radius: 20px; padding: 30px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
            <div style="text-align: center; border-bottom: 3px solid #07c160; padding-bottom: 20px; margin-bottom: 25px;">
                <h1 style="color: #07c160; margin: 0; font-size: 28px;">💬 随心聊 数据报表</h1>
                <p style="color: #888; margin: 8px 0 0;">生成时间：${now.toLocaleString('zh-CN')}</p>
            </div>
    `;

    // ---- 用户统计 ----
    if (dataTypes.includes('users')) {
        const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        let newUsersWeek = 0;
        try {
            const r = db.prepare(`SELECT COUNT(*) as count FROM users WHERE createdAt IS NOT NULL AND datetime(createdAt) >= datetime('now', '-7 days')`).get();
            newUsersWeek = r ? r.count : 0;
        } catch(e) {}
        const todayUsers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE date(createdAt) = date('now')`).get().count;
        const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
        const emailEnabled = db.prepare("SELECT COUNT(*) as count FROM users WHERE receive_email_announcements = 1").get().count;
        const emailDisabled = db.prepare("SELECT COUNT(*) as count FROM users WHERE receive_email_announcements = 0").get().count;
        
        html += `<div style="background: #f0f8f0; border-radius: 14px; padding: 18px; margin-bottom: 20px; border-left: 4px solid #07c160;">
            <h3 style="margin: 0 0 12px; color: #2e7d32;">👥 用户统计</h3>
            <table style="width:100%; border-collapse: collapse; font-size: 14px;">
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #e8f5e9;"><strong>总注册用户数</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e8f5e9; text-align: right;">${totalUsers}</td></tr>
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #e8f5e9;"><strong>今日新增</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e8f5e9; text-align: right;">${todayUsers}</td></tr>
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #e8f5e9;"><strong>近7天新增</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e8f5e9; text-align: right;">${newUsersWeek}</td></tr>
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #e8f5e9;"><strong>管理员数量</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e8f5e9; text-align: right;">${adminCount}</td></tr>
                <tr><td style="padding: 6px 0;"><strong>接收邮件公告</strong></td><td style="padding: 6px 0; text-align: right;">${emailEnabled} 人</td></tr>
                <tr><td style="padding: 6px 0;"><strong>拒绝邮件公告</strong></td><td style="padding: 6px 0; text-align: right;">${emailDisabled} 人</td></tr>
            </table>
        </div>`;
    }

    // ---- 消息统计 ----
    if (dataTypes.includes('messages')) {
        const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
        const todayMessages = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE date(timestamp) = date('now')`).get().count;
        const groupMessages = db.prepare('SELECT COUNT(*) as count FROM messages WHERE groupId > 0').get().count;
        const publicMessages = db.prepare('SELECT COUNT(*) as count FROM messages WHERE groupId = 0').get().count;
        const privateMessages = db.prepare('SELECT COUNT(*) as count FROM private_messages').get().count;
        
        html += `<div style="background: #e3f2fd; border-radius: 14px; padding: 18px; margin-bottom: 20px; border-left: 4px solid #1976d2;">
            <h3 style="margin: 0 0 12px; color: #0d47a1;">💬 消息统计</h3>
            <table style="width:100%; border-collapse: collapse; font-size: 14px;">
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #e3f2fd;"><strong>历史消息总数</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e3f2fd; text-align: right;">${totalMessages}</td></tr>
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #e3f2fd;"><strong>今日消息数</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e3f2fd; text-align: right;">${todayMessages}</td></tr>
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #e3f2fd;"><strong>公共聊天消息</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e3f2fd; text-align: right;">${publicMessages}</td></tr>
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #e3f2fd;"><strong>群聊消息</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e3f2fd; text-align: right;">${groupMessages}</td></tr>
                <tr><td style="padding: 6px 0;"><strong>私聊消息</strong></td><td style="padding: 6px 0; text-align: right;">${privateMessages}</td></tr>
            </table>
        </div>`;
    }

    // ---- 文件统计 ----
    if (dataTypes.includes('files')) {
        const totalFiles = db.prepare('SELECT COUNT(*) as count FROM file_nodes WHERE isFolder = 0').get().count;
        const totalSize = db.prepare('SELECT SUM(fileSize) as total FROM file_nodes WHERE isFolder = 0').get().total || 0;
        const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
        const sizeGB = (totalSize / 1024 / 1024 / 1024).toFixed(2);
        const totalFolders = db.prepare('SELECT COUNT(*) as count FROM file_nodes WHERE isFolder = 1').get().count;
        const starredFiles = db.prepare('SELECT COUNT(*) as count FROM file_nodes WHERE isFolder = 0 AND starred = 1').get().count;
        
        html += `<div style="background: #fff3e0; border-radius: 14px; padding: 18px; margin-bottom: 20px; border-left: 4px solid #e65100;">
            <h3 style="margin: 0 0 12px; color: #bf360c;">📁 文件统计</h3>
            <table style="width:100%; border-collapse: collapse; font-size: 14px;">
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #fff3e0;"><strong>总文件数</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #fff3e0; text-align: right;">${totalFiles}</td></tr>
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #fff3e0;"><strong>总文件夹数</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #fff3e0; text-align: right;">${totalFolders}</td></tr>
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #fff3e0;"><strong>总占用空间</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #fff3e0; text-align: right;">${sizeMB} MB (${sizeGB} GB)</td></tr>
                <tr><td style="padding: 6px 0;"><strong>星标文件数</strong></td><td style="padding: 6px 0; text-align: right;">${starredFiles}</td></tr>
            </table>
        </div>`;
    }

    // ---- 在线时长排行 ----
    if (dataTypes.includes('online')) {
        const allOnline = db.prepare(`
            SELECT u.username, COALESCE(SUM(s.duration), 0) as totalSeconds
            FROM users u
            LEFT JOIN user_sessions s ON u.userId = s.userId
            GROUP BY u.userId
            HAVING totalSeconds > 0
            ORDER BY totalSeconds DESC
            LIMIT 20
        `).all();
        html += `<div style="background: #f3e5f5; border-radius: 14px; padding: 18px; margin-bottom: 20px; border-left: 4px solid #6a1b9a;">
            <h3 style="margin: 0 0 12px; color: #4a148c;">⏱️ 在线时长排行（Top 20）</h3>`;
        if (allOnline.length === 0) {
            html += `<p style="color:#999;">暂无在线时长数据</p>`;
        } else {
            html += `<table style="width:100%; border-collapse: collapse; font-size: 14px;">
                <thead><tr style="background:#f3e5f5;"><th style="padding:8px 12px; text-align:left;">用户名</th><th style="padding:8px 12px; text-align:right;">总在线时长（小时）</th></tr></thead><tbody>`;
            for (const u of allOnline) {
                const hours = (u.totalSeconds / 3600).toFixed(1);
                html += `<tr><td style="padding:6px 12px; border-bottom:1px solid #f3e5f5;">${escapeHtml(u.username)}</td><td style="padding:6px 12px; border-bottom:1px solid #f3e5f5; text-align:right;">${hours}</td></tr>`;
            }
            html += `</tbody></table>`;
        }
        html += `</div>`;
    }

    // ---- 流量统计 ----
    if (dataTypes.includes('traffic')) {
        const totalUpload = db.prepare(`SELECT COALESCE(SUM(bytes), 0) as total FROM user_traffic WHERE type = 'upload'`).get().total;
        const totalDownload = db.prepare(`SELECT COALESCE(SUM(bytes), 0) as total FROM user_traffic WHERE type = 'download'`).get().total;
        const uploadMB = (totalUpload / 1024 / 1024).toFixed(2);
        const downloadMB = (totalDownload / 1024 / 1024).toFixed(2);
        const uploadGB = (totalUpload / 1024 / 1024 / 1024).toFixed(2);
        const downloadGB = (totalDownload / 1024 / 1024 / 1024).toFixed(2);
        const totalMB = (totalUpload + totalDownload) / 1024 / 1024;
        const totalGB = (totalUpload + totalDownload) / 1024 / 1024 / 1024;
        
        html += `<div style="background: #e0f7fa; border-radius: 14px; padding: 18px; margin-bottom: 20px; border-left: 4px solid #00695c;">
            <h3 style="margin: 0 0 12px; color: #004d40;">📈 流量统计</h3>
            <table style="width:100%; border-collapse: collapse; font-size: 14px;">
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #e0f7fa;"><strong>总上传流量</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e0f7fa; text-align: right;">${uploadMB} MB (${uploadGB} GB)</td></tr>
                <tr><td style="padding: 6px 0; border-bottom: 1px solid #e0f7fa;"><strong>总下载流量</strong></td><td style="padding: 6px 0; border-bottom: 1px solid #e0f7fa; text-align: right;">${downloadMB} MB (${downloadGB} GB)</td></tr>
                <tr><td style="padding: 6px 0;"><strong>总流量</strong></td><td style="padding: 6px 0; text-align: right;">${totalMB.toFixed(2)} MB (${totalGB.toFixed(2)} GB)</td></tr>
            </table>
        </div>`;
    }

    // ---- 系统设置 ----
    html += `<div style="background: #f5f5f5; border-radius: 14px; padding: 18px; margin-bottom: 20px; border-left: 4px solid #888;">
        <h3 style="margin: 0 0 12px; color: #333;">⚙️ 系统设置</h3>
        <table style="width:100%; border-collapse: collapse; font-size: 13px;">
            <tr><td style="padding: 4px 0; border-bottom: 1px solid #e0e0e0;"><strong>全局容量</strong></td><td style="padding: 4px 0; border-bottom: 1px solid #e0e0e0; text-align: right;">${settings.max_global_upload_bytes ? (parseInt(settings.max_global_upload_bytes) / 1024 / 1024 / 1024).toFixed(0) + ' GB' : '10 GB'}</td></tr>
            <tr><td style="padding: 4px 0; border-bottom: 1px solid #e0e0e0;"><strong>已用全局容量</strong></td><td style="padding: 4px 0; border-bottom: 1px solid #e0e0e0; text-align: right;">${settings.total_upload_bytes ? (parseInt(settings.total_upload_bytes) / 1024 / 1024 / 1024).toFixed(2) + ' GB' : '0 GB'}</td></tr>
            <tr><td style="padding: 4px 0; border-bottom: 1px solid #e0e0e0;"><strong>单文件大小限制</strong></td><td style="padding: 4px 0; border-bottom: 1px solid #e0e0e0; text-align: right;">${settings.max_file_size_bytes ? (parseInt(settings.max_file_size_bytes) / 1024 / 1024).toFixed(0) + ' MB' : '50 MB'}</td></tr>
            <tr><td style="padding: 4px 0; border-bottom: 1px solid #e0e0e0;"><strong>用户默认容量</strong></td><td style="padding: 4px 0; border-bottom: 1px solid #e0e0e0; text-align: right;">${settings.user_default_capacity_bytes ? (parseInt(settings.user_default_capacity_bytes) / 1024 / 1024).toFixed(0) + ' MB' : '100 MB'}</td></tr>
            <tr><td style="padding: 4px 0; border-bottom: 1px solid #e0e0e0;"><strong>消息长度限制</strong></td><td style="padding: 4px 0; border-bottom: 1px solid #e0e0e0; text-align: right;">${process.env.MAX_MESSAGE_LENGTH || '2000'} 字符</td></tr>
            <tr><td style="padding: 4px 0;"><strong>消息频率限制</strong></td><td style="padding: 4px 0; text-align: right;">${process.env.MESSAGE_RATE_LIMIT_MS || '300'} ms</td></tr>
        </table>
    </div>`;

    // ---- 封禁统计 ----
    const bannedCount = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM user_bans WHERE expires_at IS NULL OR expires_at > datetime('now')`).get().count;
    html += `<div style="background: #ffebee; border-radius: 14px; padding: 18px; margin-bottom: 20px; border-left: 4px solid #c62828;">
        <h3 style="margin: 0 0 12px; color: #b71c1c;">🔒 封禁统计</h3>
        <table style="width:100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 6px 0;"><strong>当前被封禁用户</strong></td><td style="padding: 6px 0; text-align: right;">${bannedCount}</td></tr>
        </table>
    </div>`;

    html += `
            <div style="text-align: center; color: #999; font-size: 12px; padding-top: 20px; border-top: 2px solid #eee; margin-top: 10px;">
                此邮件由随心聊系统自动发送，请勿回复。<br>
                © ${new Date().getFullYear()} 随心聊
            </div>
        </div>
        </body>
        </html>`;
    return html;
}

// ========== 获取报表配置 ==========
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

// ========== 更新报表配置 ==========
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

// ========== 手动发送报表 ==========
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
            await sendMail(email, `随心聊数据报表 - ${new Date().toLocaleString('zh-CN')}`, reportHtml);
        }
        res.json({ success: true, message: `报表已发送至 ${emails.join(', ')}` });
    } catch (err) {
        console.error('发送报表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 预览报表 ==========
router.post('/api/admin/report/preview', isAdmin, async (req, res) => {
    try {
        const { data_types } = req.body;
        const result = {};
        const settings = getSystemSettings();
        
        if (data_types.includes('users')) {
            const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
            let newUsersWeek = 0;
            try {
                const r = db.prepare(`SELECT COUNT(*) as count FROM users WHERE createdAt IS NOT NULL AND datetime(createdAt) >= datetime('now', '-7 days')`).get();
                newUsersWeek = r ? r.count : 0;
            } catch(e) {}
            const todayUsers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE date(createdAt) = date('now')`).get().count;
            const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
            const emailEnabled = db.prepare("SELECT COUNT(*) as count FROM users WHERE receive_email_announcements = 1").get().count;
            const emailDisabled = db.prepare("SELECT COUNT(*) as count FROM users WHERE receive_email_announcements = 0").get().count;
            result.users = { totalUsers, newUsersWeek, todayUsers, adminCount, emailEnabled, emailDisabled };
        }
        if (data_types.includes('messages')) {
            const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
            const todayMessages = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE date(timestamp) = date('now')`).get().count;
            const groupMessages = db.prepare('SELECT COUNT(*) as count FROM messages WHERE groupId > 0').get().count;
            const publicMessages = db.prepare('SELECT COUNT(*) as count FROM messages WHERE groupId = 0').get().count;
            const privateMessages = db.prepare('SELECT COUNT(*) as count FROM private_messages').get().count;
            result.messages = { totalMessages, todayMessages, groupMessages, publicMessages, privateMessages };
        }
        if (data_types.includes('files')) {
            const totalFiles = db.prepare('SELECT COUNT(*) as count FROM file_nodes WHERE isFolder = 0').get().count;
            const totalSize = db.prepare('SELECT SUM(fileSize) as total FROM file_nodes WHERE isFolder = 0').get().total || 0;
            const totalFolders = db.prepare('SELECT COUNT(*) as count FROM file_nodes WHERE isFolder = 1').get().count;
            const starredFiles = db.prepare('SELECT COUNT(*) as count FROM file_nodes WHERE isFolder = 0 AND starred = 1').get().count;
            result.files = { totalFiles, totalSizeMB: (totalSize / 1024 / 1024).toFixed(2), totalFolders, starredFiles };
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
        // 附加系统设置
        result.settings = {
            globalCapacity: settings.max_global_upload_bytes ? (parseInt(settings.max_global_upload_bytes) / 1024 / 1024 / 1024).toFixed(0) + ' GB' : '10 GB',
            usedCapacity: settings.total_upload_bytes ? (parseInt(settings.total_upload_bytes) / 1024 / 1024 / 1024).toFixed(2) + ' GB' : '0 GB',
            fileSizeLimit: settings.max_file_size_bytes ? (parseInt(settings.max_file_size_bytes) / 1024 / 1024).toFixed(0) + ' MB' : '50 MB',
            userDefaultCapacity: settings.user_default_capacity_bytes ? (parseInt(settings.user_default_capacity_bytes) / 1024 / 1024).toFixed(0) + ' MB' : '100 MB'
        };
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('预览报表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== 取消定时任务 ==========
function cancelReportSchedule() {
    if (scheduledJob) {
        scheduledJob.cancel();
        scheduledJob = null;
        console.log('📊 定时报表已取消');
    }
}

// ========== 初始化定时任务 ==========
function initReportSchedule() {
    cancelReportSchedule();
    
    try {
        const config = db.prepare('SELECT * FROM report_config WHERE id = 1').get();
        if (!config || !config.enabled) return;
        const cron = config.cron;
        const emails = config.emails.split(',').map(e => e.trim());
        const dataTypes = config.data_types ? JSON.parse(config.data_types) : [];
        if (!cron || emails.length === 0 || dataTypes.length === 0) return;
        
        scheduledJob = schedule.scheduleJob(cron, async function() {
            console.log('📊 执行定时报表任务');
            try {
                const reportHtml = await generateReportHtml(dataTypes);
                for (const email of emails) {
                    await sendMail(email, `随心聊数据报表 - ${new Date().toLocaleString('zh-CN')}`, reportHtml);
                }
                console.log('📊 定时报表发送成功');
            } catch (err) {
                console.error('📊 定时报表发送失败:', err);
            }
        });
        console.log(`📊 定时报表已启动，cron: ${cron}`);
    } catch (err) {
        console.error('初始化定时报表失败:', err);
    }
}

module.exports = { router, initReportSchedule, cancelReportSchedule };