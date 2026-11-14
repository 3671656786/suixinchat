<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

namespace Suixin\V4\Controllers;

use Suixin\V4\Auth;
use Suixin\V4\DB;
use Suixin\V4\View;

final class SocialController
{
    public static function index(): void
    {
        $uid = Auth::id();
        $suggested = DB::all('core', 'SELECT id, username, nickname, avatar, role, points, bio FROM users ORDER BY points DESC LIMIT 12');
        $following = [];
        $followers = [];
        $friends = [];
        $inbox = [];

        if ($uid > 0) {
            $following = DB::all('social', 'SELECT followee_id AS user_id, created_at FROM follows WHERE follower_id = ? ORDER BY id DESC', [$uid]);
            $followers = DB::all('social', 'SELECT follower_id AS user_id, created_at FROM follows WHERE followee_id = ? ORDER BY id DESC', [$uid]);
            $friends = DB::all('social', 'SELECT friend_id AS user_id, created_at FROM friendships WHERE user_id = ? AND status = "accepted" ORDER BY id DESC', [$uid]);
            $inbox = DB::all('social', 'SELECT * FROM messages WHERE to_id = ? OR from_id = ? ORDER BY id DESC LIMIT 30', [$uid, $uid]);
            DB::run('social', 'UPDATE messages SET is_read = 1 WHERE to_id = ? AND is_read = 0', [$uid]);
        }

        $allIds = array_column($suggested, 'id');
        foreach ([$following, $followers, $friends] as $list) {
            $allIds = array_merge($allIds, array_column($list, 'user_id'));
        }
        $allIds = array_merge($allIds, array_column($inbox, 'from_id'), array_column($inbox, 'to_id'));
        $names = \user_names($allIds);

        $followedIds = [];
        if ($uid > 0) {
            foreach (DB::all('social', 'SELECT followee_id FROM follows WHERE follower_id = ?', [$uid]) as $row) {
                $followedIds[] = (int) $row['followee_id'];
            }
        }
        View::render('social', compact('suggested', 'following', 'followers', 'friends', 'inbox', 'names', 'followedIds'));
    }
}
