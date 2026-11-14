/* Suixin Community v4 | Copyright (C) 2026 SuixinChat Contributors | GPL-3.0-only
   Modified files must carry prominent notices (GPLv3 section 5a). Original: 2026-11-15 */
(function () {
  'use strict';
  var APP = window.APP || {};
  var DICT = APP.t || {};
  var CSRF = APP.csrf || '';

  function tr(key) { return DICT[key] || key; }

  function toast(message, isError) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast show' + (isError ? ' err' : '');
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.className = 'toast'; }, 2800);
  }

  function api(action, data) {
    return fetch('/api/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF },
      body: JSON.stringify(data || {})
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: 'server_error' }; })
        .then(function (json) {
          if (!res.ok || !json.ok) {
            throw new Error(tr(json.error || 'server_error') + (json.message ? ' · ' + json.message : ''));
          }
          return json;
        });
    });
  }

  function formObject(form) {
    var data = {};
    var fd = new FormData(form);
    fd.forEach(function (value, key) { if (key !== '_token') data[key] = value; });
    return data;
  }

  function bind(id, action, options) {
    var form = document.getElementById(id);
    if (!form) return;
    var opt = options || {};
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = formObject(form);
      if (opt.decorate) data = opt.decorate(data, form) || data;
      var button = form.querySelector('[type="submit"]');
      if (button) button.disabled = true;
      api(action, data).then(function (result) {
        if (opt.onSuccess) opt.onSuccess(result, form);
        else { toast(tr('saved')); location.reload(); }
      }).catch(function (error) {
        toast(error.message, true);
      }).finally(function () {
        if (button) button.disabled = false;
      });
    });
  }

  /* ---------- 弹窗 ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-open]'), function (button) {
    button.addEventListener('click', function () {
      var modal = document.querySelector(button.getAttribute('data-open'));
      if (modal) modal.hidden = false;
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (button) {
    button.addEventListener('click', function () {
      var modal = button.closest('.modal');
      if (modal) modal.hidden = true;
    });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) { m.hidden = true; });
    }
  });

  /* ---------- 语言切换 ---------- */
  var langSelect = document.getElementById('lang-select');
  if (langSelect) {
    langSelect.addEventListener('change', function () {
      api('lang', { code: langSelect.value })
        .then(function () { location.reload(); })
        .catch(function (error) { toast(error.message, true); });
    });
  }

  /* ---------- 论坛 ---------- */
  bind('form-thread', 'thread', {
    onSuccess: function (result) { location.href = result.url; }
  });
  bind('form-reply', 'reply', {
    decorate: function (data, form) { data.thread_id = form.getAttribute('data-thread'); return data; }
  });

  /* ---------- 圈子 ---------- */
  bind('form-circle', 'circle/create', {
    onSuccess: function (result) { location.href = result.url; }
  });
  bind('form-circle-topic', 'circle/topic', {
    decorate: function (data, form) {
      var content = document.getElementById('circle-topic-content');
      data.circle_id = form.getAttribute('data-circle');
      data.content = content ? content.value.trim() : '';
      return data;
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll('.topic-reply-form'), function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var input = form.querySelector('input[name="content"]');
      api('circle/reply', { topic_id: form.getAttribute('data-topic'), content: input.value.trim() })
        .then(function () { location.reload(); })
        .catch(function (error) { toast(error.message, true); });
    });
  });
  var joinButton = document.getElementById('btn-join');
  if (joinButton) {
    joinButton.addEventListener('click', function () {
      api('circle/join', { circle_id: joinButton.getAttribute('data-circle') })
        .then(function () { location.reload(); })
        .catch(function (error) { toast(error.message, true); });
    });
  }

  /* ---------- 文库 ---------- */
  bind('form-doc', 'doc', {
    decorate: function (data) {
      data.summary = (data.content || '').slice(0, 100);
      return data;
    },
    onSuccess: function (result) { location.href = result.url; }
  });

  /* ---------- 家园 / 交友 ---------- */
  var followButton = document.getElementById('btn-follow');
  if (followButton) {
    followButton.addEventListener('click', function () {
      api('follow', { user_id: followButton.getAttribute('data-user') })
        .then(function (result) { location.reload(); })
        .catch(function (error) { toast(error.message, true); });
    });
  }
  var friendButton = document.getElementById('btn-friend');
  if (friendButton) {
    friendButton.addEventListener('click', function () {
      api('friend', { user_id: friendButton.getAttribute('data-user') })
        .then(function () { location.reload(); })
        .catch(function (error) { toast(error.message, true); });
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-follow]'), function (button) {
    button.addEventListener('click', function () {
      api('follow', { user_id: button.getAttribute('data-follow') })
        .then(function () { location.reload(); })
        .catch(function (error) { toast(error.message, true); });
    });
  });
  bind('form-message', 'message', {
    decorate: function (data, form) { data.to_id = form.getAttribute('data-to'); return data; },
    onSuccess: function () {
      var modal = document.getElementById('msg-modal');
      if (modal) modal.hidden = true;
      toast(tr('saved'));
    }
  });

  /* ---------- 聊天室：短轮询，避免长连接阻塞 PHP 内置服务器 ---------- */
  var chatRoot = document.getElementById('chat-root');
  if (chatRoot) {
    var roomId = parseInt(chatRoot.getAttribute('data-room'), 10) || 0;
    var lastId = parseInt(chatRoot.getAttribute('data-last'), 10) || 0;
    var box = document.getElementById('chat-messages');
    var onlineEl = document.getElementById('online-count');
    var polling = false;

    function appendMessage(message) {
      var row = document.createElement('div');
      row.className = 'chat-msg' + (message.mine ? ' is-mine' : '') + (String(message.user_id) === '0' ? ' is-system' : '');
      var avatar = document.createElement('span');
      avatar.className = 'avatar avatar-sm';
      avatar.textContent = String(message.user_id) === '0' ? '●' : (message.author || '?').slice(0, 1);
      var bubble = document.createElement('div');
      bubble.className = 'bubble';
      var author = document.createElement('b');
      author.textContent = message.author || '';
      var text = document.createElement('p');
      text.textContent = message.content || '';
      var time = document.createElement('small');
      time.textContent = message.created_at || '';
      bubble.appendChild(author);
      bubble.appendChild(text);
      bubble.appendChild(time);
      row.appendChild(avatar);
      row.appendChild(bubble);
      box.appendChild(row);
    }

    function poll() {
      if (polling || !roomId) return;
      polling = true;
      fetch('/api/chat/poll?room=' + roomId + '&after=' + lastId, { headers: { 'Accept': 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (json) {
          if (!json.ok) return;
          if (json.messages && json.messages.length) {
            json.messages.forEach(appendMessage);
            lastId = json.lastId;
            box.scrollTop = box.scrollHeight;
          }
          if (onlineEl) onlineEl.textContent = json.online;
        })
        .catch(function () { /* 网络抖动静默重试 */ })
        .finally(function () { polling = false; });
    }

    if (box) box.scrollTop = box.scrollHeight;
    setInterval(poll, 2500);

    var chatForm = document.getElementById('form-chat');
    if (chatForm) {
      chatForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var input = chatForm.querySelector('input[name="content"]');
        var content = input.value.trim();
        if (!content) return;
        api('chat/send', { room_id: roomId, content: content })
          .then(function () { input.value = ''; poll(); })
          .catch(function (error) { toast(error.message, true); });
      });
    }
  }
})();
