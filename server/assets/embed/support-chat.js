/*! Source Easy support chat embed (partner sites). Loads into a shadow root; no cookies.
 *  <script src="https://sourceeasy.in/embed/support-chat.js" data-site="fortune_engineering"
 *          data-logo="/logos/fortune.webp" defer></script>
 */
(function () {
  'use strict';
  if (window.__seSupportEmbed) return;
  window.__seSupportEmbed = true;

  var script = document.currentScript || document.querySelector('script[src*="/embed/support-chat.js"]');
  var ds = (script && script.dataset) || {};
  var SITE = 'fortune_engineering'; // the only partner site on the server allowlist today
  var API = (ds.api || (script ? new URL(script.src, location.href).origin : 'https://sourceeasy.in')).replace(/\/$/, '') + '/api/embed/support';
  var LOGO = ds.logo || '';
  var TOKEN_KEY = 'se_support_embed_token:' + SITE;
  var SEEN_KEY = 'se_support_embed_seen:' + SITE;
  var NAVY = '#10243a', BLUE = '#1769aa', CYAN = '#20b8d5';

  var STR = {
    en: {
      brand: 'Fortune Engineering', title: 'Chat with Fortune Engineering', open: 'Chat with us', close: 'Close chat', minimise: 'Minimise',
      online: 'Online – we usually reply in a few minutes', away: "Offline – leave a message and we'll reply soon",
      intro: 'Tell us how to reach you and we’ll pick up the conversation here.', name: 'Name', phone: 'Phone / WhatsApp', email: 'Email',
      oneIsEnough: 'Enter a phone number or email — one is enough.', message: 'Message', placeholder: 'How can we help?',
      consent: 'I agree to be contacted about this conversation.', start: 'Start chat', starting: 'Starting…', send: 'Send',
      typeHere: 'Type a message…', you: 'You', team: 'Fortune Engineering team', attachment: 'Attachment', converted: 'We opened sourcing request {ref} for you.',
      err: 'Something went wrong. Please try again.', errName: 'Please enter your name.', errContact: 'Please enter a phone number or email.',
      errConsent: 'Please tick the box to agree to be contacted.', errRate: 'Please wait a little before sending more messages.',
      errChallenge: 'Please wait a moment and try again.', errLinks: 'Please send fewer links.', errSize: 'That message is too long.',
      offline: 'Connection lost. Retrying…', privacy: 'Your details are only used to reply to you.'
    },
    zh: {
      brand: 'Fortune Engineering', title: '与 Fortune Engineering 在线沟通', open: '在线咨询', close: '关闭对话', minimise: '最小化',
      online: '在线 – 我们通常在几分钟内回复', away: '离线 – 请留言，我们会尽快回复',
      intro: '请留下联系方式，我们会在这里继续与您沟通。', name: '姓名', phone: '电话 / WhatsApp', email: '电子邮箱',
      oneIsEnough: '电话或邮箱填写一项即可。', message: '留言', placeholder: '请问有什么可以帮您？',
      consent: '我同意就此对话与我联系。', start: '开始对话', starting: '正在开始…', send: '发送',
      typeHere: '输入消息…', you: '我', team: 'Fortune Engineering 团队', attachment: '附件', converted: '我们已为您创建采购需求 {ref}。',
      err: '出现问题，请重试。', errName: '请输入您的姓名。', errContact: '请输入电话或电子邮箱。',
      errConsent: '请勾选同意联系。', errRate: '请稍后再发送更多消息。',
      errChallenge: '请稍候片刻再试。', errLinks: '请减少消息中的链接。', errSize: '消息过长。',
      offline: '连接中断，正在重试…', privacy: '您的信息仅用于回复您。'
    }
  };
  var langOf = function () {
    if (ds.lang === 'en' || ds.lang === 'zh-CN') return ds.lang === 'en' ? 'en' : 'zh';
    if (/^\/zh(-cn)?(\/|$)/i.test(location.pathname)) return 'zh';
    return /^zh/i.test(document.documentElement.lang || '') ? 'zh' : 'en';
  };
  var lang = langOf();
  var t = function (k, vars) {
    var s = (STR[lang] && STR[lang][k]) || STR.en[k] || k;
    if (vars) for (var v in vars) s = s.replace('{' + v + '}', vars[v]);
    return s;
  };

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  var state = { open: false, token: store.get(TOKEN_KEY), conv: null, desk: null, challenge: null, unread: 0, busy: false, error: '', streamOk: false };

  // ---------- DOM ----------
  var host = document.createElement('div');
  host.id = 'se-support-chat';
  host.setAttribute('data-site', SITE);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  var css = document.createElement('style');
  css.textContent = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:"Inter Variable",Inter,"Noto Sans SC",system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.wrap{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:12px;pointer-events:none}',
    '.launcher{pointer-events:auto;position:relative;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;background:' + BLUE + ';color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(16,36,58,.35);transition:transform .15s,background .15s}',
    '.launcher:hover{background:#12538a;transform:translateY(-1px)}.launcher:focus-visible{outline:3px solid ' + CYAN + ';outline-offset:3px}',
    '.launcher svg{width:28px;height:28px}',
    '.badge{position:absolute;top:-4px;right:-4px;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#e11d48;color:#fff;font-size:12px;font-weight:700;line-height:22px;text-align:center;box-shadow:0 0 0 2px #fff}',
    '.panel{pointer-events:auto;width:370px;max-width:calc(100vw - 24px);height:min(600px,calc(100vh - 110px));background:#fff;border-radius:16px;box-shadow:0 24px 60px rgba(16,36,58,.35);display:flex;flex-direction:column;overflow:hidden;color:#172638;font-size:14px;line-height:1.45}',
    '.head{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 14px;background:' + NAVY + ';color:#fff;flex-shrink:0}',
    '.logo{width:36px;height:36px;border-radius:8px;background:#fff;object-fit:contain;padding:3px;flex-shrink:0}',
    '.ht{flex:1;min-width:0}.ht b{display:block;font-size:14px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ht span{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#c5d3e0}.dot{width:7px;height:7px;border-radius:50%;background:#9ca3af;flex-shrink:0}.dot.on{background:#22c55e}',
    '.ib{background:transparent;border:0;color:#fff;opacity:.85;cursor:pointer;border-radius:8px;padding:6px;display:flex}.ib:hover{opacity:1;background:rgba(255,255,255,.12)}.ib svg{width:18px;height:18px}',
    '.body{flex:1;min-height:0;overflow-y:auto;padding:14px;background:#f4f7fa}',
    'form.pre{display:flex;flex-direction:column;gap:4px}.pre p{margin:0 0 8px;color:#475569;font-size:13.5px}',
    'label{display:block;font-size:12px;font-weight:600;color:#475569;margin-top:6px}',
    'input[type=text],input[type=tel],input[type=email],textarea{width:100%;margin-top:4px;padding:9px 10px;border:1px solid #cfd8e3;border-radius:8px;background:#fff;color:#172638;font-size:14px;outline:none}',
    'input:focus,textarea:focus{border-color:' + BLUE + ';box-shadow:0 0 0 3px rgba(23,105,170,.15)}textarea{resize:none}',
    '.hint{font-size:11.5px;color:#64748b;margin:2px 0 0}.cons{display:flex;gap:8px;align-items:flex-start;font-weight:500;margin-top:10px}.cons input{margin-top:3px}',
    '.hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden}',
    '.btn{margin-top:12px;border:0;border-radius:8px;padding:11px 14px;background:' + BLUE + ';color:#fff;font-weight:650;font-size:14px;cursor:pointer}.btn:hover{background:#12538a}.btn:disabled{opacity:.6;cursor:default}',
    '.err{color:#be123c;font-size:12.5px;margin-top:8px}.note{font-size:11px;color:#94a3b8;margin-top:8px}',
    '.msgs{display:flex;flex-direction:column;gap:8px}.row{display:flex}.row.me{justify-content:flex-end}.row.sys{justify-content:center}',
    '.bub{max-width:85%;padding:8px 12px;border-radius:16px;background:#fff;border:1px solid #e3e9f0;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}',
    '.me .bub{background:' + BLUE + ';border-color:' + BLUE + ';color:#fff;border-bottom-right-radius:4px}.them .bub{border-bottom-left-radius:4px}',
    '.sys .bub{background:#e8eef4;border:0;color:#475569;font-size:12.5px;text-align:center}',
    '.who{font-size:10.5px;font-weight:650;color:' + BLUE + ';margin-bottom:2px}.when{font-size:10px;opacity:.65;margin-top:3px}',
    '.att{display:inline-block;margin-top:4px;font-size:12.5px;text-decoration:underline;cursor:pointer;background:none;border:0;color:inherit;padding:0}',
    '.comp{display:flex;gap:8px;align-items:flex-end;padding:10px;border-top:1px solid #e3e9f0;background:#fff;flex-shrink:0}.comp textarea{margin:0;min-height:42px;max-height:120px}',
    '.send{border:0;border-radius:8px;width:42px;height:42px;background:' + CYAN + ';color:#062033;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}.send:disabled{opacity:.5}.send svg{width:18px;height:18px}',
    '.banner{font-size:11.5px;color:#92400e;background:#fef3c7;padding:5px 12px;flex-shrink:0}',
    '@media (max-width:640px){input[type=text],input[type=tel],input[type=email],textarea{font-size:16px}.wrap{right:14px;bottom:14px}.wrap.isopen{right:0;bottom:0;left:0;top:0}.wrap.isopen .launcher{display:none}.panel{width:100vw;max-width:100vw;height:100%;border-radius:0}.wrap.isopen{gap:0}}',
    '@media (prefers-reduced-motion:reduce){.launcher{transition:none}}'
  ].join('');
  root.appendChild(css);
  var wrap = el('div', 'wrap');
  root.appendChild(wrap);

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svg(path) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    path.split('|').forEach(function (d) { var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p); });
    return s;
  }
  var ICON_CHAT = 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z';
  var ICON_X = 'M18 6 6 18|M6 6l12 12';
  var ICON_MIN = 'M5 12h14';
  var ICON_SEND = 'M22 2 11 13|M22 2 15 22l-4-9-9-4 20-7z';

  // ---------- API ----------
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Accept': 'application/json' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (state.token) headers['X-Support-Token'] = state.token;
    return fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'omit', mode: 'cors', cache: 'no-store' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || 'HTTP ' + r.status); e.status = r.status; e.code = j.code; throw e; }
          return j.data;
        });
      });
  }
  function errText(e) {
    var m = { name: 'errName', contact: 'errContact', consent: 'errConsent', rate: 'errRate', challenge: 'errChallenge', links: 'errLinks', size: 'errSize' };
    return e && e.code && m[e.code] ? t(m[e.code]) : t('err');
  }
  function loadStatus() {
    return api('/status').then(function (d) { state.desk = d; state.challenge = d.challenge; state.challengeAt = Date.now(); render(); }).catch(function () {});
  }
  // Live presence: one boolean from the public endpoint, polled every 45 s while the page is visible (HTTPS fetch only: no WebSocket, no images).
  var presenceTimer = null;
  function loadPresence() {
    if (document.visibilityState === 'hidden') return Promise.resolve();
    return api('/presence').then(function (d) {
      var on = !!(d && d.online);
      if (!state.desk) return loadStatus();
      if (state.desk.online !== on) { state.desk.online = on; render(); }
    }).catch(function () {});
  }
  function startPresence() {
    if (presenceTimer) return;
    presenceTimer = setInterval(loadPresence, 45000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') loadPresence(); });
  }
  function lastSeen() { return store.get(SEEN_KEY) || ''; }
  function computeUnread() {
    if (!state.conv) { state.unread = 0; return; }
    var seen = lastSeen();
    state.unread = state.conv.messages.filter(function (m) { return m.authorKind === 'staff' && (!seen || m.at > seen); }).length;
  }
  function markSeen() {
    if (!state.conv || !state.conv.messages.length) return;
    store.set(SEEN_KEY, state.conv.messages[state.conv.messages.length - 1].at);
    state.unread = 0;
  }
  function loadConversation() {
    if (!state.token) return Promise.resolve();
    return api('/conversation').then(function (c) {
      state.conv = c;
      if (state.open) markSeen(); else computeUnread();
      render();
      startStream();
    }).catch(function (e) {
      if (e.status === 401) { state.token = null; store.set(TOKEN_KEY, null); state.conv = null; render(); }
    });
  }

  // Realtime: SSE read through fetch() so the token can travel in a header. Falls back to polling.
  var streamCtl = null, retry = 0, pollTimer = null, refreshTimer = null;
  function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(loadConversation, 150); }
  function startPolling() { if (!pollTimer) pollTimer = setInterval(function () { if (!document.hidden) loadConversation(); }, 20000); }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
  function startStream() {
    if (streamCtl || !state.token || !window.ReadableStream || !window.AbortController) { if (!window.ReadableStream) startPolling(); return; }
    var ctl = new AbortController(); streamCtl = ctl;
    fetch(API + '/stream', { headers: { 'X-Support-Token': state.token, 'Accept': 'text/event-stream' }, signal: ctl.signal, credentials: 'omit', mode: 'cors', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok || !r.body) throw new Error('stream ' + r.status);
        state.streamOk = true; retry = 0; stopPolling(); render();
        var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
        function pump() {
          return reader.read().then(function (x) {
            if (x.done) throw new Error('closed');
            buf += dec.decode(x.value, { stream: true });
            var parts = buf.split('\n\n'); buf = parts.pop();
            parts.forEach(function (p) { if (/^data:/m.test(p)) scheduleRefresh(); });
            return pump();
          });
        }
        return pump();
      })
      .catch(function () {
        if (streamCtl !== ctl) return;
        streamCtl = null; state.streamOk = false; startPolling();
        retry = Math.min(retry + 1, 6);
        setTimeout(function () { if (state.token) { loadConversation(); startStream(); } }, Math.min(60000, 2000 * Math.pow(2, retry)));
      });
  }

  // ---------- Actions ----------
  function startChat(form) {
    var f = form.elements;
    state.error = '';
    if (f.website.value) return; // honeypot
    var body = {
      name: f.name.value, phone: f.phone.value, email: f.email.value, message: f.message.value,
      consent: f.consent.checked, challenge: state.challenge, website: f.website.value,
      page: location.pathname.slice(0, 60), lang: lang === 'zh' ? 'zh-CN' : 'en'
    };
    var wait = state.challengeAt ? Math.max(0, 2300 - (Date.now() - state.challengeAt)) : 0;
    state.busy = true; render();
    setTimeout(function () {
      api('/start', { method: 'POST', body: body }).then(function (d) {
        state.busy = false;
        if (!d || !d.token) return;
        state.token = d.token; store.set(TOKEN_KEY, d.token);
        state.conv = d.conversation; markSeen(); state.draft = ''; render(); startStream();
      }).catch(function (e) {
        state.busy = false; state.error = errText(e); render();
        if (e.code === 'challenge') loadStatus();
      });
    }, wait);
  }
  function send(text) {
    text = text.trim();
    if (!text || state.busy) return;
    state.busy = true; state.error = ''; render();
    api('/messages', { method: 'POST', body: { content: text } }).then(function (m) {
      state.busy = false; state.draft = '';
      if (state.conv && m) state.conv.messages.push(m);
      markSeen(); render(true);
    }).catch(function (e) {
      state.busy = false; state.error = errText(e);
      if (e.status === 401 || e.status === 404) { state.token = null; store.set(TOKEN_KEY, null); state.conv = null; }
      render();
    });
  }
  function openAttachment(url) {
    fetch(new URL(url, API).href, { headers: { 'X-Support-Token': state.token }, credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.blob(); })
      .then(function (b) { var u = URL.createObjectURL(b); window.open(u, '_blank', 'noopener'); setTimeout(function () { URL.revokeObjectURL(u); }, 60000); })
      .catch(function () { state.error = t('err'); render(); });
  }
  function setOpen(v) {
    state.open = v;
    if (v) { markSeen(); if (!state.desk) loadStatus(); }
    render(true);
    if (v) setTimeout(function () { var x = root.querySelector('textarea, input[name=name]'); if (x) x.focus(); }, 30);
  }

  // ---------- Render ----------
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }); } catch (e) { return ''; }
  }
  function render(scroll) {
    var draftEl = root.querySelector('.comp textarea');
    if (draftEl) state.draft = draftEl.value;
    var keep = {};
    var pre = root.querySelector('form.pre');
    if (pre) { ['name', 'phone', 'email', 'message'].forEach(function (k) { keep[k] = pre.elements[k].value; }); keep.consent = pre.elements.consent.checked; }
    var hadFocus = root.activeElement && root.activeElement.name;
    wrap.textContent = '';
    wrap.className = 'wrap' + (state.open ? ' isopen' : '');
    if (state.open) wrap.appendChild(panel(keep));
    var b = el('button', 'launcher');
    b.type = 'button';
    b.setAttribute('aria-label', state.open ? t('close') : t('open'));
    b.setAttribute('aria-expanded', String(state.open));
    b.setAttribute('data-testid', 'fe-chat-launcher');
    b.appendChild(svg(state.open ? ICON_X : ICON_CHAT));
    if (!state.open && state.unread > 0) {
      var bd = el('span', 'badge', state.unread > 99 ? '99+' : String(state.unread));
      bd.setAttribute('data-testid', 'fe-chat-badge'); bd.setAttribute('aria-label', state.unread + ' unread');
      b.appendChild(bd);
    }
    b.onclick = function () { setOpen(!state.open); };
    wrap.appendChild(b);
    if (hadFocus) { var f = root.querySelector('[name="' + hadFocus + '"]'); if (f) f.focus(); }
    var body = root.querySelector('.body');
    if (body && (scroll || body.dataset.stick)) body.scrollTop = body.scrollHeight;
  }
  function panel(keep) {
    var p = el('div', 'panel');
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', t('title')); p.setAttribute('data-testid', 'fe-chat-panel');
    var h = el('div', 'head');
    if (LOGO) { var img = el('img', 'logo'); img.src = LOGO; img.alt = t('brand'); h.appendChild(img); }
    var ht = el('div', 'ht');
    ht.appendChild(el('b', null, t('title')));
    var st = el('span');
    // Unknown (not loaded yet / unreachable) is shown as grey with no label, never as "online".
    var online = !!(state.desk && state.desk.online);
    st.appendChild(el('i', 'dot' + (online ? ' on' : '')));
    st.setAttribute('data-testid', 'fe-chat-presence'); st.setAttribute('data-online', state.desk ? String(online) : 'unknown');
    st.appendChild(document.createTextNode(state.desk ? t(online ? 'online' : 'away') : ''));
    ht.appendChild(st); h.appendChild(ht);
    var mn = el('button', 'ib'); mn.type = 'button'; mn.setAttribute('aria-label', t('minimise')); mn.appendChild(svg(ICON_MIN)); mn.onclick = function () { setOpen(false); };
    var cl = el('button', 'ib'); cl.type = 'button'; cl.setAttribute('aria-label', t('close')); cl.appendChild(svg(ICON_X)); cl.onclick = function () { setOpen(false); };
    h.appendChild(mn); h.appendChild(cl);
    p.appendChild(h);
    if (state.conv && !state.streamOk && pollTimer) p.appendChild(el('div', 'banner', t('offline')));
    var body = el('div', 'body');
    p.appendChild(body);
    if (!state.conv) { body.appendChild(prechat(keep)); return p; }
    body.dataset.stick = '1';
    var list = el('div', 'msgs'); list.setAttribute('data-testid', 'fe-chat-messages');
    state.conv.messages.forEach(function (m) {
      var mine = m.authorKind === 'guest' || m.authorKind === 'customer';
      var sys = m.kind === 'system' || m.authorKind === 'system';
      var row = el('div', 'row ' + (sys ? 'sys' : mine ? 'me' : 'them'));
      var bub = el('div', 'bub');
      if (!mine && !sys) bub.appendChild(el('div', 'who', m.senderName || t('team')));
      if (m.content && m.content.trim()) bub.appendChild(el('div', null, m.content));
      (m.attachments || []).forEach(function (a) {
        var x = el('button', 'att', a.name || t('attachment')); x.type = 'button';
        x.onclick = function () { openAttachment(a.url); }; bub.appendChild(x);
      });
      if (!sys) bub.appendChild(el('div', 'when', fmtTime(m.at)));
      row.appendChild(bub); list.appendChild(row);
    });
    if (state.conv.convertedLeadRef) list.appendChild(el('div', 'note', t('converted', { ref: state.conv.convertedLeadRef })));
    body.appendChild(list);
    if (state.error) body.appendChild(el('div', 'err', state.error));
    var comp = el('form', 'comp'); comp.setAttribute('data-testid', 'fe-chat-composer');
    var ta = el('textarea'); ta.name = 'draft'; ta.rows = 1; ta.maxLength = (state.desk && state.desk.maxMessage) || 2000; ta.placeholder = t('typeHere'); ta.value = state.draft || '';
    ta.setAttribute('aria-label', t('message'));
    ta.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(ta.value); } };
    var sb = el('button', 'send'); sb.type = 'submit'; sb.disabled = !!state.busy; sb.setAttribute('aria-label', t('send')); sb.appendChild(svg(ICON_SEND));
    comp.onsubmit = function (e) { e.preventDefault(); send(ta.value); };
    comp.appendChild(ta); comp.appendChild(sb);
    p.appendChild(comp);
    return p;
  }
  function field(label, name, type, auto, val) {
    var l = el('label', null, label);
    var i = el('input'); i.type = type; i.name = name; i.autocomplete = auto; i.value = val || ''; i.maxLength = name === 'email' ? 200 : name === 'phone' ? 40 : 120;
    if (name === 'name') i.required = true;
    l.appendChild(i);
    return l;
  }
  function prechat(keep) {
    var f = el('form', 'pre'); f.setAttribute('data-testid', 'fe-chat-prechat'); f.noValidate = true;
    f.appendChild(el('p', null, t('intro')));
    f.appendChild(field(t('name'), 'name', 'text', 'name', keep.name));
    f.appendChild(field(t('phone'), 'phone', 'tel', 'tel', keep.phone));
    f.appendChild(field(t('email'), 'email', 'email', 'email', keep.email));
    f.appendChild(el('p', 'hint', t('oneIsEnough')));
    var ml = el('label', null, t('message'));
    var ta = el('textarea'); ta.name = 'message'; ta.rows = 3; ta.maxLength = 2000; ta.placeholder = t('placeholder'); ta.value = keep.message || '';
    ml.appendChild(ta); f.appendChild(ml);
    var hp = el('div', 'hp'); hp.setAttribute('aria-hidden', 'true');
    var hpi = el('input'); hpi.type = 'text'; hpi.name = 'website'; hpi.tabIndex = -1; hpi.autocomplete = 'off'; hp.appendChild(hpi); f.appendChild(hp);
    var cl = el('label', 'cons');
    var cb = el('input'); cb.type = 'checkbox'; cb.name = 'consent'; cb.checked = !!keep.consent;
    cl.appendChild(cb); cl.appendChild(document.createTextNode(t('consent'))); f.appendChild(cl);
    if (state.error) f.appendChild(el('div', 'err', state.error));
    var b = el('button', 'btn', state.busy ? t('starting') : t('start')); b.type = 'submit'; b.disabled = !!state.busy;
    f.appendChild(b);
    f.appendChild(el('div', 'note', t('privacy')));
    f.onsubmit = function (e) { e.preventDefault(); startChat(f); };
    return f;
  }

  // ---------- Boot ----------
  function boot() {
    document.body.appendChild(host);
    render();
    loadStatus();
    startPresence();
    loadConversation();
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) setOpen(false); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && state.token && !state.streamOk) loadConversation(); });
    // SPA language switch (/en/ ↔ /zh-cn/) without a reload.
    setInterval(function () { var l = langOf(); if (l !== lang) { lang = l; render(); } }, 1000);
    window.SourceEasySupportChat = { open: function () { setOpen(true); }, close: function () { setOpen(false); } };
  }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
