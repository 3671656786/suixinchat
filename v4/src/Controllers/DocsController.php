<?php
declare(strict_types=1);
// Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
// Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15

namespace Suixin\V4\Controllers;

use Suixin\V4\DB;
use Suixin\V4\Req;
use Suixin\V4\View;

final class DocsController
{
    public static function dispatch(array $seg): void
    {
        $action = $seg[1] ?? '';
        if ($action === '' || $action === 'index') {
            self::index();
        } elseif (isset($seg[1]) && ctype_digit($seg[1])) {
            self::show((int) $seg[1]);
        } else {
            \abort_page(404);
        }
    }

    public static function index(): void
    {
        $categories = DB::all('docs', 'SELECT * FROM categories ORDER BY sort_order ASC, id ASC');
        $categoryId = (int) Req::get('cat', 0);
        if ($categoryId > 0) {
            $documents = DB::all('docs', 'SELECT * FROM documents WHERE category_id = ? ORDER BY id DESC LIMIT 50', [$categoryId]);
        } else {
            $documents = DB::all('docs', 'SELECT * FROM documents ORDER BY id DESC LIMIT 50');
        }
        $names = \user_names(array_column($documents, 'user_id'));
        $catMap = [];
        foreach ($categories as $category) {
            $catMap[(int) $category['id']] = $category['name'];
        }
        View::render('docs', [
            'mode'       => 'index',
            'categories' => $categories,
            'catMap'     => $catMap,
            'categoryId' => $categoryId,
            'documents'  => $documents,
            'names'      => $names,
        ]);
    }

    public static function show(int $id): void
    {
        $document = DB::one('docs', 'SELECT * FROM documents WHERE id = ?', [$id]);
        if ($document === null) {
            \abort_page(404);
        }
        DB::run('docs', 'UPDATE documents SET views = views + 1 WHERE id = ?', [$id]);
        $document['views'] = (int) $document['views'] + 1;
        $category = DB::one('docs', 'SELECT * FROM categories WHERE id = ?', [$document['category_id']]);
        View::render('docs', [
            'mode'     => 'show',
            'document' => $document,
            'category' => $category,
            'names'    => \user_names([$document['user_id']]),
        ]);
    }
}
