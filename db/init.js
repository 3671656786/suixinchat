// db/init.js
const db = require('./connection');
const bcrypt = require('bcrypt');
const { DEFAULT_AVATAR_URL, DEFAULT_CAPACITY } = require('../config');

async function initDatabase() {
    await db._waitReady();
    db.exec(`
        -- ========== 用户相关表 ==========
        CREATE TABLE IF NOT EXISTS users (
            userId INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            email TEXT,
            avatarUrl TEXT,
            role TEXT DEFAULT 'user',
            createdAt DATETIME DEFAULT (datetime('now')),
            agreed_agreement_version INTEGER DEFAULT 0,
            agreed_agreement_at DATETIME,
            receive_email_announcements INTEGER DEFAULT 1
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

        -- ========== 群聊消息表 ==========
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            username TEXT NOT NULL,
            avatarUrl TEXT,
            content TEXT,
            fileUrl TEXT,
            fileName TEXT,
            fileType TEXT,
            timestamp DATETIME DEFAULT (datetime('now')),
            replyToId INTEGER DEFAULT NULL,
            replyToUsername TEXT,
            replyToContent TEXT,
            groupId INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
        CREATE INDEX IF NOT EXISTS idx_messages_groupId ON messages(groupId);

        -- ========== 私聊消息表 ==========
        CREATE TABLE IF NOT EXISTS private_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user INTEGER NOT NULL,
            to_user INTEGER NOT NULL,
            content TEXT,
            fileUrl TEXT,
            fileName TEXT,
            fileType TEXT,
            timestamp DATETIME DEFAULT (datetime('now')),
            is_read INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_private_messages_users ON private_messages(from_user, to_user);
        CREATE INDEX IF NOT EXISTS idx_private_messages_unread ON private_messages(to_user, is_read);

        -- ========== 消息已读记录表 ==========
        CREATE TABLE IF NOT EXISTS message_reads (
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            read_at DATETIME DEFAULT (datetime('now')),
            PRIMARY KEY (message_id, user_id)
        );

        -- ========== 注册尝试记录表 ==========
        CREATE TABLE IF NOT EXISTS reg_attempts (
            ip TEXT,
            attempt_time DATETIME DEFAULT (datetime('now'))
        );

        -- ========== 公告表 ==========
        CREATE TABLE IF NOT EXISTS announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            publisherId INTEGER NOT NULL,
            publisherName TEXT,
            timestamp DATETIME DEFAULT (datetime('now'))
        );

        -- ========== 网盘文件节点表 ==========
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
            createdAt DATETIME DEFAULT (datetime('now')),
            updatedAt DATETIME DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_file_nodes_parentId ON file_nodes(parentId);

        -- ========== 群聊相关表 ==========
        CREATE TABLE IF NOT EXISTS chat_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            ownerId INTEGER NOT NULL,
            createdAt DATETIME DEFAULT (datetime('now')),
            avatar TEXT,
            join_approval INTEGER DEFAULT 0,
            allow_join INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS group_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            groupId INTEGER NOT NULL,
            userId INTEGER NOT NULL,
            role TEXT DEFAULT 'member',
            joinedAt DATETIME DEFAULT (datetime('now')),
            UNIQUE(groupId, userId)
        );
        CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(groupId);
        CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(userId);

        -- ========== 群黑名单表 ==========
        CREATE TABLE IF NOT EXISTS group_ban_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            banned_at DATETIME DEFAULT (datetime('now')),
            reason TEXT,
            UNIQUE(group_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_group_ban_group ON group_ban_list(group_id);
        CREATE INDEX IF NOT EXISTS idx_group_ban_user ON group_ban_list(user_id);

        -- ========== 群加入申请表 ==========
        CREATE TABLE IF NOT EXISTS group_join_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            reason TEXT,
            status TEXT DEFAULT 'pending',
            requested_at DATETIME DEFAULT (datetime('now')),
            processed_at DATETIME,
            processed_by INTEGER,
            UNIQUE(group_id, user_id, status)
        );
        CREATE INDEX IF NOT EXISTS idx_join_requests_group ON group_join_requests(group_id);
        CREATE INDEX IF NOT EXISTS idx_join_requests_status ON group_join_requests(status);

        -- ========== 云笔记表 ==========
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            content TEXT,
            createdAt DATETIME DEFAULT (datetime('now')),
            updatedAt DATETIME DEFAULT (datetime('now')),
            createdBy INTEGER,
            folderId INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_notes_folderId ON notes(folderId);

        CREATE TABLE IF NOT EXISTS note_attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            noteId INTEGER NOT NULL,
            fileUrl TEXT NOT NULL,
            fileName TEXT NOT NULL,
            fileType TEXT,
            fileSize INTEGER,
            createdAt DATETIME DEFAULT (datetime('now'))
        );

        -- ========== 笔记文件夹表 ==========
        CREATE TABLE IF NOT EXISTS note_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parentId INTEGER DEFAULT 0,
            createdBy INTEGER NOT NULL,
            createdAt DATETIME DEFAULT (datetime('now')),
            updatedAt DATETIME DEFAULT (datetime('now')),
            FOREIGN KEY (createdBy) REFERENCES users(userId)
        );
        CREATE INDEX IF NOT EXISTS idx_note_folders_parent ON note_folders(parentId);

        -- ========== 邮箱验证码表 ==========
        CREATE TABLE IF NOT EXISTS email_verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT (datetime('now'))
        );

        -- ========== 验证码频率限制表 ==========
        CREATE TABLE IF NOT EXISTS verification_cooldowns (
            key TEXT PRIMARY KEY,
            count INTEGER DEFAULT 0,
            first_time INTEGER DEFAULT 0,
            last_time INTEGER DEFAULT 0
        );

        -- ========== 用户在线时长记录表 ==========
        CREATE TABLE IF NOT EXISTS user_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            loginTime DATETIME NOT NULL,
            logoutTime DATETIME,
            duration INTEGER DEFAULT 0
        );

        -- ========== 用户流量统计表 ==========
        CREATE TABLE IF NOT EXISTS user_traffic (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            bytes INTEGER NOT NULL,
            path TEXT,
            timestamp DATETIME DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_user_traffic_user ON user_traffic(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_traffic_time ON user_traffic(timestamp);

        -- ========== 数据报表配置表 ==========
        CREATE TABLE IF NOT EXISTS report_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            enabled INTEGER DEFAULT 0,
            cron TEXT DEFAULT '0 9 * * *',
            emails TEXT,
            data_types TEXT,
            updated_at DATETIME DEFAULT (datetime('now'))
        );

        -- ========== 用户封禁表 ==========
        CREATE TABLE IF NOT EXISTS user_bans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            ban_type TEXT NOT NULL,
            reason TEXT,
            banned_at DATETIME DEFAULT (datetime('now')),
            expires_at DATETIME,
            UNIQUE(user_id, ban_type)
        );
        CREATE INDEX IF NOT EXISTS idx_user_bans_user ON user_bans(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_bans_expires ON user_bans(expires_at);

        -- ========== 邮箱黑名单表 ==========
        CREATE TABLE IF NOT EXISTS email_blacklist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            reason TEXT,
            created_at DATETIME DEFAULT (datetime('now'))
        );

        -- ========== 系统配置表 ==========
        CREATE TABLE IF NOT EXISTS system_config (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at DATETIME DEFAULT (datetime('now'))
        );

        -- ========== 用户协议版本表 ==========
        CREATE TABLE IF NOT EXISTS agreement_version (
            id INTEGER PRIMARY KEY CHECK (id = 1) DEFAULT 1,
            version INTEGER DEFAULT 1,
            updated_at DATETIME DEFAULT (datetime('now'))
        );

        -- ========== Session 存储表 ==========
        CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            sess TEXT NOT NULL,
            expire DATETIME NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
    `);

    // ========== 创建 root 文件夹 ==========
    const rootFolder = db.prepare('SELECT id FROM file_nodes WHERE name = ? AND parentId = 0').get('root');
    if (!rootFolder) {
        db.prepare('INSERT INTO file_nodes (name, parentId, isFolder) VALUES (?, ?, ?)').run('root', 0, 1);
        console.log('✅ 已创建 root 文件夹');
    }

    // ========== 创建默认管理员 ==========
    const adminExists = db.prepare('SELECT userId FROM users WHERE username = ?').get('admin');
    if (!adminExists) {
        const defaultHash = bcrypt.hashSync('admin123', 10);
        db.prepare('INSERT INTO users (username, password, avatarUrl, role, receive_email_announcements) VALUES (?, ?, ?, ?, ?)').run(
            'admin',
            defaultHash,
            DEFAULT_AVATAR_URL,
            'admin',
            1
        );
        console.log('✅ 默认管理员已创建：用户名 admin，密码 admin123');
    }

    // ========== 初始化报表配置 ==========
    const reportConfigExists = db.prepare('SELECT id FROM report_config WHERE id = 1').get();
    if (!reportConfigExists) {
        db.prepare(`
            INSERT INTO report_config (id, enabled, cron, emails, data_types) 
            VALUES (1, 0, '0 9 * * *', 'admin@example.com', '["traffic","online","messages","files","users"]')
        `).run();
        console.log('✅ 已初始化报表配置');
    }

    // ========== 初始化系统配置 ==========
    const maxGlobal = db.prepare('SELECT value FROM system_config WHERE key = ?').get('max_global_upload_bytes');
    if (!maxGlobal) {
        const defaultGlobal = DEFAULT_CAPACITY.global || 10 * 1024 * 1024 * 1024;
        db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?)').run(
            'max_global_upload_bytes',
            defaultGlobal.toString()
        );
        db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?)').run(
            'total_upload_bytes',
            '0'
        );
        console.log('✅ 已初始化系统配置（全局容量 ' + (defaultGlobal / 1024 / 1024 / 1024) + 'GB）');
    }

    const fileSizeRow = db.prepare('SELECT value FROM system_config WHERE key = ?').get('max_file_size_bytes');
    if (!fileSizeRow) {
        db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?)').run(
            'max_file_size_bytes',
            (50 * 1024 * 1024).toString()
        );
        console.log('✅ 已初始化单文件大小限制 50MB');
    }

    const userDefault = db.prepare('SELECT value FROM system_config WHERE key = ?').get('user_default_capacity_bytes');
    if (!userDefault) {
        const defaultUser = DEFAULT_CAPACITY.user || 100 * 1024 * 1024;
        db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?)').run(
            'user_default_capacity_bytes',
            defaultUser.toString()
        );
        console.log('✅ 已初始化用户默认容量 ' + (defaultUser / 1024 / 1024) + 'MB');
    }

    const agreementVer = db.prepare('SELECT id FROM agreement_version WHERE id = 1').get();
    if (!agreementVer) {
        db.prepare('INSERT INTO agreement_version (id, version) VALUES (1, 1)').run();
        console.log('✅ 已初始化协议版本');
    }

    db.exec('PRAGMA foreign_keys = ON;');

    try {
        db.exec("DELETE FROM reg_attempts WHERE attempt_time < datetime('now', '-7 days')");
    } catch (e) {}

    console.log('✅ 数据库初始化完成');
}

module.exports = { initDatabase };