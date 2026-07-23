// middleware/banCheck.js
const db = require('../db/connection');

function checkBan(banType) {
    return (req, res, next) => {
        const userId = req.userId || req.session.userId;
        if (!userId) return next();

        const now = new Date().toISOString();
        const ban = db.prepare(`
            SELECT * FROM user_bans 
            WHERE user_id = ? AND (ban_type = ? OR ban_type = 'all')
            AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY expires_at NULLS FIRST
            LIMIT 1
        `).get(userId, banType, now);

        if (ban) {
            let message = '';
            switch (ban.ban_type) {
                case 'login': message = '您的账号已被封禁，无法登录'; break;
                case 'chat': message = '您已被限制使用聊天功能'; break;
                case 'files_upload': message = '您已被限制上传文件到网盘'; break;
                case 'files_download': message = '您已被限制下载网盘文件'; break;
                case 'notes': message = '您已被限制使用云笔记功能'; break;
                case 'all': message = '您的账号已被全面封禁'; break;
                default: message = '您已被限制使用此功能';
            }
            if (ban.reason) message += `，原因：${ban.reason}`;
            if (ban.expires_at) {
                const expireDate = new Date(ban.expires_at);
                message += `，将于 ${expireDate.toLocaleString()} 自动解封`;
            } else {
                message += `，此封禁为永久`;
            }
            return res.status(403).json({ success: false, message, banned: true, ban_type: ban.ban_type });
        }
        next();
    };
}

const checkLoginBan = checkBan('login');
const checkChatBan = checkBan('chat');
const checkFilesUploadBan = checkBan('files_upload');
const checkFilesDownloadBan = checkBan('files_download');
const checkNotesBan = checkBan('notes');

module.exports = { checkBan, checkLoginBan, checkChatBan, checkFilesUploadBan, checkFilesDownloadBan, checkNotesBan };