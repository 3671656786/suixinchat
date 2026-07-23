Note: This website has only been tested on Windows 11 23H2. Availability on other systems cannot be guaranteed.

This website runs based on QQ Mail service. If you need other email services, please modify accordingly.

\---



\### 🌍 English Version



```markdown

\# 💬 SuixinChat (随心聊)



SuixinChat is a \*\*full-featured real-time chat website\*\* integrating chat rooms, personal cloud storage, cloud notes, and an admin dashboard. It features a fresh green design with responsive mobile and desktop support.



> \*\*Note:\*\* The default interface language is \*\*Chinese (Simplified)\*\*. For instructions on modifying the language, please refer to the "Localization" section below.



\## ✨ Features



\### 👤 User System

\- Email verification code registration/login (supports username or email)

\- Password reset via email verification

\- Profile management (username, avatar upload/preset/URL)

\- Password change

\- Mandatory user agreement acceptance on each login



\### 💬 Chat Room

\- Real-time group chat (Emoji shortcuts like `:smile:` → 😊)

\- File sharing (images/videos/documents, normal users ≤50MB, admin ≤1GB)

\- Quote reply (click message bubble to quote)

\- Message recall (within 2 minutes, admin can recall any message)

\- Infinite scroll history loading

\- Message search (keyword, username, date range)

\- Private chat (click online user to chat, unread badge)

\- Group chat (create/join/manage groups)

\- Read receipts



\### 📁 Cloud Storage

\- Personal storage (normal users 100MB, admin unlimited)

\- Global capacity monitoring (all normal users total 10GB)

\- Folder/file management (create, upload, rename, delete, move)

\- File preview/download (video player supports MOV/MP4)

\- Starred files (separate view)

\- Batch operations (batch delete/move)

\- Real-time traffic logging



\### 📝 Cloud Notes

\- Admin: full CRUD operations (normal users: read-only)

\- Multi-attachment upload (single ≤50MB)

\- Attachment management (rename, preview, download, delete)



\### ⚙️ Admin Panel

\- User management (kick, ban)

\- Message management (view/delete)

\- Announcement management (publish/delete, supports line breaks)

\- Email announcements (SMTP bulk email)

\- Ban management (login/chat/upload/download/notes/all)

\- Email blacklist

\- Server logs viewer

\- Online duration statistics

\- Traffic statistics (upload/download, date filter)

\- Global storage monitoring

\- Data reports (scheduled/manual email reports)

\- User agreement management

\- File cleanup tool

\- Database management (read-only queries)



\### 📊 Operations Dashboard

\- Independent page (/operations), accessible to normal users

\- Statistics: users/messages/files/online duration/traffic/global storage



\## 🛠️ Tech Stack



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



\## 🗂️ Project Structure

suixinchat/

├── server.js # Main entry

├── config/ # Configuration files

├── db/ # Database connection \& initialization

├── middleware/ # Custom middleware

├── routes/ # API routes (12 modules)

├── socket/ # Socket.IO event handlers

├── utils/ # Utility functions

├── public/ # Frontend static files

├── uploads/ # User uploads (auto-created)

└── logs/ # Log files (auto-created)



\## 🚀 Quick Deployment



\### Prerequisites

\- Node.js ≥ 18

\- npm or yarn



\### Deployment Steps



1\. Clone the repository

git clone https://github.com/3671656786/suixinchat.git

cd suixinchat



2\. Install dependencies

npm install



3\. Configure environment variables

cp .env.example .env

Edit .env with your settings:

PORT=3000

SESSION\_SECRET=your\_random\_secret\_key\_here

EMAIL\_HOST=smtp.qq.com

EMAIL\_PORT=465

EMAIL\_SECURE=true

EMAIL\_USER=your\_email@qq.com

EMAIL\_PASS=your\_authorization\_code



4\. Start the server

\# Development mode

npm run dev



\# Production mode (recommended with PM2)

npm install -g pm2

pm2 start server.js --name suixinchat

pm2 save

pm2 startup



5\. Access the site

Open browser at http://localhost:3000

Default admin: admin / admin123



Docker Deployment (Optional)

FROM node:18-alpine

WORKDIR /app

COPY package\*.json ./

RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD \["node", "server.js"]



docker build -t suixinchat .

docker run -d -p 3000:3000 --name suixinchat suixinchat



🌐 Localization

Language Support

The default language of this application is Chinese (Simplified). To modify or add language support:



Option 1: Quick localization (frontend only)

The frontend text is primarily in the HTML files under /public/. To change the interface language:

1\.Edit the HTML files directly to translate text

2\.Update the CSS comments and tooltips

3\.Modify the JavaScript error messages in public/\*.js



Option 2: Multi-language support (recommended for contributors)

To add full i18n support:

1\.Create language files in public/locales/

2\.Modify public/common.js to detect browser language or use a language selector

3\.Replace hardcoded strings with translation function calls



Example for adding English translations:

// public/locales/en.js

const translations = {

&#x20;   'chat': 'Chat',

&#x20;   'files': 'Files',

&#x20;   'notes': 'Notes',

&#x20;   'admin': 'Admin',

&#x20;   // ... more translations

};



// public/common.js

function t(key) {

&#x20;   return translations\[key] || key;

}



Internationalization Contribution

If you'd like to contribute translations for other languages, please submit a Pull Request with:

1\.New language file in public/locales/

2\.Updated common.js with language detection

3\.Update README with language support list



📄 License

This project is licensed under the MIT License.



🤝 Contributing

Issues and Pull Requests are welcome!



📞 Contact

Repository: https://github.com/3671656786/suixinchat

Issues: https://github.com/3671656786/suixinchat/issues



⭐ If this project helps you, please give it a Star!



注意：该网站只在Windows11-23H2系统进行过测试，其他系统不能保证可用

该网站是基于qq邮箱服务运行的，需要其他邮箱服务请自行修改



\# 💬 随心聊 (SuixinChat)



随心聊是一款\*\*功能完整的实时聊天网站\*\*，集聊天室、网盘、云笔记、管理后台于一体，采用绿色清新风格设计，支持手机和电脑自适应访问。



\## ✨ 核心功能



\### 👤 用户系统

\- 邮箱验证码注册/登录（支持用户名或邮箱）

\- 忘记密码（邮箱验证码重置）

\- 个人资料修改（用户名、头像上传/预设/URL）

\- 密码修改

\- 每次登录强制阅读用户协议



\### 💬 聊天室

\- 实时群聊（支持 Emoji 快捷替换，如 `:smile:` → 😊）

\- 文件上传（图片/视频/文档，普通用户 ≤50MB，管理员 ≤1GB）

\- 引用回复（点击消息气泡引用回复）

\- 消息撤回（2分钟内可撤回，管理员可撤回任意消息）

\- 历史消息滚动加载（无限滚动）

\- 消息搜索（关键词、用户名、日期范围）

\- 私聊功能（在线用户私聊，未读红点提醒）

\- 群聊功能（创建群、加入群、群管理）

\- 消息已读回执



\### 📁 网盘系统

\- 个人网盘（普通用户 100MB，管理员无限制）

\- 全局容量监控（所有普通用户总和 10GB）

\- 文件夹/文件管理（新建、上传、重命名、删除、移动）

\- 文件预览/下载（视频专属播放器，支持 MOV/MP4 等）

\- 星标文件（独立视图）

\- 批量操作（批量删除/移动）

\- 流量实时记录



\### 📝 云笔记系统

\- 管理员可增删改查笔记（普通用户只读）

\- 多附件上传（单个 ≤50MB）

\- 附件管理（重命名、预览、下载、删除）



\### ⚙️ 管理面板

\- 用户管理（踢出、封禁）

\- 消息管理（查看/删除）

\- 公告管理（发布/删除，支持换行）

\- 邮件公告（SMTP 邮件群发）

\- 封禁管理（登录/聊天/网盘上传/下载/云笔记/全部）

\- 邮箱黑名单

\- 服务器日志查看

\- 在线时长统计

\- 流量统计（上传/下载，日期筛选）

\- 全局网盘容量监控

\- 数据报表（定时/手动邮件报表）

\- 用户协议管理

\- 文件清理工具

\- 数据库管理（只读查询）



\### 📊 运营数据

\- 独立页面（/operations），普通用户可查看

\- 用户/消息/文件/在线时长/流量/全局容量统计



\## 🛠️ 技术栈



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



\## 🗂️ 项目结构

suixinchat/

├── server.js # 主入口

├── config/ # 配置文件

├── db/ # 数据库连接与初始化

├── middleware/ # 自定义中间件

├── routes/ # API 路由（12个模块）

├── socket/ # Socket.IO 事件处理

├── utils/ # 工具函数

├── public/ # 前端静态文件

├── uploads/ # 用户上传文件（自动创建）

└── logs/ # 日志文件（自动创建）



\## 🚀 快速部署



\### 前置要求

\- Node.js ≥ 18

\- npm 或 yarn



\### 部署步骤



\*\*1. 克隆仓库\*\*

```bash

git clone https://github.com/3671656786/suixinchat.git

cd suixinchat



2\. 安装依赖

npm install



3\. 配置环境变量

cp .env.example .env



编辑 .env 文件，填入您的配置：

PORT=3000

SESSION\_SECRET=your\_random\_secret\_key\_here

EMAIL\_HOST=smtp.qq.com

EMAIL\_PORT=465

EMAIL\_SECURE=true

EMAIL\_USER=your\_email@qq.com

EMAIL\_PASS=your\_authorization\_code



4\. 启动服务

\# 开发模式

npm run dev



\# 生产模式（推荐使用 PM2）

npm install -g pm2

pm2 start server.js --name suixinchat

pm2 save

pm2 startup



5\. 访问网站

打开浏览器访问 http://localhost:3000

默认管理员账号：admin / admin123



Docker 部署（可选）

FROM node:18-alpine

WORKDIR /app

COPY package\*.json ./

RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD \["node", "server.js"]

docker build -t suixinchat .

docker run -d -p 3000:3000 --name suixinchat suixinchat

📄 许可证

本项目采用 MIT License，允许自由使用、修改和分发。



🤝 贡献

欢迎提交 Issue 和 Pull Request！



📞 联系方式

项目地址：https://github.com/3671656786/suixinchat



问题反馈：https://github.com/3671656786/suixinchat/issues



⭐ 如果这个项目对您有帮助，请点个 Star 支持一下！









