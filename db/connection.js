// db/connection.js
const path = require('path');
const fs = require('fs');
const DB_PATH = path.join(__dirname, '../chat.db');

const db = {};
db.usingFallback = true;

let readyResolve = null;
db._readyPromise = new Promise(r => { readyResolve = r; });
db._waitReady = () => db._readyPromise;

let pendingOps = [];
let _db = null;

// ========== 在模块加载时立即定义 transaction 方法 ==========
// 确保 groups.js 加载时就能访问到 db.transaction
db.transaction = function(fn) {
    if (typeof fn !== 'function') {
        throw new Error('db.transaction() 需要传入一个函数');
    }
    return function(...args) {
        if (!_db) {
            throw new Error('数据库尚未初始化，请稍后重试');
        }
        _db.exec('BEGIN TRANSACTION');
        try {
            const result = fn(...args);
            _db.exec('COMMIT');
            return result;
        } catch (err) {
            try { _db.exec('ROLLBACK'); } catch (rollbackErr) {}
            throw err;
        }
    };
};

// ========== 数据库初始化 ==========
(async () => {
    try {
        const initSqlJs = require('sql.js');
        const wasmPath = path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm');
        const wasmBinary = fs.existsSync(wasmPath) ? fs.readFileSync(wasmPath) : null;
        const SQL = await initSqlJs({ wasmBinary });

        _db = fs.existsSync(DB_PATH)
            ? new SQL.Database(fs.readFileSync(DB_PATH))
            : new SQL.Database();

        _db.run('PRAGMA journal_mode = WAL');
        _db.run('PRAGMA synchronous = NORMAL');
        _db.run('PRAGMA foreign_keys = ON');

        let dirty = false;
        let saveTimer = null;

        function markDirty() {
            if (!dirty) {
                dirty = true;
                clearTimeout(saveTimer);
                saveTimer = setTimeout(flush, 2000);
            }
        }

        function flush() {
            if (!dirty) return;
            try {
                fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
                dirty = false;
            } catch (e) {}
        }

        function closeAll() {
            clearTimeout(saveTimer);
            flush();
            try { _db.close(); } catch (e) {}
        }

        db.pragma = function(str) {
            _db.run('PRAGMA ' + str);
        };

        db.prepare = function(sql) {
            return {
                all(...p) {
                    const s = _db.prepare(sql);
                    if (p.length) s.bind(p);
                    const r = [];
                    while (s.step()) r.push(s.getAsObject());
                    s.free();
                    return r;
                },
                get(...p) {
                    const s = _db.prepare(sql);
                    if (p.length) s.bind(p);
                    let r = null;
                    if (s.step()) r = s.getAsObject();
                    s.free();
                    return r;
                },
                run(...p) {
                    const s = _db.prepare(sql);
                    if (p.length) s.bind(p);
                    try {
                        s.step();
                    } catch (e) {}
                    s.free();
                    markDirty();
                    let lastInsertRowid = null;
                    let changes = 0;
                    try {
                        const r = _db.exec('SELECT last_insert_rowid() as id');
                        if (r[0]?.values[0]) lastInsertRowid = r[0].values[0][0];
                    } catch (e) {}
                    try {
                        const c = _db.exec('SELECT changes() as ch');
                        if (c[0]?.values[0]) changes = c[0].values[0][0];
                    } catch (e) {}
                    return { lastInsertRowid, changes };
                },
            };
        };

        db.exec = function(sql) {
            _db.run(sql);
            markDirty();
        };

        db.close = closeAll;

        // 重放待执行的操作
        for (const op of pendingOps) {
            try {
                db.exec(op.sql);
            } catch (e) {}
        }
        pendingOps = [];

        readyResolve();
        console.log('✅ 数据库: sql.js 已就绪');
    } catch (e) {
        console.error('❌ 数据库初始化失败:', e);
        readyResolve();
    }
})();

// ========== 在数据库就绪前缓存操作 ==========
const originalExec = db.exec;
db.exec = function _pending(sql) {
    if (_db === null) {
        pendingOps.push({ sql });
    } else {
        originalExec(sql);
    }
};

module.exports = db;