// public/chat.js - 完整版（含滚动优化）
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
})();

var socket, currentUser, replyToMsg = null;
var historyLoaded = false, isLoadingMore = false, hasMoreHistory = true, oldestMessageId = null;
var PAGE_SIZE = 20;
var currentPrivateTarget = null, unreadCounts = {};
var currentGroupId = 0, myGroups = [];
var D = 'https://api.dicebear.com/7.x/avataaars/svg?seed=default';
var isAdmin = false;
var currentGroupSettings = {};

var $ = function(id) { return document.getElementById(id); };
var messagesArea = $('messagesArea');
var messageInput = $('messageInput');
var sendBtn = $('sendBtn');
var fileBtn = $('fileBtn');
var fileInput = $('fileInput');
var onlineList = $('onlineList');
var onlineCount = $('onlineCount');
var emojiBtn = $('emojiBtn');
var emojiPanel = $('emojiPanel');
var replyBar = $('replyBar');
var replyContent = $('replyContent');
var cancelReplyBtn = $('cancelReplyBtn');
var searchBtn = $('searchBtn');
var searchModal = $('searchModal');
var privateChatWindow = $('privateChatWindow');
var privateMessagesArea = $('privateMessagesArea');
var privateInput = $('privateInput');
var sendPrivateBtn = $('sendPrivateBtn');
var privateChatListBtn = $('privateChatListBtn');
var currentChatTitle = $('currentChatTitle');
var groupList = $('groupList');
var createGroupBtn = $('createGroupBtn');
var discoverGroupsBtn = $('discoverGroupsBtn');
var groupMembersBtn = $('groupMembersBtn');
var createGroupModal = $('createGroupModal');
var discoverGroupsModal = $('discoverGroupsModal');
var groupMembersModal = $('groupMembersModal');

// ========== 群设置相关 ==========
function createGroupSettingsModal() {
    var modal = document.createElement('div');
    modal.id = 'groupSettingsModal';
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:500px;">
            <div class="modal-header">
                <h3>⚙️ 群设置</h3>
                <button class="close-btn" id="closeGroupSettingsBtn2">&times;</button>
            </div>
            <form id="groupSettingsForm">
                <div class="field-group">
                    <label>群名称</label>
                    <input type="text" id="settingsGroupName" maxlength="20" placeholder="群名称">
                </div>
                <div class="field-group">
                    <label>群简介</label>
                    <input type="text" id="settingsGroupDesc" maxlength="100" placeholder="群简介">
                </div>
                <div class="field-group">
                    <label>群头像 URL</label>
                    <input type="text" id="settingsGroupAvatar" placeholder="群头像图片URL">
                </div>
                <div class="field-group">
                    <label><input type="checkbox" id="settingsJoinApproval"> 需要审批才能加入</label>
                </div>
                <div class="field-group">
                    <label><input type="checkbox" id="settingsAllowJoin" checked> 允许用户加入</label>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn-secondary" id="closeGroupSettingsBtn">取消</button>
                    <button type="submit" class="btn-primary">💾 保存设置</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function createJoinRequestModal() {
    var modal = document.createElement('div');
    modal.id = 'joinRequestModal';
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:480px;">
            <div class="modal-header">
                <h3>📋 加入群申请</h3>
                <button class="close-btn" id="closeRequestModalBtn">&times;</button>
            </div>
            <div id="requestList"></div>
            <div class="modal-footer">
                <button class="btn-secondary" id="closeRequestModalBtn2">关闭</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function createApplyJoinModal() {
    var modal = document.createElement('div');
    modal.id = 'applyJoinModal';
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:450px;">
            <div class="modal-header">
                <h3>📝 申请加入群</h3>
                <button class="close-btn" id="closeApplyModalBtn">&times;</button>
            </div>
            <div id="applyGroupInfo" style="margin-bottom:12px;color:#555;"></div>
            <div class="field-group">
                <label>申请理由</label>
                <textarea id="applyReason" rows="3" placeholder="请输入申请理由（可选）" maxlength="200"></textarea>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" id="cancelApplyBtn">取消</button>
                <button class="btn-primary" id="submitApplyBtn">📤 提交申请</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function createInviteUserModal() {
    var modal = document.createElement('div');
    modal.id = 'inviteUserModal';
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:450px;">
            <div class="modal-header">
                <h3>📤 邀请用户</h3>
                <button class="close-btn" id="closeInviteModalBtn">&times;</button>
            </div>
            <div class="field-group">
                <label>选择用户</label>
                <select id="inviteUserSelect" style="width:100%;padding:10px;border-radius:14px;border:1px solid #ddd;"></select>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" id="cancelInviteBtn">取消</button>
                <button class="btn-primary" id="submitInviteBtn">📤 邀请</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

var groupSettingsModal = document.getElementById('groupSettingsModal') || createGroupSettingsModal();
var joinRequestModal = document.getElementById('joinRequestModal') || createJoinRequestModal();
var applyJoinModal = document.getElementById('applyJoinModal') || createApplyJoinModal();
var inviteUserModal = document.getElementById('inviteUserModal') || createInviteUserModal();

// ========== 辅助函数 ==========
function ft(ts) {
    var d = new Date(ts), n = new Date(), df = n - d;
    if (df < 60000) return '刚刚';
    if (df < 3600000) return Math.floor(df / 60000) + '分钟前';
    if (df < 86400000) return Math.floor(df / 3600000) + '小时前';
    return d.toLocaleDateString();
}

function debounce(f, w) { var t; return function() { var a = arguments; clearTimeout(t); t = setTimeout(function() { f.apply(this, a); }, w); }; }

function inView(el) {
    var r = el.getBoundingClientRect();
    var cr = messagesArea.getBoundingClientRect();
    return r.top >= cr.top && r.bottom <= cr.bottom;
}

function sendReads() {
    var msgs = document.querySelectorAll('.message');
    for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        if (inView(m) && m.dataset.id) {
            socket && socket.emit('mark messages read', [m.dataset.id]);
        }
    }
}
messagesArea.addEventListener('scroll', debounce(sendReads, 500));

function sysMsg(t) {
    var d = document.createElement('div');
    d.className = 'system-message';
    d.innerHTML = t;
    messagesArea.appendChild(d);
    // 系统消息也滚动到底部
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// ========== 消息渲染函数 ==========
function appendMessage(msg, prepend) {
    var d = document.createElement('div');
    d.className = 'message ' + (currentUser && msg.userId === currentUser.userId ? 'message-right' : 'message-left');
    d.dataset.id = msg.id;
    var a = document.createElement('img');
    a.src = msg.avatarUrl || D;
    a.className = 'message-avatar';
    a.onerror = function() { a.src = D; };
    var b = document.createElement('div');
    b.className = 'message-bubble';
    if (currentUser && msg.userId !== currentUser.userId) {
        var n = document.createElement('div');
        n.className = 'message-name';
        n.innerText = msg.username;
        b.appendChild(n);
    }
    if (msg.replyTo || (msg.replyToUsername && msg.replyToContent)) {
        var rd = document.createElement('div');
        rd.style.cssText = 'font-size:12px;color:#999;margin-bottom:4px;padding:4px 8px;background:#f0f0f0;border-radius:8px;';
        rd.innerHTML = '<span style="color:var(--primary);">' + window.escapeHtml(msg.replyTo ? msg.replyTo.username : msg.replyToUsername) + '</span>: ' + window.escapeHtml((msg.replyTo ? msg.replyTo.content : msg.replyToContent || '').substring(0, 50));
        b.appendChild(rd);
    }
    if (msg.content) {
        var t = document.createElement('div');
        t.className = 'message-text';
        t.innerHTML = window.escapeHtml(msg.content);
        b.appendChild(t);
    }
    if (msg.fileUrl) {
        var fd = document.createElement('div');
        fd.className = 'file-message';
        var fn = msg.fileName || '文件', ftype = msg.fileType || '', pa = document.createElement('div');
        if (ftype.startsWith('image/')) {
            var img = document.createElement('img');
            img.src = msg.fileUrl;
            img.style.cssText = 'max-width:200px;max-height:150px;border-radius:8px;cursor:pointer';
            img.onclick = function() { window.open(msg.fileUrl, '_blank'); };
            pa.appendChild(img);
        } else if (ftype.startsWith('video/')) {
            var v = document.createElement('video');
            v.src = msg.fileUrl;
            v.controls = true;
            v.style.cssText = 'max-width:200px;max-height:150px';
            pa.appendChild(v);
        } else {
            var l = document.createElement('a');
            l.href = msg.fileUrl;
            l.textContent = '📄 预览';
            l.target = '_blank';
            l.style.cssText = 'display:inline-block;margin:4px 0';
            pa.appendChild(l);
        }
        fd.appendChild(pa);
        var ad = document.createElement('div');
        ad.className = 'file-actions';
        var ns = document.createElement('span');
        ns.innerText = fn;
        ns.style.cssText = 'font-size:12px;color:#666;margin-right:8px';
        ad.appendChild(ns);
        var pb = document.createElement('button');
        pb.textContent = '预览';
        pb.onclick = function(e) { e.stopPropagation(); window.open(msg.fileUrl, '_blank'); };
        var dbBtn = document.createElement('button');
        dbBtn.textContent = '下载';
        dbBtn.onclick = function(e) { e.stopPropagation(); var a2 = document.createElement('a'); a2.href = msg.fileUrl; a2.download = fn; document.body.appendChild(a2); a2.click(); document.body.removeChild(a2); };
        ad.appendChild(pb);
        ad.appendChild(dbBtn);
        fd.appendChild(ad);
        b.appendChild(fd);
    }
    var ts = document.createElement('div');
    ts.className = 'message-time';
    ts.innerText = ft(msg.timestamp);
    b.appendChild(ts);
    if (currentUser && (currentUser.userId === msg.userId || currentUser.role === 'admin')) {
        var rb = document.createElement('button');
        rb.innerText = '撤回';
        rb.className = 'recall-btn';
        rb.onclick = function(e) {
            e.stopPropagation();
            if (currentGroupId === 0) {
                socket.emit('recall message', msg.id);
            } else {
                socket.emit('recall group message', { groupId: currentGroupId, messageId: msg.id });
            }
        };
        b.appendChild(rb);
    }
    b.style.cursor = 'pointer';
    b.onclick = function() {
        if (msg.content) {
            replyToMsg = { id: msg.id, username: msg.username, content: msg.content };
            replyContent.innerText = '回复 ' + msg.username + ': ' + msg.content.substring(0, 50);
            replyBar.classList.remove('hidden');
        }
    };
    d.appendChild(a);
    d.appendChild(b);
    if (prepend) {
        var ld = $('loadingMore');
        if (ld) messagesArea.insertBefore(d, ld.nextSibling);
        else messagesArea.prepend(d);
    } else {
        messagesArea.appendChild(d);
        // 新消息滚动到底部
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }
}

// ========== 渲染消息列表（修复：滚动到底部） ==========
function renderMessages(msgs) {
    messagesArea.innerHTML = '<div id="loadingMore">⏳ 加载更早消息...</div>';
    for (var i = 0; i < msgs.length; i++) {
        appendMessage(msgs[i]);
    }
    var ld = $('loadingMore');
    if (ld) ld.style.display = 'none';
    // 加载完成后滚动到底部（最新消息）
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// ========== 加载历史消息（保持滚动位置） ==========
async function loadMore() {
    if (isLoadingMore || !hasMoreHistory) return;
    var fm = document.querySelector('.message');
    if (!fm) { hasMoreHistory = false; return; }
    oldestMessageId = fm.dataset.id;
    if (!oldestMessageId) return;
    isLoadingMore = true;
    var ld = $('loadingMore');
    if (ld) ld.style.display = 'block';
    try {
        var url = currentGroupId === 0 ? '/api/messages?limit=' + PAGE_SIZE + '&before=' + oldestMessageId : '/api/groups/' + currentGroupId + '/messages?limit=' + PAGE_SIZE + '&before=' + oldestMessageId;
        var r = await fetch(url, { credentials: 'include' });
        var d = await r.json();
        if (d.success && d.messages && d.messages.length) {
            var oH = messagesArea.scrollHeight, oT = messagesArea.scrollTop;
            for (var i = d.messages.length - 1; i >= 0; i--) {
                appendMessage(d.messages[i], true);
            }
            // 保持滚动位置
            messagesArea.scrollTop = oT + (messagesArea.scrollHeight - oH);
            var nf = document.querySelector('.message');
            if (nf) oldestMessageId = nf.dataset.id;
            hasMoreHistory = d.messages.length === PAGE_SIZE;
        } else {
            hasMoreHistory = false;
        }
    } catch (e) { console.error(e); }
    isLoadingMore = false;
    if (ld) ld.style.display = 'none';
}
messagesArea.addEventListener('scroll', function() {
    if (messagesArea.scrollTop === 0 && !isLoadingMore && hasMoreHistory) loadMore();
});

// ========== 加载历史（修复：滚动到底部） ==========
async function loadHistory() {
    try {
        var url = currentGroupId === 0 ? '/api/messages?limit=50' : '/api/groups/' + currentGroupId + '/messages?limit=50';
        var r = await fetch(url, { credentials: 'include' });
        var d = await r.json();
        if (d.success && d.messages) {
            renderMessages(d.messages);
            historyLoaded = true;
            hasMoreHistory = d.messages.length === 50;
            sendReads();
            // 滚动到底部
            messagesArea.scrollTop = messagesArea.scrollHeight;
        }
    } catch (e) { console.error(e); }
}

// ========== 发送消息 ==========
function sendMsg() {
    var c = messageInput.value.trim();
    if (!c && !replyToMsg) return;
    if (currentGroupId === 0) {
        socket.emit('chat message', c, replyToMsg ? replyToMsg.id : null);
    } else {
        socket.emit('group message', { groupId: currentGroupId, content: c, replyToId: replyToMsg ? replyToMsg.id : null });
    }
    messageInput.value = '';
    if (replyToMsg) { replyToMsg = null; replyBar.classList.add('hidden'); }
    messageInput.focus();
}
sendBtn.onclick = sendMsg;
messageInput.onkeypress = function(e) { if (e.key === 'Enter') sendMsg(); };
cancelReplyBtn.onclick = function() { replyToMsg = null; replyBar.classList.add('hidden'); };

// ========== 发送文件 ==========
async function sendFile(f) {
    var fd = new FormData();
    fd.append('file', f);
    try {
        var r = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: fd });
        var d = await r.json();
        if (d.success) {
            if (currentGroupId === 0) {
                socket.emit('file message', { fileUrl: d.fileUrl, fileName: d.fileName, fileType: d.fileType });
            } else {
                socket.emit('group file message', { groupId: currentGroupId, fileUrl: d.fileUrl, fileName: d.fileName, fileType: d.fileType });
            }
        } else {
            alert('上传失败: ' + d.message);
        }
    } catch (e) { alert('上传失败'); }
}
fileBtn.onclick = function() { fileInput.click(); };
fileInput.onchange = function(e) {
    if (e.target.files[0]) sendFile(e.target.files[0]);
    fileInput.value = '';
};

// ========== Emoji 面板 ==========
var emojis = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'];
function buildEmoji() {
    emojiPanel.innerHTML = '';
    for (var i = 0; i < emojis.length; i++) {
        var s = document.createElement('span');
        s.innerText = emojis[i];
        s.onclick = function() {
            messageInput.value += this.innerText;
            messageInput.focus();
            emojiPanel.style.display = 'none';
        };
        emojiPanel.appendChild(s);
    }
}
buildEmoji();
emojiBtn.onclick = function(e) { e.stopPropagation(); emojiPanel.style.display = emojiPanel.style.display === 'flex' ? 'none' : 'flex'; };
document.onclick = function(e) {
    if (!emojiPanel.contains(e.target) && e.target !== emojiBtn) emojiPanel.style.display = 'none';
};

// ========== 搜索 ==========
searchBtn.onclick = function() {
    searchModal.style.display = 'flex';
    $('searchKeyword').value = '';
    $('searchUsername').value = '';
    $('searchStartDate').value = '';
    $('searchEndDate').value = '';
    $('searchResults').innerHTML = '';
};
$('closeSearchModalBtn').onclick = function() { searchModal.style.display = 'none'; };
async function locate(mId) {
    var tm = document.querySelector('.message[data-id="' + mId + '"]');
    if (tm) {
        tm.scrollIntoView({ behavior: 'smooth' });
        tm.style.backgroundColor = '#ffffcc';
        setTimeout(function() { tm.style.backgroundColor = ''; }, 2000);
        return true;
    }
    while (!tm && hasMoreHistory && !isLoadingMore) {
        await loadMore();
        tm = document.querySelector('.message[data-id="' + mId + '"]');
        if (tm) {
            tm.scrollIntoView({ behavior: 'smooth' });
            tm.style.backgroundColor = '#ffffcc';
            setTimeout(function() { tm.style.backgroundColor = ''; }, 2000);
            return true;
        }
        await new Promise(function(r) { setTimeout(r, 300); });
    }
    alert('未找到');
    return false;
}
$('doSearchBtn').onclick = function() {
    var kw = $('searchKeyword').value.trim(), un = $('searchUsername').value.trim(), sd = $('searchStartDate').value, ed = $('searchEndDate').value, ty = $('searchType').value;
    var p = new URLSearchParams();
    if (kw) p.append('keyword', kw);
    if (un) p.append('username', un);
    if (sd) p.append('startDate', sd);
    if (ed) p.append('endDate', ed);
    if (ty) p.append('type', ty);
    fetch('/api/search?' + p.toString(), { credentials: 'include' }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) {
            $('searchResults').innerHTML = '';
            if (!d.results.length) { $('searchResults').innerHTML = '<div class="system-message">无结果</div>'; return; }
            for (var i = 0; i < d.results.length; i++) {
                var m = d.results[i];
                var dv = document.createElement('div');
                dv.className = 'search-result-item';
                dv.innerHTML = '<strong>' + window.escapeHtml(m.username) + '</strong> ' + new Date(m.timestamp).toLocaleString() + '<br>' + window.escapeHtml(m.content || '[文件]');
                dv.onclick = function() { locate(this.dataset.id); searchModal.style.display = 'none'; };
                dv.dataset.id = m.id;
                $('searchResults').appendChild(dv);
            }
        }
    }).catch(function(e) { alert('搜索失败'); });
};

// ========== 私聊 ==========
function updBadge(uid, c) {
    var ud = document.querySelector('.online-user[data-userid="' + uid + '"]');
    if (ud) {
        var b = ud.querySelector('.unread-badge');
        if (c > 0) {
            if (!b) { b = document.createElement('span'); b.className = 'unread-badge'; ud.appendChild(b); }
            b.innerText = c > 99 ? '99+' : c;
        } else if (b) b.remove();
    }
}
function appendPM(msg, sent) {
    var d = document.createElement('div');
    d.className = 'private-message ' + (sent ? 'private-message-sent' : 'private-message-received');
    d.innerHTML = '<div style="font-size:11px;' + (sent ? 'color:#e0e0e0' : 'color:#999') + '">' + (sent ? '我' : window.escapeHtml(msg.username || '对方')) + '</div><div>' + window.escapeHtml(msg.content) + '</div><div style="font-size:10px;text-align:right;' + (sent ? 'color:#e0e0e0' : 'color:#999') + '">' + ft(msg.timestamp) + '</div>';
    privateMessagesArea.appendChild(d);
    privateMessagesArea.scrollTop = privateMessagesArea.scrollHeight;
}
async function openPChat(tid, tun) {
    currentPrivateTarget = { id: tid, username: tun };
    privateChatWindow.style.display = 'flex';
    $('privateChatHeader').innerHTML = '<span>💬 与 ' + window.escapeHtml(tun) + ' 私聊</span><button id="closePChatBtn" style="background:none;border:none;color:white;cursor:pointer;">✕</button>';
    $('closePChatBtn').onclick = function() { privateChatWindow.style.display = 'none'; currentPrivateTarget = null; };
    privateMessagesArea.innerHTML = '';
    var r = await fetch('/api/private/messages/' + tid, { credentials: 'include' });
    var d = await r.json();
    if (d.success) {
        for (var i = 0; i < d.messages.length; i++) {
            var m = d.messages[i];
            var s = m.from_user === currentUser.userId;
            appendPM({ ...m, username: s ? null : tun }, s);
        }
    }
    socket.emit('join private room', tid);
    socket.emit('mark private read', tid);
    unreadCounts[tid] = 0;
    updBadge(tid, 0);
}
function renderOnline(us) {
    onlineList.innerHTML = '';
    onlineCount.innerText = us.length;
    for (var i = 0; i < us.length; i++) {
        var u = us[i];
        if (u.userId === currentUser.userId) continue;
        var d = document.createElement('div');
        d.className = 'online-user';
        d.dataset.userid = u.userId;
        var si = u.status === 'chat' ? '💬' : (u.status === 'files' ? '📁' : '📝');
        var av = u.avatarUrl || D;
        d.innerHTML = '<div class="online-user-info"><img src="' + window.escapeHtml(av) + '"><span>' + window.escapeHtml(u.username) + ' ' + si + '</span></div>';
        var uc = unreadCounts[u.userId] || 0;
        if (uc > 0) {
            var b = document.createElement('span');
            b.className = 'unread-badge';
            b.innerText = uc > 99 ? '99+' : uc;
            d.appendChild(b);
        }
        d.onclick = function() { openPChat(u.userId, u.username); };
        onlineList.appendChild(d);
    }
}
privateChatListBtn.onclick = function() {
    var m = document.createElement('div');
    m.className = 'modal';
    m.style.display = 'flex';
    m.innerHTML = '<div class="modal-content"><h3>私聊列表</h3><div id="pcl" style="max-height:300px;overflow-y:auto;"></div><button id="cpclb" style="margin-top:12px;width:100%;padding:8px;border-radius:20px;border:none;cursor:pointer;">关闭</button></div>';
    document.body.appendChild(m);
    fetch('/api/private/list', { credentials: 'include' }).then(function(r) { return r.json(); }).then(function(d) {
        if (!d.success) return;
        var c = m.querySelector('#pcl');
        c.innerHTML = '';
        if (!d.chats.length) { c.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无</div>'; return; }
        for (var i = 0; i < d.chats.length; i++) {
            var ch = d.chats[i];
            var dv = document.createElement('div');
            dv.className = 'online-user';
            dv.style.cssText = 'cursor:pointer;justify-content:space-between';
            var av = ch.avatarUrl || D;
            dv.innerHTML = '<div class="online-user-info"><img src="' + window.escapeHtml(av) + '"><span>' + window.escapeHtml(ch.username) + '</span></div>' + (ch.unread > 0 ? '<span class="unread-badge">' + ch.unread + '</span>' : '');
            dv.onclick = function() { openPChat(ch.userId, ch.username); m.remove(); };
            c.appendChild(dv);
        }
    });
    m.querySelector('#cpclb').onclick = function() { m.remove(); };
};
sendPrivateBtn.onclick = function() {
    if (!currentPrivateTarget || !privateInput.value.trim()) return;
    var c = privateInput.value.trim();
    socket.emit('private message', { toUserId: currentPrivateTarget.id, content: c });
    appendPM({ content: c, timestamp: new Date().toISOString() }, true);
    privateInput.value = '';
};
privateInput.onkeypress = function(e) { if (e.key === 'Enter') sendPrivateBtn.click(); };

// ========== 群聊核心功能 ==========

// 切换群（修复：滚动到底部）
function switchGroup(gid, name) {
    if (gid === currentGroupId) return;
    if (currentGroupId === 0) socket.emit('leave chat');
    else socket.emit('leave group room', currentGroupId);
    currentGroupId = gid;
    historyLoaded = false;
    hasMoreHistory = true;
    oldestMessageId = null;
    currentChatTitle.textContent = name;
    document.querySelectorAll('.group-item').forEach(function(el) { el.classList.remove('active'); });
    var ti = document.querySelector('.group-item[data-group-id="' + gid + '"]');
    if (ti) ti.classList.add('active');
    groupMembersBtn.style.display = gid === 0 ? 'none' : 'inline-block';
    messagesArea.innerHTML = '<div id="loadingMore">⏳ 加载更早消息...</div>';
    loadHistory();
    // 延迟滚动到底部，确保DOM渲染完成
    setTimeout(function() {
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }, 200);
    if (gid === 0) { socket.emit('join chat'); socket.emit('update status', 'chat'); } 
    else { socket.emit('join group room', gid); }
    if (gid !== 0) {
        loadGroupSettings(gid);
        updateGroupButtons(gid);
    } else {
        hideGroupButtons();
    }
}

function updateGroupButtons(gid) {
    var myGroup = myGroups.find(function(g) { return g.id === gid; });
    var role = myGroup ? myGroup.myRole : null;
    var isManager = (role === 'owner' || role === 'admin');
    
    var settingsBtn = document.getElementById('groupSettingsBtn');
    var requestBtn = document.getElementById('requestManageBtn');
    var inviteBtn = document.getElementById('inviteBtn');
    
    if (settingsBtn) settingsBtn.style.display = isManager ? 'inline-block' : 'none';
    if (requestBtn) requestBtn.style.display = isManager ? 'inline-block' : 'none';
    if (inviteBtn) inviteBtn.style.display = isManager ? 'inline-block' : 'none';
}

function hideGroupButtons() {
    var settingsBtn = document.getElementById('groupSettingsBtn');
    var requestBtn = document.getElementById('requestManageBtn');
    var inviteBtn = document.getElementById('inviteBtn');
    if (settingsBtn) settingsBtn.style.display = 'none';
    if (requestBtn) requestBtn.style.display = 'none';
    if (inviteBtn) inviteBtn.style.display = 'none';
}

function renderGroups(gs) {
    myGroups = gs;
    var html = '<div class="group-item active" data-group-id="0"><span class="group-item-icon">💬</span><div class="group-item-info"><div class="group-item-name">公共聊天室</div><div class="group-item-count">默认</div></div></div>';
    for (var i = 0; i < gs.length; i++) {
        var g = gs[i];
        var pendingBadge = g.pendingRequests > 0 ? ' <span style="background:#ff9800;color:white;border-radius:50%;padding:1px 8px;font-size:11px;margin-left:4px;">' + g.pendingRequests + '</span>' : '';
        html += '<div class="group-item ' + (g.id === currentGroupId ? 'active' : '') + '" data-group-id="' + g.id + '" data-group-name="' + window.escapeHtml(g.name) + '">';
        html += '<span class="group-item-icon">👥</span>';
        html += '<div class="group-item-info"><div class="group-item-name">' + window.escapeHtml(g.name) + pendingBadge + '</div><div class="group-item-count">' + g.memberCount + '人</div></div>';
        html += '</div>';
    }
    groupList.innerHTML = html;
    document.querySelectorAll('.group-item').forEach(function(el) {
        el.onclick = function() {
            var id = Number(this.dataset.groupId);
            if (id === 0) {
                switchGroup(0, '💬 公共聊天室');
            } else {
                switchGroup(id, '👥 ' + (this.dataset.groupName || '群聊'));
            }
        };
    });
    if (currentGroupId !== 0) {
        updateGroupButtons(currentGroupId);
    }
}

async function loadGroups() {
    try {
        var r = await fetch('/api/groups', { credentials: 'include' });
        var d = await r.json();
        if (d.success) renderGroups(d.groups);
    } catch (e) {}
}

// ========== 群设置相关 ==========
async function loadGroupSettings(groupId) {
    try {
        var r = await fetch('/api/groups/' + groupId + '/info', { credentials: 'include' });
        var d = await r.json();
        if (d.success) {
            currentGroupSettings = d.group;
            if (d.group.name) {
                var titleEl = document.getElementById('currentChatTitle');
                if (titleEl) titleEl.textContent = '👥 ' + d.group.name;
            }
        }
    } catch (e) {}
}

function openGroupSettings() {
    if (currentGroupId === 0) return;
    var myGroup = myGroups.find(function(g) { return g.id === currentGroupId; });
    if (!myGroup || (myGroup.myRole !== 'owner' && myGroup.myRole !== 'admin')) {
        alert('只有群主或管理员可以修改群设置');
        return;
    }
    fetch('/api/groups/' + currentGroupId + '/info', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) {
                var g = d.group;
                document.getElementById('settingsGroupName').value = g.name || '';
                document.getElementById('settingsGroupDesc').value = g.description || '';
                document.getElementById('settingsGroupAvatar').value = g.avatar || '';
                document.getElementById('settingsJoinApproval').checked = g.join_approval === 1;
                document.getElementById('settingsAllowJoin').checked = g.allow_join === 1;
                document.getElementById('groupSettingsModal').style.display = 'flex';
            } else {
                alert('加载群设置失败：' + d.message);
            }
        });
}

document.getElementById('groupSettingsForm')?.addEventListener('submit', function(e) {
    e.preventDefault();
    var data = {
        name: document.getElementById('settingsGroupName').value.trim(),
        description: document.getElementById('settingsGroupDesc').value.trim(),
        avatar: document.getElementById('settingsGroupAvatar').value.trim(),
        joinApproval: document.getElementById('settingsJoinApproval').checked,
        allowJoin: document.getElementById('settingsAllowJoin').checked
    };
    if (!data.name) { alert('群名称不能为空'); return; }
    fetch('/api/groups/' + currentGroupId + '/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
    }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) {
            alert('群设置已更新');
            document.getElementById('groupSettingsModal').style.display = 'none';
            loadGroups();
            loadGroupSettings(currentGroupId);
        } else {
            alert('更新失败：' + d.message);
        }
    });
});

document.getElementById('closeGroupSettingsBtn')?.addEventListener('click', function() { 
    document.getElementById('groupSettingsModal').style.display = 'none'; 
});
document.getElementById('closeGroupSettingsBtn2')?.addEventListener('click', function() { 
    document.getElementById('groupSettingsModal').style.display = 'none'; 
});

var settingsBtn = document.createElement('button');
settingsBtn.id = 'groupSettingsBtn';
settingsBtn.innerHTML = '⚙️';
settingsBtn.title = '群设置';
settingsBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1rem;color:var(--primary);padding:4px 8px;border-radius:8px;display:none;';
settingsBtn.onclick = openGroupSettings;
var parentEl = groupMembersBtn.parentElement;
if (parentEl) parentEl.insertBefore(settingsBtn, groupMembersBtn);

// ========== 申请加入群 ==========
function applyToJoinGroup(groupId) {
    fetch('/api/groups/' + groupId + '/info', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) {
                document.getElementById('applyGroupInfo').innerHTML = '申请加入群：<strong>' + window.escapeHtml(d.group.name) + '</strong>';
                document.getElementById('applyReason').value = '';
                document.getElementById('applyJoinModal').style.display = 'flex';
                document.getElementById('applyJoinModal').dataset.groupId = groupId;
            }
        });
}

document.getElementById('submitApplyBtn')?.addEventListener('click', function() {
    var groupId = parseInt(document.getElementById('applyJoinModal').dataset.groupId);
    var reason = document.getElementById('applyReason').value.trim();
    fetch('/api/groups/' + groupId + '/request-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: reason })
    }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) {
            alert(d.message);
            document.getElementById('applyJoinModal').style.display = 'none';
        } else {
            alert('申请失败：' + d.message);
        }
    });
});

document.getElementById('closeApplyModalBtn')?.addEventListener('click', function() { 
    document.getElementById('applyJoinModal').style.display = 'none'; 
});
document.getElementById('cancelApplyBtn')?.addEventListener('click', function() { 
    document.getElementById('applyJoinModal').style.display = 'none'; 
});

// ========== 加入申请管理 ==========
function viewJoinRequests() {
    if (currentGroupId === 0) return;
    fetch('/api/groups/' + currentGroupId + '/requests', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) {
                var container = document.getElementById('requestList');
                if (!d.requests || d.requests.length === 0) {
                    container.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无待审批的申请</div>';
                } else {
                    var html = '';
                    for (var i = 0; i < d.requests.length; i++) {
                        var req = d.requests[i];
                        html += '<div style="background:#f9f9f9;border-radius:12px;padding:12px;margin-bottom:10px;border-left:3px solid #ff9800;">';
                        html += '<div><strong>' + window.escapeHtml(req.username) + '</strong> 申请加入</div>';
                        html += '<div style="font-size:13px;color:#666;">理由：' + window.escapeHtml(req.reason || '无') + '</div>';
                        html += '<div style="font-size:12px;color:#999;margin-top:4px;">' + new Date(req.requested_at).toLocaleString() + '</div>';
                        html += '<div style="margin-top:8px;display:flex;gap:8px;">';
                        html += '<button class="btn-primary approve-request" data-request="' + req.id + '" style="padding:4px 16px;font-size:13px;">✅ 批准</button>';
                        html += '<button class="btn-secondary reject-request" data-request="' + req.id + '" style="padding:4px 16px;font-size:13px;">❌ 拒绝</button>';
                        html += '</div></div>';
                    }
                    container.innerHTML = html;
                    document.querySelectorAll('.approve-request').forEach(function(btn) {
                        btn.onclick = function() {
                            var rid = parseInt(this.dataset.request);
                            fetch('/api/groups/' + currentGroupId + '/approve-request', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ requestId: rid, approve: true })
                            }).then(function(r) { return r.json(); }).then(function(d2) {
                                if (d2.success) {
                                    alert(d2.message);
                                    viewJoinRequests();
                                    loadGroups();
                                } else {
                                    alert('操作失败：' + d2.message);
                                }
                            });
                        };
                    });
                    document.querySelectorAll('.reject-request').forEach(function(btn) {
                        btn.onclick = function() {
                            var rid = parseInt(this.dataset.request);
                            if (!confirm('确定拒绝该申请吗？')) return;
                            fetch('/api/groups/' + currentGroupId + '/approve-request', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ requestId: rid, approve: false })
                            }).then(function(r) { return r.json(); }).then(function(d2) {
                                if (d2.success) {
                                    alert(d2.message);
                                    viewJoinRequests();
                                    loadGroups();
                                } else {
                                    alert('操作失败：' + d2.message);
                                }
                            });
                        };
                    });
                }
                document.getElementById('joinRequestModal').style.display = 'flex';
            }
        });
}

document.getElementById('closeRequestModalBtn')?.addEventListener('click', function() { 
    document.getElementById('joinRequestModal').style.display = 'none'; 
});
document.getElementById('closeRequestModalBtn2')?.addEventListener('click', function() { 
    document.getElementById('joinRequestModal').style.display = 'none'; 
});

var requestBtn = document.createElement('button');
requestBtn.id = 'requestManageBtn';
requestBtn.innerHTML = '📋';
requestBtn.title = '加入申请管理';
requestBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1rem;color:var(--primary);padding:4px 8px;border-radius:8px;display:none;';
requestBtn.onclick = viewJoinRequests;
if (parentEl) parentEl.insertBefore(requestBtn, groupMembersBtn);

// ========== 邀请用户 ==========
function openInviteUser() {
    if (currentGroupId === 0) return;
    fetch('/api/admin/users', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) {
                var select = document.getElementById('inviteUserSelect');
                select.innerHTML = '';
                for (var i = 0; i < d.users.length; i++) {
                    var u = d.users[i];
                    if (u.userId === currentUser.userId) continue;
                    var opt = document.createElement('option');
                    opt.value = u.userId;
                    opt.textContent = u.username + (u.email ? ' (' + u.email + ')' : '');
                    select.appendChild(opt);
                }
                document.getElementById('inviteUserModal').style.display = 'flex';
            }
        });
}

document.getElementById('submitInviteBtn')?.addEventListener('click', function() {
    var targetUserId = parseInt(document.getElementById('inviteUserSelect').value);
    if (!targetUserId) { alert('请选择要邀请的用户'); return; }
    fetch('/api/groups/' + currentGroupId + '/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ targetUserId: targetUserId })
    }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) {
            alert(d.message);
            document.getElementById('inviteUserModal').style.display = 'none';
        } else {
            alert('邀请失败：' + d.message);
        }
    });
});

document.getElementById('closeInviteModalBtn')?.addEventListener('click', function() { 
    document.getElementById('inviteUserModal').style.display = 'none'; 
});
document.getElementById('cancelInviteBtn')?.addEventListener('click', function() { 
    document.getElementById('inviteUserModal').style.display = 'none'; 
});

var inviteBtn = document.createElement('button');
inviteBtn.id = 'inviteBtn';
inviteBtn.innerHTML = '📤';
inviteBtn.title = '邀请用户';
inviteBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1rem;color:var(--primary);padding:4px 8px;border-radius:8px;display:none;';
inviteBtn.onclick = openInviteUser;
if (parentEl) parentEl.insertBefore(inviteBtn, groupMembersBtn);

// ========== 创建群 ==========
createGroupBtn.onclick = function() {
    createGroupModal.style.display = 'flex';
    document.getElementById('newGroupName').value = '';
    document.getElementById('newGroupDesc').value = '';
    document.getElementById('newGroupName').focus();
};
document.getElementById('closeCreateGroupBtn').onclick = function() { createGroupModal.style.display = 'none'; };
document.getElementById('doCreateGroupBtn').onclick = function() {
    var n = document.getElementById('newGroupName').value.trim(), d = document.getElementById('newGroupDesc').value.trim();
    if (!n || n.length < 1 || n.length > 20) { alert('群名称1-20字'); return; }
    fetch('/api/groups', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, description: d })
    }).then(function(r) { return r.json(); }).then(function(dt) {
        if (dt.success) {
            createGroupModal.style.display = 'none';
            switchGroup(dt.group.id, '👥 ' + dt.group.name);
            loadGroups();
        } else {
            alert(dt.message);
        }
    }).catch(function(e) { alert('创建失败'); });
};

// ========== 发现群 ==========
discoverGroupsBtn.onclick = function() {
    discoverGroupsModal.style.display = 'flex';
    var c = document.getElementById('discoverGroupList');
    c.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">加载中...</div>';
    fetch('/api/groups/discover', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            c.innerHTML = '';
            if (!d.success || !d.groups.length) {
                c.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">暂无其他群</div>';
                return;
            }
            for (var i = 0; i < d.groups.length; i++) {
                var g = d.groups[i];
                var dv = document.createElement('div');
                dv.className = 'discover-group-item';
                var joinBtnText = g.join_approval === 1 ? '申请加入' : '加入';
                dv.innerHTML = '<div class="gi"><h4>👥 ' + window.escapeHtml(g.name) + '</h4><p>' + window.escapeHtml(g.description || '') + ' · ' + g.memberCount + '人' + (g.join_approval === 1 ? ' 🔒' : '') + '</p></div><button class="btn-sm join-group-btn" data-gid="' + g.id + '" data-approval="' + g.join_approval + '">' + joinBtnText + '</button>';
                dv.querySelector('.join-group-btn').onclick = function(e) {
                    e.stopPropagation();
                    var gid = parseInt(this.dataset.gid);
                    var approval = parseInt(this.dataset.approval);
                    if (approval === 1) {
                        applyToJoinGroup(gid);
                    } else {
                        fetch('/api/groups/' + gid + '/join', { method: 'POST', credentials: 'include' })
                            .then(function(r) { return r.json(); })
                            .then(function(d2) {
                                if (d2.success) {
                                    alert('已加入！');
                                    discoverGroupsModal.style.display = 'none';
                                    loadGroups();
                                } else {
                                    alert(d2.message);
                                }
                            });
                    }
                };
                c.appendChild(dv);
            }
        });
};
document.getElementById('closeDiscoverGroupsBtn').onclick = function() { discoverGroupsModal.style.display = 'none'; };

// ========== 群成员管理 ==========
groupMembersBtn.onclick = function() {
    if (currentGroupId === 0) return;
    groupMembersModal.style.display = 'flex';
    var c = document.getElementById('groupMemberList');
    document.getElementById('memberCount').textContent = '...';
    c.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">加载中...</div>';
    fetch('/api/groups/' + currentGroupId + '/members', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (!d.success) { c.innerHTML = '<div style="text-align:center;color:#e53935;">加载失败</div>'; return; }
            document.getElementById('memberCount').textContent = d.members.length;
            c.innerHTML = '';
            var myGroup = myGroups.find(function(g) { return g.id === currentGroupId; });
            var myRole = myGroup ? myGroup.myRole : 'member';
            for (var i = 0; i < d.members.length; i++) {
                var m = d.members[i];
                var roleTag = m.role === 'owner' ? '👑群主' : (m.role === 'admin' ? '⚙️管理员' : '成员');
                var ah = '';
                if (currentUser.userId !== m.userId && (myRole === 'owner' || (myRole === 'admin' && m.role === 'member'))) {
                    if (m.role !== 'owner') {
                        if (myRole === 'owner') {
                            ah += '<button onclick="togAdmin(' + currentGroupId + ',' + m.userId + ',\'' + (m.role === 'admin' ? 'member' : 'admin') + '\')" style="font-size:12px;padding:2px 10px;border-radius:12px;border:none;cursor:pointer;background:#e3f2fd;color:#1976d2;margin:2px;">' + (m.role === 'admin' ? '取消管理' : '设为管理') + '</button>';
                        }
                        ah += '<button onclick="kickMem(' + currentGroupId + ',' + m.userId + ')" style="font-size:12px;padding:2px 10px;border-radius:12px;border:none;cursor:pointer;background:#ffebee;color:#c62828;margin:2px;">踢出</button>';
                        if (myRole === 'owner') {
                            ah += '<button onclick="banUser(' + currentGroupId + ',' + m.userId + ')" style="font-size:12px;padding:2px 10px;border-radius:12px;border:none;cursor:pointer;background:#fff3e0;color:#e65100;margin:2px;">拉黑</button>';
                        }
                    }
                }
                if (currentUser.userId === m.userId && m.role !== 'owner') {
                    ah += '<button onclick="leaveG(' + currentGroupId + ')" style="font-size:12px;padding:2px 10px;border-radius:12px;border:none;cursor:pointer;color:#e53935;margin:2px;">退出群</button>';
                }
                var dv = document.createElement('div');
                dv.className = 'member-item';
                var av = m.avatarUrl || D;
                dv.innerHTML = '<img src="' + window.escapeHtml(av) + '"><div class="member-info"><div class="member-name">' + window.escapeHtml(m.username) + ' <span class="member-role-tag">' + roleTag + '</span></div></div><div class="member-actions">' + ah + '</div>';
                c.appendChild(dv);
            }
            if (d.banned && d.banned.length > 0 && myRole === 'owner') {
                var banDiv = document.createElement('div');
                banDiv.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid #eee;';
                var banTitle = document.createElement('div');
                banTitle.style.cssText = 'font-weight:bold;font-size:14px;color:#e53935;margin-bottom:8px;';
                banTitle.textContent = '🚫 黑名单';
                banDiv.appendChild(banTitle);
                for (var j = 0; j < d.banned.length; j++) {
                    var b = d.banned[j];
                    var bd = document.createElement('div');
                    bd.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:#ffebee;border-radius:8px;margin-bottom:4px;';
                    bd.innerHTML = '<span>' + window.escapeHtml(b.username || b.user_id) + ' (' + new Date(b.banned_at).toLocaleString() + ')</span><button onclick="unbanUser(' + currentGroupId + ',' + b.user_id + ')" style="font-size:12px;padding:2px 10px;border-radius:12px;border:none;cursor:pointer;background:#e8f5e9;color:#2e7d32;">解除</button>';
                    banDiv.appendChild(bd);
                }
                c.appendChild(banDiv);
            }
            if (myRole === 'owner') {
                var dd = document.createElement('div');
                dd.style.cssText = 'text-align:center;padding:12px;margin-top:8px;';
                dd.innerHTML = '<button style="color:#e53935;background:none;border:1px solid #e53935;border-radius:16px;padding:6px 16px;cursor:pointer;" onclick="delGroup(' + currentGroupId + ')">🗑 解散群</button>';
                c.appendChild(dd);
            }
        });
};
document.getElementById('closeGroupMembersBtn').onclick = function() { groupMembersModal.style.display = 'none'; };

// ========== 全局操作函数 ==========
window.togAdmin = function(gid, uid, role) {
    fetch('/api/groups/' + gid + '/set-role', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: uid, role: role })
    }).then(function(r) { return r.json(); }).then(function(d) {
        alert(d.message);
        if (d.success) groupMembersBtn.click();
    });
};

window.kickMem = function(gid, uid) {
    if (!confirm('踢出该成员？')) return;
    fetch('/api/groups/' + gid + '/kick', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: uid })
    }).then(function(r) { return r.json(); }).then(function(d) {
        alert(d.message);
        if (d.success) { groupMembersBtn.click(); loadGroups(); }
    });
};

window.banUser = function(gid, uid) {
    var reason = prompt('请输入拉黑原因（可选）：');
    fetch('/api/groups/' + gid + '/ban', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: uid, reason: reason || '' })
    }).then(function(r) { return r.json(); }).then(function(d) {
        alert(d.message);
        if (d.success) { groupMembersBtn.click(); loadGroups(); }
    });
};

window.unbanUser = function(gid, uid) {
    if (!confirm('确定解除拉黑该用户吗？')) return;
    fetch('/api/groups/' + gid + '/ban/' + uid, {
        method: 'DELETE',
        credentials: 'include'
    }).then(function(r) { return r.json(); }).then(function(d) {
        alert(d.message);
        if (d.success) { groupMembersBtn.click(); loadGroups(); }
    });
};

window.leaveG = function(gid) {
    if (!confirm('退出该群？')) return;
    fetch('/api/groups/' + gid + '/leave', { method: 'POST', credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) {
                alert('已退出');
                document.getElementById('groupMembersModal').style.display = 'none';
                switchGroup(0, '💬 公共聊天室');
                loadGroups();
            } else {
                alert(d.message);
            }
        });
};

window.delGroup = function(gid) {
    if (!confirm('⚠️ 解散群？不可恢复！')) return;
    fetch('/api/groups/' + gid, { method: 'DELETE', credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) {
                alert('已解散');
                document.getElementById('groupMembersModal').style.display = 'none';
                switchGroup(0, '💬 公共聊天室');
                loadGroups();
            } else {
                alert(d.message);
            }
        });
};

// ========== Socket 初始化 ==========
var initialized = false;
async function init() {
    if (initialized) return;
    initialized = true;
    
    var r = await fetch('/api/me', { credentials: 'include' });
    var d = await r.json();
    if (!d.success) { setTimeout(function() { window.location.href = '/'; }, 100); return; }
    currentUser = d.user;
    isAdmin = currentUser.role === 'admin';
    
    if (socket) socket.disconnect();
    socket = io({ withCredentials: true });
    window.socket = socket;
    
    await loadGroups();
    
    socket.on('connect', function() {
        socket.emit('join chat');
        socket.emit('update status', 'chat');
        loadHistory();
    });
    
    socket.on('history messages', function(msgs) {
        if (!historyLoaded && msgs.length && currentGroupId === 0) {
            renderMessages(msgs);
            historyLoaded = true;
            hasMoreHistory = msgs.length === 50;
            sendReads();
            // 滚动到底部
            messagesArea.scrollTop = messagesArea.scrollHeight;
        }
    });
    
    socket.on('new message', function(msg) {
        if (currentGroupId === 0) { appendMessage(msg); sendReads(); }
    });
    
    socket.on('message recalled', function(data) {
        if (currentGroupId === 0) {
            var el = document.querySelector('.message[data-id="' + data.messageId + '"]');
            if (el) el.remove();
            sysMsg('一条消息已被撤回');
        }
    });
    
    socket.on('new group message', function(msg) {
        if (currentGroupId === msg.groupId) { appendMessage(msg); sendReads(); }
    });
    
    socket.on('group message recalled', function(data) {
        if (currentGroupId === data.groupId) {
            var el = document.querySelector('.message[data-id="' + data.messageId + '"]');
            if (el) el.remove();
            sysMsg('一条消息已被撤回');
        }
    });
    
    socket.on('online users status', renderOnline);
    
    socket.on('user updated', function(data) {
        if (currentUser.userId === data.userId && data.newAvatar) currentUser.avatarUrl = data.newAvatar;
    });
    
    socket.on('system message', sysMsg);
    
    socket.on('new announcement', function(data) {
        sysMsg('【公告】' + window.escapeHtml(data.publisherName) + ':<br>' + window.escapeHtml(data.content).replace(/\n/g, '<br>'));
    });
    
    socket.on('private message', function(msg) {
        if (currentPrivateTarget && currentPrivateTarget.id === msg.from_user) {
            appendPM({ ...msg, username: currentPrivateTarget.username }, false);
            socket.emit('mark private read', msg.from_user);
        } else {
            unreadCounts[msg.from_user] = (unreadCounts[msg.from_user] || 0) + 1;
            updBadge(msg.from_user, unreadCounts[msg.from_user]);
        }
    });
    
    socket.on('new private message', function(data) {
        if (currentPrivateTarget && currentPrivateTarget.id === data.from) {
            appendPM({ ...data.message, username: currentPrivateTarget.username }, false);
            socket.emit('mark private read', data.from);
        } else {
            unreadCounts[data.from] = (unreadCounts[data.from] || 0) + 1;
            updBadge(data.from, unreadCounts[data.from]);
        }
    });
    
    socket.on('kicked', function() { window.location.href = '/'; });
    
    socket.on('user kicked', function(data) {
        sysMsg('用户 ' + window.escapeHtml(data.username) + ' 已被踢出');
    });
    
    socket.on('group_settings_changed', function(data) {
        if (currentGroupId === data.groupId) {
            sysMsg('群设置已更新');
            loadGroups();
            loadGroupSettings(data.groupId);
        }
    });
    
    socket.on('group_disbanded', function(data) {
        if (currentGroupId === data.groupId) {
            sysMsg('群已被解散');
            switchGroup(0, '💬 公共聊天室');
            loadGroups();
        }
    });
    
    socket.on('new_group_join_request', function(data) {
        if (currentGroupId === data.groupId) {
            sysMsg('🔔 有新的加入申请：' + window.escapeHtml(data.username) + ' 申请加入群聊');
            loadGroups();
        }
    });
    
    socket.on('group_created', function(data) {
        // 刷新群列表
        loadGroups();
        // 如果当前在群聊页面，自动切换到新群
        if (data.groupId && data.name) {
            switchGroup(data.groupId, '👥 ' + data.name);
        }
    });
}

// ========== 启动初始化 ==========
init();