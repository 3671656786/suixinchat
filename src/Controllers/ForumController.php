<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

namespace Suixin\V4\Controllers;

use Suixin\V4\DB;
use Suixin\V4\Req;
use Suixin\V4\View;

final class ForumController
{
    public static function dispatch(array $seg): void
    {
        $action = $seg[1] ?? '';
        if ($action === '' || $action === 'index') {
            self::index();
        } elseif ($action === 'f' && isset($seg[2]) && ctype_digit($seg[2])) {
            self::section((int) $seg[2]);
        } elseif ($action === 't' && isset($seg[2]) && ctype_digit($seg[2])) {
            self::thread((int) $seg[2]);
        } else {
            \abort_page(404);
        }
    }

    public static function index(): void
    {
        $forums = DB::all('forum', 'SELECT * FROM forums ORDER BY sort_order ASC, id ASC');
        $threads = DB::all(
            'forum',
            'SELECT t.*, f.name AS forum_name, f.slug AS forum_slug
             FROM threads t LEFT JOIN forums f ON f.id = t.forum_id
             ORDER BY t.is_top DESC, t.last_reply_at DESC, t.id DESC LIMIT 30'
        );
        $names = \user_names(array_column($threads, 'user_id'));
        $keyword = (string) Req::get('q', '');
        if ($keyword !== '') {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $keyword) . '%';
            $threads = DB::all(
                'forum',
                'SELECT t.*, f.name AS forum_name, f.slug AS forum_slug
                 FROM threads t LEFT JOIN forums f ON f.id = t.forum_id
                 WHERE t.title LIKE ? OR t.content LIKE ?
                 ORDER BY t.id DESC LIMIT 50',
                [$like, $like]
            );
            $names = \user_names(array_column($threads, 'user_id'));
        }
        View::render('forum', [
            'mode'    => 'index',
            'forums'  => $forums,
            'threads' => $threads,
            'names'   => $names,
            'keyword' => $keyword,
        ]);
    }

    public static function section(int $id): void
    {
        $forum = DB::one('forum', 'SELECT * FROM forums WHERE id = ?', [$id]);
        if ($forum === null) {
            \abort_page(404);
        }
        $threads = DB::all(
            'forum',
            'SELECT * FROM threads WHERE forum_id = ? ORDER BY is_top DESC, last_reply_at DESC, id DESC LIMIT 50',
            [$id]
        );
        $names = \user_names(array_column($threads, 'user_id'));
        View::render('forum', [
            'mode'    => 'section',
            'forums'  => [$forum],
            'threads' => $threads,
            'names'   => $names,
            'keyword' => '',
            'current' => $forum,
        ]);
    }

    public static function thread(int $id): void
    {
        $thread = DB::one(
            'forum',
            'SELECT t.*, f.name AS forum_name FROM threads t LEFT JOIN forums f ON f.id = t.forum_id WHERE t.id = ?',
            [$id]
        );
        if ($thread === null) {
            \abort_page(404);
        }
        DB::run('forum', 'UPDATE threads SET views = views + 1 WHERE id = ?', [$id]);
        $thread['views'] = (int) $thread['views'] + 1;
        $posts = DB::all('forum', 'SELECT * FROM posts WHERE thread_id = ? ORDER BY floor ASC, id ASC', [$id]);
        $names = \user_names(array_merge([$thread['user_id']], array_column($posts, 'user_id')));
        View::render('thread', compact('thread', 'posts', 'names'));
    }
}
