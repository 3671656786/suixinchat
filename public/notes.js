// public/notes.js
(function ensureGlobals() {
    if (typeof window.escapeHtml !== 'function') {
        window.escapeHtml = function(text) {
            if (!text) return '';
            var e = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
            return text.replace(/[&<>"']/g, function(m) { return e[m]; });
        };
    }
    if (typeof window.apiRequest !== 'function') {
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
var isSelecting = false; // 防止重复点击

// DOM 引用
var notesList = document.getElementById('notesList');
var newNoteBtn = document.getElementById('newNoteBtn');
var noteModal = document.getElementById('noteModal');
var modalTitle = document.getElementById('modalTitle');
var noteTitle = document.getElementById('noteTitle');
var noteContent = document.getElementById('noteContent');
var noteFolderSelect = document.getElementById('noteFolderSelect');
var noteAttachments = document.getElementById('noteAttachments');
var attachmentsList = document.getElementById('attachmentsList');
var closeNoteBtn = document.getElementById('closeNoteBtn');
var closeNoteBtn2 = document.getElementById('closeNoteBtn2');
var saveNoteBtn = document.getElementById('saveNoteBtn');
var folderTree = document.getElementById('folderTree');
var newFolderBtn = document.getElementById('newFolderBtn');
var folderModal = document.getElementById('folderModal');
var folderModalTitle = document.getElementById('folderModalTitle');
var folderModalSubtitle = document.getElementById('folderModalSubtitle');
var folderNameInput = document.getElementById('folderNameInput');
var cancelFolderBtn = document.getElementById('cancelFolderBtn');
var cancelFolderBtn2 = document.getElementById('cancelFolderBtn2');
var saveFolderBtn = document.getElementById('saveFolderBtn');
var currentFolderTitle = document.getElementById('currentFolderTitle');
var moveNoteModal = document.getElementById('moveNoteModal');
var moveNoteInfo = document.getElementById('moveNoteInfo');
var moveFolderSelect = document.getElementById('moveFolderSelect');
var cancelMoveNoteBtn = document.getElementById('cancelMoveNoteBtn');
var cancelMoveNoteBtn2 = document.getElementById('cancelMoveNoteBtn2');
var confirmMoveNoteBtn = document.getElementById('confirmMoveNoteBtn');

var editingFolderId = null;
var creatingFolderParentId = 0;
var moveNoteId = null;

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
            return folders;
        }
        return [];
    }).catch(function(err) {
        console.error('加载文件夹失败:', err);
        return [];
    });
}

// ========== 渲染文件夹树 ==========
function renderFolderTree() {
    var tree = buildFolderTree(folders, 0);
    var html = '<li class="active" data-folder-id="0"><span>📁 全部笔记</span></li>';
    html += renderTreeItems(tree, 0);
    folderTree.innerHTML = html;
    // 高亮当前选中的文件夹
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
    populateFolderSelect(noteFolderSelect);
    populateFolderSelect(moveFolderSelect);
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
            html += '<button class="add-folder" data-parent="' + f.id + '" title="新建子文件夹">➕</button>';
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

// ========== 使用事件委托处理所有点击 ==========
folderTree.addEventListener('click', function(e) {
    var target = e.target;
    
    // 1. 处理按钮点击（完全阻止冒泡）
    if (target.tagName === 'BUTTON' || target.closest('button')) {
        e.stopPropagation();
        e.preventDefault();
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
    
    // 2. 处理 toggle 点击（阻止冒泡）
    if (target.classList.contains('folder-toggle')) {
        e.stopPropagation();
        e.preventDefault();
        var fid = parseInt(target.dataset.id);
        expandedFolders[fid] = !expandedFolders[fid];
        renderFolderTree();
        return;
    }
    
    // 3. 处理文件夹点击 - 找到最近的 li[data-folder-id]
    var li = target.closest('li[data-folder-id]');
    if (!li) return;
    
    // 阻止冒泡到父级 li，防止触发两次
    e.stopPropagation();
    e.preventDefault();
    
    var folderId = parseInt(li.dataset.folderId);
    // 如果点击的是已经选中的文件夹，刷新笔记列表
    if (folderId === currentFolderId) {
        loadNotes(folderId);
        return;
    }
    selectFolder(folderId);
});

// ========== 选择文件夹 ==========
function selectFolder(folderId) {
    if (isSelecting) return;
    isSelecting = true;
    
    if (folderId === currentFolderId) {
        isSelecting = false;
        return;
    }
    
    currentFolderId = folderId;
    updateFolderTitleAndHighlight();
    loadNotes(folderId);
    
    setTimeout(function() {
        isSelecting = false;
    }, 100);
}

// 更新标题和高亮
function updateFolderTitleAndHighlight() {
    if (currentFolderId === 0) {
        currentFolderTitle.textContent = '📁 全部笔记';
    } else {
        var found = folders.find(function(f) { return f.id === currentFolderId; });
        currentFolderTitle.textContent = '📁 ' + (found ? window.escapeHtml(found.name) : '未知文件夹');
    }
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
        html += '    <span>';
        if (folderName) html += folderName + ' ';
        if (attachCount > 0) html += '📎 ' + attachCount;
        if (isAdmin) {
            html += ' <button class="delete-note" data-id="' + note.id + '" style="background:none;border:none;color:var(--danger);cursor:pointer;">删除</button>';
            html += ' <button class="move-note" data-id="' + note.id + '" data-title="' + window.escapeHtml(note.title) + '" style="background:none;border:none;color:var(--primary);cursor:pointer;">📂 移动</button>';
        }
        html += '    </span>';
        html += '  </div>';
        html += '</div>';
    }
    notesList.innerHTML = html;
    var items = notesList.querySelectorAll('.note-item');
    for (var j = 0; j < items.length; j++) {
        items[j].addEventListener('click', function(e) {
            if (e.target.classList.contains('delete-note') || e.target.classList.contains('move-note')) return;
            var id = parseInt(this.dataset.id);
            openNote(id);
        });
    }
    if (isAdmin) {
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

// ========== 打开笔记 ==========
function openNote(id) {
    var note = notes.find(function(n) { return n.id === id; });
    if (!note) return;
    currentEditId = note.id;
    noteTitle.value = note.title;
    noteContent.value = note.content || '';
    currentAttachments = (note.attachments || []).map(function(att) {
        return { id: att.id, fileUrl: att.fileUrl, fileName: att.fileName, fileType: att.fileType, fileSize: att.fileSize };
    });
    renderAttachments(currentAttachments);
    noteAttachments.value = '';
    noteFolderSelect.value = note.folderId || 0;

    var isEditable = isAdmin;
    modalTitle.innerText = isEditable ? '✏️ 编辑笔记' : '📖 查看笔记';
    noteTitle.disabled = !isEditable;
    noteContent.disabled = !isEditable;
    noteFolderSelect.disabled = !isEditable;
    noteAttachments.style.display = isEditable ? 'block' : 'none';
    saveNoteBtn.style.display = isEditable ? 'inline-block' : 'none';
    var renameBtns = document.querySelectorAll('.rename-attach');
    var deleteBtns = document.querySelectorAll('.delete-attach');
    for (var i = 0; i < renameBtns.length; i++) {
        renameBtns[i].style.display = isEditable ? 'inline-block' : 'none';
    }
    for (var j = 0; j < deleteBtns.length; j++) {
        deleteBtns[j].style.display = isEditable ? 'inline-block' : 'none';
    }
    noteModal.style.display = 'flex';
}

// ========== 渲染附件 ==========
function renderAttachments(attachments) {
    if (!attachments || attachments.length === 0) {
        attachmentsList.innerHTML = '<div style="color:#999; text-align:center; padding:12px;">暂无附件</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < attachments.length; i++) {
        var att = attachments[i];
        var previewUrl = '/api/notes/download/' + att.id + '?preview=true';
        var downloadUrl = '/api/notes/download/' + att.id;
        html += '<div class="attachment-item" data-id="' + att.id + '">';
        html += '  <span>📎 ' + window.escapeHtml(att.fileName) + ' (' + window.formatFileSize(att.fileSize || 0) + ')</span>';
        html += '  <div class="attachment-actions">';
        if (isAdmin) {
            html += '    <button class="rename-attach" data-id="' + att.id + '" data-name="' + window.escapeHtml(att.fileName) + '">重命名</button>';
        }
        html += '    <button class="preview-attach" data-url="' + previewUrl + '">预览</button>';
        html += '    <button class="download-attach" data-url="' + downloadUrl + '" data-name="' + window.escapeHtml(att.fileName) + '">下载</button>';
        if (isAdmin) {
            html += '    <button class="delete-attach" data-id="' + att.id + '">删除</button>';
        }
        html += '  </div>';
        html += '</div>';
    }
    attachmentsList.innerHTML = html;

    if (isAdmin) {
        var renameBtns = attachmentsList.querySelectorAll('.rename-attach');
        for (var r = 0; r < renameBtns.length; r++) {
            renameBtns[r].addEventListener('click', function() {
                var id = parseInt(this.dataset.id);
                var oldName = this.dataset.name;
                var newName = prompt('请输入新文件名', oldName);
                if (newName && newName.trim()) {
                    window.apiRequest('/api/notes/attachment/rename/' + id, 'PUT', { newFileName: newName.trim() }).then(function(res) {
                        if (res.success) {
                            var attIndex = currentAttachments.findIndex(function(a) { return a.id === id; });
                            if (attIndex !== -1) currentAttachments[attIndex].fileName = newName.trim();
                            renderAttachments(currentAttachments);
                        } else {
                            alert(res.message);
                        }
                    });
                }
            });
        }
        var deleteBtns = attachmentsList.querySelectorAll('.delete-attach');
        for (var d = 0; d < deleteBtns.length; d++) {
            deleteBtns[d].addEventListener('click', function() {
                if (confirm('删除附件？')) {
                    var id = parseInt(this.dataset.id);
                    window.apiRequest('/api/notes/attachment/' + id, 'DELETE').then(function(res) {
                        if (res.success) {
                            currentAttachments = currentAttachments.filter(function(a) { return a.id !== id; });
                            renderAttachments(currentAttachments);
                        } else {
                            alert(res.message);
                        }
                    });
                }
            });
        }
    }
    var previewBtns = attachmentsList.querySelectorAll('.preview-attach');
    for (var p = 0; p < previewBtns.length; p++) {
        previewBtns[p].addEventListener('click', function() {
            window.open(this.dataset.url, '_blank');
        });
    }
    var downloadBtns = attachmentsList.querySelectorAll('.download-attach');
    for (var dl = 0; dl < downloadBtns.length; dl++) {
        downloadBtns[dl].addEventListener('click', function() {
            var a = document.createElement('a');
            a.href = this.dataset.url;
            a.download = this.dataset.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    }
}

// ========== 新建笔记 ==========
newNoteBtn.addEventListener('click', function() {
    if (!isAdmin) return;
    currentEditId = null;
    noteTitle.value = '';
    noteContent.value = '';
    currentAttachments = [];
    renderAttachments(currentAttachments);
    noteAttachments.value = '';
    noteFolderSelect.value = currentFolderId === 0 ? 0 : currentFolderId;
    modalTitle.innerText = '✏️ 新建笔记';
    noteTitle.disabled = false;
    noteContent.disabled = false;
    noteFolderSelect.disabled = false;
    noteAttachments.style.display = 'block';
    saveNoteBtn.style.display = 'inline-block';
    noteModal.style.display = 'flex';
});

// ========== 保存笔记 ==========
saveNoteBtn.addEventListener('click', function() {
    if (!isAdmin) return;
    var title = noteTitle.value.trim();
    if (!title) {
        alert('请输入标题');
        return;
    }
    var folderId = parseInt(noteFolderSelect.value) || 0;
    var attachmentsToSave = currentAttachments.map(function(att) {
        return { id: att.id || undefined, fileUrl: att.fileUrl, fileName: att.fileName, fileType: att.fileType, fileSize: att.fileSize };
    });
    var payload = {
        title: title,
        content: noteContent.value,
        attachments: attachmentsToSave,
        folderId: folderId
    };
    var url = currentEditId ? '/api/notes/' + currentEditId : '/api/notes';
    var method = currentEditId ? 'PUT' : 'POST';
    window.apiRequest(url, method, payload).then(function(res) {
        if (res.success) {
            noteModal.style.display = 'none';
            loadNotes();
            loadFolders();
        } else {
            alert(res.message || '保存失败');
        }
    }).catch(function(err) {
        alert('保存失败: ' + err.message);
    });
});

// ========== 关闭笔记模态框 ==========
function closeNoteModal() {
    noteModal.style.display = 'none';
}
closeNoteBtn.addEventListener('click', closeNoteModal);
closeNoteBtn2.addEventListener('click', closeNoteModal);

// ========== 上传附件 ==========
var MAX_ATTACHMENTS_PER_UPLOAD = 50;
noteAttachments.addEventListener('change', function(e) {
    if (!isAdmin) {
        alert('仅管理员可上传附件');
        noteAttachments.value = '';
        return;
    }
    var files = Array.from(e.target.files);
    if (files.length === 0) {
        noteAttachments.value = '';
        return;
    }
    if (files.length > MAX_ATTACHMENTS_PER_UPLOAD) {
        alert('单次最多上传 ' + MAX_ATTACHMENTS_PER_UPLOAD + ' 个附件，您选择了 ' + files.length + ' 个，请分批上传。');
        noteAttachments.value = '';
        return;
    }
    var formData = new FormData();
    for (var i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }
    var uploadMsg = document.createElement('div');
    uploadMsg.style.cssText = 'color:var(--primary); font-size:13px; margin-top:6px;';
    uploadMsg.textContent = '⏳ 正在上传 ' + files.length + ' 个附件...';
    var parent = noteAttachments.parentNode;
    parent.appendChild(uploadMsg);

    fetch('/api/notes/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData
    })
    .then(function(response) { return response.json(); })
    .then(function(res) {
        if (uploadMsg.parentNode) uploadMsg.parentNode.removeChild(uploadMsg);
        if (res.success) {
            for (var j = 0; j < res.attachments.length; j++) {
                currentAttachments.push(res.attachments[j]);
            }
            renderAttachments(currentAttachments);
            alert('成功上传 ' + res.attachments.length + ' 个附件');
        } else {
            alert('上传失败: ' + (res.message || '未知错误'));
        }
        noteAttachments.value = '';
    })
    .catch(function(err) {
        if (uploadMsg.parentNode) uploadMsg.parentNode.removeChild(uploadMsg);
        alert('上传失败: ' + err.message);
        noteAttachments.value = '';
    });
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
    folderModal.style.display = 'flex';
    folderNameInput.focus();
    folderNameInput.select();
}

function closeFolderModal() {
    folderModal.style.display = 'none';
}
cancelFolderBtn.addEventListener('click', closeFolderModal);
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

// ========== 移动笔记模态框 ==========
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
    moveNoteModal.style.display = 'flex';
}

function closeMoveNoteModal() {
    moveNoteModal.style.display = 'none';
}
cancelMoveNoteBtn.addEventListener('click', closeMoveNoteModal);
cancelMoveNoteBtn2.addEventListener('click', closeMoveNoteModal);

confirmMoveNoteBtn.addEventListener('click', function() {
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

// ========== 填充文件夹下拉 ==========
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

// ========== Socket ==========
function initSocket() {
    socket = io({ withCredentials: true });
    window.socket = socket;
    socket.on('connect', function() {
        socket.emit('update status', 'notes');
    });
    socket.on('online users status', function(users) {
        var container = document.getElementById('onlineList');
        var countSpan = document.getElementById('onlineCount');
        if (!container) return;
        container.innerHTML = '';
        countSpan.innerText = users.length;
        for (var i = 0; i < users.length; i++) {
            var u = users[i];
            var div = document.createElement('div');
            div.className = 'online-user';
            var statusIcon = u.status === 'chat' ? '💬' : (u.status === 'files' ? '📁' : '📝');
            var av = u.avatarUrl || DEFAULT_AVATAR_URL;
            div.innerHTML = '<img src="' + window.escapeHtml(av) + '"><span>' + window.escapeHtml(u.username) + ' ' + statusIcon + '</span>';
            container.appendChild(div);
        }
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