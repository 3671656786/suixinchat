// migrate.js
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const colors = {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(msg, color = 'reset') {
    console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => {
        rl.question(query, answer => {
            resolve(answer);
        });
    });
}

async function main() {
    log('\n═══════════════════════════════════════════════', 'blue');
    log('  随心聊 (SuixinChat) - 数据库迁移工具 v1.3', 'green');
    log('═══════════════════════════════════════════════\n', 'blue');

    const dbPath = path.join(__dirname, 'chat.db');
    if (!fs.existsSync(dbPath)) {
        log('❌ 数据库文件不存在: chat.db', 'red');
        log('请确保在项目根目录下运行此脚本', 'yellow');
        process.exit(1);
    }

    log(`📁 找到数据库: ${dbPath}`, 'green');

    const answer = await askQuestion('\n⚠️  即将执行数据库迁移，建议先备份 chat.db 文件。\n是否继续？(y/N): ');
    if (answer.toLowerCase() !== 'y') {
        log('\n❌ 迁移已取消', 'yellow');
        rl.close();
        process.exit(0);
    }

    log('\n🔄 开始执行迁移...\n', 'blue');

    try {
        const wasmPath = path.join(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm');
        const wasmBinary = fs.existsSync(wasmPath) ? fs.readFileSync(wasmPath) : null;
        const SQL = await initSqlJs({ wasmBinary });
        const dbData = fs.readFileSync(dbPath);
        const db = new SQL.Database(dbData);

        // ========== 1. 添加 receive_email_announcements 列 ==========
        log('📧 添加 receive_email_announcements 列到 users 表...', 'blue');
        try {
            db.exec('ALTER TABLE users ADD COLUMN receive_email_announcements INTEGER DEFAULT 1');
            log('✅ receive_email_announcements 列已添加', 'green');
        } catch (e) {
            if (e.message && e.message.includes('duplicate column name')) {
                log('⏭️  receive_email_announcements 列已存在，跳过', 'yellow');
            } else {
                throw e;
            }
        }

        // ========== 2. 为 chat_groups 添加新字段 ==========
        log('📝 为 chat_groups 添加新字段...', 'blue');
        try {
            db.exec('ALTER TABLE chat_groups ADD COLUMN avatar TEXT');
            db.exec('ALTER TABLE chat_groups ADD COLUMN join_approval INTEGER DEFAULT 0');
            db.exec('ALTER TABLE chat_groups ADD COLUMN allow_join INTEGER DEFAULT 1');
            log('✅ chat_groups 字段已添加', 'green');
        } catch (e) {
            if (e.message && e.message.includes('duplicate column name')) {
                log('⏭️  字段已存在，跳过', 'yellow');
            } else {
                throw e;
            }
        }

        // ========== 3. 创建 group_ban_list 表 ==========
        log('🔒 创建 group_ban_list 表...', 'blue');
        const banTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='group_ban_list'");
        if (banTable.length === 0 || banTable[0].values.length === 0) {
            db.exec(`CREATE TABLE IF NOT EXISTS group_ban_list (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                banned_at DATETIME DEFAULT (datetime('now')),
                reason TEXT,
                UNIQUE(group_id, user_id)
            )`);
            db.exec('CREATE INDEX IF NOT EXISTS idx_group_ban_group ON group_ban_list(group_id)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_group_ban_user ON group_ban_list(user_id)');
            log('✅ group_ban_list 表已创建', 'green');
        } else {
            log('⏭️  group_ban_list 表已存在，跳过', 'yellow');
        }

        // ========== 4. 创建 group_join_requests 表 ==========
        log('📋 创建 group_join_requests 表...', 'blue');
        const reqTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='group_join_requests'");
        if (reqTable.length === 0 || reqTable[0].values.length === 0) {
            db.exec(`CREATE TABLE IF NOT EXISTS group_join_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                reason TEXT,
                status TEXT DEFAULT 'pending',
                requested_at DATETIME DEFAULT (datetime('now')),
                processed_at DATETIME,
                processed_by INTEGER,
                UNIQUE(group_id, user_id, status)
            )`);
            db.exec('CREATE INDEX IF NOT EXISTS idx_join_requests_group ON group_join_requests(group_id)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_join_requests_status ON group_join_requests(status)');
            log('✅ group_join_requests 表已创建', 'green');
        } else {
            log('⏭️  group_join_requests 表已存在，跳过', 'yellow');
        }

        // ========== 5. 确保 note_folders 表存在 ==========
        log('📂 确保 note_folders 表存在...', 'blue');
        const nfResult = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='note_folders'");
        if (nfResult.length === 0 || nfResult[0].values.length === 0) {
            db.exec(`CREATE TABLE IF NOT EXISTS note_folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                parentId INTEGER DEFAULT 0,
                createdBy INTEGER NOT NULL,
                createdAt DATETIME DEFAULT (datetime('now')),
                updatedAt DATETIME DEFAULT (datetime('now')),
                FOREIGN KEY (createdBy) REFERENCES users(userId)
            )`);
            db.exec('CREATE INDEX IF NOT EXISTS idx_note_folders_parent ON note_folders(parentId)');
            log('✅ note_folders 表已创建', 'green');
        } else {
            log('⏭️  note_folders 表已存在，跳过', 'yellow');
        }

        // ========== 6. 确保 verification_cooldowns 表存在 ==========
        log('🔒 确保 verification_cooldowns 表存在...', 'blue');
        const vcResult = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='verification_cooldowns'");
        if (vcResult.length === 0 || vcResult[0].values.length === 0) {
            db.exec(`CREATE TABLE IF NOT EXISTS verification_cooldowns (
                key TEXT PRIMARY KEY,
                count INTEGER DEFAULT 0,
                first_time INTEGER DEFAULT 0,
                last_time INTEGER DEFAULT 0
            )`);
            log('✅ verification_cooldowns 表已创建', 'green');
        } else {
            log('⏭️  verification_cooldowns 表已存在，跳过', 'yellow');
        }

        // ========== 7. 确保 sessions 表存在 ==========
        log('🗄️  确保 sessions 表存在...', 'blue');
        const sResult = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'");
        if (sResult.length === 0 || sResult[0].values.length === 0) {
            db.exec(`CREATE TABLE IF NOT EXISTS sessions (
                sid TEXT PRIMARY KEY,
                sess TEXT NOT NULL,
                expire DATETIME NOT NULL
            )`);
            db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire)');
            log('✅ sessions 表已创建', 'green');
        } else {
            log('⏭️  sessions 表已存在，跳过', 'yellow');
        }

        // ========== 8. 确保 notes 表有 folderId 列 ==========
        log('📝 确保 folderId 列存在于 notes 表...', 'blue');
        try {
            db.exec('ALTER TABLE notes ADD COLUMN folderId INTEGER DEFAULT 0');
            log('✅ folderId 列已添加到 notes 表', 'green');
        } catch (e) {
            if (e.message && e.message.includes('duplicate column name')) {
                log('⏭️  folderId 列已存在，跳过', 'yellow');
            } else {
                throw e;
            }
        }

        try {
            db.exec('CREATE INDEX IF NOT EXISTS idx_notes_folderId ON notes(folderId)');
        } catch (e) {}

        // ========== 9. 修改时间字段为 datetime('now') ==========
        // 注意：这里不修改现有数据，只确保新表使用正确的默认值
        // 现有数据的时间可能不准确，但不影响新数据

        log('\n💾 保存数据库...', 'blue');
        const backupPath = path.join(__dirname, `chat.db.backup.${Date.now()}`);
        fs.writeFileSync(backupPath, dbData);
        log(`📦 已创建备份: ${backupPath}`, 'green');

        fs.writeFileSync(dbPath, Buffer.from(db.export()));
        db.close();

        log('\n═══════════════════════════════════════════════', 'blue');
        log('✅ 迁移完成！', 'green');
        log(`   - 备份: ${backupPath}`, 'green');
        log('\n📌 提示: 如果一切正常，可以删除备份文件', 'yellow');
        log('═══════════════════════════════════════════════\n', 'blue');

    } catch (err) {
        log(`\n❌ 迁移失败: ${err.message}`, 'red');
        console.error(err);
        log('\n💡 请检查: 1. 数据库文件是否损坏', 'yellow');
        log('         2. 是否有足够的磁盘空间', 'yellow');
        log('         3. 备份文件是否可恢复', 'yellow');
        process.exit(1);
    }

    rl.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});