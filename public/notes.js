// public/notes.js
(function ensureGlobals() {
    // ========== 确保全局函数可用（使用 common.js 的函数，不再重复定义） ==========
    // 所有全局函数已在 common.js 中定义，这里不再重复定义
    // 只需要确保它们存在
    
    if (typeof window.escapeHtml !== 'function') {
        console.warn('[notes.js] escapeHtml 未定义，使用备用实现');
        window.escapeHtml = function(text) {
            if (!text) return '';
            var e = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
            return text.replace(/[&<>"']/g, function(m) { return e[m]; });
        };
    }
    if (typeof window.apiRequest !== 'function') {
        console.warn('[notes.js] apiRequest 未定义，使用备用实现');
        window.apiRequest = function(url, method, body) {
            var isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
            var options = {
                method: method,
                credentials: 'include'
            };
            if (isFormData) {
                options.body = body;
            } else {
                options.headers = { 'Content-Type': 'application/json' };
                options.body = body ? JSON.stringify(body) : undefined;
            }
            return fetch(url, options).then(function(res) { return res.json(); });
        };
    }
    if (typeof window.formatFileSize !== 'function') {
        console.warn('[notes.js] formatFileSize 未定义，使用备用实现');
        window.formatFileSize = function(bytes) {
            if (!bytes) return '0 B';
            var k = 1024;
            var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            var i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };
    }
})();

// ========== 状态 ==========
var currentUser = null;
var isAdmin = false;
var currentEditId = null;
var currentAttachments = [];
var currentFolderId = 0;
var folders = [];
var notes = [];
var socket = null;
var DEFAULT_AVATAR_URL = 'https://api.dicebear.com/7.x/avataaars/svg?seed=default';
var expandedFolders = {};
var isPreviewMode = false;
var isViewMode = false;

// DOM 引用
var notesList = document.getElementById('notesList');
var newNoteBtn = document.getElementById('newNoteBtn');
var refreshListBtn = document.getElementById('refreshListBtn');
var editorModal = document.getElementById('editorModal');
var editorModalTitle = document.getElementById('editorModalTitle');
var closeEditorBtn = document.getElementById('closeEditorBtn');
var cancelEditorBtn = document.getElementById('cancelEditorBtn');
var saveEditorBtn = document.getElementById('saveEditorBtn');
var noteTitleInput = document.getElementById('noteTitleInput');
var noteContentInput = document.getElementById('noteContentInput');
var notePreview = document.getElementById('notePreview');
var togglePreviewBtn = document.getElementById('togglePreviewBtn');
var editorFolderSelect = document.getElementById('editorFolderSelect');
var fileInput = document.getElementById('fileInput');
var uploadArea = document.getElementById('uploadArea');
var editorAttachmentList = document.getElementById('editorAttachmentList');
var wordCount = document.getElementById('wordCount');
var infoCreatedAt = document.getElementById('infoCreatedAt');
var infoUpdatedAt = document.getElementById('infoUpdatedAt');
var infoAttachCount = document.getElementById('infoAttachCount');

var folderTree = document.getElementById('folderTree');
var newFolderBtn = document.getElementById('newFolderBtn');
var folderModal = document.getElementById('folderModal');
var folderModalTitle = document.getElementById('folderModalTitle');
var folderModalSubtitle = document.getElementById('folderModalSubtitle');
var folderNameInput = document.getElementById('folderNameInput');
var closeFolderModalBtn = document.getElementById('closeFolderModalBtn');
var cancelFolderBtn2 = document.getElementById('cancelFolderBtn2');
var saveFolderBtn = document.getElementById('saveFolderBtn');
var currentFolderTitle = document.getElementById('currentFolderTitle');

var moveNoteModal = document.getElementById('moveNoteModal');
var moveNoteInfo = document.getElementById('moveNoteInfo');
var moveFolderSelect = document.getElementById('moveFolderSelect');
var closeMoveModalBtn = document.getElementById('closeMoveModalBtn');
var cancelMoveBtn2 = document.getElementById('cancelMoveBtn2');
var confirmMoveBtn = document.getElementById('confirmMoveBtn');

var toggleAttachments = document.getElementById('toggleAttachments');
var attachmentContent = document.getElementById('attachmentContent');
var toggleIcon = document.getElementById('attachmentToggleIcon');
var isAttachmentsCollapsed = false;

var editingFolderId = null;
var creatingFolderParentId = 0;
var moveNoteId = null;

// ========== 附件折叠功能 ==========
function isMobile() {
    return window.innerWidth < 768;
}

function applyAttachmentState() {
    if (isMobile()) {
        var saved = localStorage.getItem('attachmentsCollapsed');
        if (saved === null) {
            isAttachmentsCollapsed = true;
        } else {
            isAttachmentsCollapsed = saved === 'true';
        }
    } else {
        isAttachmentsCollapsed = false;
    }
    updateAttachmentUI();
}

function updateAttachmentUI() {
    if (isAttachmentsCollapsed) {
        attachmentContent.classList.add('collapsed');
        toggleIcon.textContent = '▶';
    } else {
        attachmentContent.classList.remove('collapsed');
        toggleIcon.textContent = '▼';
    }
    localStorage.setItem('attachmentsCollapsed', isAttachmentsCollapsed);
}

// ========== Markdown 渲染 ==========
function renderMarkdown(text) {
    if (!text) return '';
    try {
        if (typeof marked !== 'undefined') {
            marked.setOptions({
                breaks: true,
                gfm: true,
                pedantic: false,
            });
            return marked.parse(text);
        } else {
            return '<pre>' + window.escapeHtml(text) + '</pre>';
        }
    } catch (e) {
        console.error('Markdown 渲染失败:', e);
        return '<pre>' + window.escapeHtml(text) + '</pre>';
    }
}

function updatePreview() {
    var raw = noteContentInput.value;
    notePreview.innerHTML = renderMarkdown(raw);
    updateWordCount();
}

function updateWordCount() {
    var text = noteContentInput.value;
    var count = text.replace(/\s/g, '').length;
    wordCount.textContent = count + ' 字';
}

function togglePreview() {
    isPreviewMode = !isPreviewMode;
    if (isPreviewMode) {
        noteContentInput.style.display = 'none';
        notePreview.style.display = 'block';
        togglePreviewBtn.textContent = '✏️ 编辑';
        updatePreview();
    } else {
        noteContentInput.style.display = 'block';
        notePreview.style.display = 'none';
        togglePreviewBtn.textContent = '👁️ 预览';
    }
}

// ========== 工具栏快捷插入 ==========
document.querySelector('.md-toolbar')?.addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var cmd = btn.dataset.cmd;
    if (!cmd) return;
    if (cmd === 'preview') {
        togglePreview();
        return;
    }
    var textarea = noteContentInput;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var val = textarea.value;
    var before = val.substring(0, start);
    var selected = val.substring(start, end);
    var after = val.substring(end);
    var newText = '';
    var cursorOffset = 0;

    switch (cmd) {
        case 'bold':
            newText = before + '**' + (selected || '粗体文字') + '**' + after;
            cursorOffset = 2;
            break;
        case 'italic':
            newText = before + '*' + (selected || '斜体文字') + '*' + after;
            cursorOffset = 1;
            break;
        case 'heading':
            newText = before + '# ' + (selected || '标题') + after;
            cursorOffset = 2;
            break;
        case 'link':
            newText = before + '[' + (selected || '链接文字') + '](url)' + after;
            cursorOffset = 1;
            break;
        case 'image':
            newText = before + '![' + (selected || '图片描述') + '](图片url)' + after;
            cursorOffset = 2;
            break;
        case 'ul':
            newText = before + '- ' + (selected || '列表项') + after;
            cursorOffset = 2;
            break;
        case 'ol':
            newText = before + '1. ' + (selected || '列表项') + after;
            cursorOffset = 3;
            break;
        case 'quote':
            newText = before + '> ' + (selected || '引用内容') + after;
            cursorOffset = 2;
            break;
        case 'code':
            newText = before + '```\n' + (selected || '代码内容') + '\n```' + after;
            cursorOffset = 4;
            break;
        default:
            return;
    }
    textarea.value = newText;
    var newPos = start + newText.length - after.length + cursorOffset;
    textarea.selectionStart = textarea.selectionEnd = newPos;
    textarea.focus();
    updatePreview();
    updateWordCount();
});

// ========== 图片粘贴和拖拽 ==========
function handleImageUpload(file, callback) {
    var formData = new FormData();
    formData.append('files', file);
    fetch('/api/notes/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (data.success && data.attachments && data.attachments.length) {
            var att = data.attachments[0];
            currentAttachments.push(att);
            renderAttachments();
            if (callback) callback(att.fileUrl);
        } else {
            alert('图片上传失败');
        }
    })
    .catch(function(err) {
        alert('图片上传失败: ' + err.message);
    });
}

// 粘贴图片
noteContentInput.addEventListener('paste', function(e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.kind === 'file' && item.type && item.type.indexOf('image/') !== -1) {
            e.preventDefault();
            var file = item.getAsFile();
            var imgText = '![' + file.name + '](uploading...)';
            var start = noteContentInput.selectionStart;
            var val = noteContentInput.value;
            noteContentInput.value = val.substring(0, start) + imgText + val.substring(start);
            noteContentInput.selectionStart = noteContentInput.selectionEnd = start + imgText.length;
            updatePreview();
            updateWordCount();
            handleImageUpload(file, function(url) {
                var newVal = noteContentInput.value;
                var pos = newVal.indexOf('uploading...)');
                if (pos !== -1) {
                    noteContentInput.value = newVal.replace('uploading...)', url + ')');
                } else {
                    noteContentInput.value = newVal.replace(/\(uploading\.\.\.\)/g, '(' + url + ')');
                }
                updatePreview();
                updateWordCount();
            });
            return;
        }
    }
});

// 拖拽上传
uploadArea.addEventListener('dragover', function(e) {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});
uploadArea.addEventListener('dragleave', function(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
});
uploadArea.addEventListener('drop', function(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    var files = e.dataTransfer.files;
    if (files.length) {
        if (files[0].type && files[0].type.indexOf('image/') !== -1) {
            var imgText = '![' + files[0].name + '](uploading...)';
            var start = noteContentInput.selectionStart;
            var val = noteContentInput.value;
            noteContentInput.value = val.substring(0, start) + imgText + val.substring(start);
            noteContentInput.selectionStart = noteContentInput.selectionEnd = start + imgText.length;
            updatePreview();
            updateWordCount();
            handleImageUpload(files[0], function(url) {
                var newVal = noteContentInput.value;
                noteContentInput.value = newVal.replace(/\(uploading\.\.\.\)/g, '(' + url + ')');
                updatePreview();
                updateWordCount();
            });
        } else {
            var formData = new FormData();
            for (var i = 0; i < files.length; i++) {
                formData.append('files', files[i]);
            }
            fetch('/api/notes/upload', {
                method: 'POST',
                credentials: 'include',
                body: formData
            })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.success) {
                    for (var j = 0; j < data.attachments.length; j++) {
                        currentAttachments.push(data.attachments[j]);
                    }
                    renderAttachments();
                    alert('成功上传 ' + data.attachments.length + ' 个附件');
                }
            });
        }
    }
});
uploadArea.addEventListener('click', function() {
    fileInput.click();
});
fileInput.addEventListener('change', function() {
    var files = Array.from(fileInput.files);
    if (!files.length) return;
    if (files.length > 50) {
        alert('单次最多上传50个文件');
        fileInput.value = '';
        return;
    }
    var formData = new FormData();
    for (var i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }
    fetch('/api/notes/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (data.success) {
            for (var j = 0; j < data.attachments.length; j++) {
                currentAttachments.push(data.attachments[j]);
            }
            renderAttachments();
            alert('成功上传 ' + data.attachments.length + ' 个附件');
        }
    });
    fileInput.value = '';
});

// ========== 加载文件夹 ==========
function loadFolders() {
    return window.apiRequest('/api/note-folders', 'GET').then(function(res) {
        if (res.success) {
            folders = res.folders;
            var newExpanded = {};
            for (var i = 0; i < folders.length; i++) {
                var fid = folders[i].id;
                if (expandedFolders[fid] !== undefined) {
                    newExpanded[fid] = expandedFolders[fid];
                } else {
                    newExpanded[fid] = true;
                }
            }
            expandedFolders = newExpanded;
            renderFolderTree();
            populateFolderSelect(editorFolderSelect);
            populateFolderSelect(moveFolderSelect);
            return folders;
        }
        return [];
    }).catch(function(err) {
        console.error('加载文件夹失败:', err);
        return [];
    });
}

function renderFolderTree() {
    var tree = buildFolderTree(folders, 0);
    var html = '<li class="active" data-folder-id="0"><span>📁 全部笔记</span></li>';
    html += renderTreeItems(tree, 0);
    folderTree.innerHTML = html;
    var items = folderTree.querySelectorAll('li[data-folder-id]');
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var fid = parseInt(item.dataset.folderId);
        if (fid === currentFolderId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    }
    if (newFolderBtn) {
        newFolderBtn.style.display = isAdmin ? 'inline-block' : 'none';
    }
}

function buildFolderTree(folderList, parentId) {
    parentId = parentId || 0;
    var children = [];
    for (var i = 0; i < folderList.length; i++) {
        if (folderList[i].parentId === parentId) {
            children.push(folderList[i]);
        }
    }
    return children;
}

function renderTreeItems(children, level) {
    var html = '';
    for (var i = 0; i < children.length; i++) {
        var f = children[i];
        var subChildren = buildFolderTree(folders, f.id);
        var hasSub = subChildren.length > 0;
        var isExpanded = expandedFolders[f.id] !== undefined ? expandedFolders[f.id] : true;
        var toggleSymbol = isExpanded ? '▼' : '▶';
        var displayStyle = isExpanded ? 'block' : 'none';
        html += '<li data-folder-id="' + f.id + '" style="padding-left:' + (level * 16 + 8) + 'px;">';
        html += '<div class="folder-item">';
        if (hasSub) {
            html += '<span class="folder-toggle" data-id="' + f.id + '">' + toggleSymbol + '</span>';
        } else {
            html += '<span class="folder-toggle-placeholder"></span>';
        }
        html += '<span class="folder-name">📁 ' + window.escapeHtml(f.name) + '</span>';
        if (isAdmin) {
            html += '<div class="folder-actions">';
            html += '<button class="add-folder" data-parent="' + f.id + '" title="新建子文件夹">+</button>';
            html += '<button class="rename-folder" data-id="' + f.id + '" data-name="' + window.escapeHtml(f.name) + '" title="重命名">✏️</button>';
            html += '<button class="delete-folder" data-id="' + f.id + '" title="删除">🗑️</button>';
            html += '</div>';
        }
        html += '</div>';
        if (hasSub) {
            html += '<ul class="sub-tree" style="display:' + displayStyle + ';">' + renderTreeItems(subChildren, level + 1) + '</ul>';
        }
        html += '</li>';
    }
    return html;
}

folderTree.addEventListener('click', function(e) {
    var target = e.target;
    if (target.tagName === 'BUTTON' || target.closest('button')) {
        if (target.classList.contains('add-folder')) {
            var parentId = parseInt(target.dataset.parent);
            openFolderModal(null, null, parentId);
            return;
        }
        if (target.classList.contains('rename-folder')) {
            var id = parseInt(target.dataset.id);
            var name = target.dataset.name;
            openFolderModal(id, name);
            return;
        }
        if (target.classList.contains('delete-folder')) {
            var id = parseInt(target.dataset.id);
            deleteFolder(id);
            return;
        }
        return;
    }
    if (target.classList.contains('folder-toggle')) {
        var fid = parseInt(target.dataset.id);
        expandedFolders[fid] = !expandedFolders[fid];
        renderFolderTree();
        return;
    }
    var li = target.closest('li[data-folder-id]');
    if (!li) return;
    var folderId = parseInt(li.dataset.folderId);
    if (folderId === currentFolderId) return;
    selectFolder(folderId);
});

function selectFolder(folderId) {
    if (currentFolderId === folderId) return;
    currentFolderId = folderId;
    if (folderId === 0) {
        currentFolderTitle.textContent = '📁 全部笔记';
    } else {
        var found = folders.find(function(f) { return f.id === folderId; });
        currentFolderTitle.textContent = '📁 ' + (found ? window.escapeHtml(found.name) : '未知文件夹');
    }
    var items = folderTree.querySelectorAll('li[data-folder-id]');
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var fid = parseInt(item.dataset.folderId);
        if (fid === folderId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    }
    loadNotes(folderId);
}

function populateFolderSelect(selectEl) {
    if (!selectEl) return;
    var html = '<option value="0">根目录（无文件夹）</option>';
    var sorted = folders.slice().sort(function(a, b) { return a.parentId - b.parentId || a.name.localeCompare(b.name); });
    for (var i = 0; i < sorted.length; i++) {
        var f = sorted[i];
        var indent = f.parentId === 0 ? '' : '— ';
        html += '<option value="' + f.id + '">' + indent + window.escapeHtml(f.name) + '</option>';
    }
    selectEl.innerHTML = html;
}

// ========== 加载笔记 ==========
function loadNotes(folderId) {
    var url = '/api/notes';
    if (folderId !== undefined) {
        url += '?folderId=' + folderId;
    } else {
        url += '?folderId=' + currentFolderId;
    }
    return window.apiRequest(url, 'GET').then(function(res) {
        if (res.success) {
            notes = res.notes;
            renderNotes(notes);
            return notes;
        } else {
            notesList.innerHTML = '<div class="note-empty">加载失败</div>';
            return [];
        }
    }).catch(function(err) {
        console.error('加载笔记失败:', err);
        notesList.innerHTML = '<div class="note-empty">加载失败</div>';
        return [];
    });
}

// ========== 渲染笔记列表 ==========
function renderNotes(notes) {
    if (!notes || notes.length === 0) {
        notesList.innerHTML = '<div class="note-empty">📝 暂无笔记</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < notes.length; i++) {
        var note = notes[i];
        var attachCount = note.attachments ? note.attachments.length : 0;
        var folderName = '';
        if (note.folderId && note.folderId > 0) {
            var f = folders.find(function(fld) { return fld.id === note.folderId; });
            if (f) folderName = '📁 ' + window.escapeHtml(f.name);
        }
        html += '<div class="note-item" data-id="' + note.id + '">';
        html += '  <div class="note-title">' + window.escapeHtml(note.title) + '</div>';
        html += '  <div class="note-meta">';
        html += '    <span>' + new Date(note.createdAt).toLocaleString() + ' by ' + window.escapeHtml(note.creatorName || '管理员') + '</span>';
        html += '    <span class="tags">';
        if (folderName) html += folderName + ' ';
        if (attachCount > 0) html += '📎 ' + attachCount;
        if (isAdmin) {
            html += ' <button class="edit-btn" data-id="' + note.id + '" style="background:none;border:1px solid #0066ff;color:#0066ff;padding:2px 12px;border-radius:12px;font-size:12px;cursor:pointer;">编辑</button>';
            html += ' <button class="delete-note" data-id="' + note.id + '" style="background:none;border:none;color:#ff4d4f;cursor:pointer;font-size:12px;">删除</button>';
            html += ' <button class="move-note" data-id="' + note.id + '" data-title="' + window.escapeHtml(note.title) + '" style="background:none;border:none;color:#0066ff;cursor:pointer;font-size:12px;">移动</button>';
        }
        html += '    </span>';
        html += '  </div>';
        html += '</div>';
    }
    notesList.innerHTML = html;
    var items = notesList.querySelectorAll('.note-item');
    for (var j = 0; j < items.length; j++) {
        items[j].addEventListener('click', function(e) {
            if (e.target.classList.contains('edit-btn') || e.target.classList.contains('delete-note') || e.target.classList.contains('move-note')) return;
            var id = parseInt(this.dataset.id);
            openNoteForRead(id);
        });
    }
    if (isAdmin) {
        var editBtns = notesList.querySelectorAll('.edit-btn');
        for (var ebt = 0; ebt < editBtns.length; ebt++) {
            editBtns[ebt].addEventListener('click', function(e) {
                e.stopPropagation();
                var id = parseInt(this.dataset.id);
                openNoteForEdit(id);
            });
        }
        var delBtns = notesList.querySelectorAll('.delete-note');
        for (var k = 0; k < delBtns.length; k++) {
            delBtns[k].addEventListener('click', function(e) {
                e.stopPropagation();
                var id = parseInt(this.dataset.id);
                if (confirm('删除笔记？')) {
                    window.apiRequest('/api/notes/' + id, 'DELETE').then(function(res) {
                        if (res.success) {
                            loadNotes();
                            loadFolders();
                        } else {
                            alert('删除失败');
                        }
                    });
                }
            });
        }
        var moveBtns = notesList.querySelectorAll('.move-note');
        for (var m = 0; m < moveBtns.length; m++) {
            moveBtns[m].addEventListener('click', function(e) {
                e.stopPropagation();
                var id = parseInt(this.dataset.id);
                var title = this.dataset.title;
                openMoveNoteModal(id, title);
            });
        }
    }
}

// ========== 阅读模式 ==========
function openNoteForRead(id) {
    var note = notes.find(function(n) { return n.id === id; });
    if (!note) return;
    isViewMode = true;
    currentEditId = note.id;
    noteTitleInput.value = note.title;
    noteTitleInput.disabled = true;
    noteContentInput.value = note.content || '';
    noteContentInput.disabled = true;
    noteContentInput.style.display = 'none';
    notePreview.style.display = 'block';
    notePreview.innerHTML = renderMarkdown(note.content || '');
    togglePreviewBtn.style.display = 'none';
    editorModalTitle.textContent = '📖 ' + note.title;
    saveEditorBtn.style.display = 'none';
    var toolbar = document.querySelector('.md-toolbar');
    if (toolbar) toolbar.style.display = 'none';

    if (isAdmin) {
        var editReadBtn = document.querySelector('.toolbar-right .edit-read-btn');
        if (!editReadBtn) {
            editReadBtn = document.createElement('button');
            editReadBtn.className = 'btn btn-primary edit-read-btn';
            editReadBtn.textContent = '✏️ 编辑';
            editReadBtn.style.marginRight = '8px';
            var right = document.querySelector('.toolbar-right');
            if (right) right.prepend(editReadBtn);
        }
        editReadBtn.style.display = 'inline-block';
        editReadBtn.onclick = function() {
            openNoteForEdit(id);
        };
    }

    currentAttachments = (note.attachments || []).map(function(att) {
        return { id: att.id, fileUrl: att.fileUrl, fileName: att.fileName, fileType: att.fileType, fileSize: att.fileSize };
    });
    renderAttachments();
    editorFolderSelect.value = note.folderId || 0;
    editorFolderSelect.disabled = true;
    infoCreatedAt.textContent = new Date(note.createdAt).toLocaleString();
    infoUpdatedAt.textContent = new Date(note.updatedAt).toLocaleString();
    infoAttachCount.textContent = currentAttachments.length;
    updateWordCount();

    if (isMobile()) {
        isAttachmentsCollapsed = true;
        updateAttachmentUI();
    }

    editorModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// ========== 编辑模式 ==========
function openNoteForEdit(id) {
    if (!isAdmin) return;
    isViewMode = false;
    var note = id ? notes.find(function(n) { return n.id === id; }) : null;
    currentEditId = id || null;
    noteTitleInput.value = note ? note.title : '';
    noteTitleInput.disabled = false;
    noteContentInput.value = note ? note.content || '' : '';
    noteContentInput.disabled = false;
    noteContentInput.style.display = 'block';
    notePreview.style.display = 'none';
    togglePreviewBtn.style.display = 'inline-block';
    editorModalTitle.textContent = note ? '✏️ 编辑笔记' : '✏️ 新建笔记';
    saveEditorBtn.style.display = 'inline-block';
    var toolbar = document.querySelector('.md-toolbar');
    if (toolbar) toolbar.style.display = 'flex';

    var editReadBtn = document.querySelector('.toolbar-right .edit-read-btn');
    if (editReadBtn) editReadBtn.style.display = 'none';

    currentAttachments = note ? (note.attachments || []).map(function(att) {
        return { id: att.id || undefined, fileUrl: att.fileUrl, fileName: att.fileName, fileType: att.fileType, fileSize: att.fileSize };
    }) : [];
    renderAttachments();
    editorFolderSelect.value = note ? (note.folderId || 0) : (currentFolderId || 0);
    editorFolderSelect.disabled = false;
    infoCreatedAt.textContent = note ? new Date(note.createdAt).toLocaleString() : '-';
    infoUpdatedAt.textContent = note ? new Date(note.updatedAt).toLocaleString() : '-';
    infoAttachCount.textContent = currentAttachments.length;
    updateWordCount();
    updatePreview();

    if (isMobile()) {
        isAttachmentsCollapsed = false;
        updateAttachmentUI();
    }

    editorModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (!note) {
        noteTitleInput.focus();
    }
}

function closeEditor() {
    editorModal.classList.remove('active');
    document.body.style.overflow = '';
    isViewMode = false;
    noteTitleInput.disabled = false;
    noteContentInput.disabled = false;
    saveEditorBtn.style.display = 'inline-block';
    togglePreviewBtn.style.display = 'inline-block';
    var toolbar = document.querySelector('.md-toolbar');
    if (toolbar) toolbar.style.display = 'flex';
    editorFolderSelect.disabled = false;
    noteContentInput.style.display = 'block';
    notePreview.style.display = 'none';
    isPreviewMode = false;
    togglePreviewBtn.textContent = '👁️ 预览';
    var editReadBtn = document.querySelector('.toolbar-right .edit-read-btn');
    if (editReadBtn) editReadBtn.style.display = 'none';
    loadNotes();
    loadFolders();
}

closeEditorBtn.addEventListener('click', closeEditor);
cancelEditorBtn.addEventListener('click', closeEditor);

// ========== 保存笔记 ==========
saveEditorBtn.addEventListener('click', function() {
    if (!isAdmin) return;
    var title = noteTitleInput.value.trim();
    if (!title) {
        alert('请输入标题');
        return;
    }
    var folderId = parseInt(editorFolderSelect.value) || 0;
    var content = noteContentInput.value;
    var attachmentsToSave = currentAttachments.map(function(att) {
        return { id: att.id || undefined, fileUrl: att.fileUrl, fileName: att.fileName, fileType: att.fileType, fileSize: att.fileSize };
    });
    var payload = {
        title: title,
        content: content,
        attachments: attachmentsToSave,
        folderId: folderId
    };
    var url = currentEditId ? '/api/notes/' + currentEditId : '/api/notes';
    var method = currentEditId ? 'PUT' : 'POST';
    window.apiRequest(url, method, payload).then(function(res) {
        if (res.success) {
            closeEditor();
        } else {
            alert(res.message || '保存失败');
        }
    }).catch(function(err) {
        alert('保存失败: ' + err.message);
    });
});

// ========== 渲染附件（修复 #11: 单一函数，无重复） ==========
function renderAttachments() {
    if (!currentAttachments || currentAttachments.length === 0) {
        editorAttachmentList.innerHTML = '<div style="color:#8590a6; font-size:13px; text-align:center; padding:12px;">暂无附件</div>';
        infoAttachCount.textContent = '0';
        return;
    }
    var html = '';
    for (var i = 0; i < currentAttachments.length; i++) {
        var att = currentAttachments[i];
        var isImage = att.fileType && att.fileType.indexOf('image/') !== -1;
        var icon = isImage ? '🖼️' : '📄';
        var previewUrl = '/api/notes/download/' + att.id + '?preview=true';
        var downloadUrl = '/api/notes/download/' + att.id;
        html += '<div class="attachment-item" data-id="' + att.id + '">';
        html += '  <span class="att-icon">' + icon + '</span>';
        html += '  <div class="att-info">';
        html += '    <div class="att-name">' + window.escapeHtml(att.fileName) + '</div>';
        html += '    <div class="att-size">' + window.formatFileSize(att.fileSize || 0) + '</div>';
        html += '  </div>';
        html += '  <div class="att-actions">';
        if (!isViewMode && isAdmin) {
            html += '    <button class="rename-attach" data-id="' + att.id + '" data-name="' + window.escapeHtml(att.fileName) + '" title="重命名">✏️</button>';
        }
        html += '    <button class="preview-attach" data-url="' + previewUrl + '" title="预览">👁️</button>';
        html += '    <button class="download-attach" data-url="' + downloadUrl + '" data-name="' + window.escapeHtml(att.fileName) + '" title="下载">⬇️</button>';
        if (!isViewMode && isAdmin) {
            html += '    <button class="delete-attach" data-id="' + att.id + '" title="删除" class="delete-btn">✕</button>';
        }
        html += '  </div>';
        html += '</div>';
    }
    editorAttachmentList.innerHTML = html;
    infoAttachCount.textContent = currentAttachments.length;

    if (!isViewMode && isAdmin) {
        document.querySelectorAll('.rename-attach').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = parseInt(this.dataset.id);
                var oldName = this.dataset.name;
                var newName = prompt('请输入新文件名', oldName);
                if (newName && newName.trim()) {
                    window.apiRequest('/api/notes/attachment/rename/' + id, 'PUT', { newFileName: newName.trim() }).then(function(res) {
                        if (res.success) {
                            var attIndex = currentAttachments.findIndex(function(a) { return a.id === id; });
                            if (attIndex !== -1) currentAttachments[attIndex].fileName = newName.trim();
                            renderAttachments();
                        } else {
                            alert(res.message);
                        }
                    });
                }
            });
        });
        document.querySelectorAll('.delete-attach').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (confirm('删除附件？')) {
                    var id = parseInt(this.dataset.id);
                    window.apiRequest('/api/notes/attachment/' + id, 'DELETE').then(function(res) {
                        if (res.success) {
                            currentAttachments = currentAttachments.filter(function(a) { return a.id !== id; });
                            renderAttachments();
                        } else {
                            alert(res.message);
                        }
                    });
                }
            });
        });
    }
    document.querySelectorAll('.preview-attach').forEach(function(btn) {
        btn.addEventListener('click', function() {
            window.open(this.dataset.url, '_blank');
        });
    });
    document.querySelectorAll('.download-attach').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var a = document.createElement('a');
            a.href = this.dataset.url;
            a.download = this.dataset.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    });
}

// ========== 新建笔记 ==========
newNoteBtn.addEventListener('click', function() {
    if (!isAdmin) return;
    openNoteForEdit(null);
});

refreshListBtn.addEventListener('click', function() {
    loadNotes();
});

// ========== 文件夹操作 ==========
newFolderBtn.addEventListener('click', function() {
    if (!isAdmin) return;
    openFolderModal(null, null, 0);
});

function openFolderModal(id, name, parentId) {
    editingFolderId = id;
    creatingFolderParentId = parentId !== undefined ? parentId : 0;
    if (id === null) {
        folderModalTitle.textContent = '📂 新建文件夹';
        var parentName = '根目录';
        if (creatingFolderParentId !== 0) {
            var parent = folders.find(function(f) { return f.id === creatingFolderParentId; });
            if (parent) parentName = parent.name;
        }
        folderModalSubtitle.textContent = '在 “' + window.escapeHtml(parentName) + '” 下创建';
        folderNameInput.value = '';
    } else {
        folderModalTitle.textContent = '✏️ 重命名文件夹';
        folderModalSubtitle.textContent = '';
        folderNameInput.value = name;
    }
    folderModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    folderNameInput.focus();
    folderNameInput.select();
}

function closeFolderModal() {
    folderModal.classList.remove('active');
    document.body.style.overflow = '';
}
closeFolderModalBtn.addEventListener('click', closeFolderModal);
cancelFolderBtn2.addEventListener('click', closeFolderModal);

saveFolderBtn.addEventListener('click', function() {
    var name = folderNameInput.value.trim();
    if (!name) {
        alert('请输入名称');
        return;
    }
    if (name.length > 50) {
        alert('名称不能超过50个字符');
        return;
    }
    if (editingFolderId === null) {
        var parentId = creatingFolderParentId;
        window.apiRequest('/api/note-folders', 'POST', { name: name, parentId: parentId }).then(function(res) {
            if (res.success) {
                closeFolderModal();
                loadFolders().then(function() {
                    selectFolder(res.folder.id);
                });
            } else {
                alert(res.message);
            }
        });
    } else {
        window.apiRequest('/api/note-folders/' + editingFolderId, 'PUT', { name: name }).then(function(res) {
            if (res.success) {
                closeFolderModal();
                loadFolders().then(function() {
                    selectFolder(currentFolderId);
                });
            } else {
                alert(res.message);
            }
        });
    }
});

function deleteFolder(id) {
    if (!confirm('确定删除该文件夹及其所有笔记和子文件夹吗？不可恢复！')) return;
    window.apiRequest('/api/note-folders/' + id, 'DELETE').then(function(res) {
        if (res.success) {
            loadFolders().then(function() {
                if (currentFolderId === id) {
                    selectFolder(0);
                } else {
                    loadNotes();
                }
            });
        } else {
            alert(res.message);
        }
    });
}

// ========== 移动笔记 ==========
function openMoveNoteModal(id, title) {
    moveNoteId = id;
    moveNoteInfo.textContent = '移动笔记: "' + title + '"';
    populateFolderSelect(moveFolderSelect);
    var current = notes.find(function(n) { return n.id === id; });
    if (current && current.folderId !== undefined) {
        moveFolderSelect.value = current.folderId;
    } else {
        moveFolderSelect.value = 0;
    }
    moveNoteModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeMoveNoteModal() {
    moveNoteModal.classList.remove('active');
    document.body.style.overflow = '';
}
closeMoveModalBtn.addEventListener('click', closeMoveNoteModal);
cancelMoveBtn2.addEventListener('click', closeMoveNoteModal);

confirmMoveBtn.addEventListener('click', function() {
    if (!isAdmin) return;
    var folderId = parseInt(moveFolderSelect.value) || 0;
    window.apiRequest('/api/notes/' + moveNoteId + '/move', 'PUT', { folderId: folderId }).then(function(res) {
        if (res.success) {
            closeMoveNoteModal();
            loadNotes();
            loadFolders();
        } else {
            alert(res.message);
        }
    });
});

// ========== 附件折叠事件绑定 ==========
if (toggleAttachments) {
    toggleAttachments.addEventListener('click', function(e) {
        if (e.target.closest('button')) return;
        if (!isMobile()) return;
        isAttachmentsCollapsed = !isAttachmentsCollapsed;
        updateAttachmentUI();
    });
}

window.addEventListener('resize', function() {
    var wasMobile = isMobile();
    if (!wasMobile && attachmentContent.classList.contains('collapsed')) {
        isAttachmentsCollapsed = false;
        updateAttachmentUI();
    } else if (wasMobile && !attachmentContent.classList.contains('collapsed') && localStorage.getItem('attachmentsCollapsed') === null) {
        isAttachmentsCollapsed = true;
        updateAttachmentUI();
    }
});

// ========== Socket ==========
function initSocket() {
    socket = io({ withCredentials: true });
    window.socket = socket;
    socket.on('connect', function() {
        socket.emit('update status', 'notes');
        // 心跳由 common.js 自动处理
    });
    socket.on('online users status', function(users) {
        // 无在线列表，忽略
    });
    socket.on('kicked', function(reason) {
        alert(reason);
        window.location.href = '/';
    });
}

// ========== 初始化 ==========
(function init() {
    fetch('/api/me', { credentials: 'include' })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (!data.success) {
                window.location.href = '/';
                return;
            }
            currentUser = data.user;
            isAdmin = currentUser.role === 'admin';
            if (isAdmin) {
                newNoteBtn.classList.remove('hidden');
                newFolderBtn.classList.remove('hidden');
            }
            initSocket();
            applyAttachmentState();
            loadFolders().then(function() {
                return loadNotes(0);
            }).then(function() {
                selectFolder(0);
            });
        })
        .catch(function(err) {
            console.error('初始化失败:', err);
            window.location.href = '/';
        });
})();