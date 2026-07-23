// config/multer.js
const multer = require('multer');
const path = require('path');
const { AVATAR_DIR, NOTES_FILES_DIR, PRIVATE_FILES_DIR, PUBLIC_FILES_DIR, FILES_DIR, ALLOWED_UPLOAD_MIMES } = require('./index');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (req.url === '/api/uploadAvatar') cb(null, AVATAR_DIR);
        else if (req.url === '/api/notes/upload') cb(null, NOTES_FILES_DIR);
        else if (req.url === '/api/private/upload') cb(null, PRIVATE_FILES_DIR);
        else if (req.url === '/api/file/upload') cb(null, PUBLIC_FILES_DIR);
        else cb(null, FILES_DIR);
    },
    filename: (req, file, cb) => {
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