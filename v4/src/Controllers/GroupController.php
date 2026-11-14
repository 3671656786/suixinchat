<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

namespace Suixin\V4\Controllers;

use Suixin\V4\Auth;
use Suixin\V4\DB;
use Suixin\V4\View;

final class GroupController
{
    public static function dispatch(array $seg): void
    {
        $action = $seg[1] ?? '';
        if ($action === '' || $action === 'index') {
            self::index();
        } elseif (isset($seg[1]) && ctype_digit($seg[1])) {
            self::show((int) $seg[1]);
        } else {
            \abort_page(404);
        }
    }

    public static function index(): void
    {
        $circles = DB::all('groups', 'SELECT * FROM circles ORDER BY member_count DESC, id ASC');
        $joined = [];
        if (Auth::id() > 0) {
            foreach (DB::all('groups', 'SELECT circle_id FROM circle_members WHERE user_id = ?', [Auth::id()]) as $row) {
                $joined[] = (int) $row['circle_id'];
            }
        }
        $ownerIds = array_column($circles, 'owner_id');
        View::render('groups', [
            'mode'    => 'index',
            'circles' => $circles,
            'joined'  => $joined,
            'names'   => \user_names($ownerIds),
        ]);
    }

    public static function show(int $id): void
    {
        $circle = DB::one('groups', 'SELECT * FROM circles WHERE id = ?', [$id]);
        if ($circle === null) {
            \abort_page(404);
        }
        $topics = DB::all('groups', 'SELECT * FROM circle_topics WHERE circle_id = ? ORDER BY id DESC LIMIT 30', [$id]);
        $replies = [];
        if ($topics !== []) {
            $topicIds = array_column($topics, 'id');
            $ph = implode(',', array_fill(0, count($topicIds), '?'));
            $rows = DB::all('groups', "SELECT * FROM circle_replies WHERE topic_id IN ({$ph}) ORDER BY id ASC", $topicIds);
            foreach ($rows as $row) {
                $replies[(int) $row['topic_id']][] = $row;
            }
        }
        $members = DB::all('groups', 'SELECT user_id, role FROM circle_members WHERE circle_id = ? ORDER BY id ASC LIMIT 30', [$id]);
        $joined = false;
        if (Auth::id() > 0) {
            $joined = DB::val('groups', 'SELECT COUNT(*) FROM circle_members WHERE circle_id = ? AND user_id = ?', [$id, Auth::id()], 0) > 0;
        }
        $allUserIds = array_merge(
            [$circle['owner_id']],
            array_column($topics, 'user_id'),
            array_column($members, 'user_id')
        );
        foreach ($replies as $list) {
            $allUserIds = array_merge($allUserIds, array_column($list, 'user_id'));
        }
        View::render('groups', [
            'mode'    => 'show',
            'circle'  => $circle,
            'topics'  => $topics,
            'replies' => $replies,
            'members' => $members,
            'joined'  => $joined,
            'names'   => \user_names($allUserIds),
        ]);
    }
}
