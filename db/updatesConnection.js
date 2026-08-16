// db/updatesConnection.js
const path = require('path');
const fs = require('fs');
const DB_PATH = path.join(__dirname, '../updates.db');

const db = {};
db.usingFallback = true;

let readyResolve = null;
db._readyPromise = new Promise(r => { readyResolve = r; });
db._waitReady = () => db._readyPromise;

let pendingOps = [];
let _db = null;
let realExec = null;

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

        let dirty = false, saveTimer = null;
        function markDirty() {
            if (!dirty) { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 2000); }
        }
        // 修复 #54：flush 失败后保持 dirty 并重新调度重试，避免数据永久丢失
        function flush() {
            if (!dirty) return;
            try {
                fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
                dirty = false;
            } catch (e) {
                // 写入失败：保留 dirty，并重新调度重试（最多每分钟重试）
                clearTimeout(saveTimer);
                saveTimer = setTimeout(flush, 5000);
                console.error('❌ 更新公告数据库保存失败，5秒后重试:', e.message);
            }
        }
        function closeAll() { clearTimeout(saveTimer); flush(); try { _db.close(); } catch (e) {} }

        db.pragma = function(str) { _db.run('PRAGMA ' + str); };
        db.prepare = function(sql) {
            if (!_db) throw new Error('数据库尚未初始化，请稍后重试');
            return {
                all(...p) {
                    const s = _db.prepare(sql); if (p.length) s.bind(p);
                    const r = []; while (s.step()) r.push(s.getAsObject()); s.free(); return r;
                },
                get(...p) {
                    const s = _db.prepare(sql); if (p.length) s.bind(p);
                    let r = null; if (s.step()) r = s.getAsObject(); s.free(); return r;
                },
                run(...p) {
                    const s = _db.prepare(sql); if (p.length) s.bind(p);
                    try { s.step(); } catch (e) {}
                    s.free(); markDirty();
                    let lastInsertRowid = null, changes = 0;
                    try { const r = _db.exec('SELECT last_insert_rowid() as id'); if (r[0]?.values[0]) lastInsertRowid = r[0].values[0][0]; } catch(e) {}
                    try { const c = _db.exec('SELECT changes() as ch'); if (c[0]?.values[0]) changes = c[0].values[0][0]; } catch(e) {}
                    return { lastInsertRowid, changes };
                },
            };
        };
        realExec = function(sql) { _db.run(sql); markDirty(); };
        db.close = closeAll;

        for (const op of pendingOps) { try { db.exec(op.sql); } catch (e) {} }
        pendingOps = [];

        readyResolve();
        console.log('✅ 更新公告数据库: sql.js 已就绪');
    } catch (e) {
        console.error('❌ 更新公告数据库初始化失败:', e);
        readyResolve();
    }
})();

// 修复 #53：统一执行入口，数据库就绪前缓存操作
db.exec = function _pending(sql) {
    if (_db === null) {
        pendingOps.push({ sql });
    } else if (realExec) {
        realExec(sql);
    }
};

module.exports = db;
