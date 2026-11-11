/* Lord Erebus — public giveaway page */
(function () {
  'use strict';
  const { Sound, Wheel, confetti, toast, esc, money, setBusy } = window.LE;
  const API = 'api/public.php';
  const $ = id => document.getElementById(id);

  const sound = new Sound();
  const pointer = $('pointer');
  const wheel = new Wheel($('wheel'), {
    onTick: i => { sound.tick(i); pointer.classList.remove('tick'); void pointer.offsetWidth; pointer.classList.add('tick'); },
  });

  let state = null;          // last state from server
  let clockOffset = 0;       // server_time - local time (seconds)
  let revealing = false;
  let showFormAnyway = false;
  let myUid = '';
  try { myUid = localStorage.getItem('le_uid') || ''; } catch (e) {}

  /* ---------------- data ---------------- */
  async function load() {
    try {
      const url = API + '?action=state' + (myUid ? '&uid=' + encodeURIComponent(myUid) : '') + '&_=' + Date.now();
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed');
      clockOffset = data.server_time - Date.now() / 1000;
      const prev = state;
      state = data;
      render(prev);
    } catch (e) {
      if (!state) setBadge('red', 'OFFLINE', false);
    }
  }

  function schedulePoll() {
    const delay = document.hidden ? 20000 : 5000;
    setTimeout(async () => { await load(); schedulePoll(); }, delay);
  }

  const now = () => Date.now() / 1000 + clockOffset;

  /* ---------------- render ---------------- */
  function setBadge(cls, text, live) {
    const b = $('statusBadge');
    b.className = 'badge ' + cls;
    b.innerHTML = `<span class="dot ${live ? 'live' : ''}"></span><span>${esc(text)}</span>`;
  }

  function render(prev) {
    const g = state.giveaway;
    if (!g) { setBadge('', 'NO GIVEAWAY YET', false); return; }
    const cur = g.currency;
    const drawingNow = g.status !== 'drawn' && g.draw_at && g.draw_at <= now();

    // Title + copy
    const words = g.title.trim().split(/\s+/);
    $('gTitle').innerHTML = words.length > 1
      ? esc(words.slice(0, -1).join(' ')) + ' <em>' + esc(words[words.length - 1]) + '</em>'
      : esc(g.title);
    $('gSubtitle').textContent = g.subtitle || '';
    document.title = g.title + ' — Lord Erebus';

    // Badge
    if (g.status === 'drawn') setBadge('gold', 'WINNERS ANNOUNCED', false);
    else if (drawingNow) setBadge('red', 'DRAWING WINNERS…', true);
    else if (g.accepting) setBadge('red', 'LIVE · ENTRIES OPEN', true);
    else setBadge('', 'ENTRIES CLOSED', false);

    // Numbers
    const pool = g.budget > 0 ? money(g.budget, cur) : 'Rewards';
    $('tPool').textContent = pool; $('sPool').textContent = pool;
    $('tWinners').textContent = g.winners_count; $('sWinners').textContent = state.winners.length || g.winners_count;
    $('tEntries').textContent = state.entries.toLocaleString('en-IN'); $('sEntries').textContent = state.entries.toLocaleString('en-IN');

    // Countdown
    $('countdownWrap').hidden = !(g.draw_at && g.status !== 'drawn' && !drawingNow);
    tickCountdown();

    // Hero CTAs
    const ctas = $('heroCtas');
    const enterBtn = g.accepting && !(state.me && state.me.entered) ? '<a class="btn primary lg" href="#enter">Enter now</a>' : '';
    const watch = g.status === 'drawn' ? '<a class="btn gold lg" href="#live">See winners</a>' : '<a class="btn ghost lg" href="#live">Watch live draw</a>';
    ctas.innerHTML = enterBtn + watch;

    // Wheel
    wheel.setSegments(state.wheel.map(s => ({ label: s.name, rank: s.rank })));
    $('wheelCaption').textContent = g.status === 'drawn'
      ? 'Winners were drawn ' + new Date(g.drawn_at * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + '.'
      : state.wheel.length ? 'Showing the latest entrants. The wheel spins when the draw starts.' : 'Be the first to enter!';

    renderEntryCard();
    updateSticky();

    // Winners + live reveal
    const justDrawn = prev && prev.giveaway && prev.giveaway.id === g.id && prev.giveaway.status !== 'drawn' && g.status === 'drawn';
    if (justDrawn) reveal();
    else if (!revealing) {
      renderWinners();
      if (g.status === 'drawn') {
        wheel.stopIdle();
        if (!prev) { const i = state.wheel.findIndex(s => s.rank === 1); if (i >= 0) wheel.spinTo(i, { duration: 1600 }); }
      } else wheel.startIdle();
    }
  }

  function renderWinners() {
    const g = state.giveaway, list = $('winnersList');
    if (g.status !== 'drawn') {
      $('winnersBadge').className = 'badge'; $('winnersBadge').textContent = 'Not drawn yet';
      list.innerHTML = `<li style="display:block" class="empty">Winners appear here the moment they are drawn.</li>`;
      return;
    }
    $('winnersBadge').className = 'badge gold'; $('winnersBadge').textContent = state.winners.length + ' winners';
    if (!state.winners.length) { list.innerHTML = '<li style="display:block" class="empty">No winners.</li>'; return; }
    const meRank = state.me && state.me.won ? state.me.rank : null;
    list.innerHTML = state.winners.map(w => `
      <li class="${w.rank === meRank ? 'me' : ''}">
        <span class="rank ${w.rank <= 3 ? 'r' + w.rank : ''}">#${w.rank}</span>
        <span class="who"><b>${esc(w.name)}${w.rank === meRank ? ' (you)' : ''}</b><small class="mono">UID ${esc(w.uid)}</small></span>
        <span class="amt">${w.prize > 0 ? esc(money(w.prize, g.currency)) : '🏆'}</span>
      </li>`).join('');
  }

  function renderEntryCard() {
    const g = state.giveaway, me = state.me, box = $('entryState'), form = $('entryFormWrap');
    let html = '';
    if (me && me.won) {
      html = `<div class="big-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3"/></svg></div>
        <h3>You won${me.prize ? ' ' + esc(money(me.prize, g.currency)) : ''}!</h3>
        <p>Rank #${me.rank}. We'll contact you on your Gmail. Check your inbox and spam folder.</p>`;
      box.className = 'entry-state won';
    } else if (me && me.entered && !showFormAnyway) {
      html = `<div class="big-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></div>
        <h3>${g.status === 'drawn' ? 'Not this time' : "You're in!"}</h3>
        <p>UID <b class="mono">${esc(myUid)}</b> is entered.${g.status === 'drawn' ? ' Better luck next giveaway!' : ' Keep this page open for the live draw.'}</p>
        ${g.accepting ? '<button class="btn ghost sm" type="button" id="anotherBtn">Enter a different UID</button>' : ''}`;
      box.className = 'entry-state';
    } else if (!g.accepting) {
      const done = g.status === 'drawn';
      html = `<div class="big-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
        <h3>${done ? 'Giveaway finished' : 'Entries closed'}</h3>
        <p>${done ? 'Winners are announced below. Follow Lord Erebus for the next one!' : 'Entries are not open right now. Check back soon!'}</p>
        ${done ? '<a class="btn gold" href="#live">See winners</a>' : ''}`;
      box.className = 'entry-state closed';
    }
    form.hidden = !!html;
    box.hidden = !html;
    if (html) {
      box.innerHTML = html;
      const another = $('anotherBtn');
      if (another) another.onclick = () => { showFormAnyway = true; renderEntryCard(); $('entryForm').game_uid.focus(); };
    }
  }

  /* ---------------- countdown ---------------- */
  function tickCountdown() {
    if (!state || !state.giveaway || !state.giveaway.draw_at || $('countdownWrap').hidden) return;
    let s = Math.max(0, Math.floor(state.giveaway.draw_at - now()));
    const parts = { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
    document.querySelectorAll('#countdown [data-u]').forEach(el => { el.textContent = String(parts[el.dataset.u]).padStart(2, '0'); });
    $('countdown').firstElementChild.hidden = parts.d === 0;
    if (s === 0) load();
  }
  setInterval(tickCountdown, 1000);

  /* ---------------- live reveal ---------------- */
  async function reveal() {
    revealing = true;
    wheel.stopIdle();
    document.getElementById('live').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const g = state.giveaway;
    const top = state.winners.slice(0, 3).reverse(); // build up to #1
    $('winnersList').innerHTML = '';
    $('winnersBadge').className = 'badge red'; $('winnersBadge').innerHTML = '<span class="dot live"></span>Drawing…';
    for (const w of top) {
      const idx = state.wheel.findIndex(s => s.rank === w.rank);
      await wheel.spinTo(idx, { duration: top.length > 1 ? 5200 : 6500 });
      sound.fanfare();
      confetti(w.rank === 1 ? 4200 : 2200);
      await showWinnerCard(w, g.currency);
    }
    revealing = false;
    renderWinners();
    renderEntryCard();
    if (state.me && state.me.won) { confetti(5000); sound.fanfare(); }
  }

  function showWinnerCard(w, cur) {
    return new Promise(resolve => {
      const el = document.createElement('div');
      el.className = 'winner-overlay';
      el.innerHTML = `<div class="winner-card" role="dialog" aria-modal="true" aria-label="Winner">
        <span class="badge gold">${w.rank === 1 ? '★ GRAND WINNER' : 'WINNER #' + w.rank}</span>
        <div class="winner-name">${esc(w.name)}</div>
        <div class="muted mono">UID ${esc(w.uid)}</div>
        <div class="winner-prize">${w.prize > 0 ? esc(money(w.prize, cur)) : '🏆'}</div>
        <button class="btn primary block" type="button">Continue</button></div>`;
      const close = () => { clearTimeout(timer); el.remove(); resolve(); };
      const timer = setTimeout(close, 4500);
      el.addEventListener('click', e => { if (e.target === el || e.target.tagName === 'BUTTON') close(); });
      document.body.appendChild(el);
    });
  }

  /* ---------------- entry form ---------------- */
  const form = $('entryForm');
  form.game_uid.addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });

  function fieldError(name, msg) {
    const f = form.querySelector(`[data-f="${name}"]`);
    if (!f) return;
    f.classList.toggle('invalid', !!msg);
    f.querySelector('.err').textContent = msg || '';
  }

  function validate() {
    const v = { game_uid: form.game_uid.value.trim(), game_name: form.game_name.value.trim(), email: form.email.value.trim().toLowerCase() };
    const errs = {};
    if (!/^\d{5,15}$/.test(v.game_uid)) errs.game_uid = 'UID must be 5–15 digits, numbers only.';
    if (!v.game_name) errs.game_name = 'Enter your in-game name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errs.email = 'Enter a valid email.';
    else if (!/@(gmail|googlemail)\.com$/.test(v.email)) errs.email = 'Please use your Gmail address (@gmail.com).';
    ['game_uid', 'game_name', 'email'].forEach(k => fieldError(k, errs[k]));
    return Object.keys(errs).length ? null : v;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    sound.unlock();
    $('formError').hidden = true;
    const v = validate();
    if (!v) { form.querySelector('.invalid .input')?.focus(); return; }
    const btn = $('submitBtn');
    setBusy(btn, true, 'Submitting…');
    try {
      const res = await fetch(API + '?action=enter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...v, website: form.website.value }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: 'Server error. Please try again.' }));
      if (!data.ok) {
        if (data.fields) Object.entries(data.fields).forEach(([k, m]) => fieldError(k, m));
        $('formError').textContent = data.error; $('formError').hidden = false;
        // Already entered with this UID → remember it so the page shows their status
        if (res.status === 409 && data.fields && data.fields.game_uid) { rememberUid(v.game_uid); }
        return;
      }
      rememberUid(v.game_uid);
      showFormAnyway = false;
      form.reset();
      toast(data.message || "You're in!", 'success');
      confetti(2200); sound.fanfare();
      await load();
    } catch (err) {
      $('formError').textContent = 'Network error. Check your connection and try again.';
      $('formError').hidden = false;
    } finally {
      setBusy(btn, false);
    }
  });

  function rememberUid(uid) {
    myUid = uid;
    try { localStorage.setItem('le_uid', uid); } catch (e) {}
  }

  /* ---------------- chrome ---------------- */
  const topbar = $('topbar');
  const onScroll = () => topbar.classList.toggle('scrolled', scrollY > 20);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  let enterVisible = true;
  new IntersectionObserver(es => { enterVisible = es[0].isIntersecting; updateSticky(); }, { threshold: 0.1 }).observe($('enter'));
  function updateSticky() {
    const bar = $('stickyCta');
    if (!state || !state.giveaway) return;
    const g = state.giveaway;
    const entered = state.me && state.me.entered;
    const show = !enterVisible && scrollY > 200 && (g.accepting && !entered || g.status === 'drawn');
    bar.classList.toggle('show', show);
    bar.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (g.status === 'drawn') {
      $('stickyTitle').textContent = 'Winners announced';
      $('stickySub').textContent = state.winners.length + ' winners · ' + (g.budget ? money(g.budget, g.currency) : 'rewards');
      $('stickyBtn').textContent = 'See winners'; $('stickyBtn').href = '#live';
    } else {
      $('stickyTitle').textContent = g.budget ? money(g.budget, g.currency) + ' prize pool' : 'Giveaway is live';
      $('stickySub').textContent = g.winners_count + ' winners · free entry';
      $('stickyBtn').textContent = 'Enter now'; $('stickyBtn').href = '#enter';
    }
  }
  addEventListener('scroll', () => state && updateSticky(), { passive: true });

  const soundBtn = $('soundBtn');
  soundBtn.setAttribute('aria-pressed', String(sound.enabled));
  soundBtn.addEventListener('click', () => { sound.unlock(); sound.setEnabled(!sound.enabled); soundBtn.setAttribute('aria-pressed', String(sound.enabled)); });

  // Falling sakura petals (matches the artwork)
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const petals = $('petals');
    for (let i = 0; i < 16; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = 9 + Math.random() * 10 + 's';
      p.style.animationDelay = -Math.random() * 18 + 's';
      p.style.setProperty('--dx', (Math.random() * 160 - 40) + 'px');
      p.style.transform = `scale(${0.6 + Math.random() * 0.8})`;
      petals.appendChild(p);
    }
  }

  $('year').textContent = new Date().getFullYear();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  load().then(schedulePoll);
})();
