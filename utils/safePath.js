// utils/safePath.js
const path = require('path');
const fs = require('fs');

const isWindows = process.platform === 'win32';

// Windows 上路径比较不区分大小写
function pathsEqual(a, b) {
    if (isWindows) return a.toLowerCase() === b.toLowerCase();
    return a === b;
}

function startsWithPath(base, target) {
    if (isWindows) return target.toLowerCase().startsWith(base.toLowerCase());
    return target.startsWith(base);
}

// 修复 #23：对 undefined/null/非字符串路径做防御，返回 null 而不是崩溃
function safePath(baseDir, userPath) {
    if (userPath === undefined || userPath === null || typeof userPath !== 'string') {
        return null;
    }
    const absoluteBase = path.resolve(baseDir);
    
    let relative = userPath;
    const knownPrefixes = ['/uploads/', '\\uploads\\'];
    for (const prefix of knownPrefixes) {
        if (relative.startsWith(prefix)) {
            relative = relative.slice(prefix.length);
            break;
        }
    }
    
    let normalized = path.normalize(relative);
    let prev;
    do {
        prev = normalized;
        normalized = normalized.replace(/^(\.\.[\/\\])+/, '');
        normalized = normalized.replace(/^(\.[\/\\])+/, '');
        if (normalized === '..' || normalized === '.') {
            normalized = '';
        }
    } while (prev !== normalized);
    
    if (!normalized) {
        return absoluteBase;
    }
    
    const fullPath = path.resolve(absoluteBase, normalized);
    
    // 修复 #24：Windows 上使用大小写不敏感比较
    if (!startsWithPath(absoluteBase, fullPath)) {
        throw new Error('Path traversal detected: path escapes base directory');
    }
    
    if (fs.existsSync(fullPath)) {
        try {
            const realPath = fs.realpathSync(fullPath);
            if (!startsWithPath(absoluteBase, realPath)) {
                throw new Error('Path traversal detected via symlink');
            }
            return realPath;
        } catch (err) {
            if (err.message && err.message.includes('Path traversal')) throw err;
        }
    } else {
        const parentDir = path.resolve(path.dirname(fullPath));
        if (!startsWithPath(absoluteBase, parentDir)) {
            throw new Error('Path traversal detected: parent directory escapes base');
        }
    }
    
    return fullPath;
}

module.exports = { safePath };