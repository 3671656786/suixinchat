<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

namespace Suixin\V4\Controllers;

use Suixin\V4\DB;
use Suixin\V4\Req;
use Suixin\V4\View;

final class RankController
{
    private const ALLOWED = ['points', 'thread_count', 'post_count', 'doc_count', 'friend_count'];

    public static function index(): void
    {
        $sort = (string) Req::get('sort', 'points');
        if (!in_array($sort, self::ALLOWED, true)) {
            $sort = 'points';
        }
        $rows = DB::all('rank', "SELECT * FROM scores ORDER BY {$sort} DESC, user_id ASC LIMIT 30");
        $names = \user_names(array_column($rows, 'user_id'));
        $badges = DB::all('rank', 'SELECT * FROM badges ORDER BY id ASC');
        $topPoints = DB::all('rank', 'SELECT user_id, points FROM scores ORDER BY points DESC LIMIT 3');
        $topNames = \user_names(array_column($topPoints, 'user_id'));
        View::render('rank', [
            'rows'      => $rows,
            'names'     => $names,
            'badges'    => $badges,
            'sort'      => $sort,
            'topPoints' => $topPoints,
            'topNames'  => $topNames,
        ]);
    }
}
