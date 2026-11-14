<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15
/** @var string $mode @var array $forums @var array $threads @var array $names @var string $keyword */
$isSection = $mode === 'section';
$current = $current ?? null;
?>
<div class="page-head">
  <div>
    <div class="crumbs"><a href="/"><?= e(t('nav_home')) ?></a> / <a href="/forum"><?= e(t('nav_forum')) ?></a><?php if ($isSection): ?> / <?= e($current['name']) ?><?php endif; ?></div>
    <h1><?= $isSection ? e($current['name']) : e(t('nav_forum')) ?></h1>
    <p class="muted"><?= $isSection ? e($current['description']) : e(t('forum_desc')) ?></p>
  </div>
  <?php if (\Suixin\V4\Auth::id() > 0): ?>
    <button class="btn btn-primary" data-open="#composer"><?= e(t('new_thread')) ?></button>
  <?php else: ?>
    <a class="btn btn-primary" href="/login"><?= e(t('login')) ?></a>
  <?php endif; ?>
</div>

<?php if (!$isSection): ?>
<section class="panel">
  <div class="panel-head"><h2><?= e(t('forum_sections')) ?></h2></div>
  <div class="forum-grid">
    <?php foreach ($forums as $forum): ?>
      <a class="forum-card" href="/forum/f/<?= (int) $forum['id'] ?>">
        <span class="forum-icon"><?= e($forum['icon']) ?></span>
        <div><b><?= e($forum['name']) ?></b><p class="muted"><?= e($forum['description']) ?></p></div>
        <span class="forum-meta"><?= (int) $forum['thread_count'] ?> <?= e(t('stat_threads')) ?> · <?= (int) $forum['post_count'] ?> <?= e(t('stat_posts')) ?></span>
      </a>
    <?php endforeach; ?>
  </div>
</section>
<?php endif; ?>

<section class="panel">
  <div class="panel-head">
    <h2><?= $keyword !== '' ? e(t('search')) . ' · ' . e($keyword) : ($isSection ? e(t('stat_threads')) : e(t('latest_threads'))) ?></h2>
    <div class="sort-links">
      <a href="<?= $isSection ? '/forum/f/' . (int) $current['id'] : '/forum' ?>"><?= e(t('all')) ?></a>
    </div>
  </div>
  <div class="thread-list">
    <?php if ($threads === []): ?><div class="empty"><?= e(t('no_threads')) ?></div><?php endif; ?>
    <?php foreach ($threads as $thread): ?>
      <article class="thread-row">
        <span class="avatar"><?= e(mb_substr(\user_label($names, (int) $thread['user_id']), 0, 1)) ?></span>
        <div class="thread-body">
          <div class="thread-title-line">
            <?php if ((int) $thread['is_top'] === 1): ?><span class="tag tag-top"><?= e(t('pinned')) ?></span><?php endif; ?>
            <?php if ((int) $thread['is_essence'] === 1): ?><span class="tag tag-essence"><?= e(t('essence')) ?></span><?php endif; ?>
            <a class="thread-title" href="/forum/t/<?= (int) $thread['id'] ?>"><?= e($thread['title']) ?></a>
          </div>
          <div class="thread-meta">
            <?php if (!$isSection): ?><span class="tag-plain"><?= e($thread['forum_name'] ?? '') ?></span><span>·</span><?php endif; ?>
            <span><?= e(\user_label($names, (int) $thread['user_id'])) ?></span>
            <span>·</span><span><?= e(\time_ago($thread['last_reply_at'] ?? $thread['created_at'])) ?></span>
          </div>
        </div>
        <div class="thread-count"><b><?= (int) $thread['reply_count'] ?></b><span><?= e(t('stat_posts')) ?></span></div>
      </article>
    <?php endforeach; ?>
  </div>
</section>

<?php if (\Suixin\V4\Auth::id() > 0): ?>
<div class="modal" id="composer" hidden>
  <div class="modal-backdrop" data-close></div>
  <div class="modal-box">
    <div class="modal-head"><h2><?= e(t('new_thread')) ?></h2><button class="icon-btn" data-close aria-label="close">×</button></div>
    <form id="form-thread">
      <?= csrf_field() ?>
      <label class="field"><span><?= e(t('forum_sections')) ?></span>
        <select name="forum_id" required>
          <?php foreach (\Suixin\V4\DB::all('forum', 'SELECT id, name FROM forums ORDER BY sort_order') as $f): ?>
            <option value="<?= (int) $f['id'] ?>"<?= $isSection && (int) $current['id'] === (int) $f['id'] ? ' selected' : '' ?>><?= e($f['name']) ?></option>
          <?php endforeach; ?>
        </select>
      </label>
      <label class="field"><span><?= e(t('thread_title')) ?></span><input name="title" maxlength="120" required></label>
      <label class="field"><span><?= e(t('thread_content')) ?></span><textarea name="content" rows="6" maxlength="5000" required></textarea></label>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close><?= e(t('cancel')) ?></button><button class="btn btn-primary" type="submit"><?= e(t('submit')) ?></button></div>
    </form>
  </div>
</div>
<?php endif; ?>
