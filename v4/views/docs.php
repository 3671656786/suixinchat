<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15
/** @var string $mode */
$isShow = $mode === 'show';
$logged = \Suixin\V4\Auth::id() > 0;
?>
<div class="page-head">
  <div>
    <div class="crumbs"><a href="/"><?= e(t('nav_home')) ?></a> / <a href="/docs"><?= e(t('nav_docs')) ?></a><?php if ($isShow): ?> / <?= e($document['title']) ?><?php endif; ?></div>
    <h1><?= $isShow ? e($document['title']) : e(t('docs_title')) ?></h1>
    <p class="muted"><?= $isShow ? e($document['summary']) : e(t('docs_desc')) ?></p>
  </div>
  <?php if (!$isShow && $logged): ?><button class="btn btn-primary" data-open="#doc-composer"><?= e(t('upload_doc')) ?></button><?php endif; ?>
</div>

<?php if (!$isShow): ?>
  <div class="chip-bar">
    <a class="chip<?= $categoryId === 0 ? ' is-active' : '' ?>" href="/docs"><?= e(t('all')) ?></a>
    <?php foreach ($categories as $category): ?>
      <a class="chip<?= $categoryId === (int) $category['id'] ? ' is-active' : '' ?>" href="/docs?cat=<?= (int) $category['id'] ?>"><?= e($category['name']) ?></a>
    <?php endforeach; ?>
  </div>
  <div class="card-grid">
    <?php foreach ($documents as $document): ?>
      <a class="doc-card" href="/docs/<?= (int) $document['id'] ?>">
        <span class="doc-icon">▤</span>
        <div class="doc-head"><b><?= e($document['title']) ?></b><small><?= e($catMap[(int) $document['category_id']] ?? '') ?></small></div>
        <p class="muted"><?= e($document['summary']) ?></p>
        <div class="doc-foot">
          <span><?= e(\user_label($names, (int) $document['user_id'])) ?></span>
          <span><?= (int) $document['views'] ?> <?= e(t('views')) ?></span>
        </div>
      </a>
    <?php endforeach; ?>
    <?php if ($documents === []): ?><div class="empty"><?= e(t('no_threads')) ?></div><?php endif; ?>
  </div>

  <?php if ($logged): ?>
  <div class="modal" id="doc-composer" hidden>
    <div class="modal-backdrop" data-close></div>
    <div class="modal-box">
      <div class="modal-head"><h2><?= e(t('upload_doc')) ?></h2><button class="icon-btn" data-close aria-label="close">×</button></div>
      <form id="form-doc">
        <?= csrf_field() ?>
        <label class="field"><span><?= e(t('docs_title')) ?></span>
          <select name="category_id" required>
            <?php foreach ($categories as $category): ?><option value="<?= (int) $category['id'] ?>"><?= e($category['name']) ?></option><?php endforeach; ?>
          </select>
        </label>
        <label class="field"><span><?= e(t('thread_title')) ?></span><input name="title" maxlength="120" required></label>
        <label class="field"><span><?= e(t('thread_content')) ?></span><textarea name="content" rows="6" maxlength="5000" required></textarea></label>
        <input type="hidden" name="summary" value="">
        <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close><?= e(t('cancel')) ?></button><button class="btn btn-primary" type="submit"><?= e(t('submit')) ?></button></div>
      </form>
    </div>
  </div>
  <?php endif; ?>

<?php else: ?>
  <article class="panel doc-detail">
    <div class="post-meta">
      <span class="avatar"><?= e(mb_substr(\user_label($names, (int) $document['user_id']), 0, 1)) ?></span>
      <div><b><?= e(\user_label($names, (int) $document['user_id'])) ?></b><small><?= e($document['created_at']) ?></small></div>
      <div class="post-stats"><?= (int) $document['views'] ?> <?= e(t('views')) ?></div>
    </div>
    <div class="post-content"><?= nl2br(e($document['content'])) ?></div>
    <div class="doc-actions"><a class="btn btn-ghost" href="/docs"><?= e(t('back_home')) ?></a></div>
  </article>
<?php endif; ?>
