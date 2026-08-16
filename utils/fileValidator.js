// utils/fileValidator.js
const fs = require('fs');

const MAGIC_SIGNATURES = {
    'image/jpeg': [['FFD8FF', 0]],
    'image/png': [['89504E47', 0]],
    'image/gif': [['47494638', 0]],
    'image/webp': [['52494646', 0]],
    'image/svg+xml': [['3C737667', 0], ['3C3F786D', 0]],
    'image/bmp': [['424D', 0]],  // #2-低 修复：添加 BMP
    'image/tiff': [['49492A00', 0], ['4D4D002A', 0]],  // #2-低 修复：添加 TIFF
    'video/mp4': [['66747970', 4]],
    'video/quicktime': [['66747970', 4]],
    'video/x-msvideo': [['52494646', 0]],
    'video/webm': [['1A45DFA3', 0]],
    'video/ogg': [['4F676753', 0]],
    'application/pdf': [['25504446', 0]],
    'application/msword': [['504B0304', 0]],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [['504B0304', 0]],
    'application/vnd.ms-excel': [['504B0304', 0]],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [['504B0304', 0]],
    'application/vnd.ms-powerpoint': [['504B0304', 0]],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': [['504B0304', 0]],
    // #2-低 修复：添加 ODT/ODS/ODP
    'application/vnd.oasis.opendocument.text': [['504B0304', 0]],
    'application/vnd.oasis.opendocument.spreadsheet': [['504B0304', 0]],
    'application/vnd.oasis.opendocument.presentation': [['504B0304', 0]],
    'text/plain': [],
    'text/csv': [],
    'application/zip': [['504B0304', 0]],
    'application/x-rar-compressed': [['52617221', 0]],
    'application/x-7z-compressed': [['377ABCAF', 0]],
    'application/json': [],
    'application/xml': [],
    'audio/mpeg': [['FFFB', 0], ['FFF3', 0], ['FFE3', 0], ['494433', 0]],
    'audio/wav': [['52494646', 0]],
    'audio/ogg': [['4F676753', 0]],
    'audio/webm': [['1A45DFA3', 0]]
};

function readFileHexSignature(filePath, bytes = 8) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(bytes);
        const bytesRead = fs.readSync(fd, buffer, 0, bytes, 0);
        fs.closeSync(fd);
        if (bytesRead === 0) return '';
        return buffer.slice(0, bytesRead).toString('hex').toUpperCase();
    } catch (e) {
        return '';
    }
}

function validateFileType(filePath, declaredMime) {
    // 修复 #22：读取16字节，保证 WebP 的 "WEBP" 标记（位于第8-11字节）在范围内
    const hex = readFileHexSignature(filePath, 16);
    if (!hex) return { valid: false, detectedType: null, reason: '无法读取文件' };

    // #23 修复：检测 UTF-16 文本文件
    if (hex.startsWith('FFFE') || hex.startsWith('FEFF')) {
        return { valid: true, detectedType: 'text/plain; charset=utf-16' };
    }

    if (declaredMime === 'text/plain' || declaredMime === 'text/csv' ||
        declaredMime === 'application/json' || declaredMime === 'application/xml') {
        try {
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(512);
            const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
            fs.closeSync(fd);
            // 允许少量 NULL 字节（UTF-16 等），但超过 5% 则拒绝
            let nullCount = 0;
            for (let i = 0; i < bytesRead; i++) {
                if (buffer[i] === 0) nullCount++;
            }
            if (nullCount > bytesRead * 0.05 && !declaredMime.startsWith('application/')) {
                return { valid: false, detectedType: 'binary', reason: '文件包含过多NULL字节，可能不是纯文本' };
            }
        } catch (e) {}
        return { valid: true, detectedType: declaredMime };
    }

    const signatures = MAGIC_SIGNATURES[declaredMime];
    if (!signatures || signatures.length === 0) {
        return { valid: true, detectedType: declaredMime };
    }

    if (declaredMime === 'image/svg+xml') {
        const headerText = hex.startsWith('3C737667') || hex.startsWith('3C3F786D');
        if (headerText) return { valid: true, detectedType: declaredMime };
        return { valid: false, detectedType: null, reason: '文件头不匹配SVG格式' };
    }

    if (declaredMime === 'image/webp') {
        // RIFF(0-3) + size(4-7) + WEBP(8-11)：检查偏移 8 处的 'WEBP' 标记
        if (hex.startsWith('52494646') && hex.substring(16, 24) === '57454250') {
            return { valid: true, detectedType: declaredMime };
        }
        return { valid: false, detectedType: null, reason: '文件头不匹配WebP格式' };
    }

    if (declaredMime.startsWith('application/vnd.openxmlformats') || 
        declaredMime === 'application/msword' ||
        declaredMime === 'application/vnd.ms-excel' ||
        declaredMime === 'application/vnd.ms-powerpoint' ||
        declaredMime === 'application/vnd.oasis.opendocument.text' ||
        declaredMime === 'application/vnd.oasis.opendocument.spreadsheet' ||
        declaredMime === 'application/vnd.oasis.opendocument.presentation') {
        if (!hex.startsWith('504B0304')) {
            return { valid: false, detectedType: null, reason: 'Office文档应为ZIP格式，但文件头不匹配' };
        }
        return { valid: true, detectedType: declaredMime };
    }

    for (const [sig, offset] of signatures) {
        const sigHex = hex.substring(offset * 2, offset * 2 + sig.length);
        if (sigHex === sig) {
            return { valid: true, detectedType: declaredMime };
        }
    }

    return { valid: false, detectedType: null, reason: `文件头 (${hex.substring(0, 16)}...) 与声明的 ${declaredMime} 类型不匹配` };
}

module.exports = { validateFileType, readFileHexSignature, MAGIC_SIGNATURES };