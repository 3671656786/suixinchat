# 💬 随心聊 (SuixinChat)

随心聊是一款 **功能完整的实时聊天网站**，集聊天室、个人网盘、云笔记、管理后台于一体，采用绿色清新风格设计，支持手机和电脑自适应访问。

> **当前版本：v2.2.0** | 默认界面语言为中文 (简体)。如需修改为英文或其他语言，请参考下方的 [🌐 多语言支持](#-多语言支持) 章节。

---

## ✨ 核心功能

### 👤 用户系统
- 邮箱验证码注册/登录（支持用户名或邮箱）
- 忘记密码（邮箱验证码重置）
- 个人资料修改（用户名、头像上传/预设/URL）
- 密码修改
- 每次登录强制阅读用户协议
- **📧 邮件公告接收设置**（用户可自主选择是否接收系统邮件公告）

### 💬 聊天室
- 实时群聊（支持 Emoji 快捷替换，如 `:smile:` → 😊）
- 文件上传（图片/视频/文档，普通用户 ≤50MB，管理员 ≤1GB）
- 引用回复（点击消息气泡引用回复）
- 消息撤回（2分钟内可撤回，管理员可撤回任意消息）
- 历史消息滚动加载（无限滚动）
- 消息搜索（关键词、用户名、日期范围）
- 私聊功能（在线用户私聊，未读红点提醒）
- 群聊功能（创建群、加入群、群管理）
- 消息已读回执

### 📁 网盘系统
- 个人网盘（普通用户 100MB，管理员无限制）
- 全局容量监控（所有普通用户总和 10GB，管理员可修改）
- 个人容量管理（管理员可单独修改每个用户的容量）
- 单文件大小限制（默认 50MB，管理员可修改）
- 文件夹/文件管理（新建、上传、重命名、删除、移动）
- 文件预览/下载（视频专属播放器，支持 MOV/MP4/AVI/MKV/WEBM）
- 星标文件（独立视图）
- 批量操作（批量删除/移动）
- 流量实时记录

### 📝 云笔记系统
- 管理员可增删改查笔记（普通用户只读）
- 多附件上传（单个 ≤50MB）
- 附件管理（重命名、预览、下载、删除）
- **笔记文件夹分类**（支持多级文件夹，可展开/折叠）

### ⚙️ 管理面板
- 用户管理（踢出、封禁）
- **用户邮件接收状态显示**（“已接收”/“已拒绝”标签）
- 消息管理（查看/删除）
- 公告管理（发布/删除，支持换行）
- **邮件公告增强**：
  - 支持发送给所有已开启接收的用户、指定注册用户或单个邮箱
  - **发送进度显示**（实时显示已发送数量、成功/失败数，每3秒自动发送一封）
- 封禁管理（登录/聊天/网盘上传/下载/云笔记/全部，支持到期时间）
- 邮箱黑名单
- 服务器日志查看
- 在线时长统计
- 流量统计（上传/下载，日期筛选）
- 全局网盘容量监控
- **容量管理**（全局容量、个人容量、单文件大小限制）
- **数据报表**（定时/手动邮件报表，包含用户、消息、文件、在线时长、流量、系统设置等详细数据）
- 用户协议管理
- 文件清理工具（扫描孤儿文件/缺失文件）
- 数据库管理（只读查询）

### 📊 运营数据
- 独立页面（/operations），普通用户可查看
- 用户/消息/文件/在线时长/流量/全局容量/封禁统计

---

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 后端框架 | Express 5 |
| 实时通信 | Socket.IO |
| 数据库 | SQLite (sql.js) |
| 认证 | express-session + bcrypt |
| 文件上传 | multer |
| 邮件服务 | nodemailer |
| 日志系统 | winston + DailyRotateFile |
| 定时任务 | node-schedule |
| 前端 | 原生 HTML/CSS/JS |
| 部署 | PM2 |

---

## 🗂️ 项目结构

```
suixinchat/
├── server.js                 # 主入口
├── package.json
├── ecosystem.config.js       # PM2 配置
├── .env.example              # 环境变量模板
├── agreement.txt             # 用户协议（自动生成）
├── migrate.js                # 数据库迁移脚本
├── config/                   # 配置文件
│   ├── index.js              # 全局配置
│   └── multer.js             # 文件上传配置
├── db/                       # 数据库
│   ├── connection.js         # sql.js 连接
│   └── init.js               # 数据库初始化
├── middleware/               # 自定义中间件
│   ├── admin.js              # 管理员验证
│   ├── auth.js               # 登录验证
│   ├── banCheck.js           # 封禁检查
│   └── fileAccess.js         # 网盘权限
├── routes/                   # API 路由（12 个模块）
├── socket/                   # Socket.IO 事件处理（5 个模块）
├── utils/                    # 工具函数（6 个模块）
├── public/                   # 前端静态文件
├── uploads/                  # 用户上传文件（自动创建）
└── logs/                     # 日志文件（自动创建）
```

---

## 🚀 快速部署

### 前置要求
- Node.js ≥ 18
- npm 或 yarn

### 部署步骤

**1. 克隆仓库**

```bash
git clone https://github.com/3671656786/suixinchat.git
cd suixinchat
```

**2. 安装依赖**

```bash
npm install
```

**3. 配置环境变量**

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入您的配置：

```env
PORT=3000
SESSION_SECRET=your_random_secret_key_here
NODE_ENV=production
LOG_LEVEL=info
USE_SQLITE_SESSION=false

# 邮件服务（QQ邮箱示例）
EMAIL_HOST=smtp.qq.com
EMAIL_PORT=465
EMAIL_SECURE=true
EMAIL_USER=your_email@qq.com
EMAIL_PASS=your_authorization_code

# 可选配置
MAX_MESSAGE_LENGTH=2000
MESSAGE_RATE_LIMIT_MS=300
HEARTBEAT_INTERVAL=30000
HEARTBEAT_TIMEOUT=40000
```

**4. 初始化数据库**

首次启动时自动创建数据库，无需手动操作。

如果从旧版本升级，请先运行迁移脚本：

```bash
node migrate.js
```

**5. 启动服务**

```bash
# 开发模式
npm run dev

# 生产模式（推荐使用 PM2）
npm install -g pm2
pm2 start server.js --name suixinchat
pm2 save
pm2 startup
```

**6. 访问网站**

打开浏览器访问 `http://localhost:3000`

默认管理员账号：`admin` / `admin123`

---

## 🐳 Docker 部署（可选）

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

构建并运行：

```bash
docker build -t suixinchat .
docker run -d -p 3000:3000 --name suixinchat suixinchat
```

---

## 🌐 多语言支持

### 当前支持的语言

| 语言 | 状态 |
|------|------|
| 简体中文 | ✅ 默认 |
| 英文 | 🔧 需手动修改 |

### 修改界面语言

项目默认使用**中文 (简体)**。如需修改为英文或其他语言，有两种方式：

#### 方式一：直接修改 HTML 文件（快速方式）

前端文字主要在 `/public/` 目录下的 HTML 文件中：

1. 编辑 `public/index.html`、`public/chat.html` 等文件
2. 将中文文本替换为目标语言
3. 更新 `public/*.js` 中的提示信息和错误消息

#### 方式二：添加 i18n 支持（推荐）

1. 在 `public/locales/` 目录下创建语言文件，如 `en.js`：

```javascript
// public/locales/en.js
var translations = {
    '聊天室': 'Chat Room',
    '网盘': 'Cloud Storage',
    '云笔记': 'Cloud Notes',
    '管理面板': 'Admin Panel',
    '登录': 'Login',
    '注册': 'Register',
    '用户名': 'Username',
    '密码': 'Password',
    '邮箱': 'Email',
    '验证码': 'Verification Code',
    '发送': 'Send',
    '取消': 'Cancel',
    '确认': 'Confirm',
    '删除': 'Delete',
    '上传': 'Upload',
    '下载': 'Download',
    '预览': 'Preview',
    '搜索': 'Search',
    // ... 更多翻译
};
```

2. 在 `public/common.js` 中添加语言检测和翻译函数：

```javascript
// public/common.js
function getLanguage() {
    var lang = localStorage.getItem('language') || navigator.language || 'zh-CN';
    return lang.startsWith('en') ? 'en' : 'zh-CN';
}

function t(key) {
    var lang = getLanguage();
    if (lang === 'en' && window.translations && window.translations[key]) {
        return window.translations[key];
    }
    return key;
}
```

3. 在 HTML 中使用 `t()` 函数替换硬编码文本：

```html
<!-- 原来 -->
<h2>登录账户</h2>

<!-- 修改后 -->
<h2 data-i18n="登录账户">登录账户</h2>
<!-- 或使用 JS 动态渲染 -->
<h2 id="loginTitle"></h2>
<script>document.getElementById('loginTitle').innerText = t('登录账户');</script>
```

### 贡献翻译

如果您希望为项目添加其他语言支持，欢迎提交 Pull Request：

1. 在 `public/locales/` 下添加新的语言文件
2. 更新 `common.js` 中的语言检测逻辑
3. 更新此 README 中的语言支持列表

---

## 📄 许可证

本项目采用 MIT License，允许自由使用、修改和分发。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📞 联系方式

- 项目地址：https://github.com/3671656786/suixinchat
- 问题反馈：https://github.com/3671656786/suixinchat/issues

---

## ⭐ Star

如果这个项目对您有帮助，请点个 Star 支持一下！

---

---

# 💬 SuixinChat (随心聊)

SuixinChat is a **full-featured real-time chat website** integrating chat rooms, personal cloud storage, cloud notes, and an admin dashboard. It features a fresh green design with responsive mobile and desktop support.

> **Current Version: v2.2.0** | Default interface language is Chinese (Simplified). For instructions on modifying the language, please refer to the [🌐 Internationalization](#-internationalization) section below.

---

## ✨ Features

### 👤 User System
- Email verification code registration/login (supports username or email)
- Password reset via email verification
- Profile management (username, avatar upload/preset/URL)
- Password change
- Mandatory user agreement acceptance on each login
- **📧 Email Announcement Preference** (users can opt-in/out of system email notifications)

### 💬 Chat Room
- Real-time group chat (Emoji shortcuts like `:smile:` → 😊)
- File sharing (images/videos/documents, normal users ≤50MB, admin ≤1GB)
- Quote reply (click message bubble to quote)
- Message recall (within 2 minutes, admin can recall any message)
- Infinite scroll history loading
- Message search (keyword, username, date range)
- Private chat (click online user to chat, unread badge)
- Group chat (create/join/manage groups)
- Read receipts

### 📁 Cloud Storage
- Personal storage (normal users 100MB, admin unlimited)
- Global capacity monitoring (all normal users total 10GB, admin adjustable)
- Individual user capacity management (admin can modify each user's capacity)
- Single file size limit (default 50MB, admin adjustable)
- Folder/file management (create, upload, rename, delete, move)
- File preview/download (video player supports MOV/MP4/AVI/MKV/WEBM)
- Starred files (separate view)
- Batch operations (batch delete/move)
- Real-time traffic logging

### 📝 Cloud Notes
- Admin: full CRUD operations (normal users: read-only)
- Multi-attachment upload (single ≤50MB)
- Attachment management (rename, preview, download, delete)
- **Note folder classification** (multi-level folders with expand/collapse)

### ⚙️ Admin Panel
- User management (kick, ban)
- **User email reception status display** ("Accepted"/"Rejected" badges)
- Message management (view/delete)
- Announcement management (publish/delete, supports line breaks)
- **Enhanced Email Announcements**:
  - Send to all opted-in users, selected registered users, or a single email address
  - **Real-time progress display** (sent count, success/fail, automatic 3-second interval)
- Ban management (login/chat/upload/download/notes/all, with expiration)
- Email blacklist
- Server logs viewer
- Online duration statistics
- Traffic statistics (upload/download, date filter)
- Global storage monitoring
- **Capacity Management** (global capacity, personal capacity, file size limit)
- **Data Reports** (scheduled/manual email reports with detailed stats: users, messages, files, online duration, traffic, system settings, etc.)
- User agreement management
- File cleanup tool (scan orphan/missing files)
- Database management (read-only queries)

### 📊 Operations Dashboard
- Independent page (/operations), accessible to normal users
- Statistics: users/messages/files/online duration/traffic/global storage/bans

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| Backend | Express 5 |
| Realtime | Socket.IO |
| Database | SQLite (sql.js) |
| Auth | express-session + bcrypt |
| File Upload | multer |
| Email | nodemailer |
| Logging | winston + DailyRotateFile |
| Scheduling | node-schedule |
| Frontend | Vanilla HTML/CSS/JS |
| Deployment | PM2 |

---

## 🗂️ Project Structure

```
suixinchat/
├── server.js                 # Main entry
├── package.json
├── ecosystem.config.js       # PM2 configuration
├── .env.example              # Environment variables template
├── agreement.txt             # User agreement (auto-generated)
├── migrate.js                # Database migration script
├── config/                   # Configuration files
│   ├── index.js              # Global config
│   └── multer.js             # File upload config
├── db/                       # Database
│   ├── connection.js         # sql.js connection
│   └── init.js               # Database initialization
├── middleware/               # Custom middleware
│   ├── admin.js              # Admin verification
│   ├── auth.js               # Login verification
│   ├── banCheck.js           # Ban check
│   └── fileAccess.js         # Cloud storage permissions
├── routes/                   # API routes (12 modules)
├── socket/                   # Socket.IO event handlers (5 modules)
├── utils/                    # Utility functions (6 modules)
├── public/                   # Frontend static files
├── uploads/                  # User uploads (auto-created)
└── logs/                     # Log files (auto-created)
```

---

## 🚀 Quick Deployment

### Prerequisites
- Node.js ≥ 18
- npm or yarn

### Deployment Steps

**1. Clone the repository**

```bash
git clone https://github.com/3671656786/suixinchat.git
cd suixinchat
```

**2. Install dependencies**

```bash
npm install
```

**3. Configure environment variables**

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
PORT=3000
SESSION_SECRET=your_random_secret_key_here
NODE_ENV=production
LOG_LEVEL=info
USE_SQLITE_SESSION=false

# Email service (QQ Mail example)
EMAIL_HOST=smtp.qq.com
EMAIL_PORT=465
EMAIL_SECURE=true
EMAIL_USER=your_email@qq.com
EMAIL_PASS=your_authorization_code

# Optional settings
MAX_MESSAGE_LENGTH=2000
MESSAGE_RATE_LIMIT_MS=300
HEARTBEAT_INTERVAL=30000
HEARTBEAT_TIMEOUT=40000
```

**4. Initialize database**

The database is auto-created on first startup. No manual action needed.

If upgrading from an older version, run the migration script first:

```bash
node migrate.js
```

**5. Start the server**

```bash
# Development mode
npm run dev

# Production mode (recommended with PM2)
npm install -g pm2
pm2 start server.js --name suixinchat
pm2 save
pm2 startup
```

**6. Access the site**

Open browser at `http://localhost:3000`

Default admin: `admin` / `admin123`

---

## 🐳 Docker Deployment (Optional)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

Build and run:

```bash
docker build -t suixinchat .
docker run -d -p 3000:3000 --name suixinchat suixinchat
```

---

## 🌐 Internationalization

### Currently Supported Languages

| Language | Status |
|----------|--------|
| Chinese (Simplified) | ✅ Default |
| English | 🔧 Manual modification required |

### Modifying Interface Language

The application uses **Chinese (Simplified)** as the default language. To change to English or another language:

#### Option 1: Direct HTML Editing (Quick Method)

Frontend text is primarily in HTML files under `/public/`:

1. Edit `public/index.html`, `public/chat.html`, etc.
2. Replace Chinese text with target language
3. Update prompt messages and error messages in `public/*.js`

#### Option 2: Add i18n Support (Recommended)

1. Create language files in `public/locales/`, e.g., `en.js`:

```javascript
// public/locales/en.js
var translations = {
    '聊天室': 'Chat Room',
    '网盘': 'Cloud Storage',
    '云笔记': 'Cloud Notes',
    '管理面板': 'Admin Panel',
    '登录': 'Login',
    '注册': 'Register',
    '用户名': 'Username',
    '密码': 'Password',
    '邮箱': 'Email',
    '验证码': 'Verification Code',
    '发送': 'Send',
    '取消': 'Cancel',
    '确认': 'Confirm',
    '删除': 'Delete',
    '上传': 'Upload',
    '下载': 'Download',
    '预览': 'Preview',
    '搜索': 'Search',
    // ... more translations
};
```

2. Add language detection and translation function in `public/common.js`:

```javascript
// public/common.js
function getLanguage() {
    var lang = localStorage.getItem('language') || navigator.language || 'zh-CN';
    return lang.startsWith('en') ? 'en' : 'zh-CN';
}

function t(key) {
    var lang = getLanguage();
    if (lang === 'en' && window.translations && window.translations[key]) {
        return window.translations[key];
    }
    return key;
}
```

3. Replace hardcoded strings with `t()` function calls in HTML:

```html
<!-- Original -->
<h2>登录账户</h2>

<!-- After modification -->
<h2 data-i18n="登录账户">登录账户</h2>
<!-- Or use JS dynamic rendering -->
<h2 id="loginTitle"></h2>
<script>document.getElementById('loginTitle').innerText = t('登录账户');</script>
```

### Contributing Translations

If you'd like to contribute translations for other languages, please submit a Pull Request with:

1. New language file in `public/locales/`
2. Updated `common.js` with language detection
3. Updated language support list in this README

---

## 📄 License

This project is licensed under the MIT License.

---

## 🤝 Contributing

Issues and Pull Requests are welcome!

---

## 📞 Contact

- Repository: https://github.com/3671656786/suixinchat
- Issues: https://github.com/3671656786/suixinchat/issues

---

## ⭐ Star

If this project helps you, please give it a Star!

---

## 更新日志 / Changelog

### v2.2.0 (2026-07-28)
- ✅ 新增用户邮件公告接收设置（用户可自主选择开启/关闭）
- ✅ 管理员用户列表显示邮件接收状态（“已接收”/“已拒绝”标签）
- ✅ 邮件公告支持发送给指定注册用户（多选）
- ✅ 邮件公告发送时每3秒一封，实时显示进度条和倒计时
- ✅ 数据报表增加详细内容（用户、消息、文件、在线时长、流量、系统设置等）
- ✅ 修复 Session MemoryStore 内存泄漏 (SQLite 存储)
- ✅ 修复群聊创建后自动加入 Socket 房间
- ✅ 修复管理员踢人清理私聊房间
- ✅ 修复验证码频率限制 (改用数据库存储)
- ✅ 修复 common.js 心跳监听不生效
- ✅ 修复 UTF-16 文本文件误判
- ✅ 修复云笔记附件被误识别为孤儿文件
- ✅ 新增容量管理功能 (全局容量、个人容量、单文件大小限制)
- ✅ 优化云笔记文件夹 UI（展开/折叠、操作按钮常驻）
- ✅ 修复运营数据显示异常
- ✅ 重构前端 escapeHtml 统一到 common.js
- ✅ 新增数据库迁移脚本 migrate.js

### v2.1.0
- 完整功能实现
- 安全加固
- 响应式设计

---

**注意：该网站只在 Windows 11 23H2 系统进行过测试，其他系统不能保证可用。**

**Note: This website has only been tested on Windows 11 23H2. Availability on other systems cannot be guaranteed.**

**该网站默认基于 QQ 邮箱服务运行，如需使用其他邮箱服务请自行修改配置。**

**This website runs based on QQ Mail service by default. If you need other email services, please modify the configuration accordingly.**
```

---

## 主要更新点

1. **版本号**：顶部和更新日志中明确标注 `v2.2.0`。
2. **功能列表补充**：
   - 用户系统增加“邮件公告接收设置”。
   - 管理面板增加“用户邮件接收状态显示”和“邮件公告增强”子项。
   - 云笔记增加“笔记文件夹分类”。
3. **更新日志**：添加 `v2.2.0` 的详细变更条目。
4. **整体介绍词**：优化了部分描述，使新功能一目了然。