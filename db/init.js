// db/init.js
const db = require('./connection');
const bcrypt = require('bcrypt');
const { DEFAULT_AVATAR_URL } = require('../config');

async function initDatabase() {
    await db._waitReady();
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            userId INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            email TEXT,
            avatarUrl TEXT,
            role TEXT DEFAULT 'user',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            agreed_agreement_version INTEGER DEFAULT 0,
            agreed_agreement_at DATETIME
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
        
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            username TEXT NOT NULL,
            avatarUrl TEXT,
            content TEXT,
            fileUrl TEXT,
            fileName TEXT,
            fileType TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            replyToId INTEGER DEFAULT NULL,
            replyToUsername TEXT,
            replyToContent TEXT,
            groupId INTEGER DEFAULT 0
        );
        
        CREATE TABLE IF NOT EXISTS private_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user INTEGER NOT NULL,
            to_user INTEGER NOT NULL,
            content TEXT,
            fileUrl TEXT,
            fileName TEXT,
            fileType TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_read INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_private_messages_users ON private_messages(from_user, to_user);
        CREATE INDEX IF NOT EXISTS idx_private_messages_unread ON private_messages(to_user, is_read);
        
        CREATE TABLE IF NOT EXISTS message_reads (
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (message_id, user_id)
        );
        
        CREATE TABLE IF NOT EXISTS reg_attempts (
            ip TEXT,
            attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            publisherId INTEGER NOT NULL,
            publisherName TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS file_nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parentId INTEGER DEFAULT 0,
            isFolder INTEGER DEFAULT 0,
            fileUrl TEXT,
            fileType TEXT,
            fileSize INTEGER,
            originalName TEXT,
            uploaderId INTEGER,
            uploaderName TEXT,
            downloadCount INTEGER DEFAULT 0,
            starred INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- 群聊功能
        CREATE TABLE IF NOT EXISTS chat_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            ownerId INTEGER NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS group_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            groupId INTEGER NOT NULL,
            userId INTEGER NOT NULL,
            role TEXT DEFAULT 'member',
            joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(groupId, userId)
        );
        CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(groupId);
        CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(userId);
        CREATE INDEX IF NOT EXISTS idx_messages_groupId ON messages(groupId);

        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            content TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            createdBy INTEGER
        );
        
        CREATE TABLE IF NOT EXISTS note_attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            noteId INTEGER NOT NULL,
            fileUrl TEXT NOT NULL,
            fileName TEXT NOT NULL,
            fileType TEXT,
            fileSize INTEGER,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS email_verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS user_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            loginTime DATETIME NOT NULL,
            logoutTime DATETIME,
            duration INTEGER DEFAULT 0
        );
        
        CREATE TABLE IF NOT EXISTS user_traffic (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            bytes INTEGER NOT NULL,
            path TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_user_traffic_user ON user_traffic(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_traffic_time ON user_traffic(timestamp);
        
        CREATE TABLE IF NOT EXISTS report_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            enabled INTEGER DEFAULT 0,
            cron TEXT DEFAULT '0 9 * * *',
            emails TEXT,
            data_types TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS user_bans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            ban_type TEXT NOT NULL,
            reason TEXT,
            banned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            UNIQUE(user_id, ban_type)
        );
        CREATE INDEX IF NOT EXISTS idx_user_bans_user ON user_bans(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_bans_expires ON user_bans(expires_at);
        
        CREATE TABLE IF NOT EXISTS email_blacklist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS system_config (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS agreement_version (
            id INTEGER PRIMARY KEY CHECK (id = 1) DEFAULT 1,
            version INTEGER DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
        CREATE INDEX IF NOT EXISTS idx_file_nodes_parentId ON file_nodes(parentId);
    `);

    // 迁移旧表添加列
    try { db.exec('ALTER TABLE messages ADD COLUMN replyToUsername TEXT'); } catch(e) {}
    try { db.exec('ALTER TABLE messages ADD COLUMN replyToContent TEXT'); } catch(e) {}
    try { db.exec('ALTER TABLE users ADD COLUMN agreed_agreement_version INTEGER DEFAULT 0'); } catch(e) {}
    try { db.exec('ALTER TABLE users ADD COLUMN agreed_agreement_at DATETIME'); } catch(e) {}

    // 创建 root 文件夹
    const rootFolder = db.prepare('SELECT id FROM file_nodes WHERE name = ? AND parentId = 0').get('root');
    if (!rootFolder) {
        db.prepare('INSERT INTO file_nodes (name, parentId, isFolder) VALUES (?, ?, ?)').run('root', 0, 1);
    }

    // 创建默认管理员
    const adminExists = db.prepare('SELECT userId FROM users WHERE username = ?').get('admin');
    if (!adminExists) {
        const defaultHash = bcrypt.hashSync('admin123', 10);
        db.prepare('INSERT INTO users (username, password, avatarUrl, role) VALUES (?, ?, ?, ?)').run('admin', defaultHash, DEFAULT_AVATAR_URL, 'admin');
        console.log('默认管理员已创建：用户名 admin，密码 admin123');
    }

    // 初始化报表配置
    const reportConfigExists = db.prepare('SELECT id FROM report_config WHERE id = 1').get();
    if (!reportConfigExists) {
        db.prepare(`INSERT INTO report_config (id, enabled, cron, emails, data_types) VALUES (1, 0, '0 9 * * *', 'admin@example.com', '["traffic","online","messages","files","users"]')`).run();
    }

    // 初始化系统配置（全局容量等）
    const maxGlobal = db.prepare('SELECT value FROM system_config WHERE key = ?').get('max_global_upload_bytes');
    if (!maxGlobal) {
        db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?)').run('max_global_upload_bytes', (10 * 1024 * 1024 * 1024).toString());
        db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?)').run('total_upload_bytes', '0');
        console.log('已初始化系统配置（全局容量）');
    }

    // 初始化协议版本
    const agreementVer = db.prepare('SELECT id FROM agreement_version WHERE id = 1').get();
    if (!agreementVer) {
        db.prepare('INSERT INTO agreement_version (id, version) VALUES (1, 1)').run();
    }

    db.exec('PRAGMA foreign_keys = ON;');

    // 清理过期注册尝试记录（保留7天）
    try {
        db.exec("DELETE FROM reg_attempts WHERE attempt_time < datetime('now', '-7 days')");
    } catch(e) {}

    console.log('数据库初始化完成');
}

module.exports = { initDatabase };