<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

namespace Suixin\V4;

use PDO;
use RuntimeException;
use Throwable;

final class Config
{
    private static array $data = [];

    public static function load(string $path): void
    {
        $base = require $path;
        $local = dirname($path) . '/config.local.php';
        if (is_file($local)) {
            $override = require $local;
            if (is_array($override)) {
                $base = array_replace_recursive($base, $override);
            }
        }
        self::$data = $base;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        $value = self::$data;
        foreach (explode('.', $key) as $part) {
            if (!is_array($value) || !array_key_exists($part, $value)) {
                return $default;
            }
            $value = $value[$part];
        }
        return $value;
    }
}

/** 分库连接管理：每个业务模块一个独立 PDO 实例 / 独立数据库文件。 */
final class DB
{
    private static array $connections = [];

    public static function get(string $shard): PDO
    {
        if (isset(self::$connections[$shard])) {
            return self::$connections[$shard];
        }
        $map = Config::get('db.shards', []);
        if (!isset($map[$shard])) {
            throw new RuntimeException('Unknown database shard: ' . $shard);
        }
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            Config::get('db.host', '127.0.0.1'),
            (int) Config::get('db.port', 3306),
            $map[$shard],
            Config::get('db.charset', 'utf8mb4')
        );
        $pdo = new PDO($dsn, Config::get('db.user'), Config::get('db.password'), [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        self::$connections[$shard] = $pdo;
        return $pdo;
    }

    public static function run(string $shard, string $sql, array $params = []): \PDOStatement
    {
        $statement = self::get($shard)->prepare($sql);
        $statement->execute($params);
        return $statement;
    }

    public static function all(string $shard, string $sql, array $params = []): array
    {
        return self::run($shard, $sql, $params)->fetchAll();
    }

    public static function one(string $shard, string $sql, array $params = []): ?array
    {
        $row = self::run($shard, $sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    public static function val(string $shard, string $sql, array $params = [], mixed $default = null): mixed
    {
        $value = self::run($shard, $sql, $params)->fetchColumn();
        return $value === false ? $default : $value;
    }

    public static function id(string $shard): int
    {
        return (int) self::get($shard)->lastInsertId();
    }

    /** 跨分片派生表：用于"数据库分文件"自检。 */
    public static function shardNames(): array
    {
        return Config::get('db.shards', []);
    }
}

final class Auth
{
    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        session_name(Config::get('security.session_name', 'SUIXIN_V4'));
        session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'path' => '/']);
        session_start();
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
        if (empty($_SESSION['locale'])) {
            $_SESSION['locale'] = Config::get('i18n.default', 'zh-CN');
        }
    }

    public static function id(): int
    {
        return (int) ($_SESSION['uid'] ?? 0);
    }

    public static function user(): ?array
    {
        $uid = self::id();
        if ($uid <= 0) {
            return null;
        }
        return DB::one(
            'core',
            'SELECT id, username, nickname, email, avatar, role, points, lang, bio, signature, created_at
             FROM users WHERE id = ?',
            [$uid]
        );
    }

    public static function isAdmin(): bool
    {
        $user = self::user();
        return $user !== null && $user['role'] === 'admin';
    }

    public static function check(string $account, string $password): bool
    {
        $user = DB::one('core', 'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1', [$account, $account]);
        if ($user === null || !password_verify($password, $user['password_hash'])) {
            return false;
        }
        if ((int) $user['status'] !== 1) {
            return false;
        }
        session_regenerate_id(true);
        $_SESSION['uid'] = (int) $user['id'];
        $_SESSION['locale'] = $user['lang'] ?: Config::get('i18n.default', 'zh-CN');
        I18n::reload();
        return true;
    }

    /** @return array{ok:bool,error:string,uid:int} */
    public static function register(string $username, string $email, string $password, string $nickname): array
    {
        $maxUser = (int) Config::get('security.max_username', 24);
        $minPass = (int) Config::get('security.min_password', 6);
        $username = trim($username);
        $email = trim($email);
        $nickname = trim($nickname) ?: $username;

        if (!preg_match('/^[A-Za-z0-9_\x{4e00}-\x{9fa5}]{2,' . $maxUser . '}$/u', $username)) {
            return ['ok' => false, 'error' => 'username_invalid', 'uid' => 0];
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return ['ok' => false, 'error' => 'email_invalid', 'uid' => 0];
        }
        if (mb_strlen($password) < $minPass) {
            return ['ok' => false, 'error' => 'password_short', 'uid' => 0];
        }
        if (mb_strlen($nickname) > 32) {
            return ['ok' => false, 'error' => 'nickname_long', 'uid' => 0];
        }
        if (DB::val('core', 'SELECT COUNT(*) FROM users WHERE username = ? OR email = ?', [$username, $email], 0) > 0) {
            return ['ok' => false, 'error' => 'account_exists', 'uid' => 0];
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $locale = I18n::locale();
        DB::run(
            'core',
            'INSERT INTO users (username, email, password_hash, nickname, role, points, lang, status, created_at)
             VALUES (?, ?, ?, ?, "member", 10, ?, 1, NOW())',
            [$username, $email, $hash, $nickname, $locale]
        );
        $uid = DB::id('core');
        DB::run('home', 'INSERT INTO profiles (user_id, mood, visitor_count) VALUES (?, "", 0)', [$uid]);
        DB::run('rank', 'INSERT INTO scores (user_id, points, thread_count, post_count, doc_count, friend_count, updated_at)
                 VALUES (?, 10, 0, 0, 0, 0, NOW())', [$uid]);
        return ['ok' => true, 'error' => '', 'uid' => $uid];
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], '', false, true);
        }
        session_destroy();
    }

    /** 积分变动：总账在 core，榜单快照在 rank，保持两个分片一致。 */
    public static function addPoints(int $uid, int $delta, string $field = ''): void
    {
        if ($uid <= 0 || $delta === 0) {
            return;
        }
        DB::run('core', 'UPDATE users SET points = GREATEST(0, points + ?) WHERE id = ?', [$delta, $uid]);
        $allowed = ['thread_count', 'post_count', 'doc_count', 'friend_count'];
        if (in_array($field, $allowed, true)) {
            DB::run(
                'rank',
                'INSERT INTO scores (user_id, points, ' . $field . ', updated_at) VALUES (?, GREATEST(0, ?), 1, NOW())
                 ON DUPLICATE KEY UPDATE points = GREATEST(0, points + ?), '
                    . $field . ' = ' . $field . ' + 1, updated_at = NOW()',
                [$uid, $delta, $delta]
            );
        } else {
            DB::run(
                'rank',
                'INSERT INTO scores (user_id, points, updated_at) VALUES (?, GREATEST(0, ?), NOW())
                 ON DUPLICATE KEY UPDATE points = GREATEST(0, points + ?), updated_at = NOW()',
                [$uid, $delta, $delta]
            );
        }
    }

    public static function notify(int $uid, string $type, string $content): void
    {
        DB::run('core', 'INSERT INTO notifications (user_id, type, content, created_at) VALUES (?, ?, ?, NOW())', [$uid, $type, $content]);
    }
}

final class Req
{
    public static function path(): string
    {
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $path = rtrim($path, '/');
        return $path === '' ? '/' : $path;
    }

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return isset($_GET[$key]) ? trim((string) $_GET[$key]) : $default;
    }

    public static function input(string $key, mixed $default = null, array $body = []): mixed
    {
        $value = $body[$key] ?? $_POST[$key] ?? $default;
        return is_string($value) ? trim($value) : $value;
    }

    public static function body(): array
    {
        $raw = file_get_contents('php://input');
        $decoded = json_decode(is_string($raw) ? $raw : '', true);
        return is_array($decoded) ? $decoded : $_POST;
    }

    public static function csrfValid(array $body = []): bool
    {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($body['_token'] ?? ($_POST['_token'] ?? ''));
        $expected = $_SESSION['csrf'] ?? '';
        return is_string($token) && $expected !== '' && hash_equals($expected, $token);
    }

    public static function csrfToken(): string
    {
        return (string) ($_SESSION['csrf'] ?? '');
    }

    public static function limit(string $text, int $max): string
    {
        $text = trim($text);
        return mb_strlen($text) > $max ? mb_substr($text, 0, $max) : $text;
    }
}

final class View
{
    public static function e(mixed $value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    public static function render(string $template, array $data = []): void
    {
        $file = dirname(__DIR__) . '/views/' . $template . '.php';
        if (!is_file($file)) {
            throw new RuntimeException('View not found: ' . $template);
        }
        $data['csrf'] = Req::csrfToken();
        extract($data, EXTR_SKIP);
        ob_start();
        require $file;
        $content = ob_get_clean();
        require dirname(__DIR__) . '/views/layout.php';
    }

    public static function json(mixed $data, int $code = 200): void
    {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function redirect(string $url): void
    {
        header('Location: ' . $url);
        exit;
    }
}

final class I18n
{
    private static array $dictionary = [];
    private static bool $loaded = false;

    public static function locale(): string
    {
        return (string) ($_SESSION['locale'] ?? Config::get('i18n.default', 'zh-CN'));
    }

    public static function set(string $code): bool
    {
        $available = Config::get('i18n.available', ['zh-CN']);
        if (!in_array($code, $available, true)) {
            return false;
        }
        $_SESSION['locale'] = $code;
        if (Auth::id() > 0) {
            DB::run('core', 'UPDATE users SET lang = ? WHERE id = ?', [$code, Auth::id()]);
        }
        self::reload();
        return true;
    }

    public static function reload(): void
    {
        self::$loaded = false;
        self::$dictionary = [];
    }

    private static function load(): void
    {
        if (self::$loaded) {
            return;
        }
        self::$loaded = true;
        try {
            foreach (DB::all('i18n', 'SELECT k, v FROM translations WHERE locale = ?', [self::locale()]) as $row) {
                self::$dictionary[$row['k']] = $row['v'];
            }
        } catch (Throwable $ignored) {
            // 安装前允许回退到键名，避免安装流程被阻断
        }
    }

    public static function t(string $key, array $vars = []): string
    {
        self::load();
        $text = self::$dictionary[$key] ?? $key;
        foreach ($vars as $name => $value) {
            $text = str_replace('{' . $name . '}', (string) $value, $text);
        }
        return $text;
    }

    public static function all(): array
    {
        self::load();
        return self::$dictionary;
    }
}
