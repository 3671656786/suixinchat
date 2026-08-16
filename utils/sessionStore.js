// utils/sessionStore.js
const session = require('express-session');

class SQLiteSessionStore extends session.Store {
    constructor(options = {}) {
        super(options);
        this.db = options.db;
        this.tableName = options.tableName || 'sessions';
        if (!this.db) throw new Error('需要传入 db 实例');
        // 修复 #57：保存初始化 Promise，get/set 等方法在初始化完成后再执行
        this._ready = this._init().catch(err => console.error('[sessionStore] 建表失败:', err.message));
        this._initialized = false;
        this._ready.then(() => { this._initialized = true; });
        // #1-低 修复：启动定期清理任务（每小时执行一次）
        this._startCleanupTask();
    }

    // 修复 #80：统一为 SQLite datetime 格式（YYYY-MM-DD HH:MM:SS，UTC）。
    // 原实现存储 ISO 8601（含 T 与 Z），与 SQLite datetime('now') 的空格格式
    // 做字符串比较时 'T'(0x54) > ' '(0x20) 会导致过期判断错误。
    _toSqliteDatetime(date) {
        return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    }

    async _init() {
        if (this.db._waitReady) await this.db._waitReady();
        this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.tableName} (
            sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire DATETIME NOT NULL
        )`);
        // 首次启动时清理过期会话
        this._cleanExpired();
    }

    // 所有读写操作先等待初始化完成（返回可调用的函数包装器）
    _whenReady(cb) {
        return (...args) => {
            this._ready.then(() => cb(...args), () => cb(...args));
        };
    }

    // #1-低 修复：清理过期会话
    _cleanExpired() {
        try {
            const result = this.db.prepare(`DELETE FROM ${this.tableName} WHERE expire <= datetime('now')`).run();
            if (result.changes > 0) {
                console.log(`[sessionStore] 已清理 ${result.changes} 条过期会话`);
            }
        } catch (err) {
            console.error('[sessionStore] 清理过期会话失败:', err.message);
        }
    }

    _startCleanupTask() {
        // 每小时清理一次
        setInterval(() => {
            this._cleanExpired();
        }, 60 * 60 * 1000);
    }

    get(sid, cb) {
        this._whenReady(() => {
            try {
                const row = this.db.prepare(`SELECT sess FROM ${this.tableName} WHERE sid = ? AND expire > datetime('now')`).get(sid);
                cb(null, row ? JSON.parse(row.sess) : null);
            } catch (err) { cb(err); }
        })();
    }
    set(sid, session, cb) {
        this._whenReady(() => {
            try {
                // 修复 #56：session.cookie.expires 为 undefined 时使用默认 7 天有效期
                let expires;
                if (session && session.cookie && session.cookie.expires) {
                    expires = this._toSqliteDatetime(new Date(session.cookie.expires));
                } else {
                    expires = this._toSqliteDatetime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
                }
                this.db.prepare(`INSERT OR REPLACE INTO ${this.tableName} (sid, sess, expire) VALUES (?, ?, ?)`)
                    .run(sid, JSON.stringify(session), expires);
                cb(null);
            } catch (err) { cb(err); }
        })();
    }
    destroy(sid, cb) {
        this._whenReady(() => {
            try { this.db.prepare(`DELETE FROM ${this.tableName} WHERE sid = ?`).run(sid); cb(null); } catch (err) { cb(err); }
        })();
    }
    touch(sid, session, cb) {
        this._whenReady(() => {
            try {
                let expires;
                if (session && session.cookie && session.cookie.expires) {
                    expires = this._toSqliteDatetime(new Date(session.cookie.expires));
                } else {
                    expires = this._toSqliteDatetime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
                }
                this.db.prepare(`UPDATE ${this.tableName} SET expire = ? WHERE sid = ?`)
                    .run(expires, sid);
                cb(null);
            } catch (err) { cb(err); }
        })();
    }
    length(cb) {
        this._whenReady(() => {
            try {
                const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM ${this.tableName} WHERE expire > datetime('now')`).get();
                cb(null, row.cnt);
            } catch (err) { cb(err); }
        })();
    }
    clear(cb) {
        this._whenReady(() => {
            try { this.db.prepare(`DELETE FROM ${this.tableName}`).run(); cb(null); } catch (err) { cb(err); }
        })();
    }
    all(cb) {
        this._whenReady(() => {
            try {
                const rows = this.db.prepare(`SELECT sid, sess FROM ${this.tableName} WHERE expire > datetime('now')`).all();
                const sessions = rows.map(r => { try { return JSON.parse(r.sess); } catch(e) { return null; } }).filter(Boolean);
                cb(null, sessions);
            } catch (err) { cb(err); }
        })();
    }
}

module.exports = SQLiteSessionStore;