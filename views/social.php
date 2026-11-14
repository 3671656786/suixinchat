<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15
/** @var array $suggested @var array $following @var array $followers @var array $friends @var array $inbox */
$logged = \Suixin\V4\Auth::id() > 0;
?>
<div class="page-head">
  <div><div class="crumbs"><a href="/"><?= e(t('nav_home')) ?></a> / <?= e(t('nav_social')) ?></div>
    <h1><?= e(t('social_title')) ?></h1><p class="muted"><?= e(t('social_desc')) ?></p></div>
</div>

<div class="grid-main">
  <div class="col-main">
    <section class="panel">
      <div class="panel-head"><h2><?= e(t('recommend')) ?></h2></div>
      <div class="people-grid">
        <?php foreach ($suggested as $person): ?>
          <?php if (!$logged || (int) $person['id'] !== \Suixin\V4\Auth::id()): ?>
          <div class="person-card">
            <a class="person-top" href="/space/<?= (int) $person['id'] ?>">
              <span class="avatar"><?= e(mb_substr($person['nickname'] ?: $person['username'], 0, 1)) ?></span>
              <div><b><?= e($person['nickname'] ?: $person['username']) ?></b><small class="muted"><?= (int) $person['points'] ?> <?= e(t('points')) ?></small></div>
            </a>
            <p class="muted"><?= e($person['bio']) ?></p>
            <?php if ($logged): ?>
              <div class="person-actions">
                <button class="btn btn-sm <?= in_array((int) $person['id'], $followedIds, true) ? 'btn-ghost' : 'btn-primary' ?>" data-follow="<?= (int) $person['id'] ?>"><?= e(in_array((int) $person['id'], $followedIds, true) ? t('unfollow') : t('follow')) ?></button>
                <a class="btn btn-ghost btn-sm" href="/space/<?= (int) $person['id'] ?>"><?= e(t('send_message')) ?></a>
              </div>
            <?php endif; ?>
          </div>
          <?php endif; ?>
        <?php endforeach; ?>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2><?= e(t('inbox')) ?></h2></div>
      <div class="message-list">
        <?php foreach ($inbox as $item): ?>
          <div class="message-row">
            <span class="avatar avatar-sm"><?= e(mb_substr(\user_label($names, (int) $item['from_id']), 0, 1)) ?></span>
            <div><b><?= e(\user_label($names, (int) $item['from_id'])) ?> → <?= e(\user_label($names, (int) $item['to_id'])) ?></b>
              <p><?= e($item['content']) ?></p><small class="muted"><?= e($item['created_at']) ?></small></div>
          </div>
        <?php endforeach; ?>
        <?php if ($inbox === []): ?><div class="empty"><?= $logged ? e(t('no_threads')) : e(t('login_required')) ?></div><?php endif; ?>
      </div>
    </section>
  </div>

  <aside class="col-side">
    <section class="panel">
      <div class="panel-head"><h2><?= e(t('following')) ?> (<?= count($following) ?>)</h2></div>
      <div class="member-list">
        <?php foreach ($following as $row): ?>
          <a class="member-row" href="/space/<?= (int) $row['user_id'] ?>"><span class="avatar avatar-sm"><?= e(mb_substr(\user_label($names, (int) $row['user_id']), 0, 1)) ?></span><span><?= e(\user_label($names, (int) $row['user_id'])) ?></span></a>
        <?php endforeach; ?><?php if ($following === []): ?><p class="muted">—</p><?php endif; ?>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2><?= e(t('followers')) ?> (<?= count($followers) ?>)</h2></div>
      <div class="member-list">
        <?php foreach ($followers as $row): ?>
          <a class="member-row" href="/space/<?= (int) $row['user_id'] ?>"><span class="avatar avatar-sm"><?= e(mb_substr(\user_label($names, (int) $row['user_id']), 0, 1)) ?></span><span><?= e(\user_label($names, (int) $row['user_id'])) ?></span></a>
        <?php endforeach; ?><?php if ($followers === []): ?><p class="muted">—</p><?php endif; ?>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2><?= e(t('friends')) ?> (<?= count($friends) ?>)</h2></div>
      <div class="member-list">
        <?php foreach ($friends as $row): ?>
          <a class="member-row" href="/space/<?= (int) $row['user_id'] ?>"><span class="avatar avatar-sm"><?= e(mb_substr(\user_label($names, (int) $row['user_id']), 0, 1)) ?></span><span><?= e(\user_label($names, (int) $row['user_id'])) ?></span></a>
        <?php endforeach; ?><?php if ($friends === []): ?><p class="muted">—</p><?php endif; ?>
      </div>
    </section>
  </aside>
</div>
