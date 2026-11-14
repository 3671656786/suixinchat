<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15
/** @var string $mode @var string $error */
$isLogin = $mode === 'login';
?>
<div class="auth-wrap">
  <div class="auth-card">
    <div class="auth-brand"><span class="brand-mark">随</span><strong><?= e(t('site_name')) ?></strong></div>
    <h1><?= e($isLogin ? t('login_title') : t('register_title')) ?></h1>
    <p class="muted"><?= e(t('slogan')) ?></p>

    <?php if ($error !== ''): ?><div class="alert alert-error"><?= e(t($error)) ?></div><?php endif; ?>

    <form method="post" action="<?= $isLogin ? '/login' : '/register' ?>">
      <?= csrf_field() ?>
      <?php if ($isLogin): ?>
        <label class="field"><span><?= e(t('username')) ?></span><input name="account" autocomplete="username" required></label>
        <label class="field"><span><?= e(t('password')) ?></span><input name="password" type="password" autocomplete="current-password" required></label>
      <?php else: ?>
        <label class="field"><span><?= e(t('username')) ?></span><input name="username" maxlength="24" required></label>
        <label class="field"><span><?= e(t('nickname')) ?></span><input name="nickname" maxlength="32"></label>
        <label class="field"><span><?= e(t('email')) ?></span><input name="email" type="email" required></label>
        <label class="field"><span><?= e(t('password')) ?></span><input name="password" type="password" minlength="6" autocomplete="new-password" required></label>
      <?php endif; ?>
      <button class="btn btn-primary btn-block" type="submit"><?= e($isLogin ? t('login') : t('register')) ?></button>
    </form>

    <div class="auth-switch">
      <?php if ($isLogin): ?>
        <?= e(t('no_account')) ?> <a href="/register"><?= e(t('register')) ?></a>
      <?php else: ?>
        <?= e(t('has_account')) ?> <a href="/login"><?= e(t('login')) ?></a>
      <?php endif; ?>
    </div>
    <div class="auth-demo">
      <small class="muted">演示账号：admin / admin123 · luna / demo123</small>
    </div>
  </div>
</div>
