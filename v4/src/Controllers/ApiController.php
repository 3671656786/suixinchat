<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

namespace Suixin\V4\Controllers;

use Suixin\V4\Auth;
use Suixin\V4\Config;
use Suixin\V4\DB;
use Suixin\V4\I18n;
use Suixin\V4\Req;
use Suixin\V4\View;

final class ApiController
{
    public static function dispatch(array $seg, string $method): void
    {
        $action = implode('/', array_slice($seg, 1));
        try {
            $result = match ($action) {
                'health'        => self::health(),
                'lang'          => self::lang(),
                'thread'        => self::thread(),
                'reply'         => self::reply(),
                'circle/create' => self::circleCreate(),
                'circle/join'   => self::circleJoin(),
                'circle/topic'  => self::circleTopic(),
                'circle/reply'  => self::circleReply(),
                'follow'        => self::follow(),
                'friend'        => self::friend(),
                'message'       => self::message(),
                'doc'           => self::doc(),
                'chat/send'     => self::chatSend(),
                'chat/poll'     => self::chatPoll(),
                default         => ['ok' => false, 'error' => 'unknown_action'],
            };
            View::json($result);
        } catch (\Throwable $e) {
            View::json(['ok' => false, 'error' => 'server_error', 'message' => $e->getMessage()], 500);
        }
    }

    private static function guard(): array
    {
        $body = Req::body();
        if (!Req::csrfValid($body)) {
            View::json(['ok' => false, 'error' => 'csrf_invalid'], 403);
        }
        if (Auth::id() <= 0) {
            View::json(['ok' => false, 'error' => 'login_required'], 401);
        }
        return $body;
    }

    private static function text(array $body, string $key, int $max = 0): string
    {
        $value = isset($body[$key]) && is_scalar($body[$key]) ? (string) $body[$key] : '';
        $max = $max ?: (int) Config::get('security.max_content', 5000);
        return Req::limit($value, $max);
    }

    /** 分库自检：返回每个独立 database 的表数量，用于验证"数据库分文件存储"。 */
    private static function health(): array
    {
        $shards = [];
        foreach (DB::shardNames() as $alias => $name) {
            $shards[$alias] = [
                'database' => $name,
                'tables'   => (int) DB::val($alias, 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = ?', [$name], 0),
            ];
        }
        return [
            'ok'      => true,
            'version' => Config::get('version'),
            'locale'  => I18n::locale(),
            'shards'  => $shards,
            'threads' => (int) DB::val('forum', 'SELECT COUNT(*) FROM threads', [], 0),
            'locales' => (int) DB::val('i18n', 'SELECT COUNT(DISTINCT locale) FROM translations', [], 0),
        ];
    }

    private static function lang(): array
    {
        $body = self::guard();
        $code = self::text($body, 'code', 12);
        if (!I18n::set($code)) {
            return ['ok' => false, 'error' => 'unsupported_locale'];
        }
        return ['ok' => true, 'locale' => $code];
    }

    private static function thread(): array
    {
        $body = self::guard();
        $forumId = (int) ($body['forum_id'] ?? 0);
        $title = self::text($body, 'title', (int) Config::get('security.max_title', 120));
        $content = self::text($body, 'content');
        if ($title === '' || $content === '') {
            return ['ok' => false, 'error' => 'empty_fields'];
        }
        if (DB::one('forum', 'SELECT id FROM forums WHERE id = ?', [$forumId]) === null) {
            return ['ok' => false, 'error' => 'forum_not_found'];
        }
        DB::run(
            'forum',
            'INSERT INTO threads (forum_id,user_id,title,content,views,reply_count,last_reply_at,created_at)
             VALUES (?,?,?,?,0,0,NOW(),NOW())',
            [$forumId, Auth::id(), $title, $content]
        );
        $id = DB::id('forum');
        DB::run('forum', 'UPDATE forums SET thread_count = thread_count + 1 WHERE id = ?', [$forumId]);
        Auth::addPoints(Auth::id(), 5, 'thread_count');
        DB::run('home', 'INSERT INTO feeds (user_id,type,content,created_at) VALUES (?,"thread",?,NOW())', [Auth::id(), $title]);
        return ['ok' => true, 'id' => $id, 'url' => '/forum/t/' . $id];
    }

    private static function reply(): array
    {
        $body = self::guard();
        $threadId = (int) ($body['thread_id'] ?? 0);
        $content = self::text($body, 'content');
        if ($content === '') {
            return ['ok' => false, 'error' => 'empty_fields'];
        }
        $thread = DB::one('forum', 'SELECT id, user_id, title FROM threads WHERE id = ?', [$threadId]);
        if ($thread === null) {
            return ['ok' => false, 'error' => 'thread_not_found'];
        }
        $floor = (int) DB::val('forum', 'SELECT COALESCE(MAX(floor),0) FROM posts WHERE thread_id = ?', [$threadId], 0) + 1;
        DB::run('forum', 'INSERT INTO posts (thread_id,user_id,content,floor,created_at) VALUES (?,?,?,?,NOW())', [$threadId, Auth::id(), $content, $floor]);
        DB::run('forum', 'UPDATE threads SET reply_count = reply_count + 1, last_reply_at = NOW() WHERE id = ?', [$threadId]);
        Auth::addPoints(Auth::id(), 2, 'post_count');
        DB::run('home', 'INSERT INTO feeds (user_id,type,content,created_at) VALUES (?,"reply",?,NOW())', [Auth::id(), $thread['title']]);
        if ((int) $thread['user_id'] !== Auth::id()) {
            Auth::notify((int) $thread['user_id'], 'reply', '你的主题收到了新回复：' . $thread['title']);
        }
        return ['ok' => true, 'floor' => $floor];
    }

    private static function circleCreate(): array
    {
        $body = self::guard();
        $name = self::text($body, 'name', 80);
        $description = self::text($body, 'description', 255);
        if ($name === '') {
            return ['ok' => false, 'error' => 'empty_fields'];
        }
        $slug = 'circle-' . bin2hex(random_bytes(5));
        DB::run(
            'groups',
            'INSERT INTO circles (name,slug,description,icon,owner_id,member_count,visibility,created_at)
             VALUES (?,?,?,"◈",?,1,"public",NOW())',
            [$name, $slug, $description, Auth::id()]
        );
        $id = DB::id('groups');
        DB::run('groups', 'INSERT INTO circle_members (circle_id,user_id,role,joined_at) VALUES (?,?,"owner",NOW())', [$id, Auth::id()]);
        Auth::addPoints(Auth::id(), 3);
        return ['ok' => true, 'id' => $id, 'url' => '/groups/' . $id];
    }

    private static function circleJoin(): array
    {
        $body = self::guard();
        $circleId = (int) ($body['circle_id'] ?? 0);
        if (DB::one('groups', 'SELECT id FROM circles WHERE id = ?', [$circleId]) === null) {
            return ['ok' => false, 'error' => 'circle_not_found'];
        }
        $statement = DB::run(
            'groups',
            'INSERT IGNORE INTO circle_members (circle_id,user_id,role,joined_at) VALUES (?,?,"member",NOW())',
            [$circleId, Auth::id()]
        );
        if ($statement->rowCount() > 0) {
            DB::run('groups', 'UPDATE circles SET member_count = member_count + 1 WHERE id = ?', [$circleId]);
        }
        return ['ok' => true, 'joined' => true];
    }

    private static function circleTopic(): array
    {
        $body = self::guard();
        $circleId = (int) ($body['circle_id'] ?? 0);
        $title = self::text($body, 'title', (int) Config::get('security.max_title', 120));
        $content = self::text($body, 'content');
        if ($title === '' || $content === '') {
            return ['ok' => false, 'error' => 'empty_fields'];
        }
        if (DB::one('groups', 'SELECT id FROM circles WHERE id = ?', [$circleId]) === null) {
            return ['ok' => false, 'error' => 'circle_not_found'];
        }
        DB::run('groups', 'INSERT INTO circle_topics (circle_id,user_id,title,content,created_at) VALUES (?,?,?,?,NOW())', [$circleId, Auth::id(), $title, $content]);
        Auth::addPoints(Auth::id(), 2);
        return ['ok' => true];
    }

    private static function circleReply(): array
    {
        $body = self::guard();
        $topicId = (int) ($body['topic_id'] ?? 0);
        $content = self::text($body, 'content');
        if ($content === '') {
            return ['ok' => false, 'error' => 'empty_fields'];
        }
        if (DB::one('groups', 'SELECT id FROM circle_topics WHERE id = ?', [$topicId]) === null) {
            return ['ok' => false, 'error' => 'topic_not_found'];
        }
        DB::run('groups', 'INSERT INTO circle_replies (topic_id,user_id,content,created_at) VALUES (?,?,?,NOW())', [$topicId, Auth::id(), $content]);
        DB::run('groups', 'UPDATE circle_topics SET reply_count = reply_count + 1 WHERE id = ?', [$topicId]);
        Auth::addPoints(Auth::id(), 1);
        return ['ok' => true];
    }

    /** 关注 / 取消关注切换。 */
    private static function follow(): array
    {
        $body = self::guard();
        $target = (int) ($body['user_id'] ?? 0);
        if ($target <= 0 || $target === Auth::id()) {
            return ['ok' => false, 'error' => 'invalid_user'];
        }
        if (DB::one('core', 'SELECT id FROM users WHERE id = ?', [$target]) === null) {
            return ['ok' => false, 'error' => 'user_not_found'];
        }
        $existing = DB::val('social', 'SELECT id FROM follows WHERE follower_id = ? AND followee_id = ?', [Auth::id(), $target], 0);
        if ($existing > 0) {
            DB::run('social', 'DELETE FROM follows WHERE id = ?', [$existing]);
            return ['ok' => true, 'following' => false];
        }
        DB::run('social', 'INSERT INTO follows (follower_id,followee_id,created_at) VALUES (?,?,NOW())', [Auth::id(), $target]);
        Auth::notify($target, 'follow', '有新成员关注了你');
        return ['ok' => true, 'following' => true];
    }

    private static function friend(): array
    {
        $body = self::guard();
        $target = (int) ($body['user_id'] ?? 0);
        if ($target <= 0 || $target === Auth::id()) {
            return ['ok' => false, 'error' => 'invalid_user'];
        }
        if (DB::one('core', 'SELECT id FROM users WHERE id = ?', [$target]) === null) {
            return ['ok' => false, 'error' => 'user_not_found'];
        }
        DB::run('social', 'INSERT IGNORE INTO friendships (user_id,friend_id,status,created_at) VALUES (?,?,"accepted",NOW())', [Auth::id(), $target]);
        DB::run('social', 'INSERT IGNORE INTO friendships (user_id,friend_id,status,created_at) VALUES (?,?,"accepted",NOW())', [$target, Auth::id()]);
        Auth::addPoints(Auth::id(), 2, 'friend_count');
        return ['ok' => true];
    }

    private static function message(): array
    {
        $body = self::guard();
        $target = (int) ($body['to_id'] ?? 0);
        $content = self::text($body, 'content', 1000);
        if ($target <= 0 || $content === '') {
            return ['ok' => false, 'error' => 'empty_fields'];
        }
        if (DB::one('core', 'SELECT id FROM users WHERE id = ?', [$target]) === null) {
            return ['ok' => false, 'error' => 'user_not_found'];
        }
        DB::run('social', 'INSERT INTO messages (from_id,to_id,content,is_read,created_at) VALUES (?,?,?,0,NOW())', [Auth::id(), $target, $content]);
        Auth::notify($target, 'message', '你收到了一条新私信');
        return ['ok' => true];
    }

    private static function doc(): array
    {
        $body = self::guard();
        $categoryId = (int) ($body['category_id'] ?? 0);
        $title = self::text($body, 'title', (int) Config::get('security.max_title', 120));
        $summary = self::text($body, 'summary', 500);
        $content = self::text($body, 'content');
        if ($title === '' || $content === '') {
            return ['ok' => false, 'error' => 'empty_fields'];
        }
        if (DB::one('docs', 'SELECT id FROM categories WHERE id = ?', [$categoryId]) === null) {
            return ['ok' => false, 'error' => 'category_not_found'];
        }
        DB::run('docs', 'INSERT INTO documents (category_id,user_id,title,summary,content,created_at) VALUES (?,?,?,?,?,NOW())', [$categoryId, Auth::id(), $title, $summary, $content]);
        $id = DB::id('docs');
        Auth::addPoints(Auth::id(), 10, 'doc_count');
        DB::run('home', 'INSERT INTO feeds (user_id,type,content,created_at) VALUES (?,"doc",?,NOW())', [Auth::id(), $title]);
        return ['ok' => true, 'id' => $id, 'url' => '/docs/' . $id];
    }

    private static function chatSend(): array
    {
        $body = self::guard();
        $roomId = (int) ($body['room_id'] ?? 0);
        $content = self::text($body, 'content', 1000);
        if ($content === '') {
            return ['ok' => false, 'error' => 'empty_fields'];
        }
        if (DB::one('chat', 'SELECT id FROM rooms WHERE id = ?', [$roomId]) === null) {
            return ['ok' => false, 'error' => 'room_not_found'];
        }
        DB::run('chat', 'INSERT INTO messages (room_id,user_id,content,created_at) VALUES (?,?,?,NOW())', [$roomId, Auth::id(), $content]);
        DB::run(
            'chat',
            'INSERT INTO online (user_id,room_id,last_seen) VALUES (?,?,NOW()) ON DUPLICATE KEY UPDATE last_seen = NOW()',
            [Auth::id(), $roomId]
        );
        return ['ok' => true, 'id' => DB::id('chat')];
    }

    /** 游客也可读取，只读接口无需 CSRF。 */
    private static function chatPoll(): array
    {
        $roomId = (int) Req::get('room', 0);
        $after = (int) Req::get('after', 0);
        if ($roomId <= 0) {
            return ['ok' => false, 'error' => 'room_required'];
        }
        $messages = DB::all(
            'chat',
            'SELECT id,room_id,user_id,content,created_at FROM messages WHERE room_id = ? AND id > ? ORDER BY id ASC LIMIT 50',
            [$roomId, $after]
        );
        $names = \user_names(array_column($messages, 'user_id'));
        foreach ($messages as &$message) {
            $uid = (int) $message['user_id'];
            $message['author'] = $uid === 0 ? t('site_name') : ($names[$uid]['nickname'] ?? ('#' . $uid));
            $message['mine'] = $uid === Auth::id() && $uid > 0;
        }
        unset($message);
        return [
            'ok'        => true,
            'messages'  => $messages,
            'lastId'    => $messages === [] ? $after : (int) $messages[array_key_last($messages)]['id'],
            'online'    => (int) DB::val('chat', 'SELECT COUNT(*) FROM online WHERE room_id = ? AND last_seen > DATE_SUB(NOW(), INTERVAL 5 MINUTE)', [$roomId], 0),
        ];
    }
}
