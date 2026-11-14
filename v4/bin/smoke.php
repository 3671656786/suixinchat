<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

require __DIR__ . '/../src/bootstrap.php';

use Suixin\V4\DB;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Smoke test is CLI only.');
}

$base = rtrim($argv[1] ?? 'http://127.0.0.1:8081', '/');
$cookie = tempnam(sys_get_temp_dir(), 'suixin_smoke_');
$csrf = '';
$pass = 0;
$fail = 0;
$created = ['threads' => [], 'posts' => [], 'docs' => [], 'messages' => [], 'chat' => [], 'topics' => []];

function http(string $method, string $path, mixed $data = null, bool $json = false): array
{
    global $base, $cookie, $csrf;
    $ch = curl_init($base . $path);
    $headers = ['Accept: text/html,application/json'];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => false,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_COOKIEFILE     => $cookie,
        CURLOPT_COOKIEJAR      => $cookie,
        CURLOPT_TIMEOUT        => 12,
        CURLOPT_PROXY          => '',
    ]);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($json) {
            $headers[] = 'Content-Type: application/json';
            $headers[] = 'X-CSRF-Token: ' . $csrf;
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data ?? [], JSON_UNESCAPED_UNICODE));
        } else {
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($data ?? []));
        }
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $location = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    $error = curl_error($ch);
    curl_close($ch);
    return ['status' => $status, 'body' => is_string($body) ? $body : '', 'location' => $location, 'error' => $error];
}

function check(string $name, bool $condition, string $detail = ''): void
{
    global $pass, $fail;
    if ($condition) {
        $pass++;
        echo "  PASS  {$name}" . ($detail !== '' ? " ({$detail})" : '') . PHP_EOL;
    } else {
        $fail++;
        echo "  FAIL  {$name}" . ($detail !== '' ? " ({$detail})" : '') . PHP_EOL;
    }
}

function looksBroken(string $body): bool
{
    foreach (['Fatal error', 'Parse error', 'Uncaught', 'Warning:', 'Notice:', '服务暂不可用', 'SQLSTATE'] as $needle) {
        if (str_contains($body, $needle)) {
            return true;
        }
    }
    return false;
}

function cleanup(array $created, string $marker): void
{
    try {
        $like = '%' . $marker . '%';
        foreach (DB::all('forum', 'SELECT id FROM threads WHERE title LIKE ?', [$like]) as $row) {
            DB::run('forum', 'DELETE FROM posts WHERE thread_id = ?', [$row['id']]);
            DB::run('forum', 'DELETE FROM threads WHERE id = ?', [$row['id']]);
        }
        foreach (DB::all('groups', 'SELECT id FROM circle_topics WHERE title LIKE ?', [$like]) as $row) {
            DB::run('groups', 'DELETE FROM circle_replies WHERE topic_id = ?', [$row['id']]);
            DB::run('groups', 'DELETE FROM circle_topics WHERE id = ?', [$row['id']]);
        }
        DB::run('docs', 'DELETE FROM documents WHERE title LIKE ?', [$like]);
        DB::run('social', 'DELETE FROM messages WHERE content LIKE ?', [$like]);
        DB::run('chat', 'DELETE FROM messages WHERE content LIKE ?', [$like]);
        DB::run('home', 'DELETE FROM feeds WHERE content LIKE ?', [$like]);
        DB::run('core', 'UPDATE users SET lang = "zh-CN" WHERE username = "admin"');
        DB::run('forum', 'UPDATE forums f SET thread_count = (SELECT COUNT(*) FROM threads t WHERE t.forum_id = f.id), post_count = (SELECT COUNT(*) FROM posts p JOIN threads t2 ON t2.id = p.thread_id WHERE t2.forum_id = f.id)');
    } catch (Throwable $ignored) {
        // 清理失败不影响测试结论
    }
}

echo "Suixin Community v4 smoke test -> {$base}" . PHP_EOL;
echo str_repeat('-', 60) . PHP_EOL;

/* 1. 分库自检 */
$healthRes = http('GET', '/api/health');
$health = json_decode($healthRes['body'], true);
check('api/health 200', $healthRes['status'] === 200);
check('version 4.0.0', ($health['version'] ?? '') === '4.0.0');
check('9 independent database shards', is_array($health['shards'] ?? null) && count($health['shards']) === 9, 'found ' . count($health['shards'] ?? []));
$allShardsHaveTables = true;
foreach ($health['shards'] ?? [] as $alias => $info) {
    if (($info['tables'] ?? 0) < 1) { $allShardsHaveTables = false; }
}
check('every shard has tables', $allShardsHaveTables);
check('4 locales loaded', (int) ($health['locales'] ?? 0) === 4);

/* 2. 全站页面 */
$pages = [
    '/'              => '首页',
    '/forum'         => '论坛',
    '/forum/f/1'     => '版块',
    '/forum/t/1'     => '主题详情',
    '/groups'        => '圈子列表',
    '/groups/1'      => '圈子详情',
    '/rank'          => '排行榜',
    '/rank?sort=doc_count' => '排行榜排序',
    '/docs'          => '文库列表',
    '/docs/1'        => '文档详情',
    '/social'        => '交友',
    '/chat'          => '聊天室',
    '/login'         => '登录',
    '/register'      => '注册',
    '/space/1'       => '家园',
];
foreach ($pages as $path => $label) {
    $res = http('GET', $path);
    check("GET {$path} {$label}", $res['status'] === 200 && !looksBroken($res['body']) && str_contains($res['body'], '<!doctype html>'), 'HTTP ' . $res['status']);
}
$notFound = http('GET', '/definitely-not-a-page');
check('404 handling', $notFound['status'] === 404);

/* 3. 提取 CSRF 并登录 */
$loginPage = http('GET', '/login');
if (preg_match('/name="csrf-token" content="([^"]+)"/', $loginPage['body'], $match)) {
    $csrf = $match[1];
}
check('CSRF token exposed', $csrf !== '');
$login = http('POST', '/login', ['account' => 'admin', 'password' => 'admin123', '_token' => $csrf]);
check('login as admin', $login['status'] === 302 && str_contains($login['location'], '/'), 'HTTP ' . $login['status']);
$afterLogin = http('GET', '/');
check('session persists after login', str_contains($afterLogin['body'], 'href="/logout"'));

/* 4. 写操作 API */
$marker = '[SMOKE-' . date('His') . ']';
$thread = http('POST', '/api/thread', ['forum_id' => 1, 'title' => $marker . ' 主题', 'content' => '冒烟测试内容'], true);
$threadJson = json_decode($thread['body'], true);
check('api/thread create', ($threadJson['ok'] ?? false) === true);
$threadId = (int) ($threadJson['id'] ?? 0);
if ($threadId > 0) { $created['threads'][] = $threadId; }

$reply = http('POST', '/api/reply', ['thread_id' => $threadId, 'content' => $marker . ' 回复'], true);
check('api/reply create', (json_decode($reply['body'], true)['ok'] ?? false) === true);

$join = http('POST', '/api/circle/join', ['circle_id' => 1], true);
check('api/circle/join', (json_decode($join['body'], true)['ok'] ?? false) === true);

$topic = http('POST', '/api/circle/topic', ['circle_id' => 1, 'title' => $marker . ' 话题', 'content' => '内容'], true);
check('api/circle/topic', (json_decode($topic['body'], true)['ok'] ?? false) === true);

$follow = http('POST', '/api/follow', ['user_id' => 2], true);
check('api/follow', (json_decode($follow['body'], true)['ok'] ?? false) === true);

$friend = http('POST', '/api/friend', ['user_id' => 3], true);
check('api/friend', (json_decode($friend['body'], true)['ok'] ?? false) === true);

$message = http('POST', '/api/message', ['to_id' => 2, 'content' => $marker . ' 私信'], true);
check('api/message', (json_decode($message['body'], true)['ok'] ?? false) === true);

$doc = http('POST', '/api/doc', ['category_id' => 1, 'title' => $marker . ' 文档', 'summary' => '摘要', 'content' => '正文'], true);
$docJson = json_decode($doc['body'], true);
check('api/doc create', ($docJson['ok'] ?? false) === true);
if (($docJson['id'] ?? 0) > 0) { $created['docs'][] = (int) $docJson['id']; }

$chatSend = http('POST', '/api/chat/send', ['room_id' => 1, 'content' => $marker . ' 消息'], true);
check('api/chat/send', (json_decode($chatSend['body'], true)['ok'] ?? false) === true);
$poll = http('GET', '/api/chat/poll?room=1&after=0');
$pollJson = json_decode($poll['body'], true);
check('api/chat/poll', ($pollJson['ok'] ?? false) === true && is_array($pollJson['messages'] ?? null));

/* 5. 多语言 */
$lang = http('POST', '/api/lang', ['code' => 'en'], true);
check('api/lang switch to en', (json_decode($lang['body'], true)['ok'] ?? false) === true);
$english = http('GET', '/');
check('UI translated to English', str_contains($english['body'], 'Latest discussions') || str_contains($english['body'], 'Explore the forum'));
http('POST', '/api/lang', ['code' => 'zh-CN'], true);

/* 6. CSRF 防护 */
$noCsrf = curl_init($base . '/api/thread');
curl_setopt_array($noCsrf, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['forum_id' => 1, 'title' => 'x', 'content' => 'x']),
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_PROXY => '',
    CURLOPT_TIMEOUT => 10,
]);
$noCsrfBody = curl_exec($noCsrf);
$noCsrfStatus = (int) curl_getinfo($noCsrf, CURLINFO_HTTP_CODE);
curl_close($noCsrf);
check('CSRF rejection', $noCsrfStatus === 403);

cleanup($created, '[SMOKE-');
@unlink($cookie);

echo str_repeat('-', 60) . PHP_EOL;
echo "RESULT: {$pass} passed, {$fail} failed" . PHP_EOL;
exit($fail === 0 ? 0 : 1);
