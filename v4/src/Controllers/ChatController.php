<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

namespace Suixin\V4\Controllers;

use Suixin\V4\Auth;
use Suixin\V4\DB;
use Suixin\V4\Req;
use Suixin\V4\View;

final class ChatController
{
    public static function index(): void
    {
        $rooms = DB::all('chat', 'SELECT * FROM rooms ORDER BY id ASC');
        if ($rooms === []) {
            \abort_page(500, 'chat rooms not initialised');
        }
        $roomId = (int) Req::get('room', (int) $rooms[0]['id']);
        $room = DB::one('chat', 'SELECT * FROM rooms WHERE id = ?', [$roomId]);
        if ($room === null) {
            $room = $rooms[0];
            $roomId = (int) $room['id'];
        }
        $messages = DB::all(
            'chat',
            'SELECT * FROM (SELECT * FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT 50) recent ORDER BY id ASC',
            [$roomId]
        );
        $onlineRows = DB::all('chat', 'SELECT user_id FROM online WHERE room_id = ? AND last_seen > DATE_SUB(NOW(), INTERVAL 5 MINUTE)', [$roomId]);
        $onlineNames = \user_names(array_column($onlineRows, 'user_id'));
        $names = \user_names(array_column($messages, 'user_id'));
        $lastId = $messages === [] ? 0 : (int) $messages[array_key_last($messages)]['id'];

        $uid = Auth::id();
        if ($uid > 0) {
            DB::run(
                'chat',
                'INSERT INTO online (user_id,room_id,last_seen) VALUES (?,?,NOW())
                 ON DUPLICATE KEY UPDATE last_seen = NOW()',
                [$uid, $roomId]
            );
        }
        View::render('chat', compact('rooms', 'room', 'roomId', 'messages', 'names', 'onlineNames', 'lastId'));
    }
}
