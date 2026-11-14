<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15
/** @var array $rows @var array $names @var array $badges @var string $sort @var array $topPoints */
$sorts = ['points' => t('points'), 'thread_count' => t('stat_threads'), 'post_count' => t('stat_posts'), 'doc_count' => t('nav_docs'), 'friend_count' => t('friends')];
?>
<div class="page-head">
  <div><div class="crumbs"><a href="/"><?= e(t('nav_home')) ?></a> / <?= e(t('nav_rank')) ?></div>
    <h1><?= e(t('rank_title')) ?></h1><p class="muted"><?= e(t('rank_desc')) ?></p></div>
</div>

<div class="podium">
  <?php foreach ($topPoints as $index => $row): ?>
    <a class="podium-item podium-<?= $index + 1 ?>" href="/space/<?= (int) $row['user_id'] ?>">
      <span class="medal"><?= ['①','②','③'][$index] ?></span>
      <span class="avatar"><?= e(mb_substr(\user_label($topNames, (int) $row['user_id']), 0, 1)) ?></span>
      <b><?= e(\user_label($topNames, (int) $row['user_id'])) ?></b>
      <small><?= (int) $row['points'] ?> <?= e(t('points')) ?></small>
    </a>
  <?php endforeach; ?>
</div>

<div class="grid-main">
  <div class="col-main">
    <section class="panel">
      <div class="panel-head">
        <h2><?= e(t('rank_title')) ?></h2>
        <div class="sort-links">
          <?php foreach ($sorts as $key => $label): ?>
            <a class="<?= $key === $sort ? 'is-active' : '' ?>" href="/rank?sort=<?= e($key) ?>"><?= e($label) ?></a>
          <?php endforeach; ?>
        </div>
      </div>
      <div class="rank-list">
        <?php foreach ($rows as $index => $row): ?>
          <a class="rank-row" href="/space/<?= (int) $row['user_id'] ?>">
            <span class="rank-num<?= $index < 3 ? ' rank-top' : '' ?>"><?= $index + 1 ?></span>
            <span class="avatar avatar-sm"><?= e(mb_substr(\user_label($names, (int) $row['user_id']), 0, 1)) ?></span>
            <b><?= e(\user_label($names, (int) $row['user_id'])) ?></b>
            <span class="rank-value"><?= (int) $row[$sort] ?></span>
          </a>
        <?php endforeach; ?>
      </div>
    </section>
  </div>
  <aside class="col-side">
    <section class="panel">
      <div class="panel-head"><h2><?= e(t('badges')) ?></h2></div>
      <div class="badge-list badge-list-vertical">
        <?php foreach ($badges as $badge): ?>
          <div class="badge-row"><span class="badge-icon"><?= e($badge['icon']) ?></span>
            <div><b><?= e($badge['name']) ?></b><small class="muted"><?= e($badge['description']) ?></small></div></div>
        <?php endforeach; ?>
      </div>
    </section>
  </aside>
</div>
