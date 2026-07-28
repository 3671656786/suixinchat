// server.js - 主入口
require('dotenv').config();
const express = require('express');
const http = require('http');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

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

// ========== 优雅关闭 ==========
async function gracefulShutdown(signal) {
    console.log(`\n⚠️ 收到 ${signal}，正在关闭服务...`);
    try {
        const dbModule = require('./db/connection');
        if (dbModule.close) {
            dbModule.close();
            console.log('✅ 数据库已安全保存');
        }
    } catch (e) {
        console.error('关闭数据库失败:', e);
    }
    process.exit(0);
}
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
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ========== 协议文件初始化 ==========
const AGREEMENT_FILE = path.join(__dirname, 'agreement.txt');
async function initAgreementFile() {
    try {
        await fsPromises.access(AGREEMENT_FILE);
    } catch (err) {
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
const { router: reportRoutes, initReportSchedule } = require('./routes/report');

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

// 静态页面路由
const pages = ['chat','files','notes','admin','profile','announcements','clean-files','db-manager','agreement','operations'];
pages.forEach(p => app.get(`/${p}`, (req, res) => res.sendFile(path.join(__dirname, 'public', `${p}.html`))));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Socket.IO
const { initSocket } = require('./socket');

// ========== 异步启动主函数 ==========
async function startServer() {
    try {
        // 1. 初始化协议文件
        await initAgreementFile();

        // 2. 初始化数据库
        const { initDatabase } = require('./db/init');
        await initDatabase();

        // 3. 升级 Session 存储为 SQLite（如果启用）
        const db = require('./db/connection');
        if (process.env.USE_SQLITE_SESSION === 'true') {
            const SQLiteSessionStore = require('./utils/sessionStore');
            const sqliteStore = new SQLiteSessionStore({ db });
            sessionMiddleware.store = sqliteStore;
            console.log('✅ 使用 SQLite Session 存储');
        }

        // 4. 初始化 Socket
        initSocket(server, sessionMiddleware);

        // 5. 初始化定时报表
        initReportSchedule();

        // 6. 启动服务器
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