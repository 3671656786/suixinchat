<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

namespace Suixin\V4\Controllers;

use Suixin\V4\Auth;
use Suixin\V4\DB;
use Suixin\V4\View;

final class SpaceController
{
    public static function dispatch(array $seg): void
    {
        $target = isset($seg[1]) && ctype_digit($seg[1]) ? (int) $seg[1] : Auth::id();
        if ($target <= 0) {
            View::redirect('/login');
        }
        self::show($target);
    }

    public static function show(int $uid): void
    {
        $profile = DB::one(
            'core',
            'SELECT id, username, nickname, avatar, role, points, bio, signature, created_at FROM users WHERE id = ?',
            [$uid]
        );
        if ($profile === null) {
            \abort_page(404);
        }
        $home = DB::one('home', 'SELECT * FROM profiles WHERE user_id = ?', [$uid]) ?: ['mood' => '', 'visitor_count' => 0, 'tags' => ''];
        $feeds = DB::all('home', 'SELECT * FROM feeds WHERE user_id = ? ORDER BY id DESC LIMIT 20', [$uid]);
        $visitors = DB::all('home', 'SELECT visitor_id, visited_at FROM visitors WHERE host_user_id = ? ORDER BY id DESC LIMIT 10', [$uid]);
        $threadCount = (int) DB::val('rank', 'SELECT thread_count FROM scores WHERE user_id = ?', [$uid], 0);
        $badges = DB::all(
            'rank',
            'SELECT b.* FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ? ORDER BY b.id ASC',
            [$uid]
        );

        $viewer = Auth::id();
        if ($viewer > 0 && $viewer !== $uid && (int) DB::val('home', 'SELECT COUNT(*) FROM visitors WHERE host_user_id = ? AND visitor_id = ? AND visited_at > DATE_SUB(NOW(), INTERVAL 1 DAY)', [$uid, $viewer], 0) === 0) {
            DB::run('home', 'INSERT INTO visitors (host_user_id,visitor_id,visited_at) VALUES (?,?,NOW())', [$uid, $viewer]);
            DB::run('home', 'UPDATE profiles SET visitor_count = visitor_count + 1 WHERE user_id = ?', [$uid]);
            $home['visitor_count'] = (int) $home['visitor_count'] + 1;
        }
        $isFollowing = false;
        if ($viewer > 0) {
            $isFollowing = DB::val('social', 'SELECT COUNT(*) FROM follows WHERE follower_id = ? AND followee_id = ?', [$viewer, $uid], 0) > 0;
        }
        $isFriend = false;
        if ($viewer > 0) {
            $isFriend = DB::val('social', 'SELECT COUNT(*) FROM friendships WHERE user_id = ? AND friend_id = ? AND status = "accepted"', [$viewer, $uid], 0) > 0;
        }
        View::render('space', [
            'profile'      => $profile,
            'home'         => $home,
            'feeds'        => $feeds,
            'visitors'     => $visitors,
            'visitorNames' => \user_names(array_column($visitors, 'visitor_id')),
            'threadCount'  => $threadCount,
            'badges'       => $badges,
            'isFollowing'  => $isFollowing,
            'isFriend'     => $isFriend,
        ]);
    }
}
