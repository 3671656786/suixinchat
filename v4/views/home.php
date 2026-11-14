<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15
/** @var array $stats @var array $forums @var array $threads @var array $names */
?>
<section class="hero">
  <div class="hero-glow"></div>
  <div class="hero-body">
    <span class="eyebrow">SUIXIN COMMUNITY · v<?= e(site_version()) ?></span>
    <h1><?= e(t('hero_title')) ?></h1>
    <p><?= e(t('hero_desc')) ?></p>
    <div class="hero-actions">
      <a class="btn btn-light" href="/forum"><?= e(t('hero_cta')) ?> →</a>
      <a class="btn btn-outline-light" href="/chat"><?= e(t('nav_chat')) ?></a>
    </div>
    <div class="hero-stats">
      <div><b><?= (int) $stats['threads'] ?></b><span><?= e(t('stat_threads')) ?></span></div>
      <div><b><?= (int) $stats['posts'] ?></b><span><?= e(t('stat_posts')) ?></span></div>
      <div><b><?= (int) $stats['members'] ?></b><span><?= e(t('stat_members')) ?></span></div>
      <div><b><?= (int) $stats['docs'] ?></b><span><?= e(t('nav_docs')) ?></span></div>
    </div>
  </div>
</section>

<div class="grid-main">
  <div class="col-main">
    <section class="panel">
      <div class="panel-head">
        <h2><?= e(t('latest_threads')) ?></h2>
        <a class="link-more" href="/forum"><?= e(t('more')) ?> →</a>
      </div>
      <div class="thread-list">
        <?php if ($threads === []): ?>
          <div class="empty"><?= e(t('no_threads')) ?></div>
        <?php endif; ?>
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
                <a href="/forum/f/<?= (int) $thread['forum_id'] ?>"><?= e($thread['forum_name'] ?? '') ?></a>
                <span>·</span><span><?= e(\user_label($names, (int) $thread['user_id'])) ?></span>
                <span>·</span><span><?= e(\time_ago($thread['created_at'] ?? null)) ?></span>
              </div>
            </div>
            <div class="thread-count"><b><?= (int) $thread['reply_count'] ?></b><span><?= e(t('posts')) ?></span></div>
          </article>
        <?php endforeach; ?>
      </div>
    </section>
  </div>

  <aside class="col-side">
    <section class="panel">
      <div class="panel-head"><h2><?= e(t('forum_sections')) ?></h2></div>
      <div class="section-list">
        <?php foreach ($forums as $forum): ?>
          <a class="section-item" href="/forum/f/<?= (int) $forum['id'] ?>">
            <span class="section-icon"><?= e($forum['icon']) ?></span>
            <span class="section-copy"><b><?= e($forum['name']) ?></b><small><?= e($forum['description']) ?></small></span>
            <span class="section-count"><?= (int) $forum['thread_count'] ?></span>
          </a>
        <?php endforeach; ?>
      </div>
    </section>
    <section class="panel panel-accent">
      <div class="panel-head"><h2><?= e(t('nav_chat')) ?></h2></div>
      <p class="muted"><?= e(t('chat_desc')) ?></p>
      <div class="online-pill"><i></i> <?= (int) $stats['online'] ?> <?= e(t('online')) ?></div>
      <a class="btn btn-primary btn-block" href="/chat"><?= e(t('nav_chat')) ?> →</a>
    </section>
  </aside>
</div>
