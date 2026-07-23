// utils/safePath.js
const path = require('path');
const fs = require('fs');

function safePath(baseDir, userPath) {
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
    
    if (!fullPath.startsWith(absoluteBase)) {
        throw new Error('Path traversal detected: path escapes base directory');
    }
    
    if (fs.existsSync(fullPath)) {
        try {
            const realPath = fs.realpathSync(fullPath);
            if (!realPath.startsWith(absoluteBase)) {
                throw new Error('Path traversal detected via symlink');
            }
            return realPath;
        } catch (err) {
            if (err.message && err.message.includes('Path traversal')) throw err;
        }
    } else {
        const parentDir = path.resolve(path.dirname(fullPath));
        if (!parentDir.startsWith(absoluteBase)) {
            throw new Error('Path traversal detected: parent directory escapes base');
        }
    }
    
    return fullPath;
}

module.exports = { safePath };