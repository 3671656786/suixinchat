<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15
/** @var array $thread @var array $posts @var array $names */
$author = $names[(int) $thread['user_id']] ?? null;
?>
<div class="crumbs"><a href="/"><?= e(t('nav_home')) ?></a> / <a href="/forum"><?= e(t('nav_forum')) ?></a> / <a href="/forum/f/<?= (int) $thread['forum_id'] ?>"><?= e($thread['forum_name'] ?? '') ?></a></div>

<article class="panel thread-detail">
  <div class="thread-detail-head">
    <div>
      <?php if ((int) $thread['is_top'] === 1): ?><span class="tag tag-top"><?= e(t('pinned')) ?></span><?php endif; ?>
      <?php if ((int) $thread['is_essence'] === 1): ?><span class="tag tag-essence"><?= e(t('essence')) ?></span><?php endif; ?>
      <h1><?= e($thread['title']) ?></h1>
    </div>
  </div>
  <div class="post-meta">
    <span class="avatar"><?= e(mb_substr(\user_label($names, (int) $thread['user_id']), 0, 1)) ?></span>
    <div><b><?= e(\user_label($names, (int) $thread['user_id'])) ?></b>
      <small><?= e(t('created_at')) ?> <?= e($thread['created_at']) ?></small></div>
    <div class="post-stats"><?= (int) $thread['views'] ?> <?= e(t('views')) ?> · <?= (int) $thread['reply_count'] ?> <?= e(t('stat_posts')) ?></div>
  </div>
  <div class="post-content"><?= nl2br(e($thread['content'])) ?></div>
</article>

<section class="panel">
  <div class="panel-head"><h2><?= e(t('reply')) ?> (<?= count($posts) ?>)</h2></div>
  <div id="post-list">
    <?php if ($posts === []): ?><div class="empty"><?= e(t('no_replies')) ?></div><?php endif; ?>
    <?php foreach ($posts as $post): ?>
      <article class="floor" id="floor-<?= (int) $post['floor'] ?>">
        <span class="floor-num">#<?= (int) $post['floor'] ?></span>
        <div class="floor-body">
          <div class="floor-author"><b><?= e(\user_label($names, (int) $post['user_id'])) ?></b><small><?= e($post['created_at']) ?></small></div>
          <div class="post-content"><?= nl2br(e($post['content'])) ?></div>
        </div>
      </article>
    <?php endforeach; ?>
  </div>
</section>

<section class="panel">
  <div class="panel-head"><h2><?= e(t('reply')) ?></h2></div>
  <?php if (\Suixin\V4\Auth::id() > 0): ?>
    <form id="form-reply" data-thread="<?= (int) $thread['id'] ?>">
      <?= csrf_field() ?>
      <label class="field"><textarea name="content" rows="4" maxlength="5000" placeholder="<?= e(t('reply_hint')) ?>" required></textarea></label>
      <div class="form-foot"><button class="btn btn-primary" type="submit"><?= e(t('reply')) ?></button></div>
    </form>
  <?php else: ?>
    <div class="empty"><a href="/login"><?= e(t('login')) ?></a> · <?= e(t('login_required')) ?></div>
  <?php endif; ?>
</section>
