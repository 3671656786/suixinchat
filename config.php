<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

return [
    'version' => '4.0.0',
    'site' => [
        'name'        => '随心社区',
        'name_en'     => 'Suixin Community',
        'slogan'      => '以讨论为核心的社区',
        'base_url'    => 'http://127.0.0.1:8081',
    ],
    'db' => [
        'host'     => '127.0.0.1',
        'port'     => 3307,
        'user'     => 'root',
        'password' => getenv('SUIXIN_DB_PASS') ?: 'suixin_dev',
        'charset'  => 'utf8mb4',
        // 数据库分文件存储：每个模块使用独立 database。
        // MariaDB/MySQL 下每个 database 对应独立数据目录，InnoDB 每表独立 .ibd 文件。
        'shards' => [
            'core'   => 'suixin_core',    // 用户 / 会话配置 / 通知 / 积分总账
            'forum'  => 'suixin_forum',   // 版块 / 主题 / 楼层 / 点赞
            'groups' => 'suixin_groups',  // 圈子 / 成员 / 圈内话题
            'home'   => 'suixin_home',    // 家园空间 / 动态 / 访客
            'rank'   => 'suixin_rank',    // 排行榜 / 勋章
            'docs'   => 'suixin_docs',    // 文档文库 / 分类
            'social' => 'suixin_social',  // 关注 / 好友 / 私信
            'chat'   => 'suixin_chat',    // 聊天室 / 消息 / 在线
            'i18n'   => 'suixin_i18n',    // 多语言词条
        ],
    ],
    'security' => [
        'session_name'   => 'SUIXIN_V4',
        'max_title'      => 120,
        'max_content'    => 5000,
        'max_username'   => 24,
        'min_password'   => 6,
        'chat_poll_ms'   => 2500,
    ],
    'i18n' => [
        'default'   => 'zh-CN',
        'available' => ['zh-CN', 'en', 'ja', 'ko'],
        'names'     => ['zh-CN' => '简体中文', 'en' => 'English', 'ja' => '日本語', 'ko' => '한국어'],
    ],
];
