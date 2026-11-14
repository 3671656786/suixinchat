<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

require __DIR__ . '/../src/bootstrap.php';

use Suixin\V4\DB;
use Suixin\V4\Schema;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Installer is CLI only.');
}

try {
    // --fresh：清空各分片业务表后重新灌入演示数据（可重复初始化，便于重置环境）
    if (in_array('--fresh', $argv ?? [], true)) {
        foreach (DB::shardNames() as $alias => $name) {
            foreach (DB::all($alias, 'SHOW TABLES') as $row) {
                $table = (string) reset($row);
                if (preg_match('/^[A-Za-z0-9_]+$/', $table)) {
                    DB::run($alias, "TRUNCATE TABLE `{$table}`");
                }
            }
        }
    }
    $result = Schema::install();
    $check = [];
    foreach (DB::shardNames() as $alias => $name) {
        $check[$alias] = (int) DB::val($alias, 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = ?', [$name], 0);
    }
    echo json_encode([
        'ok'        => true,
        'version'   => \Suixin\V4\Config::get('version'),
        'databases' => $result['databases'],
        'tables'    => $result['tables'],
        'seeded'    => $result['seeded'],
        'tables_per_shard' => $check,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . PHP_EOL;
} catch (Throwable $e) {
    fwrite(STDERR, 'INSTALL FAILED: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
