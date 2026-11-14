<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

require dirname(__DIR__) . '/src/bootstrap.php';

$controllerDir = dirname(__DIR__) . '/src/Controllers/';
foreach ([
    'HomeController', 'AccountController', 'ForumController', 'GroupController',
    'SpaceController', 'RankController', 'DocsController', 'SocialController',
    'ChatController', 'ApiController',
] as $controller) {
    require_once $controllerDir . $controller . '.php';
}

use Suixin\V4\Controllers\AccountController;
use Suixin\V4\Controllers\ApiController;
use Suixin\V4\Controllers\ChatController;
use Suixin\V4\Controllers\DocsController;
use Suixin\V4\Controllers\ForumController;
use Suixin\V4\Controllers\GroupController;
use Suixin\V4\Controllers\HomeController;
use Suixin\V4\Controllers\RankController;
use Suixin\V4\Controllers\SocialController;
use Suixin\V4\Controllers\SpaceController;
use Suixin\V4\Req;

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');

try {
    $path = Req::path();
    $method = Req::method();
    $segments = array_values(array_filter(explode('/', trim($path, '/')), static fn($s) => $s !== ''));
    $root = $segments[0] ?? '';

    switch ($root) {
        case '':
            HomeController::index();
            break;
        case 'forum':
            ForumController::dispatch($segments);
            break;
        case 'groups':
            GroupController::dispatch($segments);
            break;
        case 'space':
            SpaceController::dispatch($segments);
            break;
        case 'rank':
            RankController::index();
            break;
        case 'docs':
            DocsController::dispatch($segments);
            break;
        case 'social':
            SocialController::index();
            break;
        case 'chat':
            ChatController::index();
            break;
        case 'login':
            AccountController::dispatch(['account', 'login'], $method);
            break;
        case 'register':
            AccountController::dispatch(['account', 'register'], $method);
            break;
        case 'logout':
            AccountController::dispatch(['account', 'logout'], $method);
            break;
        case 'api':
            ApiController::dispatch($segments, $method);
            break;
        default:
            abort_page(404);
    }
} catch (Throwable $e) {
    error_log('[suixin-v4] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>服务暂不可用</title>';
    echo '<h1>服务暂不可用</h1><p>' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</p>';
}
