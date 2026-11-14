<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15
/** @var int $code @var string $message */
http_response_code($code);
?>
<div class="error-page">
  <div class="error-code"><?= (int) $code ?></div>
  <h1><?= $code === 404 ? e(t('not_found')) : e(t('not_found')) ?></h1>
  <p class="muted"><?= e($message) ?></p>
  <a class="btn btn-primary" href="/"><?= e(t('back_home')) ?></a>
</div>
