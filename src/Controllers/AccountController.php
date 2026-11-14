<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

namespace Suixin\V4\Controllers;

use Suixin\V4\Auth;
use Suixin\V4\DB;
use Suixin\V4\I18n;
use Suixin\V4\Req;
use Suixin\V4\View;

final class AccountController
{
    public static function dispatch(array $seg, string $method): void
    {
        $action = $seg[1] ?? 'login';
        switch ($action) {
            case 'login':
                self::login($method);
                break;
            case 'register':
                self::register($method);
                break;
            case 'logout':
                Auth::logout();
                View::redirect('/');
                break;
            default:
                \abort_page(404);
        }
    }

    private static function login(string $method): void
    {
        $error = '';
        if ($method === 'POST') {
            if (!Req::csrfValid()) {
                $error = 'csrf_invalid';
            } else {
                $account = (string) Req::input('account', '');
                $password = (string) Req::input('password', '');
                if ($account !== '' && $password !== '' && Auth::check($account, $password)) {
                    View::redirect('/');
                }
                $error = 'login_failed';
            }
        }
        View::render('auth', ['mode' => 'login', 'error' => $error]);
    }

    private static function register(string $method): void
    {
        $error = '';
        if ($method === 'POST') {
            if (!Req::csrfValid()) {
                $error = 'csrf_invalid';
            } else {
                $result = Auth::register(
                    (string) Req::input('username', ''),
                    (string) Req::input('email', ''),
                    (string) Req::input('password', ''),
                    (string) Req::input('nickname', '')
                );
                if ($result['ok']) {
                    Auth::check((string) Req::input('username', ''), (string) Req::input('password', ''));
                    DB::run('home', 'INSERT INTO feeds (user_id,type,content,created_at) VALUES (?,"join","加入了社区",NOW())', [$result['uid']]);
                    View::redirect('/');
                }
                $error = $result['error'];
            }
        }
        View::render('auth', ['mode' => 'register', 'error' => $error]);
    }

    public static function setLanguage(string $code): bool
    {
        return I18n::set($code);
    }
}
