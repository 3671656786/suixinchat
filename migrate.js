// migrate.js - 数据库一键迁移脚本
// 使用方法: node migrate.js
// 功能: 新增 verification_cooldowns 表，以及未来可能的其他迁移

const path = require('path');
const fs = require('fs');
const readline = require('readline');

// 颜色输出
const colors = {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(msg, color = 'reset') {
    console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

// 创建交互界面
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => {
        rl.question(query, answer => {
            resolve(answer);
        });
    });
}

async function main() {
    log('\n═══════════════════════════════════════════════', 'blue');
    log('  随心聊 (SuixinChat) - 数据库迁移工具 v1.0', 'green');
    log('═══════════════════════════════════════════════\n', 'blue');

    // 检查数据库文件
    const dbPath = path.join(__dirname, 'chat.db');
    if (!fs.existsSync(dbPath)) {
        log('❌ 数据库文件不存在: chat.db', 'red');
        log('请确保在项目根目录下运行此脚本', 'yellow');
        process.exit(1);
    }

    log(`📁 找到数据库: ${dbPath}`, 'green');

    // 确认执行
    const answer = await askQuestion('\n⚠️  即将执行数据库迁移，建议先备份 chat.db 文件。\n是否继续？(y/N): ');
    
    if (answer.toLowerCase() !== 'y') {
        log('\n❌ 迁移已取消', 'yellow');
        rl.close();
        process.exit(0);
    }

    log('\n🔄 开始执行迁移...\n', 'blue');

    try {
        // 加载数据库
        const initSqlJs = require('sql.js');
        const wasmPath = path.join(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm');
        const wasmBinary = fs.existsSync(wasmPath) ? fs.readFileSync(wasmPath) : null;
        const SQL = await initSqlJs({ wasmBinary });

        // 读取现有数据库
        const dbData = fs.readFileSync(dbPath);
        const db = new SQL.Database(dbData);

        // ========== 执行迁移 ==========
        const migrations = [
            {
                name: 'verification_cooldowns 表',
                sql: `
                    CREATE TABLE IF NOT EXISTS verification_cooldowns (
                        key TEXT PRIMARY KEY,
                        count INTEGER DEFAULT 0,
                        first_time INTEGER DEFAULT 0,
                        last_time INTEGER DEFAULT 0
                    )
                `,
                check: "SELECT name FROM sqlite_master WHERE type='table' AND name='verification_cooldowns'"
            },
            // 未来可在此添加更多迁移
            // {
            //     name: '示例迁移',
            //     sql: 'ALTER TABLE users ADD COLUMN new_column TEXT',
            //     check: "SELECT new_column FROM users LIMIT 1"
            // }
        ];

        let executedCount = 0;
        let skippedCount = 0;

        for (const migration of migrations) {
            // 检查是否已执行
            try {
                const checkResult = db.exec(migration.check);
                // 如果有结果，说明表/列已存在
                if (checkResult && checkResult.length > 0 && checkResult[0].values && checkResult[0].values.length > 0) {
                    log(`⏭️  跳过: ${migration.name} (已存在)`, 'yellow');
                    skippedCount++;
                    continue;
                }
                // 对于 ALTER TABLE 检查，可能返回空结果但无错误，需要特殊处理
                // 如果 exec 没有报错，说明查询执行了，但可能没有数据
                // 对于 CREATE TABLE，我们使用 sqlite_master 检查更可靠
                if (migration.sql.trim().toUpperCase().startsWith('ALTER')) {
                    // 对于 ALTER，我们无法通过查询结果判断，尝试执行
                    // 如果执行失败，说明列已存在或表不存在
                    try {
                        db.exec(migration.sql);
                        log(`✅ 执行: ${migration.name}`, 'green');
                        executedCount++;
                        continue;
                    } catch (alterErr) {
                        // 如果错误包含 "duplicate column" 或 "already exists"，说明已存在
                        if (alterErr.message && (alterErr.message.includes('duplicate column') || alterErr.message.includes('already exists'))) {
                            log(`⏭️  跳过: ${migration.name} (已存在)`, 'yellow');
                            skippedCount++;
                            continue;
                        }
                        throw alterErr;
                    }
                }
            } catch (checkErr) {
                // 查询失败，说明表/列不存在，执行迁移
                // 对于 CREATE TABLE，如果表不存在，检查会返回空数组
                if (migration.sql.trim().toUpperCase().startsWith('CREATE TABLE')) {
                    // 第二次检查：直接尝试创建
                    try {
                        db.exec(migration.sql);
                        log(`✅ 执行: ${migration.name}`, 'green');
                        executedCount++;
                        continue;
                    } catch (createErr) {
                        if (createErr.message && createErr.message.includes('already exists')) {
                            log(`⏭️  跳过: ${migration.name} (已存在)`, 'yellow');
                            skippedCount++;
                            continue;
                        }
                        throw createErr;
                    }
                }
                // 其他 SQL 类型（ALTER, INSERT 等）
                try {
                    db.exec(migration.sql);
                    log(`✅ 执行: ${migration.name}`, 'green');
                    executedCount++;
                    continue;
                } catch (execErr) {
                    if (execErr.message && (execErr.message.includes('duplicate') || execErr.message.includes('already exists'))) {
                        log(`⏭️  跳过: ${migration.name} (已存在)`, 'yellow');
                        skippedCount++;
                        continue;
                    }
                    throw execErr;
                }
            }
        }

        // ========== 保存数据库 ==========
        log('\n💾 保存数据库...', 'blue');
        const data = db.export();
        // 创建备份
        const backupPath = path.join(__dirname, `chat.db.backup.${Date.now()}`);
        fs.writeFileSync(backupPath, dbData);
        log(`📦 已创建备份: ${backupPath}`, 'green');

        // 写入新数据库
        fs.writeFileSync(dbPath, Buffer.from(data));
        db.close();

        // ========== 完成 ==========
        log('\n═══════════════════════════════════════════════', 'blue');
        log('✅ 迁移完成！', 'green');
        log(`   - 执行: ${executedCount} 项`, 'green');
        log(`   - 跳过: ${skippedCount} 项`, 'yellow');
        log(`   - 备份: ${backupPath}`, 'green');
        log('\n📌 提示: 如果一切正常，可以删除备份文件', 'yellow');
        log('═══════════════════════════════════════════════\n', 'blue');

    } catch (err) {
        log(`\n❌ 迁移失败: ${err.message}`, 'red');
        console.error(err);
        log('\n💡 请检查: 1. 数据库文件是否损坏', 'yellow');
        log('         2. 是否有足够的磁盘空间', 'yellow');
        log('         3. 备份文件是否可恢复', 'yellow');
        process.exit(1);
    }

    rl.close();
}

// 运行
main().catch(err => {
    console.error(err);
    process.exit(1);
});