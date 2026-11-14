<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

use Suixin\V4\Auth;
use Suixin\V4\Config;
use Suixin\V4\I18n;
use Suixin\V4\Req;

$user = Auth::user();
$currentPath = Req::path();
$nav = [
    '/'        => t('nav_home'),
    '/forum'   => t('nav_forum'),
    '/groups'  => t('nav_groups'),
    '/space'   => t('nav_space'),
    '/rank'    => t('nav_rank'),
    '/docs'    => t('nav_docs'),
    '/social'  => t('nav_social'),
    '/chat'    => t('nav_chat'),
];
$locales = Config::get('i18n.available', ['zh-CN']);
$localeNames = Config::get('i18n.names', []);
?>
<!doctype html>
<html lang="<?= e(I18n::locale()) ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#4f46e5">
<title><?= e($title ?? t('site_name')) ?> · <?= e(t('site_name')) ?> v<?= e(site_version()) ?></title>
<?= csrf_meta() ?>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<header class="topbar">
  <div class="wrap topbar-inner">
    <a class="brand" href="/" aria-label="<?= e(t('site_name')) ?>">
      <span class="brand-mark">随</span>
      <span class="brand-copy"><strong><?= e(t('site_name')) ?></strong><small><?= e(t('slogan')) ?></small></span>
    </a>
    <nav class="nav" aria-label="main">
      <?php foreach ($nav as $href => $label): ?>
        <?php $active = $href === '/' ? $currentPath === '/' : str_starts_with($currentPath, $href); ?>
        <a class="nav-link<?= $active ? ' is-active' : '' ?>" href="<?= e($href) ?>"><?= e($label) ?></a>
      <?php endforeach; ?>
    </nav>
    <form class="search" action="/forum" method="get" role="search">
      <span aria-hidden="true">⌕</span>
      <input type="search" name="q" value="<?= e(Req::get('q', '')) ?>" placeholder="<?= e(t('search_hint')) ?>" aria-label="<?= e(t('search')) ?>">
    </form>
    <div class="actions">
      <label class="lang-wrap">
        <span class="sr-only"><?= e(t('language')) ?></span>
        <select id="lang-select" class="lang-select" aria-label="<?= e(t('language')) ?>">
          <?php foreach ($locales as $code): ?>
            <option value="<?= e($code) ?>"<?= $code === I18n::locale() ? ' selected' : '' ?>><?= e($localeNames[$code] ?? $code) ?></option>
          <?php endforeach; ?>
        </select>
      </label>
      <?php if ($user): ?>
        <a class="user-chip" href="/space">
          <span class="avatar avatar-sm"><?= e(mb_substr($user['nickname'] ?: $user['username'], 0, 1)) ?></span>
          <span class="user-name"><?= e($user['nickname'] ?: $user['username']) ?></span>
        </a>
        <a class="btn btn-ghost btn-sm" href="/logout"><?= e(t('logout')) ?></a>
      <?php else: ?>
        <a class="btn btn-ghost btn-sm" href="/login"><?= e(t('login')) ?></a>
        <a class="btn btn-primary btn-sm" href="/register"><?= e(t('register')) ?></a>
      <?php endif; ?>
    </div>
  </div>
</header>

<main class="wrap main" id="main">
  <?= $content ?>
</main>

<footer class="footer">
  <div class="wrap footer-inner">
    <div>
      <strong><?= e(t('site_name')) ?></strong> <span class="muted">v<?= e(site_version()) ?></span>
      <p class="muted"><?= e(t('footer_note')) ?></p>
    </div>
    <div class="footer-links">
      <a href="/forum"><?= e(t('nav_forum')) ?></a>
      <a href="/docs"><?= e(t('nav_docs')) ?></a>
      <a href="/rank"><?= e(t('nav_rank')) ?></a>
    </div>
  </div>
</footer>

<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>
window.APP = {
  csrf: "<?= e(Req::csrfToken()) ?>",
  locale: "<?= e(I18n::locale()) ?>",
  logged: <?= $user ? 'true' : 'false' ?>,
  uid: <?= (int) ($user['id'] ?? 0) ?>,
  t: <?= json_encode(I18n::all(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>
};
</script>
<script src="/assets/app.js"></script>
</body>
</html>
