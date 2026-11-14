<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

require_once __DIR__ . '/Core.php';
require_once __DIR__ . '/Schema.php';

use Suixin\V4\Auth;
use Suixin\V4\Config;
use Suixin\V4\I18n;
use Suixin\V4\Req;
use Suixin\V4\View;

Config::load(dirname(__DIR__) . '/config.php');
date_default_timezone_set('Asia/Shanghai');
Auth::start();

/** 模板与控制器使用的全局短函数 */
function t(string $key, array $vars = []): string
{
    return I18n::t($key, $vars);
}

function e(mixed $value): string
{
    return View::e($value);
}

function csrf_field(): string
{
    return '<input type="hidden" name="_token" value="' . e(Req::csrfToken()) . '">';
}

function csrf_meta(): string
{
    return '<meta name="csrf-token" content="' . e(Req::csrfToken()) . '">';
}

function site_version(): string
{
    return (string) Config::get('version', '4.0.0');
}

/** 用户昵称跨分片查表：core 保存主档，其他分片只存 user_id。 */
function user_names(array $ids): array
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
    if ($ids === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $rows = \Suixin\V4\DB::all('core', "SELECT id, username, nickname, avatar, role FROM users WHERE id IN ({$placeholders})", $ids);
    $map = [];
    foreach ($rows as $row) {
        $map[(int) $row['id']] = $row;
    }
    return $map;
}

function user_label(array $map, int $uid): string
{
    if ($uid === 0) {
        return t('site_name');
    }
    return $map[$uid]['nickname'] ?? ('#' . $uid);
}

function time_ago(?string $datetime): string
{
    if (!$datetime) {
        return '';
    }
    $diff = time() - (int) strtotime($datetime);
    if ($diff < 60) {
        return $diff . 's';
    }
    if ($diff < 3600) {
        return floor($diff / 60) . 'm';
    }
    if ($diff < 86400) {
        return floor($diff / 3600) . 'h';
    }
    return date('m-d', (int) strtotime($datetime));
}

function abort_page(int $code, string $message = ''): void
{
    \Suixin\V4\View::render('error', ['code' => $code, 'message' => $message]);
    exit;
}
