<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

namespace Suixin\V4;

use PDO;

/**
 * 数据库分文件存储：9 个业务模块各自独立 database。
 * MariaDB 数据目录下每个 database 是独立文件夹，InnoDB 每表生成独立 .ibd 文件。
 */
final class Schema
{
    public static function createDatabases(): array
    {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;charset=%s',
            Config::get('db.host', '127.0.0.1'),
            (int) Config::get('db.port', 3306),
            Config::get('db.charset', 'utf8mb4')
        );
        $pdo = new PDO($dsn, Config::get('db.user'), Config::get('db.password'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
        $created = [];
        foreach (DB::shardNames() as $alias => $name) {
            if (!preg_match('/^[A-Za-z0-9_]+$/', $name)) {
                throw new \RuntimeException('Invalid database name: ' . $name);
            }
            $pdo->exec("CREATE DATABASE IF NOT EXISTS `{$name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
            $created[$alias] = $name;
        }
        return $created;
    }

    /** @return array<string, string[]> 每个分片的建表语句 */
    public static function tables(): array
    {
        return [
            'core' => [
                'CREATE TABLE IF NOT EXISTS users (
                    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(48) NOT NULL UNIQUE,
                    email VARCHAR(160) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    nickname VARCHAR(64) NOT NULL,
                    avatar VARCHAR(255) NOT NULL DEFAULT "",
                    role VARCHAR(16) NOT NULL DEFAULT "member",
                    points INT NOT NULL DEFAULT 0,
                    lang VARCHAR(12) NOT NULL DEFAULT "zh-CN",
                    bio VARCHAR(255) NOT NULL DEFAULT "",
                    signature VARCHAR(255) NOT NULL DEFAULT "",
                    status TINYINT NOT NULL DEFAULT 1,
                    created_at DATETIME NOT NULL,
                    INDEX idx_points (points)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS settings (
                    k VARCHAR(64) PRIMARY KEY,
                    v TEXT
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS notifications (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    user_id INT UNSIGNED NOT NULL,
                    type VARCHAR(32) NOT NULL DEFAULT "system",
                    content VARCHAR(500) NOT NULL DEFAULT "",
                    is_read TINYINT NOT NULL DEFAULT 0,
                    created_at DATETIME NOT NULL,
                    INDEX idx_user (user_id, is_read)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            ],
            'forum' => [
                'CREATE TABLE IF NOT EXISTS forums (
                    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(80) NOT NULL,
                    slug VARCHAR(64) NOT NULL UNIQUE,
                    description VARCHAR(255) NOT NULL DEFAULT "",
                    icon VARCHAR(16) NOT NULL DEFAULT "◎",
                    sort_order INT NOT NULL DEFAULT 0,
                    thread_count INT NOT NULL DEFAULT 0,
                    post_count INT NOT NULL DEFAULT 0
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS threads (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    forum_id INT UNSIGNED NOT NULL,
                    user_id INT UNSIGNED NOT NULL,
                    title VARCHAR(160) NOT NULL,
                    content TEXT NOT NULL,
                    is_top TINYINT NOT NULL DEFAULT 0,
                    is_essence TINYINT NOT NULL DEFAULT 0,
                    views INT NOT NULL DEFAULT 0,
                    reply_count INT NOT NULL DEFAULT 0,
                    last_reply_at DATETIME,
                    created_at DATETIME NOT NULL,
                    INDEX idx_forum (forum_id, is_top, last_reply_at),
                    INDEX idx_user (user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS posts (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    thread_id BIGINT UNSIGNED NOT NULL,
                    user_id INT UNSIGNED NOT NULL,
                    content TEXT NOT NULL,
                    floor INT NOT NULL DEFAULT 1,
                    created_at DATETIME NOT NULL,
                    INDEX idx_thread (thread_id, floor)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS likes (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    user_id INT UNSIGNED NOT NULL,
                    target_type VARCHAR(16) NOT NULL,
                    target_id BIGINT UNSIGNED NOT NULL,
                    created_at DATETIME NOT NULL,
                    UNIQUE KEY uniq_like (user_id, target_type, target_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            ],
            'groups' => [
                'CREATE TABLE IF NOT EXISTS circles (
                    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(80) NOT NULL,
                    slug VARCHAR(64) NOT NULL UNIQUE,
                    description VARCHAR(255) NOT NULL DEFAULT "",
                    icon VARCHAR(16) NOT NULL DEFAULT "◈",
                    owner_id INT UNSIGNED NOT NULL,
                    member_count INT NOT NULL DEFAULT 0,
                    visibility VARCHAR(16) NOT NULL DEFAULT "public",
                    created_at DATETIME NOT NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS circle_members (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    circle_id INT UNSIGNED NOT NULL,
                    user_id INT UNSIGNED NOT NULL,
                    role VARCHAR(16) NOT NULL DEFAULT "member",
                    joined_at DATETIME NOT NULL,
                    UNIQUE KEY uniq_member (circle_id, user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS circle_topics (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    circle_id INT UNSIGNED NOT NULL,
                    user_id INT UNSIGNED NOT NULL,
                    title VARCHAR(160) NOT NULL,
                    content TEXT NOT NULL,
                    reply_count INT NOT NULL DEFAULT 0,
                    created_at DATETIME NOT NULL,
                    INDEX idx_circle (circle_id, id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS circle_replies (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    topic_id BIGINT UNSIGNED NOT NULL,
                    user_id INT UNSIGNED NOT NULL,
                    content TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    INDEX idx_topic (topic_id, id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            ],
            'home' => [
                'CREATE TABLE IF NOT EXISTS profiles (
                    user_id INT UNSIGNED PRIMARY KEY,
                    cover VARCHAR(255) NOT NULL DEFAULT "",
                    mood VARCHAR(255) NOT NULL DEFAULT "",
                    tags VARCHAR(255) NOT NULL DEFAULT "",
                    visitor_count INT NOT NULL DEFAULT 0
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS feeds (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    user_id INT UNSIGNED NOT NULL,
                    type VARCHAR(32) NOT NULL DEFAULT "post",
                    content VARCHAR(500) NOT NULL DEFAULT "",
                    created_at DATETIME NOT NULL,
                    INDEX idx_user (user_id, id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS visitors (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    host_user_id INT UNSIGNED NOT NULL,
                    visitor_id INT UNSIGNED NOT NULL,
                    visited_at DATETIME NOT NULL,
                    INDEX idx_host (host_user_id, id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            ],
            'rank' => [
                'CREATE TABLE IF NOT EXISTS scores (
                    user_id INT UNSIGNED PRIMARY KEY,
                    points INT NOT NULL DEFAULT 0,
                    thread_count INT NOT NULL DEFAULT 0,
                    post_count INT NOT NULL DEFAULT 0,
                    doc_count INT NOT NULL DEFAULT 0,
                    friend_count INT NOT NULL DEFAULT 0,
                    online_seconds INT NOT NULL DEFAULT 0,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_points (points)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS badges (
                    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(64) NOT NULL,
                    icon VARCHAR(16) NOT NULL DEFAULT "★",
                    rule_type VARCHAR(32) NOT NULL,
                    rule_value INT NOT NULL DEFAULT 0,
                    description VARCHAR(255) NOT NULL DEFAULT ""
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS user_badges (
                    user_id INT UNSIGNED NOT NULL,
                    badge_id INT UNSIGNED NOT NULL,
                    earned_at DATETIME NOT NULL,
                    PRIMARY KEY (user_id, badge_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            ],
            'docs' => [
                'CREATE TABLE IF NOT EXISTS categories (
                    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(80) NOT NULL,
                    slug VARCHAR(64) NOT NULL UNIQUE,
                    parent_id INT UNSIGNED NOT NULL DEFAULT 0,
                    sort_order INT NOT NULL DEFAULT 0
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS documents (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    category_id INT UNSIGNED NOT NULL,
                    user_id INT UNSIGNED NOT NULL,
                    title VARCHAR(160) NOT NULL,
                    summary VARCHAR(500) NOT NULL DEFAULT "",
                    content TEXT NOT NULL,
                    file_name VARCHAR(255) NOT NULL DEFAULT "",
                    file_path VARCHAR(255) NOT NULL DEFAULT "",
                    file_size INT NOT NULL DEFAULT 0,
                    downloads INT NOT NULL DEFAULT 0,
                    views INT NOT NULL DEFAULT 0,
                    created_at DATETIME NOT NULL,
                    INDEX idx_category (category_id, id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            ],
            'social' => [
                'CREATE TABLE IF NOT EXISTS follows (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    follower_id INT UNSIGNED NOT NULL,
                    followee_id INT UNSIGNED NOT NULL,
                    created_at DATETIME NOT NULL,
                    UNIQUE KEY uniq_follow (follower_id, followee_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS friendships (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    user_id INT UNSIGNED NOT NULL,
                    friend_id INT UNSIGNED NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT "pending",
                    created_at DATETIME NOT NULL,
                    UNIQUE KEY uniq_friend (user_id, friend_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS messages (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    from_id INT UNSIGNED NOT NULL,
                    to_id INT UNSIGNED NOT NULL,
                    content VARCHAR(1000) NOT NULL,
                    is_read TINYINT NOT NULL DEFAULT 0,
                    created_at DATETIME NOT NULL,
                    INDEX idx_inbox (to_id, is_read, id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            ],
            'chat' => [
                'CREATE TABLE IF NOT EXISTS rooms (
                    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(80) NOT NULL,
                    slug VARCHAR(64) NOT NULL UNIQUE,
                    description VARCHAR(255) NOT NULL DEFAULT "",
                    created_at DATETIME NOT NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS messages (
                    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    room_id INT UNSIGNED NOT NULL,
                    user_id INT UNSIGNED NOT NULL,
                    content VARCHAR(1000) NOT NULL,
                    created_at DATETIME NOT NULL,
                    INDEX idx_room (room_id, id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS online (
                    user_id INT UNSIGNED NOT NULL,
                    room_id INT UNSIGNED NOT NULL,
                    last_seen DATETIME NOT NULL,
                    PRIMARY KEY (user_id, room_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            ],
            'i18n' => [
                'CREATE TABLE IF NOT EXISTS locales (
                    code VARCHAR(12) PRIMARY KEY,
                    name VARCHAR(64) NOT NULL,
                    is_default TINYINT NOT NULL DEFAULT 0,
                    enabled TINYINT NOT NULL DEFAULT 1
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
                'CREATE TABLE IF NOT EXISTS translations (
                    locale VARCHAR(12) NOT NULL,
                    k VARCHAR(96) NOT NULL,
                    v VARCHAR(500) NOT NULL,
                    PRIMARY KEY (locale, k)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
            ],
        ];
    }

    public static function install(): array
    {
        $created = self::createDatabases();
        $tables = 0;
        foreach (self::tables() as $shard => $statements) {
            foreach ($statements as $sql) {
                DB::run($shard, $sql);
                $tables++;
            }
        }
        $seeded = self::seed();
        return ['databases' => $created, 'tables' => $tables, 'seeded' => $seeded];
    }

    /** 幂等种子数据：全部使用 INSERT IGNORE，重复执行不会产生重复记录。 */
    public static function seed(): array
    {
        $counts = [];

        $users = [
            ['admin', 'admin@suixin.local', 'admin123', '管理员', 'admin', 1000],
            ['luna',  'luna@suixin.local',  'demo123',  'Luna',    'member', 320],
            ['kai',   'kai@suixin.local',   'demo123',  '阿凯',    'member', 265],
            ['mira',  'mira@suixin.local',  'demo123',  'Mira',    'member', 188],
        ];
        foreach ($users as [$name, $email, $pass, $nick, $role, $points]) {
            DB::run(
                'core',
                'INSERT IGNORE INTO users (username,email,password_hash,nickname,role,points,lang,status,created_at)
                 VALUES (?,?,?,?,?,?, "zh-CN", 1, NOW())',
                [$name, $email, password_hash($pass, PASSWORD_DEFAULT), $nick, $role, $points]
            );
        }
        $ids = [];
        foreach (DB::all('core', 'SELECT id, username, nickname, avatar FROM users') as $row) {
            $ids[$row['username']] = (int) $row['id'];
        }
        $counts['users'] = count($ids);

        foreach ($ids as $uid) {
            DB::run('home', 'INSERT IGNORE INTO profiles (user_id, mood, visitor_count) VALUES (?, "", 0)', [$uid]);
            DB::run('rank', 'INSERT IGNORE INTO scores (user_id, points, updated_at) VALUES (?, 0, NOW())', [$uid]);
        }
        // 排行榜快照与总账对齐
        foreach (DB::all('core', 'SELECT id, points FROM users') as $row) {
            DB::run('rank', 'UPDATE scores SET points = ? WHERE user_id = ?', [(int) $row['points'], (int) $row['id']]);
        }

        DB::run('core', 'INSERT IGNORE INTO settings (k,v) VALUES ("version","4.0.0")');
        DB::run('core', 'INSERT IGNORE INTO settings (k,v) VALUES ("installed_at",NOW())');

        $forums = [
            ['综合讨论', 'general', '聊聊社区里的新鲜事，任何话题都欢迎', '◎'],
            ['技术分享', 'tech', '开发、运维、架构与工具的经验交流', '⌘'],
            ['资源互助', 'resources', '资料、工具、教程的分享与求助', '◇'],
            ['站务公告', 'notice', '官方公告、版本更新与规则说明', '◆'],
        ];
        foreach ($forums as $i => [$name, $slug, $desc, $icon]) {
            DB::run(
                'forum',
                'INSERT IGNORE INTO forums (name,slug,description,icon,sort_order) VALUES (?,?,?,?,?)',
                [$name, $slug, $desc, $icon, $i]
            );
        }
        $counts['forums'] = count($forums);

        $threads = [
            [1, 'luna',  '欢迎来到随心社区 v4.0', '这是完全重新设计的讨论型社区。论坛、圈子、家园、排行榜、文库、交友与聊天室都在这里，界面与架构全部重写。欢迎发帖交流！', 1, 1],
            [2, 'kai',   'PHP 8.3 + 分库存储的一点实践', '把用户、论坛、圈子、文库等拆成独立数据库后，备份和迁移都可以按模块单独进行，排查问题也更清晰。', 0, 1],
            [3, 'mira',  '文档文库应该怎么组织才好用？', '大家习惯按分类浏览还是按标签检索？想听听社区的意见，后续可以按投票结果调整。', 0, 0],
            [1, 'admin', '社区规则与版块说明', '请友善讨论，禁止广告与人身攻击。技术问题请发到技术分享，资料类内容请发到资源互助。', 1, 0],
        ];
        foreach ($threads as [$forumId, $author, $title, $content, $top, $essence]) {
            $exists = DB::val('forum', 'SELECT COUNT(*) FROM threads WHERE title = ?', [$title], 0);
            if ($exists > 0) {
                continue;
            }
            DB::run(
                'forum',
                'INSERT INTO threads (forum_id,user_id,title,content,is_top,is_essence,views,reply_count,last_reply_at,created_at)
                 VALUES (?,?,?,?,?,?,0,0,NOW(),NOW())',
                [$forumId, $ids[$author], $title, $content, $top, $essence]
            );
            $tid = DB::id('forum');
            DB::run('forum', 'UPDATE forums SET thread_count = thread_count + 1 WHERE id = ?', [$forumId]);
            DB::run(
                'home',
                'INSERT INTO feeds (user_id,type,content,created_at) VALUES (?,"thread",?,NOW())',
                [$ids[$author], $title]
            );
        }
        $counts['threads'] = (int) DB::val('forum', 'SELECT COUNT(*) FROM threads', [], 0);

        $allThreads = DB::all('forum', 'SELECT id, user_id FROM threads');
        foreach ($allThreads as $thread) {
            if (DB::val('forum', 'SELECT COUNT(*) FROM posts WHERE thread_id = ?', [$thread['id']], 0) > 0) {
                continue;
            }
            DB::run(
                'forum',
                'INSERT INTO posts (thread_id,user_id,content,floor,created_at) VALUES (?,?,?,1,NOW())',
                [$thread['id'], $ids['kai'], '这个方向挺好，先支持一下，后续再补充细节。']
            );
            DB::run(
                'forum',
                'INSERT INTO posts (thread_id,user_id,content,floor,created_at) VALUES (?,?,?,2,NOW())',
                [$thread['id'], $ids['mira'], '同感，期待后续更新。']
            );
            DB::run('forum', 'UPDATE threads SET reply_count = 2 WHERE id = ?', [$thread['id']]);
        }
        $counts['posts'] = (int) DB::val('forum', 'SELECT COUNT(*) FROM posts', [], 0);

        $circles = [
            ['开发者茶馆', 'devs', '写代码、聊技术、分享踩坑经历', '⌘', 'luna'],
            ['设计灵感圈', 'design', '界面、交互与视觉设计的灵感集散地', '✦', 'mira'],
            ['深夜书屋', 'reading', '读书笔记与闲聊，慢慢来', '☾', 'kai'],
        ];
        foreach ($circles as [$name, $slug, $desc, $icon, $owner]) {
            DB::run(
                'groups',
                'INSERT IGNORE INTO circles (name,slug,description,icon,owner_id,member_count,visibility,created_at)
                 VALUES (?,?,?,?,?,1,"public",NOW())',
                [$name, $slug, $desc, $icon, $ids[$owner]]
            );
        }
        foreach (DB::all('groups', 'SELECT id, owner_id FROM circles') as $circle) {
            DB::run(
                'groups',
                'INSERT IGNORE INTO circle_members (circle_id,user_id,role,joined_at) VALUES (?,?,"owner",NOW())',
                [(int) $circle['id'], (int) $circle['owner_id']]
            );
            if (DB::val('groups', 'SELECT COUNT(*) FROM circle_topics WHERE circle_id = ?', [$circle['id']], 0) == 0) {
                DB::run(
                    'groups',
                    'INSERT INTO circle_topics (circle_id,user_id,title,content,created_at) VALUES (?,?,"圈子开张啦","欢迎加入，先来打个招呼吧。",NOW())',
                    [(int) $circle['id'], (int) $circle['owner_id']]
                );
            }
        }
        $counts['circles'] = (int) DB::val('groups', 'SELECT COUNT(*) FROM circles', [], 0);

        $categories = [
            ['入门指南', 'guide'], ['开发文档', 'dev'], ['社区资料', 'community'],
        ];
        foreach ($categories as $i => [$name, $slug]) {
            DB::run('docs', 'INSERT IGNORE INTO categories (name,slug,parent_id,sort_order) VALUES (?,?,0,?)', [$name, $slug, $i]);
        }
        $docRows = [
            ['guide', 'admin', '快速上手', '注册账号后即可在论坛发帖、加入圈子、上传文档。', '从登录到发出第一个主题的十分钟指南。'],
            ['dev', 'kai', '分库设计说明', '九个业务模块各自独立数据库，便于备份与迁移。', '每个模块对应一个独立 database，表结构按领域隔离。'],
            ['community', 'mira', '社区公约', '友善讨论、尊重他人、不发布广告。', '维护讨论质量的基本约定。'],
        ];
        foreach ($docRows as [$slug, $author, $title, $summary, $content]) {
            if (DB::val('docs', 'SELECT COUNT(*) FROM documents WHERE title = ?', [$title], 0) > 0) {
                continue;
            }
            $cid = DB::val('docs', 'SELECT id FROM categories WHERE slug = ?', [$slug], 0);
            DB::run(
                'docs',
                'INSERT INTO documents (category_id,user_id,title,summary,content,created_at) VALUES (?,?,?,?,?,NOW())',
                [$cid, $ids[$author], $title, $summary, $content]
            );
        }
        $counts['documents'] = (int) DB::val('docs', 'SELECT COUNT(*) FROM documents', [], 0);

        $badges = [
            ['社区元老', '★', 'points', 1000, '积分达到 1000'],
            ['话题发起者', '✎', 'threads', 1, '发布首个主题'],
            ['热心回复', '↻', 'posts', 10, '累计回复 10 次'],
            ['知识贡献', '▤', 'docs', 1, '上传首篇文档'],
        ];
        foreach ($badges as [$name, $icon, $type, $value, $desc]) {
            DB::run('rank', 'INSERT IGNORE INTO badges (name,icon,rule_type,rule_value,description) VALUES (?,?,?,?,?)', [$name, $icon, $type, $value, $desc]);
        }
        DB::run('rank', 'INSERT IGNORE INTO user_badges (user_id,badge_id,earned_at) VALUES (?,1,NOW())', [$ids['admin']]);
        $counts['badges'] = (int) DB::val('rank', 'SELECT COUNT(*) FROM badges', [], 0);

        DB::run('social', 'INSERT IGNORE INTO follows (follower_id,followee_id,created_at) VALUES (?,?,NOW())', [$ids['luna'], $ids['kai']]);
        DB::run('social', 'INSERT IGNORE INTO follows (follower_id,followee_id,created_at) VALUES (?,?,NOW())', [$ids['mira'], $ids['luna']]);
        DB::run('social', 'INSERT IGNORE INTO friendships (user_id,friend_id,status,created_at) VALUES (?,?,"accepted",NOW())', [$ids['luna'], $ids['mira']]);
        DB::run('social', 'INSERT IGNORE INTO friendships (user_id,friend_id,status,created_at) VALUES (?,?,"accepted",NOW())', [$ids['mira'], $ids['luna']]);

        $rooms = [
            ['综合大厅', 'lobby', '所有人都可以参与的公共讨论'],
            ['技术频道', 'tech', '聊代码、工具与架构'],
            ['闲聊灌水', 'casual', '放松一下，随便聊聊'],
        ];
        foreach ($rooms as [$name, $slug, $desc]) {
            DB::run('chat', 'INSERT IGNORE INTO rooms (name,slug,description,created_at) VALUES (?,?,?,NOW())', [$name, $slug, $desc]);
        }
        foreach (DB::all('chat', 'SELECT id FROM rooms') as $room) {
            if (DB::val('chat', 'SELECT COUNT(*) FROM messages WHERE room_id = ?', [$room['id']], 0) == 0) {
                DB::run(
                    'chat',
                    'INSERT INTO messages (room_id,user_id,content,created_at) VALUES (?,0,"欢迎来到聊天室，请友善交流。",NOW())',
                    [(int) $room['id']]
                );
            }
        }
        $counts['chat_rooms'] = (int) DB::val('chat', 'SELECT COUNT(*) FROM rooms', [], 0);

        $locales = ['zh-CN' => '简体中文', 'en' => 'English', 'ja' => '日本語', 'ko' => '한국어'];
        foreach ($locales as $code => $name) {
            DB::run('i18n', 'INSERT IGNORE INTO locales (code,name,is_default,enabled) VALUES (?,?,?,1)', [$code, $name, $code === 'zh-CN' ? 1 : 0]);
        }
        $counts['translations'] = self::seedTranslations();

        return $counts;
    }

    /** 四语词条：顺序固定为 zh-CN / en / ja / ko。 */
    private static function seedTranslations(): int
    {
        $dict = [
            'site_name'        => ['随心社区', 'Suixin Community', '随心コミュニティ', '쉬신 커뮤니티'],
            'slogan'           => ['以讨论为核心的社区', 'A community built around discussion', '議論を中心としたコミュニティ', '토론을 중심으로 한 커뮤니티'],
            'nav_home'         => ['首页', 'Home', 'ホーム', '홈'],
            'nav_forum'        => ['论坛', 'Forum', 'フォーラム', '포럼'],
            'nav_groups'       => ['圈子', 'Groups', 'サークル', '모임'],
            'nav_space'        => ['家园', 'Space', 'マイホーム', '마이홈'],
            'nav_rank'         => ['排行榜', 'Ranking', 'ランキング', '랭킹'],
            'nav_docs'         => ['文库', 'Docs', '文書ライブラリ', '문서'],
            'nav_social'       => ['交友', 'Friends', 'フレンド', '친구'],
            'nav_chat'         => ['聊天室', 'Chat', 'チャット', '채팅'],
            'login'            => ['登录', 'Sign in', 'ログイン', '로그인'],
            'register'         => ['注册', 'Sign up', '新規登録', '회원가입'],
            'logout'           => ['退出', 'Sign out', 'ログアウト', '로그아웃'],
            'search'           => ['搜索', 'Search', '検索', '검색'],
            'search_hint'      => ['搜索主题、文档、圈子…', 'Search threads, docs, groups…', 'スレッド・文書・サークルを検索…', '글·문서·모임 검색…'],
            'submit'           => ['提交', 'Submit', '送信', '제출'],
            'cancel'           => ['取消', 'Cancel', 'キャンセル', '취소'],
            'reply'            => ['回复', 'Reply', '返信', '답글'],
            'more'             => ['查看更多', 'View more', 'もっと見る', '더 보기'],
            'hero_title'       => ['让每一次讨论都有回响', 'Every discussion deserves an echo', 'すべての議論に反響を', '모든 토론에 울림을'],
            'hero_desc'        => ['论坛、圈子、家园、文库与实时聊天，重新组织的社区体验。', 'Forums, groups, personal spaces, docs and live chat — a community redesigned.', 'フォーラム、サークル、マイホーム、文書、リアルタイムチャット。', '포럼, 모임, 마이홈, 문서, 실시간 채팅을 새롭게.'],
            'hero_cta'         => ['进入论坛', 'Explore the forum', 'フォーラムへ', '포럼 들어가기'],
            'stat_threads'     => ['主题', 'Threads', 'スレッド', '글'],
            'stat_members'     => ['成员', 'Members', 'メンバー', '회원'],
            'stat_posts'       => ['回复', 'Replies', '返信', '답글'],
            'online'           => ['在线', 'online', 'オンライン', '접속중'],
            'latest_threads'   => ['最新讨论', 'Latest discussions', '最新の議論', '최신 토론'],
            'hot_threads'      => ['热门话题', 'Trending', '人気の話題', '인기 글'],
            'forum_sections'   => ['版块', 'Sections', '板一覧', '게시판'],
            'forum_desc'       => ['选择感兴趣的版块，开始或加入一场讨论。', 'Pick a section and join the conversation.', '板を選んで議論に参加しましょう。', '게시판을 골라 토론에 참여하세요.'],
            'threads'          => ['主题数', 'Threads', 'スレッド数', '글 수'],
            'posts'            => ['回复数', 'Replies', '返信数', '답글 수'],
            'views'            => ['浏览', 'Views', '閲覧', '조회'],
            'last_reply'       => ['最后回复', 'Last reply', '最終返信', '마지막 답글'],
            'pinned'           => ['置顶', 'Pinned', '固定', '고정'],
            'essence'          => ['精华', 'Featured', 'おすすめ', '추천'],
            'new_thread'       => ['发表主题', 'New thread', '新規スレッド', '새 글'],
            'thread_title'     => ['标题', 'Title', 'タイトル', '제목'],
            'thread_content'   => ['正文', 'Content', '本文', '내용'],
            'reply_hint'       => ['写下你的看法…', 'Share your thoughts…', '意見を書いてください…', '생각을 남겨보세요…'],
            'no_threads'       => ['还没有主题，来发第一帖吧。', 'No threads yet. Be the first to post.', 'まだスレッドがありません。', '아직 글이 없습니다.'],
            'no_replies'       => ['还没有回复。', 'No replies yet.', 'まだ返信がありません。', '아직 답글이 없습니다.'],
            'groups_title'     => ['圈子与群组', 'Groups & Circles', 'サークルとグループ', '모임과 그룹'],
            'groups_desc'      => ['按兴趣聚在一起，聊得更深一点。', 'Gather around shared interests.', '共通の興味で集まりましょう。', '관심사로 모이세요.'],
            'create_group'     => ['创建圈子', 'Create group', 'サークル作成', '모임 만들기'],
            'join_group'       => ['加入', 'Join', '参加', '가입'],
            'joined'           => ['已加入', 'Joined', '参加済み', '가입됨'],
            'members'          => ['成员', 'Members', 'メンバー', '멤버'],
            'circle_topics'    => ['圈内话题', 'Topics', 'サークルの話題', '모임 글'],
            'new_topic'        => ['发起话题', 'New topic', '話題を作成', '새 글'],
            'space_title'      => ['个人家园', 'Personal space', 'マイホーム', '마이홈'],
            'feeds'            => ['动态', 'Activity', 'アクティビティ', '활동'],
            'visitors'         => ['最近访客', 'Recent visitors', '最近の訪問者', '최근 방문자'],
            'follow'           => ['关注', 'Follow', 'フォロー', '팔로우'],
            'unfollow'         => ['取消关注', 'Unfollow', 'フォロー解除', '언팔로우'],
            'add_friend'       => ['加好友', 'Add friend', 'フレンド追加', '친구 추가'],
            'send_message'     => ['发私信', 'Message', 'メッセージ', '쪽지 보내기'],
            'rank_title'       => ['社区排行榜', 'Community ranking', 'コミュニティランキング', '커뮤니티 랭킹'],
            'rank_desc'        => ['积分、主题、文档与人气，多维度的贡献榜。', 'Points, threads, docs and popularity.', 'ポイント・スレッド・文書・人気。', '포인트·글·문서·인기.'],
            'points'           => ['积分', 'Points', 'ポイント', '포인트'],
            'badges'           => ['勋章', 'Badges', 'バッジ', '배지'],
            'docs_title'       => ['文档文库', 'Document library', '文書ライブラリ', '문서 라이브러리'],
            'docs_desc'        => ['沉淀社区里的知识与资料。', 'Knowledge collected by the community.', 'コミュニティの知見を蓄積。', '커뮤니티의 지식을 모읍니다.'],
            'upload_doc'       => ['投稿文档', 'Submit document', '文書を投稿', '문서 등록'],
            'downloads'        => ['下载', 'Downloads', 'ダウンロード', '다운로드'],
            'social_title'     => ['交友系统', 'Friends & connections', 'フレンド・交流', '친구와 관계'],
            'social_desc'      => ['关注感兴趣的人，结交志同道合的朋友。', 'Follow people and make friends.', '気になる人をフォローして友達に。', '관심 있는 사람을 팔로우하세요.'],
            'recommend'        => ['推荐成员', 'Suggested members', 'おすすめメンバー', '추천 회원'],
            'following'        => ['关注中', 'Following', 'フォロー中', '팔로잉'],
            'followers'        => ['粉丝', 'Followers', 'フォロワー', '팔로워'],
            'friends'          => ['好友', 'Friends', 'フレンド', '친구'],
            'inbox'            => ['私信', 'Messages', 'メッセージ', '쪽지'],
            'chat_title'       => ['实时聊天室', 'Live chat rooms', 'リアルタイムチャット', '실시간 채팅'],
            'chat_rooms'       => ['房间列表', 'Rooms', '部屋一覧', '방 목록'],
            'chat_desc'        => ['选择房间，和其他成员即时交流。', 'Pick a room and talk in real time.', '部屋を選んでリアルタイムに会話。', '방을 골라 실시간 대화.'],
            'chat_hint'        => ['输入消息…', 'Type a message…', 'メッセージを入力…', '메시지 입력…'],
            'chat_send'        => ['发送', 'Send', '送信', '보내기'],
            'chat_login'       => ['登录后即可发言', 'Sign in to chat', 'ログインすると発言できます', '로그인 후 대화 가능'],
            'login_title'      => ['欢迎回来', 'Welcome back', 'おかえりなさい', '다시 오신 것을 환영합니다'],
            'register_title'   => ['加入社区', 'Join the community', 'コミュニティに参加', '커뮤니티 가입'],
            'username'         => ['用户名', 'Username', 'ユーザー名', '사용자명'],
            'password'         => ['密码', 'Password', 'パスワード', '비밀번호'],
            'email'            => ['邮箱', 'Email', 'メール', '이메일'],
            'nickname'         => ['昵称', 'Nickname', 'ニックネーム', '닉네임'],
            'no_account'       => ['还没有账号？', 'No account yet?', 'アカウントをお持ちでない方', '계정이 없으신가요?'],
            'has_account'      => ['已有账号？', 'Already have an account?', 'すでにアカウントをお持ちの方', '이미 계정이 있으신가요?'],
            'login_failed'     => ['账号或密码不正确', 'Invalid credentials', '認証情報が正しくありません', '로그인 정보가 올바르지 않습니다'],
            'register_failed'  => ['注册失败，请检查输入', 'Registration failed, please check your input', '登録に失敗しました', '가입에 실패했습니다'],
            'login_required'   => ['请先登录', 'Please sign in first', '先にログインしてください', '먼저 로그인하세요'],
            'csrf_invalid'     => ['表单已过期，请刷新重试', 'Form expired, please refresh', 'フォームの有効期限が切れました', '양식이 만료되었습니다'],
            'saved'            => ['已保存', 'Saved', '保存しました', '저장됨'],
            'not_found'        => ['页面不存在', 'Page not found', 'ページが見つかりません', '페이지를 찾을 수 없습니다'],
            'back_home'        => ['返回首页', 'Back to home', 'ホームへ戻る', '홈으로'],
            'all'              => ['全部', 'All', 'すべて', '전체'],
            'by'               => ['作者', 'by', '投稿者', '작성자'],
            'language'         => ['语言', 'Language', '言語', '언어'],
            'footer_note'      => ['GPL-3.0-only 开源 · 二次修改须显著标注并开源', 'GPL-3.0-only · Modified versions must be prominently marked and open sourced', 'GPL-3.0-only · 改変時は明示と公開が必要', 'GPL-3.0-only · 수정 시 명시 및 공개 필요'],
            'read_more'        => ['阅读全文', 'Read more', '続きを読む', '자세히 보기'],
            'created_at'       => ['发布于', 'Posted', '投稿日', '작성일'],
        ];

        $rows = [];
        $params = [];
        $order = ['zh-CN', 'en', 'ja', 'ko'];
        foreach ($dict as $key => $values) {
            foreach ($order as $index => $locale) {
                $rows[] = '(?,?,?)';
                $params[] = $locale;
                $params[] = $key;
                $params[] = $values[$index];
            }
        }
        DB::run('i18n', 'INSERT IGNORE INTO translations (locale,k,v) VALUES ' . implode(',', $rows), $params);
        return count($rows);
    }
}
