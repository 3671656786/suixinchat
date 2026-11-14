<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15
/** @var array $rooms @var array $room @var int $roomId @var array $messages @var array $names @var array $onlineNames @var int $lastId */
$logged = \Suixin\V4\Auth::id() > 0;
?>
<div class="page-head">
  <div><div class="crumbs"><a href="/"><?= e(t('nav_home')) ?></a> / <?= e(t('nav_chat')) ?></div>
    <h1><?= e(t('chat_title')) ?></h1><p class="muted"><?= e(t('chat_desc')) ?></p></div>
  <div class="online-pill"><i></i> <span id="online-count"><?= count($onlineNames) ?></span> <?= e(t('online')) ?></div>
</div>

<div class="chat-layout" id="chat-root" data-room="<?= (int) $roomId ?>" data-last="<?= (int) $lastId ?>">
  <aside class="chat-rooms panel">
    <div class="panel-head"><h2><?= e(t('chat_rooms')) ?></h2></div>
    <?php foreach ($rooms as $item): ?>
      <a class="room-link<?= (int) $item['id'] === $roomId ? ' is-active' : '' ?>" href="/chat?room=<?= (int) $item['id'] ?>">
        <b><?= e($item['name']) ?></b><small><?= e($item['description']) ?></small>
      </a>
    <?php endforeach; ?>
  </aside>

  <section class="chat-main panel">
    <div class="panel-head"><h2><?= e($room['name']) ?></h2><small class="muted"><?= e($room['description']) ?></small></div>
    <div class="chat-messages" id="chat-messages">
      <?php foreach ($messages as $message): ?>
        <?php $uid = (int) $message['user_id']; ?>
        <div class="chat-msg<?= $uid === \Suixin\V4\Auth::id() && $logged ? ' is-mine' : '' ?><?= $uid === 0 ? ' is-system' : '' ?>">
          <span class="avatar avatar-sm"><?= $uid === 0 ? '●' : e(mb_substr(\user_label($names, $uid), 0, 1)) ?></span>
          <div class="bubble"><b><?= $uid === 0 ? e(t('site_name')) : e(\user_label($names, $uid)) ?></b><p><?= e($message['content']) ?></p><small><?= e($message['created_at']) ?></small></div>
        </div>
      <?php endforeach; ?>
    </div>
    <?php if ($logged): ?>
      <form class="chat-input" id="form-chat">
        <?= csrf_field() ?>
        <input name="content" maxlength="1000" placeholder="<?= e(t('chat_hint')) ?>" autocomplete="off" required>
        <button class="btn btn-primary" type="submit"><?= e(t('chat_send')) ?></button>
      </form>
    <?php else: ?>
      <div class="chat-login"><a href="/login"><?= e(t('login')) ?></a> · <?= e(t('chat_login')) ?></div>
    <?php endif; ?>
  </section>
</div>
