// db/notesInit.js
const db = require('./notesConnection');

async function initNotesDatabase() {
    await db._waitReady();
    db.exec(`
        -- ========== 云笔记表（独立数据库） ==========
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            content TEXT,
            createdAt DATETIME DEFAULT (datetime('now')),
            updatedAt DATETIME DEFAULT (datetime('now')),
            createdBy INTEGER,
            folderId INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS note_attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            noteId INTEGER NOT NULL,
            fileUrl TEXT NOT NULL,
            fileName TEXT NOT NULL,
            fileType TEXT,
            fileSize INTEGER,
            createdAt DATETIME DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS note_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parentId INTEGER DEFAULT 0,
            createdBy INTEGER NOT NULL,
            createdAt DATETIME DEFAULT (datetime('now')),
            updatedAt DATETIME DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_notes_folderId ON notes(folderId);
        CREATE INDEX IF NOT EXISTS idx_note_folders_parent ON note_folders(parentId);
    `);
    console.log('✅ 云笔记独立数据库初始化完成');
}

module.exports = { initNotesDatabase };