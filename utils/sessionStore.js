// utils/sessionStore.js
const session = require('express-session');

class SQLiteSessionStore extends session.Store {
    constructor(options = {}) {
        super(options);
        this.db = options.db;
        this.tableName = options.tableName || 'sessions';
        if (!this.db) throw new Error('需要传入 db 实例');
        this._init().catch(err => console.error('[sessionStore] 建表失败:', err.message));
    }

    async _init() {
        if (this.db._waitReady) await this.db._waitReady();
        this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.tableName} (
            sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire DATETIME NOT NULL
        )`);
    }

    get(sid, cb) {
        try {
            const row = this.db.prepare(`SELECT sess FROM ${this.tableName} WHERE sid = ? AND expire > datetime('now')`).get(sid);
            cb(null, row ? JSON.parse(row.sess) : null);
        } catch (err) { cb(err); }
    }
    set(sid, session, cb) {
        try {
            this.db.prepare(`INSERT OR REPLACE INTO ${this.tableName} (sid, sess, expire) VALUES (?, ?, ?)`)
                .run(sid, JSON.stringify(session), new Date(session.cookie.expires).toISOString());
            cb(null);
        } catch (err) { cb(err); }
    }
    destroy(sid, cb) {
        try { this.db.prepare(`DELETE FROM ${this.tableName} WHERE sid = ?`).run(sid); cb(null); } catch (err) { cb(err); }
    }
    touch(sid, session, cb) {
        try {
            this.db.prepare(`UPDATE ${this.tableName} SET expire = ? WHERE sid = ?`)
                .run(new Date(session.cookie.expires).toISOString(), sid);
            cb(null);
        } catch (err) { cb(err); }
    }
    length(cb) {
        try {
            const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM ${this.tableName} WHERE expire > datetime('now')`).get();
            cb(null, row.cnt);
        } catch (err) { cb(err); }
    }
    clear(cb) {
        try { this.db.prepare(`DELETE FROM ${this.tableName}`).run(); cb(null); } catch (err) { cb(err); }
    }
    all(cb) {
        try {
            const rows = this.db.prepare(`SELECT sid, sess FROM ${this.tableName} WHERE expire > datetime('now')`).all();
            const sessions = rows.map(r => { try { return JSON.parse(r.sess); } catch(e) { return null; } }).filter(Boolean);
            cb(null, sessions);
        } catch (err) { cb(err); }
    }
}

module.exports = SQLiteSessionStore;