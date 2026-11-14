<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15
// PHP 内置开发服务器路由：静态资源交给服务器，其余请求交给单入口。

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (str_contains($uri, '..')) {
    http_response_code(403);
    return true;
}
$file = __DIR__ . $uri;
if ($uri !== '/' && is_file($file) && !str_ends_with($file, '.php')) {
    return false;
}
require __DIR__ . '/index.php';
