// db/updatesInit.js
const db = require('./updatesConnection');

async function initUpdatesDatabase() {
    await db._waitReady();
    db.exec(`
        CREATE TABLE IF NOT EXISTS updates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT (datetime('now')),
            is_sent INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS user_read_updates (
            user_id INTEGER NOT NULL,
            update_id INTEGER NOT NULL,
            read_at DATETIME DEFAULT (datetime('now')),
            PRIMARY KEY (user_id, update_id)
        );

        CREATE INDEX IF NOT EXISTS idx_updates_created_at ON updates(created_at);
        CREATE INDEX IF NOT EXISTS idx_user_read_updates_user ON user_read_updates(user_id);
    `);

    const count = db.prepare('SELECT COUNT(*) as cnt FROM updates').get();
    if (count.cnt === 0) {
        db.prepare(`
            INSERT INTO updates (version, title, content, created_at, is_sent)
            VALUES (?, ?, ?, datetime('now', '-1 day'), ?)
        `).run('0.1', '欢迎使用随心聊', '欢迎使用随心聊！这是第一个更新公告。\n\n我们会持续优化，为您带来更好的体验。', 0);
        console.log('✅ 已插入初始更新公告');
    }

    console.log('✅ 更新公告数据库初始化完成');
}

module.exports = { initUpdatesDatabase };