/* Lord Erebus — admin panel */
(function () {
  'use strict';
  const { toast, confirmDialog, esc, money, ago, setBusy } = window.LE;
  const API = '/api/admin';
  const $ = id => document.getElementById(id);
  let csrf = null;
  let S = null; // last admin state
  let splitMode = 'equal';
  let tab = 'draw';
  let formDirty = false;

  /* ---------------- API ---------------- */
  async function api(action, { method = 'GET', body, params = {} } = {}) {
    const qs = new URLSearchParams({ action, ...params, _: Date.now() });
    const res = await fetch(API + '?' + qs, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-CSRF': csrf || '' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'Server error (' + res.status + ')' }));
    if (res.status === 401 && action !== 'login') { showLogin(); throw new Error(data.error); }
    if (!data.ok) { const e = new Error(data.error || 'Request failed'); e.data = data; throw e; }
    return data;
  }
  async function act(action, body, btn, okMsg) {
    setBusy(btn, true);
    try {
      const r = await api(action, { method: 'POST', body: body || {} });
      if (okMsg) toast(r.note || okMsg, 'success');
      await refresh();
      return r;
    } catch (e) { toast(e.message, 'error'); throw e; }
    finally { setBusy(btn, false); }
  }

  /* ---------------- auth ---------------- */
  function showLogin() { $('appView').hidden = true; $('loginView').hidden = false; }
  function showApp() { $('loginView').hidden = true; $('appView').hidden = false; }

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('loginBtn'), err = $('loginError');
    err.hidden = true; setBusy(btn, true, 'Signing in…');
    try {
      const r = await api('login', { method: 'POST', body: { password: e.target.password.value } });
      csrf = r.csrf; e.target.reset(); showApp(); await refresh();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { setBusy(btn, false); }
  });

  $('logoutBtn').addEventListener('click', async () => {
    try { await api('logout', { method: 'POST' }); } catch (e) {}
    csrf = null; showLogin();
  });

  /* ---------------- tabs ---------------- */
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (b) switchTab(b.dataset.tab);
  });
  function switchTab(t) {
    tab = t;
    document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== t; });
    scrollTo({ top: 0 });
    if (t === 'entries') loadEntries();
    if (t === 'history') loadHistory();
    if (t === 'draw') refresh();
  }

  /* ---------------- draw tab ---------------- */
  async function refresh() {
    if (!csrf) return;
    try { S = await api('state'); renderDraw(); } catch (e) { /* handled */ }
  }

  function fmtDate(sec) {
    return new Date(sec * 1000).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function countdown(sec) {
    let s = Math.max(0, Math.round(sec - Date.now() / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    s %= 60;
    return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + m + 'm ' + s + 's';
  }

  function renderDraw() {
    const g = S.giveaway, st = S.stats, drawn = g.status === 'drawn';
    $('kEntries').textContent = st.total; $('kEligible').textContent = st.eligible;
    $('kIps').textContent = st.ips; $('kShared').textContent = st.shared_ip_entries;
    $('kSharedWrap').classList.toggle('warn', st.shared_ip_entries > 0);
    $('stLastHour').textContent = st.last_hour ? '+' + st.last_hour + ' in the last hour' : '';
    $('stTitle').textContent = g.title;

    const b = $('stBadge');
    if (drawn) { b.className = 'badge gold'; b.textContent = 'FINISHED · WINNERS DRAWN'; }
    else if (g.accepting) { b.className = 'badge green'; b.innerHTML = '<span class="dot live"></span>ENTRIES OPEN'; }
    else { b.className = 'badge'; b.textContent = 'ENTRIES CLOSED'; }

    $('stLine').textContent = drawn
      ? `Drawn ${fmtDate(g.drawn_at)} (${g.drawn_by === 'schedule' ? 'scheduled' : 'manual'}) · ${S.winners.length} winners`
      : `${g.winners_count} winners · ${money(g.budget, g.currency)} budget · ${g.split_mode === 'random' ? 'random split' : 'equal split'}`;

    $('liveControls').hidden = drawn; $('scheduleBox').hidden = drawn; $('finishedBox').hidden = !drawn;
    $('toggleOpenBtn').textContent = g.status === 'open' ? 'Close entries' : 'Open entries';
    $('toggleOpenBtn').className = g.status === 'open' ? 'btn danger' : 'btn';

    $('schedInfo').hidden = !g.draw_at || drawn;
    if (g.draw_at) $('schedBadge').textContent = 'Draw at ' + fmtDate(g.draw_at) + ' · in ' + countdown(g.draw_at);

    // Winners
    $('winnersCard').hidden = !drawn;
    if (drawn) {
      const paid = S.winners.reduce((a, w) => a + Number(w.prize || 0), 0);
      $('winTotal').textContent = money(paid, g.currency) + ' total';
      $('winnersAdmin').innerHTML = S.winners.map(w => `
        <div class="erow win">
          <div class="main-line"><span class="rank ${w.win_rank <= 3 ? 'r' + w.win_rank : ''}" style="width:30px;height:30px;font-size:12px;">#${w.win_rank}</span>
            <b>${esc(w.game_name)}</b><span class="amt display" style="font-size:24px;color:var(--gold);">${esc(money(w.prize, g.currency))}</span></div>
          <div class="acts"><button class="btn sm ghost" data-replace="${w.id}" type="button">Replace</button></div>
          <div class="meta">
            <span>UID <b class="mono copy" data-copy="${esc(w.game_uid)}">${esc(w.game_uid)}</b></span>
            <span class="copy" data-copy="${esc(w.email)}">${esc(w.email)}</span>
            <span class="mono">IP ${esc(w.ip)}</span>
          </div>
        </div>`).join('') || '<p class="empty">No winners.</p>';
    }

    // Config form (don't clobber while the admin is typing)
    if (!formDirty) fillConfig(g);
    $('lockBadge').hidden = !drawn;
    document.querySelectorAll('#configForm .lockable').forEach(i => { i.disabled = drawn; });
    document.querySelectorAll('#splitSeg button').forEach(x => { x.disabled = drawn; });
  }

  function fillConfig(g) {
    const f = $('configForm');
    f.title.value = g.title; f.subtitle.value = g.subtitle;
    f.winners_count.value = g.winners_count; f.budget.value = g.budget; f.min_prize.value = g.min_prize;
    f.currency.value = g.currency; f.max_per_ip.value = g.max_per_ip; f.unique_ip_winners.checked = g.unique_ip_winners;
    setSplit(g.split_mode);
  }

  function setSplit(mode) {
    splitMode = mode;
    document.querySelectorAll('#splitSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('minPrizeField').style.opacity = mode === 'random' ? '1' : '.45';
    $('configForm').min_prize.disabled = mode !== 'random' || (S && S.giveaway.status === 'drawn');
    preview();
  }
  $('splitSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) { formDirty = true; setSplit(b.dataset.mode); } });

  function preview() {
    const f = $('configForm');
    const n = Math.max(0, parseInt(f.winners_count.value || '0', 10));
    const budget = Math.max(0, parseInt(f.budget.value || '0', 10));
    const min = Math.max(0, parseInt(f.min_prize.value || '0', 10));
    const cur = f.currency.value || '₹';
    const el = $('splitPreview');
    if (!n) { el.textContent = 'Set the number of winners.'; return; }
    if (budget === 0) { el.textContent = `${n} winners, no cash prize (budget is 0).`; return; }
    if (splitMode === 'equal') {
      const each = Math.floor(budget / n), rem = budget % n;
      el.textContent = `Each of the ${n} winners gets ${money(each, cur)}` + (rem ? ` (${rem} get +1)` : '') + '.';
    } else {
      if (min * n > budget) { el.textContent = `⚠ Budget too small: ${n} × ${money(min, cur)} = ${money(min * n, cur)}.`; return; }
      el.textContent = `Random amounts for ${n} winners, each at least ${money(min, cur)}, adding up to exactly ${money(budget, cur)}. #1 gets the biggest.`;
    }
    const eligible = S ? S.stats.eligible : 0;
    if (S && S.giveaway.status !== 'drawn' && eligible < n) el.textContent += ` Only ${eligible} eligible entries so far — if that stays, everyone eligible wins.`;
  }
  $('configForm').addEventListener('input', () => { formDirty = true; preview(); });

  $('configForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const body = {
      title: f.title.value, subtitle: f.subtitle.value,
      winners_count: f.winners_count.value, budget: f.budget.value, min_prize: f.min_prize.value || 0,
      split_mode: splitMode, currency: f.currency.value, max_per_ip: f.max_per_ip.value || 0,
      unique_ip_winners: f.unique_ip_winners.checked,
    };
    try { await act('save_config', body, $('saveCfgBtn'), 'Settings saved'); formDirty = false; renderDraw(); } catch (e) {}
  });

  $('toggleOpenBtn').addEventListener('click', e => {
    const open = S.giveaway.status !== 'open';
    act('set_status', { status: open ? 'open' : 'paused' }, e.currentTarget, open ? 'Entries are open' : 'Entries closed').catch(() => {});
  });

  $('drawNowBtn').addEventListener('click', async e => {
    const g = S.giveaway;
    if (formDirty) { toast('Save your settings first.', 'error'); return; }
    const ok = await confirmDialog({
      title: 'Start the draw now?',
      message: `This picks ${g.winners_count} random winners from ${S.stats.eligible} eligible entries and splits ${money(g.budget, g.currency)}. Entries close and the result goes live on the site instantly. This cannot be undone.`,
      confirmText: 'Draw winners',
    });
    if (ok) act('draw_now', {}, e.currentTarget, 'Winners drawn! They are live on the site.').catch(() => {});
  });

  $('schedBtn').addEventListener('click', e => {
    const v = $('schedInput').value;
    if (!v) { toast('Pick a date and time first.', 'error'); return; }
    if (formDirty) { toast('Save your settings first.', 'error'); return; }
    const at = Math.floor(new Date(v).getTime() / 1000);
    act('schedule', { draw_at: at }, e.currentTarget, 'Draw scheduled · entries are open').catch(() => {});
  });
  $('schedCancelBtn').addEventListener('click', e => act('schedule', { draw_at: null }, e.currentTarget, 'Schedule cancelled').catch(() => {}));

  $('newGiveawayBtn').addEventListener('click', async e => {
    const ok = await confirmDialog({ title: 'Start a new giveaway?', message: 'A fresh round starts with the same settings and entries closed. The finished giveaway moves to History.', confirmText: 'Start new' });
    if (ok) { formDirty = false; act('new_giveaway', {}, e.currentTarget, 'New giveaway created. Open entries when ready.').catch(() => {}); }
  });

  $('winnersAdmin').addEventListener('click', async e => {
    const b = e.target.closest('[data-replace]'); if (!b) return;
    const ok = await confirmDialog({ title: 'Replace this winner?', message: 'They will be disqualified and a new random entrant gets the same rank and prize. The site updates instantly.', confirmText: 'Replace', danger: true });
    if (ok) act('replace_winner', { entry_id: Number(b.dataset.replace) }, b, 'Winner replaced').catch(() => {});
  });

  $('kSharedWrap').addEventListener('click', () => { setFilter('shared_ip'); switchTab('entries'); });

  // Click-to-copy
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-copy]'); if (!c) return;
    navigator.clipboard?.writeText(c.dataset.copy).then(() => toast('Copied'), () => {});
  });

  /* ---------------- entries tab ---------------- */
  let eFilter = 'all', ePage = 1, eTimer = 0;
  function setFilter(f) {
    eFilter = f; ePage = 1;
    document.querySelectorAll('#eFilter button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === f)));
  }
  $('eFilter').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setFilter(b.dataset.f); loadEntries(); } });
  $('eSearch').addEventListener('input', () => { clearTimeout(eTimer); eTimer = setTimeout(() => { ePage = 1; loadEntries(); }, 300); });

  async function loadEntries() {
    let r;
    try { r = await api('entries', { params: { q: $('eSearch').value.trim(), filter: eFilter, page: ePage } }); }
    catch (e) { toast(e.message, 'error'); return; }
    const cur = S ? S.giveaway.currency : '₹';
    $('eCount').textContent = `${r.total} ${r.total === 1 ? 'entry' : 'entries'}` + (eFilter === 'shared_ip' ? ' sharing an IP with another entry (grouped by IP)' : '');
    let lastIp = null;
    $('eList').innerHTML = r.rows.map(x => {
      const shared = Number(x.ip_count) > 1;
      const sep = eFilter === 'shared_ip' && x.ip !== lastIp ? `<div class="eyebrow" style="margin-top:8px;">IP ${esc(x.ip)} · ${x.ip_count} entries</div>` : '';
      lastIp = x.ip;
      return sep + `
      <div class="erow ${x.disqualified == 1 ? 'dq' : ''} ${x.win_rank ? 'win' : ''}">
        <div class="main-line">
          <b>${esc(x.game_name)}</b>
          ${x.win_rank ? `<span class="badge gold">#${x.win_rank} · ${esc(money(x.prize, cur))}</span>` : ''}
          ${x.disqualified == 1 ? '<span class="badge red">Disqualified</span>' : ''}
        </div>
        <div class="acts">
          ${x.win_rank ? '' : `<button class="btn sm ghost" data-dq="${x.id}" type="button">${x.disqualified == 1 ? 'Restore' : 'Disqualify'}</button>
          <button class="btn sm danger" data-del="${x.id}" type="button" aria-label="Delete entry">✕</button>`}
        </div>
        <div class="meta">
          <span>UID <b class="mono copy" data-copy="${esc(x.game_uid)}">${esc(x.game_uid)}</b></span>
          <span class="copy" data-copy="${esc(x.email)}">${esc(x.email)}</span>
          <span class="mono">IP ${esc(x.ip)} ${shared ? `<button class="badge red ipchip" data-ip="${esc(x.ip)}" type="button" title="Show all entries from this IP">Shared ×${x.ip_count}</button>` : ''}</span>
          <span title="${esc(new Date(x.created_at * 1000).toLocaleString())}">${ago(x.created_at)}</span>
          <span class="faint" style="font-size:12px;" title="${esc(x.user_agent)}">${esc(deviceOf(x.user_agent))}</span>
        </div>
      </div>`;
    }).join('') || '<p class="empty">No entries found.</p>';

    $('ePager').innerHTML = r.pages > 1
      ? `<button class="btn sm" data-p="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>← Prev</button><span class="faint">Page ${r.page} of ${r.pages}</span><button class="btn sm" data-p="${r.page + 1}" ${r.page >= r.pages ? 'disabled' : ''}>Next →</button>`
      : '';
  }

  function deviceOf(ua) {
    if (!ua) return '';
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Other';
    const br = /Edg\//.test(ua) ? 'Edge' : /OPR|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return os + (br ? ' · ' + br : '');
  }

  $('ePager').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { ePage = Number(b.dataset.p); loadEntries(); scrollTo({ top: 0 }); } });
  $('eList').addEventListener('click', async e => {
    const ip = e.target.closest('[data-ip]');
    if (ip) { $('eSearch').value = ip.dataset.ip; setFilter('all'); loadEntries(); return; }
    const dq = e.target.closest('[data-dq]');
    if (dq) { try { await api('toggle_dq', { method: 'POST', body: { entry_id: Number(dq.dataset.dq) } }); loadEntries(); refresh(); } catch (ex) { toast(ex.message, 'error'); } return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      const ok = await confirmDialog({ title: 'Delete this entry?', message: 'It is removed permanently. Use Disqualify instead if you want to keep a record.', confirmText: 'Delete', danger: true });
      if (!ok) return;
      try { await api('delete_entry', { method: 'POST', body: { entry_id: Number(del.dataset.del) } }); toast('Entry deleted'); loadEntries(); refresh(); } catch (ex) { toast(ex.message, 'error'); }
    }
  });

  /* ---------------- history tab ---------------- */
  async function loadHistory() {
    let r;
    try { r = await api('history'); } catch (e) { toast(e.message, 'error'); return; }
    $('histList').innerHTML = r.rows.map(g => `
      <details data-gid="${g.id}">
        <summary>
          <div class="row"><b>${esc(g.title)}</b><span class="spacer"></span>
            <span class="badge ${g.status === 'drawn' ? 'gold' : g.status === 'open' ? 'green' : ''}">${g.status === 'drawn' ? 'Drawn' : g.status === 'open' ? 'Open' : 'Closed'}</span></div>
          <span class="faint" style="font-size:13px;">#${g.id} · created ${new Date(g.created_at * 1000).toLocaleDateString()} · ${g.entries} entries · ${g.winners} winners · ${esc(money(g.paid, g.currency))} awarded</span>
        </summary>
        <div class="stack" style="padding-bottom:16px;">
          <div class="elist" data-winners>Loading…</div>
          <a class="btn sm" href="${API}?action=export&giveaway=${g.id}">⬇ Export all entries (CSV)</a>
        </div>
      </details>`).join('') || '<p class="empty">No giveaways yet.</p>';
  }
  $('histList').addEventListener('toggle', async e => {
    const d = e.target; if (!d.open || d.dataset.loaded) return;
    d.dataset.loaded = '1';
    const box = d.querySelector('[data-winners]');
    try {
      const r = await api('winners', { params: { giveaway: d.dataset.gid } });
      box.innerHTML = r.rows.map(w => `<div class="erow win"><div class="main-line"><b>#${w.win_rank} ${esc(w.game_name)}</b><span style="color:var(--gold)">${esc(String(w.prize))}</span></div><div></div>
        <div class="meta"><span class="mono copy" data-copy="${esc(w.game_uid)}">UID ${esc(w.game_uid)}</span><span class="copy" data-copy="${esc(w.email)}">${esc(w.email)}</span><span class="mono">IP ${esc(w.ip)}</span></div></div>`).join('') || '<p class="faint" style="margin:0;">No winners drawn.</p>';
    } catch (ex) { box.textContent = ex.message; }
  }, true);

  /* ---------------- settings ---------------- */
  $('pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button[type=submit]');
    setBusy(btn, true);
    try {
      const r = await api('change_password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
      if (r.csrf) csrf = r.csrf;
      f.reset(); toast('Password updated', 'success');
    } catch (ex) { toast(ex.message, 'error'); }
    finally { setBusy(btn, false); }
  });

  /* ---------------- boot ---------------- */
  // Live refresh: keeps entry counts and the schedule countdown fresh
  setInterval(() => { if (csrf && tab === 'draw' && !document.hidden) refresh(); }, 10000);
  setInterval(() => { if (S && S.giveaway.draw_at && S.giveaway.status !== 'drawn' && tab === 'draw') $('schedBadge').textContent = 'Draw at ' + fmtDate(S.giveaway.draw_at) + ' · in ' + countdown(S.giveaway.draw_at); }, 1000);

  // Default schedule input: one hour from now, rounded
  (function () {
    const d = new Date(Date.now() + 3600e3); d.setMinutes(0, 0, 0);
    const p = n => String(n).padStart(2, '0');
    $('schedInput').value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  })();

  (async function boot() {
    try {
      const me = await api('me');
      if (me.authed) { csrf = me.csrf; showApp(); await refresh(); } else showLogin();
    } catch (e) { showLogin(); $('loginError').textContent = 'Cannot reach the server API.'; $('loginError').hidden = false; }
  })();
})();
