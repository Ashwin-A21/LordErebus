/* Lord Erebus — gallery wall, modelled on the vivmgmt.com home gallery.
 *  - 5 staggered columns of 3:4 cards on a track wider than the screen.
 *    Desktop: the track pans left/right following the mouse (lerp 0.05).
 *    Phones: native horizontal swipe, centred on load.
 *  - Scrolling lifts every column, each with its own lag.
 *  - A looping timeline visits one column at a time: the top two cards dip and fade,
 *    the top card swaps to the next clip/photo, then they rise back.
 *  - Entrance: the wall starts zoomed in (1.3x) and settles while cards fade in.
 * Clips are pre-cropped to the centre (portrait), sped up 1.6x and colour graded.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const G = 'assets/gallery/';
  const UID = '1747454789';

  /* ---------------- media ---------------- */
  const clip = (n, label) => ({ type: 'video', src: `${G}clip${n}.mp4`, wide: `${G}clip${n}-wide.mp4`, poster: `${G}clip${n}.jpg`, label, color: ['#2a0a12', '#1b0c2c', '#26100a'][n % 3] });
  const pic = (n, label) => ({ type: 'image', src: `${G}char${n}.jpg`, label, color: '#1f0b14' });
  const uidTile = { type: 'uid', src: `${G}char1.jpg`, label: 'Profile', color: '#2a0a12' };

  const C = {}; for (let i = 1; i <= 9; i++) C[i] = clip(i, ['', 'Push', 'Drop', 'Scope', 'Flank', 'Rush', 'Clutch', 'Spray', 'Eagle', 'One-tap'][i]);
  const P = { 1: pic(1, 'Fit'), 2: pic(2, 'Emote'), 3: pic(3, 'Throne') };

  // stack = visible cards top→bottom, cycle = what the top card rotates through
  const COLUMNS = [
    { stack: [C[1], P[1], C[5], C[8], P[3]], cycle: [C[1], P[2], C[7]] },
    { stack: [C[2], C[6], P[2], C[9], C[3]], cycle: [C[2], P[3], C[4]] },
    { stack: [P[3], uidTile, C[7], P[1], C[2]], cycle: [P[3], C[5], C[9]] },
    { stack: [C[3], P[2], C[8], C[5], C[1]], cycle: [C[3], P[1], C[6]] },
    { stack: [C[9], C[4], P[1], C[6], C[4]], cycle: [C[9], P[2], C[8]] },
  ];
  const OFFSETS = [0, 0.516, 0.218, 0.516, 0]; // column start offsets in card heights
  const LAG = [0.5, 0.8, 0.2, 0.3, 0.6];        // per-column follow duration (s)
  const SHIFT = 1.25;                            // how far columns travel while scrolling (card heights)

  const wall = $('gwall'), stage = $('gstage'), view = $('gview'), track = $('gtrack');
  if (!wall) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- build DOM ---------------- */
  function tileHTML(m, first) {
    const chip = `<span class="grain" aria-hidden="true"></span><span class="chip"><i></i>${m.type === 'video' ? 'Clip · ' : ''}${m.label}</span>`;
    if (m.type === 'uid') {
      return `<div class="gtile uidtile" data-wrap data-kind="uid" style="background-color:${m.color}">
        <img src="${m.src}" alt="" loading="lazy" decoding="async" draggable="false">
        <div class="uidtxt"><span class="eyebrow" style="color:#fff">Add me · UID</span><b>${UID}</b><span class="faint" style="font-size:12px">Tap to copy</span></div></div>`;
    }
    const isV = m.type === 'video';
    // the first card of each column carries both elements so it can switch type while cycling
    const img = (first || !isV) ? `<img data-media src="${isV ? '' : m.src}" alt="Lord Erebus ${m.label}" loading="${first ? 'eager' : 'lazy'}" decoding="async" draggable="false" style="display:${isV ? 'none' : 'block'}">` : '';
    const vid = (first || isV) ? `<video data-media ${isV ? `src="${m.src}" poster="${m.poster}"` : ''} muted loop playsinline preload="${isV ? 'metadata' : 'none'}" style="display:${isV ? 'block' : 'none'}"></video>` : '';
    return `<div class="gtile" data-wrap data-src="${m.src}" style="background-color:${m.color}">${img}${vid}${chip}</div>`;
  }
  track.innerHTML = COLUMNS.map((col, ci) =>
    `<div class="gcol" data-col style="margin-top:calc(var(--colw) * 4 / 3 * ${OFFSETS[ci]})">${col.stack.map((m, ti) => tileHTML(m, ti === 0)).join('')}</div>`
  ).join('');

  const colEls = [...track.querySelectorAll('[data-col]')];
  const videos = () => [...track.querySelectorAll('video')];

  /* ---------------- play only clips that are on screen ---------------- */
  let wallVisible = false;
  const vio = new IntersectionObserver(es => es.forEach(e => {
    const v = e.target;
    if (e.isIntersecting && wallVisible && v.style.display !== 'none' && v.getAttribute('src')) v.play().catch(() => {});
    else v.pause();
  }), { root: null, threshold: 0.2 });
  videos().forEach(v => vio.observe(v));

  /* ---------------- horizontal pan (desktop: follows mouse; phone: swipe) ---------------- */
  const desktop = matchMedia('(min-width: 992px)');
  let cur = 0, target = 0, center = 0, max = 0;
  function measure() {
    if (!desktop.matches) {
      track.style.transform = '';
      view.scrollLeft = (track.scrollWidth - view.clientWidth) / 2;
      return;
    }
    max = Math.max(0, track.scrollWidth - view.clientWidth);
    center = -max / 2; cur = target = center;
  }
  view.addEventListener('pointermove', e => {
    if (!desktop.matches || e.pointerType !== 'mouse') return;
    const r = view.getBoundingClientRect();
    target = -max * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }, { passive: true });
  view.addEventListener('pointerleave', () => { target = center; }, { passive: true });
  (function loop() {
    if (desktop.matches) { cur += 0.05 * (target - cur); track.style.transform = `translate3d(${cur}px,0,0)`; }
    requestAnimationFrame(loop);
  })();
  addEventListener('resize', measure, { passive: true });
  measure();
  addEventListener('load', measure);

  /* ---------------- viewer ---------------- */
  const all = [];
  COLUMNS.forEach(c => [...c.stack, ...c.cycle].forEach(m => { if (m.type !== 'uid' && !all.includes(m)) all.push(m); }));
  let down = { x: 0, y: 0 };
  view.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  view.addEventListener('click', e => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // it was a drag/swipe
    const w = e.target.closest('[data-wrap]'); if (!w) return;
    if (w.dataset.kind === 'uid') return copyUid();
    const i = all.findIndex(m => m.src === w.dataset.src);
    if (i >= 0) openViewer(i);
  });

  function openViewer(i) {
    const el = document.createElement('div');
    el.className = 'gviewer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    const render = () => {
      const m = all[i];
      el.innerHTML = `<div class="frame">${m.type === 'video'
        ? `<video src="${m.wide}" poster="${m.poster}" autoplay loop muted playsinline controls></video>`
        : `<img src="${m.src}" alt="Lord Erebus ${m.label}">`}
        <div class="meta"><span>${m.type === 'video' ? 'Clip' : 'Photo'} · ${m.label}</span><span>${i + 1} / ${all.length}</span></div></div>
        <button class="icon-btn nav prev" data-d="-1" aria-label="Previous">‹</button>
        <button class="icon-btn nav next" data-d="1" aria-label="Next">›</button>
        <button class="btn sm ghost close" data-close>Close</button>`;
    };
    const step = d => { i = (i + d + all.length) % all.length; render(); };
    const close = () => { el.remove(); removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); };
    el.addEventListener('click', e => {
      if (e.target.dataset.d) return step(Number(e.target.dataset.d));
      if (e.target === el || e.target.hasAttribute('data-close')) close();
    });
    let sx = null;
    el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); sx = null; });
    addEventListener('keydown', onKey);
    render(); document.body.appendChild(el);
  }

  /* ---------------- copy UID ---------------- */
  function copyUid() {
    const done = () => window.LE && LE.toast('UID ' + UID + ' copied. Add me in Free Fire!', 'success');
    if (navigator.clipboard) navigator.clipboard.writeText(UID).then(done, done); else done();
  }
  const cb = $('copyUidBtn'); if (cb) cb.addEventListener('click', copyUid);

  /* ---------------- motion (GSAP) ---------------- */
  function start() {
    const io = new IntersectionObserver(([e]) => {
      wallVisible = e.isIntersecting;
      videos().forEach(v => { vio.unobserve(v); vio.observe(v); }); // re-evaluate play state
      if (window.__gtl) wallVisible ? window.__gtl.play() : window.__gtl.pause();
    }, { threshold: 0.12 });
    io.observe(wall);

    if (!window.gsap || !window.ScrollTrigger || reduced) return;
    const { gsap, ScrollTrigger } = window;
    gsap.registerPlugin(ScrollTrigger);
    const media = [...track.querySelectorAll('[data-media]')];
    const tileH = () => (colEls[0] ? colEls[0].offsetWidth : 300) * 4 / 3;

    // entrance
    gsap.set(stage, { scale: 1.3, y: '5vh', transformOrigin: 'center top' });
    gsap.set(media, { opacity: 0 });
    gsap.set('[data-gword]', { clipPath: 'inset(0 100% 0 0)' });
    gsap.set('[data-gtag]', { opacity: 0 });
    let introDone = false;
    ScrollTrigger.create({
      trigger: wall, start: 'top 80%', once: true,
      onEnter: () => {
        gsap.to(media, { opacity: 1, duration: 0.8, ease: 'power1.out', stagger: 0.03 });
        gsap.timeline({ delay: 0.5, onComplete: () => { introDone = true; measure(); } })
          .to(stage, { scale: 1, y: 0, duration: 1.5, ease: 'power2.out' }, 0)
          .to('[data-gword]', { clipPath: 'inset(0 0% 0 0)', duration: 1.5, ease: 'power3.inOut' }, 0)
          .to('[data-gtag]', { opacity: 1, duration: 0.6 }, 1.4);
      },
    });

    // scroll: columns rise with different lag
    const movers = colEls.map((c, i) => gsap.quickTo(c, 'y', { duration: LAG[i], ease: 'power3' }));
    ScrollTrigger.create({
      trigger: wall, start: 'top 75%', end: 'bottom bottom', invalidateOnRefresh: true,
      onUpdate: self => movers.forEach(m => m(-self.progress * tileH() * SHIFT)),
    });

    // cycling timeline: one column at a time
    const states = colEls.map((col, ci) => {
      const wraps = [...col.querySelectorAll('[data-wrap]')].slice(0, 2);
      const first = wraps[0];
      return {
        wraps, first, img: first.querySelector('img'), vid: first.querySelector('video'),
        second: wraps[1] ? [...wraps[1].querySelectorAll('[data-media]')] : [],
        cycle: COLUMNS[ci].cycle, index: 0, type: COLUMNS[ci].cycle[0].type,
      };
    });
    const current = s => (s.type === 'video' ? s.vid : s.img);
    const tl = gsap.timeline({ repeat: -1, paused: true });
    let at = 0;
    states.forEach((s, i) => {
      const n = at;
      tl.to(s.wraps, { y: 70, duration: 1, ease: 'power1.inOut' }, n);
      tl.call(() => gsap.to([current(s), ...s.second], { opacity: 0, duration: 0.9, ease: 'sine.inOut' }), [], n + 0.1);
      tl.call(() => {
        s.index = (s.index + 1) % s.cycle.length;
        const next = s.cycle[s.index];
        if (next.type === 'video') {
          s.vid.src = next.src; s.vid.poster = next.poster;
          s.img.style.display = 'none'; s.vid.style.display = 'block'; s.vid.style.opacity = 0;
          s.vid.play().catch(() => {});
        } else {
          s.img.src = next.src; s.vid.pause();
          s.vid.style.display = 'none'; s.img.style.display = 'block'; s.img.style.opacity = 0;
        }
        s.type = next.type;
        s.first.dataset.src = next.src;
        s.first.querySelector('.chip').innerHTML = `<i></i>${next.type === 'video' ? 'Clip · ' : ''}${next.label}`;
        gsap.to(s.first, { backgroundColor: next.color, duration: 0.5 });
      }, [], n + 1.12);
      tl.to(s.wraps, { y: 0, duration: 1, ease: 'power1.inOut' }, n + 1.12);
      tl.call(() => gsap.to([current(s), ...s.second], { opacity: 1, duration: 0.85, ease: 'sine.inOut' }), [], n + 1.12);
      if (i === states.length - 1) tl.to({}, { duration: 3 }, n + 2.12);
      else at = n + 0.62;
    });
    window.__gtl = tl;
    const kick = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) gsap.delayedCall(introDone ? 0 : 2.2, () => wallVisible && tl.play());
    }, { threshold: 0.15 });
    kick.observe(wall);
  }

  if (document.readyState === 'complete') start(); else addEventListener('load', start);
})();
