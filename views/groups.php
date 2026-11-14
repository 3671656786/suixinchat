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
    <div class="crumbs"><a href="/"><?= e(t('nav_home')) ?></a> / <a href="/groups"><?= e(t('nav_groups')) ?></a><?php if ($isShow): ?> / <?= e($circle['name']) ?><?php endif; ?></div>
    <h1><?= $isShow ? e($circle['name']) : e(t('groups_title')) ?></h1>
    <p class="muted"><?= $isShow ? e($circle['description']) : e(t('groups_desc')) ?></p>
  </div>
  <?php if (!$isShow && $logged): ?>
    <button class="btn btn-primary" data-open="#circle-composer"><?= e(t('create_group')) ?></button>
  <?php elseif ($isShow && $logged): ?>
    <button class="btn <?= $joined ? 'btn-ghost' : 'btn-primary' ?>" id="btn-join" data-circle="<?= (int) $circle['id'] ?>"<?= $joined ? ' disabled' : '' ?>><?= e($joined ? t('joined') : t('join_group')) ?></button>
  <?php endif; ?>
</div>

<?php if (!$isShow): ?>
  <div class="card-grid">
    <?php foreach ($circles as $item): ?>
      <a class="circle-card" href="/groups/<?= (int) $item['id'] ?>">
        <span class="circle-icon"><?= e($item['icon']) ?></span>
        <h3><?= e($item['name']) ?></h3>
        <p class="muted"><?= e($item['description']) ?></p>
        <div class="circle-foot">
          <span><?= (int) $item['member_count'] ?> <?= e(t('members')) ?></span>
          <?php if (in_array((int) $item['id'], $joined, true)): ?><span class="tag tag-top"><?= e(t('joined')) ?></span><?php endif; ?>
        </div>
      </a>
    <?php endforeach; ?>
  </div>

  <?php if ($logged): ?>
  <div class="modal" id="circle-composer" hidden>
    <div class="modal-backdrop" data-close></div>
    <div class="modal-box">
      <div class="modal-head"><h2><?= e(t('create_group')) ?></h2><button class="icon-btn" data-close aria-label="close">×</button></div>
      <form id="form-circle">
        <?= csrf_field() ?>
        <label class="field"><span><?= e(t('thread_title')) ?></span><input name="name" maxlength="80" required></label>
        <label class="field"><span><?= e(t('groups_desc')) ?></span><textarea name="description" rows="3" maxlength="255"></textarea></label>
        <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close><?= e(t('cancel')) ?></button><button class="btn btn-primary" type="submit"><?= e(t('submit')) ?></button></div>
      </form>
    </div>
  </div>
  <?php endif; ?>

<?php else: ?>
  <div class="grid-main">
    <div class="col-main">
      <section class="panel">
        <div class="panel-head"><h2><?= e(t('circle_topics')) ?></h2></div>
        <?php if ($logged): ?>
          <form id="form-circle-topic" class="inline-form" data-circle="<?= (int) $circle['id'] ?>">
            <?= csrf_field() ?>
            <input name="title" maxlength="120" placeholder="<?= e(t('thread_title')) ?>" required>
            <button class="btn btn-primary btn-sm" type="submit"><?= e(t('new_topic')) ?></button>
          </form>
          <textarea id="circle-topic-content" class="full-textarea" rows="2" maxlength="5000" placeholder="<?= e(t('thread_content')) ?>"></textarea>
        <?php endif; ?>
        <div class="topic-list">
          <?php foreach ($topics as $topic): ?>
            <article class="topic-item">
              <div class="topic-head">
                <b><?= e($topic['title']) ?></b>
                <small><?= e(\user_label($names, (int) $topic['user_id'])) ?> · <?= e(\time_ago($topic['created_at'])) ?></small>
              </div>
              <p><?= nl2br(e($topic['content'])) ?></p>
              <?php foreach ($replies[(int) $topic['id']] ?? [] as $reply): ?>
                <div class="topic-reply"><b><?= e(\user_label($names, (int) $reply['user_id'])) ?>：</b><?= e($reply['content']) ?></div>
              <?php endforeach; ?>
              <?php if ($logged): ?>
                <form class="topic-reply-form" data-topic="<?= (int) $topic['id'] ?>">
                  <input name="content" maxlength="5000" placeholder="<?= e(t('reply_hint')) ?>" required>
                  <button class="btn btn-ghost btn-sm" type="submit"><?= e(t('reply')) ?></button>
                </form>
              <?php endif; ?>
            </article>
          <?php endforeach; ?>
          <?php if ($topics === []): ?><div class="empty"><?= e(t('no_threads')) ?></div><?php endif; ?>
        </div>
      </section>
    </div>
    <aside class="col-side">
      <section class="panel">
        <div class="panel-head"><h2><?= e(t('members')) ?> (<?= (int) $circle['member_count'] ?>)</h2></div>
        <div class="member-list">
          <?php foreach ($members as $member): ?>
            <a class="member-row" href="/space/<?= (int) $member['user_id'] ?>">
              <span class="avatar avatar-sm"><?= e(mb_substr(\user_label($names, (int) $member['user_id']), 0, 1)) ?></span>
              <span><?= e(\user_label($names, (int) $member['user_id'])) ?></span>
              <?php if ($member['role'] === 'owner'): ?><span class="tag tag-essence">圈主</span><?php endif; ?>
            </a>
          <?php endforeach; ?>
        </div>
      </section>
    </aside>
  </div>
<?php endif; ?>
