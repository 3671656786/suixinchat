<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15
/** @var array $profile @var array $home @var array $feeds @var array $visitors */
$isSelf = \Suixin\V4\Auth::id() === (int) $profile['id'];
$logged = \Suixin\V4\Auth::id() > 0;
?>
<div class="space-hero">
  <span class="avatar avatar-lg"><?= e(mb_substr($profile['nickname'] ?: $profile['username'], 0, 1)) ?></span>
  <div class="space-info">
    <h1><?= e($profile['nickname'] ?: $profile['username']) ?>
      <?php if ($profile['role'] === 'admin'): ?><span class="tag tag-essence">ADMIN</span><?php endif; ?>
    </h1>
    <p class="muted">@<?= e($profile['username']) ?> · <?= e($profile['bio']) ?></p>
    <div class="space-stats">
      <span><b><?= (int) $profile['points'] ?></b> <?= e(t('points')) ?></span>
      <span><b><?= (int) $threadCount ?></b> <?= e(t('stat_threads')) ?></span>
      <span><b><?= (int) $home['visitor_count'] ?></b> <?= e(t('visitors')) ?></span>
    </div>
  </div>
  <?php if (!$isSelf && $logged): ?>
    <div class="space-actions">
      <button class="btn btn-primary" id="btn-follow" data-user="<?= (int) $profile['id'] ?>"><?= e($isFollowing ? t('unfollow') : t('follow')) ?></button>
      <button class="btn btn-ghost" id="btn-friend" data-user="<?= (int) $profile['id'] ?>"<?= $isFriend ? ' disabled' : '' ?>><?= e($isFriend ? t('friends') : t('add_friend')) ?></button>
      <button class="btn btn-ghost" data-open="#msg-modal"><?= e(t('send_message')) ?></button>
    </div>
  <?php endif; ?>
</div>

<div class="grid-main">
  <div class="col-main">
    <section class="panel">
      <div class="panel-head"><h2><?= e(t('feeds')) ?></h2></div>
      <div class="feed-list">
        <?php foreach ($feeds as $feed): ?>
          <div class="feed-row"><span class="feed-dot"></span><div><b><?= e($feed['content']) ?></b><small><?= e($feed['created_at']) ?></small></div></div>
        <?php endforeach; ?>
        <?php if ($feeds === []): ?><div class="empty"><?= e(t('no_threads')) ?></div><?php endif; ?>
      </div>
    </section>
  </div>
  <aside class="col-side">
    <section class="panel">
      <div class="panel-head"><h2><?= e(t('badges')) ?></h2></div>
      <div class="badge-list">
        <?php foreach ($badges as $badge): ?>
          <span class="badge-chip" title="<?= e($badge['description']) ?>"><?= e($badge['icon']) ?> <?= e($badge['name']) ?></span>
        <?php endforeach; ?>
        <?php if ($badges === []): ?><p class="muted">—</p><?php endif; ?>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2><?= e(t('visitors')) ?></h2></div>
      <div class="member-list">
        <?php foreach ($visitors as $visitor): ?>
          <a class="member-row" href="/space/<?= (int) $visitor['visitor_id'] ?>">
            <span class="avatar avatar-sm"><?= e(mb_substr(\user_label($visitorNames, (int) $visitor['visitor_id']), 0, 1)) ?></span>
            <span><?= e(\user_label($visitorNames, (int) $visitor['visitor_id'])) ?></span>
          </a>
        <?php endforeach; ?>
        <?php if ($visitors === []): ?><p class="muted">—</p><?php endif; ?>
      </div>
    </section>
  </aside>
</div>

<?php if (!$isSelf && $logged): ?>
<div class="modal" id="msg-modal" hidden>
  <div class="modal-backdrop" data-close></div>
  <div class="modal-box">
    <div class="modal-head"><h2><?= e(t('send_message')) ?></h2><button class="icon-btn" data-close aria-label="close">×</button></div>
    <form id="form-message" data-to="<?= (int) $profile['id'] ?>">
      <?= csrf_field() ?>
      <label class="field"><textarea name="content" rows="4" maxlength="1000" required></textarea></label>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close><?= e(t('cancel')) ?></button><button class="btn btn-primary" type="submit"><?= e(t('submit')) ?></button></div>
    </form>
  </div>
</div>
<?php endif; ?>
