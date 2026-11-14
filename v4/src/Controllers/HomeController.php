<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

namespace Suixin\V4\Controllers;

use Suixin\V4\DB;
use Suixin\V4\View;

final class HomeController
{
    public static function index(): void
    {
        $stats = [
            'threads' => (int) DB::val('forum', 'SELECT COUNT(*) FROM threads', [], 0),
            'members' => (int) DB::val('core', 'SELECT COUNT(*) FROM users', [], 0),
            'posts'   => (int) DB::val('forum', 'SELECT COUNT(*) FROM posts', [], 0),
            'docs'    => (int) DB::val('docs', 'SELECT COUNT(*) FROM documents', [], 0),
            'online'  => (int) DB::val('chat', 'SELECT COUNT(*) FROM online WHERE last_seen > DATE_SUB(NOW(), INTERVAL 5 MINUTE)', [], 0),
        ];
        $forums = DB::all('forum', 'SELECT * FROM forums ORDER BY sort_order ASC, id ASC');
        $threads = DB::all(
            'forum',
            'SELECT t.*, f.name AS forum_name, f.slug AS forum_slug
             FROM threads t LEFT JOIN forums f ON f.id = t.forum_id
             ORDER BY t.is_top DESC, t.last_reply_at DESC, t.id DESC LIMIT 8'
        );
        $names = \user_names(array_column($threads, 'user_id'));
        View::render('home', compact('stats', 'forums', 'threads', 'names'));
    }
}
