# 💬 随心社区 Suixin Community v4.0.0

以**讨论**为核心、完全重新设计的社区系统。PHP 8.1+ / MariaDB，纯自研实现，界面与架构全部重写，**不包含任何 Discuz! 源码或模板**（Discuz! X 仅作为本地架构参考）。

> 版本从 **v4.0.0** 起步。v3.x（Node.js 版）已从当前分支移除，代码完整保留在 git 历史与 `v3.0.0` 标签中。

---

## ✨ 功能模块

| 模块 | 能力 |
|------|------|
| **论坛** | 版块、主题、楼层回复、置顶、精华、浏览量、发帖/回复、主题搜索 |
| **圈子 / 群组** | 创建圈子、加入、成员列表、圈内话题与回复 |
| **家园** | 个人空间、动态、访客记录、勋章、签名、关注与私信入口 |
| **排行榜** | 积分 / 主题 / 回复 / 文档 / 好友多维榜单、前三领奖台、勋章体系 |
| **文档文库** | 分类浏览、投稿、详情页、浏览量 |
| **交友系统** | 关注 / 取关、互加好友、私信收件箱、推荐成员 |
| **聊天室** | 多房间、实时消息轮询、在线人数、游客只读 |
| **多国语言** | 简体中文 / English / 日本語 / 한국어，词条存于独立 i18n 库，即时切换 |

### 建议后续添加的功能
① 通知中心前端展示（后端 `core.notifications` 已就绪）② 全站统一搜索（当前仅论坛主题）③ 活动 / 投票 ④ 敏感词与内容审核 ⑤ AI 润色与实时翻译 ⑥ 插件 / 主题机制 ⑦ 数据库导出备份与回滚工具 ⑧ 管理后台。

---

## 🗄️ 数据库分文件存储

九个业务模块各用一个**独立 database**。在 MariaDB / MySQL 中，每个 database 对应数据目录下的独立文件夹，InnoDB 每表生成独立 `.ibd` 文件，可单独备份与迁移：

| 分片 | 数据库 | 内容 |
|------|--------|------|
| core | `suixin_core` | 用户、站点配置、通知 |
| forum | `suixin_forum` | 版块、主题、楼层、点赞 |
| groups | `suixin_groups` | 圈子、成员、圈内话题 |
| home | `suixin_home` | 家园资料、动态、访客 |
| rank | `suixin_rank` | 积分快照、勋章 |
| docs | `suixin_docs` | 文档分类与文档 |
| social | `suixin_social` | 关注、好友、私信 |
| chat | `suixin_chat` | 房间、消息、在线状态 |
| i18n | `suixin_i18n` | 语言与翻译词条 |

连接映射见 `config.php` 的 `db.shards`，统一由 `src/Core.php` 的 `DB` 类惰性连接。

---

## 🚀 快速开始

前置：PHP 8.1+（需 `pdo_mysql` / `mbstring` / `openssl` / `curl` / `fileinfo` / `zip`）、MariaDB 10.6+ 或 MySQL 8。

```bash
# 1. 配置数据库连接（默认 127.0.0.1:3307 / root / suixin_dev）
#    编辑 config.php，或用环境变量 SUIXIN_DB_PASS 覆盖密码
#    生产环境请新建 config.local.php 覆盖（已在 .gitignore 中）

# 2. 建库、建表、灌入演示数据（幂等，可重复执行）
php bin/install.php
#    需要重置演示数据时：php bin/install.php --fresh

# 3. 启动（在仓库根目录）
php -S 127.0.0.1:8081 -t public public/router.php
#    Windows 也可运行：powershell -File bin/serve.ps1

# 4. 自检（37 项冒烟测试）
php bin/smoke.php http://127.0.0.1:8081
```

打开 `http://127.0.0.1:8081`。演示账号：`admin / admin123`、`luna / demo123`（**部署前请修改密码**）。

---

## 🧱 目录结构

```
├── config.php            # 版本、站点、九个分库映射
├── VERSION               # 4.0.0
├── public/               # 单入口 index.php、router.php、全新 CSS/JS
├── src/
│   ├── Core.php          # Config / DB / Auth / Req / View / I18n
│   ├── Schema.php        # 分库表结构与四语种子数据
│   ├── bootstrap.php
│   └── Controllers/      # 10 个模块控制器 + 统一 JSON API
├── views/                # 全新设计的原生 PHP 模板
├── bin/                  # install.php / smoke.php / serve.ps1
└── data/                 # 运行时目录（不进入发布包）
```

安全：PDO 预处理、CSRF 校验、输出转义、`password_hash` 密码、会话 HttpOnly、安全响应头。

---

## 📄 许可证与回退

- **v4.0.0 起：GPL-3.0-only**。依据 GPLv3 第 5(a)(b)(c) 与第 6 条，二次修改必须在修改过的文件中**显著标注修改与日期**，并以相同许可证**整体开源**。源码文件头均带此声明。
- **v3.0.0 及更早版本仍为 MIT**，MIT 授权一经发出不可追溯撤销。
- 回退：`git checkout v3.0.0`（旧版完整代码）或 `git checkout <commit>`；远程已有 `v4.0.0` 标签。
- `discuzx/` 等第三方参考源码各有原许可证，**不包含在发布包中**。

---

## ✅ 质量记录

`bin/smoke.php` 覆盖 15 个页面、404、CSRF、登录会话、9 个写接口、聊天轮询、四语切换与分库自检 —— **37 项全部通过**。
