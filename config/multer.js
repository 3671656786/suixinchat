// config/multer.js
const multer = require('multer');
const path = require('path');
const { AVATAR_DIR, NOTES_FILES_DIR, PRIVATE_FILES_DIR, PUBLIC_FILES_DIR, FILES_DIR, ALLOWED_UPLOAD_MIMES } = require('./index');

// 修复：中文/非 ASCII 文件名乱码。
// busboy 默认按 latin1 解码 multipart 中的 filename，而现代浏览器按 UTF-8 发送，
// 导致中文文件名变成乱码。这里将 latin1 解码结果恢复为原始 UTF-8 字节。
function fixOriginalName(name) {
    if (!name) return name;
    try {
        const restored = Buffer.from(name, 'latin1').toString('utf8');
        // 恢复成功且未产生替换字符时使用恢复后的名字
        if (!restored.includes('\uFFFD')) return restored;
    } catch (e) { /* 忽略 */ }
    return name;
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (req.url === '/api/uploadAvatar') cb(null, AVATAR_DIR);
        else if (req.url === '/api/notes/upload') cb(null, NOTES_FILES_DIR);
        else if (req.url === '/api/private/upload') cb(null, PRIVATE_FILES_DIR);
        else if (req.url === '/api/file/upload') cb(null, PUBLIC_FILES_DIR);
        else cb(null, FILES_DIR);
    },
    filename: (req, file, cb) => {
        // 修正 originalname，确保后续使用（扩展名、数据库记录、返回给前端）均为正确编码
        file.originalname = fixOriginalName(file.originalname);
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, unique + ext);
    }
});

// 通用文件类型过滤器（所有上传共用）
function fileFilter(req, file, cb) {
    // 头像上传使用更严格的图片类型过滤
    if (req.url === '/api/uploadAvatar') {
        const { ALLOWED_AVATAR_MIMES } = require('./index');
        if (ALLOWED_AVATAR_MIMES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('头像仅支持 JPG/PNG/GIF/WebP/SVG 格式'));
        }
        return;
    }
    // 其他上传使用完整白名单
    if (ALLOWED_UPLOAD_MIMES.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('不支持的文件类型'));
    }
}

module.exports = { storage, fileFilter };