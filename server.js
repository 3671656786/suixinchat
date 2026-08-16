// server.js - 主入口（修复 Windows 关闭错误 + 优化）
process.env.TZ = 'Asia/Shanghai';
require('dotenv').config();
const express = require('express');
const http = require('http');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const schedule = require('node-schedule');

const app = express();
const server = http.createServer(app);

const {
    PORT, SESSION_SECRET, SESSION_MAX_AGE,
    UPLOAD_DIR, AVATAR_DIR, FILES_DIR, PUBLIC_FILES_DIR,
    RECALLED_DIR, NOTES_FILES_DIR, PRIVATE_FILES_DIR
} = require('./config');

// ========== 全局错误处理 ==========
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ unhandledRejection:', reason?.message || reason);
    console.error('堆栈:', reason?.stack || '');
});
process.on('uncaughtException', (err) => {
    console.error('⚠️ uncaughtException:', err.message);
    console.error('堆栈:', err.stack);
});

// ========== 修复：安全优雅关闭 ==========
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        console.log('⏳ 已在关闭中，请等待...');
        return;
    }
    isShuttingDown = true;
    console.log(`\n⚠️ 收到 ${signal}，正在关闭服务...`);

    // 增加超时到 10 秒
    const forceExitTimeout = setTimeout(() => {
        console.error('❌ 关闭超时（10秒），强制退出');
        process.exit(1);
    }, 10000);

    try {
        // 1. 停止接收新请求（但不强制断开现有连接）
        server.close(() => {
            console.log('✅ HTTP 服务器已停止接收新连接');
        });

        // 2. 等待现有连接完成（最多3秒）
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 3. 关闭 Socket.IO
        try {
            const { getIO } = require('./socket');
            const io = getIO();
            if (io) {
                await new Promise((resolve, reject) => {
                    io.close((err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                console.log('✅ Socket.IO 已关闭');
            }
        } catch (e) {
            console.warn('⚠️ Socket.IO 关闭失败:', e.message);
        }

        // 4. 取消定时任务
        try {
            const { cancelReportSchedule } = require('./routes/report');
            cancelReportSchedule();
            console.log('✅ 定时报表已取消');
        } catch (e) { /* 忽略 */ }

        try {
            const scheduledJobs = schedule.scheduledJobs;
            if (scheduledJobs) {
                for (const jobName in scheduledJobs) {
                    scheduledJobs[jobName].cancel();
                }
                console.log('✅ 所有定时任务已取消');
            }
        } catch (e) { /* 忽略 */ }

        // 5. 关闭数据库（带重试）
        const dbModules = [
            { name: '主数据库', path: './db/connection' },
            { name: '更新公告数据库', path: './db/updatesConnection' },
            { name: '云笔记数据库', path: './db/notesConnection' }
        ];

        for (const dbMod of dbModules) {
            try {
                const db = require(dbMod.path);
                if (db && typeof db.close === 'function') {
                    // 尝试关闭，如果失败则忽略
                    await Promise.race([
                        new Promise((resolve) => {
                            try {
                                db.close();
                                resolve();
                            } catch (e) {
                                resolve();
                            }
                        }),
                        new Promise(resolve => setTimeout(resolve, 500))
                    ]);
                    console.log(`✅ ${dbMod.name}已关闭`);
                }
            } catch (e) {
                console.warn(`⚠️ ${dbMod.name}关闭失败:`, e.message);
            }
        }

        console.log('✅ 所有资源已释放');

    } catch (err) {
        console.error('❌ 关闭过程中出错:', err);
    } finally {
        clearTimeout(forceExitTimeout);
        setTimeout(() => {
            process.exit(0);
        }, 500);
    }
}

// ========== 注册信号处理 ==========
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('message', (msg) => {
    if (msg === 'shutdown') gracefulShutdown('PM2 shutdown');
});

// ========== 创建目录 ==========
[UPLOAD_DIR, AVATAR_DIR, FILES_DIR, PUBLIC_FILES_DIR, RECALLED_DIR, NOTES_FILES_DIR, PRIVATE_FILES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// ========== Session 中间件 ==========
const memoryStore = new session.MemoryStore();
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: memoryStore,
    cookie: { secure: false, maxAge: SESSION_MAX_AGE }
});
app.use(sessionMiddleware);

// ========== 中间件 ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 修复 #97：基础安全响应头（轻量替代 helmet）
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});
app.use(express.static('public'));
// 修复 #59：不再整体暴露 uploads 目录（recalled/ 等敏感目录可被直接访问），
// 只静态服务对外需要的子目录
app.use('/uploads/public_files', express.static(path.join(UPLOAD_DIR, 'public_files')));
app.use('/uploads/notes_files', express.static(path.join(UPLOAD_DIR, 'notes_files')));
app.use('/uploads/private_files', express.static(path.join(UPLOAD_DIR, 'private_files')));
app.use('/uploads/avatars', express.static(path.join(UPLOAD_DIR, 'avatars')));
app.use('/uploads/files', express.static(path.join(UPLOAD_DIR, 'files')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ========== 协议文件初始化 ==========
const AGREEMENT_FILE = path.join(__dirname, 'agreement.txt');
async function initAgreementFile() {
    try {
        await fsPromises.access(AGREEMENT_FILE);
    } catch (err) {
        // 修复 #60：仅在文件不存在（ENOENT）时创建；权限等其他错误不覆盖现有文件
        if (err.code !== 'ENOENT') {
            console.error('⚠️ 无法访问协议文件（不覆盖现有文件）:', err.message);
            return;
        }
        const text = `【随心聊用户协议】\n\n欢迎使用随心聊！为了保障良好的交流环境，请您仔细阅读并同意以下条款：\n\n1. 尊重他人，文明聊天，不发布违法、色情、暴力、谩骂等内容。\n2. 请勿传播垃圾信息、广告或恶意刷屏。\n3. 保护个人隐私，不要随意泄露他人信息。\n4. 本平台有权对违规用户进行警告、封禁等处理。\n5. 用户对自己的言论和行为负责，请遵守法律法规。\n6. 如有任何疑问，请联系管理员。\n\n感谢您的使用！`;
        await fsPromises.writeFile(AGREEMENT_FILE, text, 'utf8');
        console.log('✅ 已创建默认协议文件 agreement.txt');
    }
}

// ========== 路由模块 ==========
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const chatRoutes = require('./routes/chat');
const filesRoutes = require('./routes/files');
const notesRoutes = require('./routes/notes');
const privateRoutes = require('./routes/private');
const adminRoutes = require('./routes/admin');
const announcementsRoutes = require('./routes/announcements');
const agreementRoutes = require('./routes/agreement');
const operationsRoutes = require('./routes/operations');
const groupsRoutes = require('./routes/groups');
const { router: reportRoutes, initReportSchedule, cancelReportSchedule } = require('./routes/report');
const updatesRoutes = require('./routes/updates');

app.use(authRoutes);
app.use(userRoutes);
app.use(chatRoutes);
app.use(filesRoutes);
app.use(notesRoutes);
app.use(privateRoutes);
app.use(adminRoutes);
app.use(announcementsRoutes);
app.use(agreementRoutes);
app.use(operationsRoutes);
app.use(groupsRoutes);
app.use(reportRoutes);
app.use(updatesRoutes);

// ========== 静态页面路由 ==========
const pages = [
    'chat', 'files', 'notes', 'admin', 'profile',
    'announcements', 'clean-files', 'db-manager',
    'agreement', 'operations', 'updates'
];
// 修复 #61：页面文件不存在时返回 404 而不是 500
pages.forEach(p => app.get(`/${p}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${p}.html`), (err) => {
        if (err && !res.headersSent) {
            res.status(404).send('页面不存在');
        }
    });
}));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
        if (err && !res.headersSent) {
            res.status(404).send('页面不存在');
        }
    });
});

// ========== Socket.IO ==========
const { initSocket } = require('./socket');

// ========== 定时任务：每天18点清理过期封禁 ==========
function scheduleExpiredBanCleanup() {
    try {
        schedule.scheduleJob('0 18 * * *', function() {
            try {
                const db = require('./db/connection');
                const now = new Date().toISOString();
                const result = db.prepare(`
                    DELETE FROM user_bans 
                    WHERE expires_at IS NOT NULL AND expires_at <= ?
                `).run(now);
                if (result.changes > 0) {
                    console.log(`[定时任务] ${new Date().toLocaleString()} 已清理 ${result.changes} 条过期封禁记录`);
                    const { logToFile } = require('./utils/logger');
                    logToFile(`[定时任务] 已清理 ${result.changes} 条过期封禁记录`);
                }
            } catch (err) {
                console.error('[定时任务] 清理过期封禁失败:', err);
            }
        });
        console.log('✅ 定时封禁清理任务已启动（每天 18:00）');
    } catch (err) {
        console.error('❌ 定时封禁清理任务启动失败:', err);
    }
}

// ========== 启动时清理过期封禁 ==========
async function cleanExpiredBansOnStartup() {
    try {
        const db = require('./db/connection');
        await db._waitReady();
        const now = new Date().toISOString();
        const result = db.prepare(`
            DELETE FROM user_bans 
            WHERE expires_at IS NOT NULL AND expires_at <= ?
        `).run(now);
        if (result.changes > 0) {
            console.log(`✅ 启动时已清理 ${result.changes} 条过期封禁记录`);
        }
    } catch (err) {
        console.error('❌ 启动时清理过期封禁失败:', err);
    }
}

// ========== 异步启动主函数 ==========
async function startServer() {
    try {
        // 1. 初始化协议文件
        await initAgreementFile();

        // 2. 初始化主数据库
        const { initDatabase } = require('./db/init');
        await initDatabase();

        // 3. 初始化更新公告数据库
        const { initUpdatesDatabase } = require('./db/updatesInit');
        await initUpdatesDatabase();

        // 4. 初始化云笔记独立数据库
        const { initNotesDatabase } = require('./db/notesInit');
        await initNotesDatabase();

        // 5. 升级 Session 存储为 SQLite（修复 #58：默认启用，避免重启后所有用户 session 丢失）
        const db = require('./db/connection');
        // 未显式设置或设置为 true 时均使用 SQLite 会话存储
        if (process.env.USE_SQLITE_SESSION !== 'false') {
            const SQLiteSessionStore = require('./utils/sessionStore');
            const sqliteStore = new SQLiteSessionStore({ db });
            sessionMiddleware.store = sqliteStore;
            console.log('✅ 使用 SQLite Session 存储');
        } else {
            console.warn('⚠️ USE_SQLITE_SESSION=false，使用 MemoryStore，重启后会话将丢失');
        }

        // 6. 启动时清理过期封禁
        await cleanExpiredBansOnStartup();

        // 7. 启动定时封禁清理（每天18点）
        scheduleExpiredBanCleanup();

        // 8. 初始化 Socket.IO
        initSocket(server, sessionMiddleware);

        // 9. 初始化定时报表
        initReportSchedule();

        // 10. 启动服务器
        server.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('❌ 启动失败:', err);
        process.exit(1);
    }
}

// ========== 执行启动 ==========
startServer();