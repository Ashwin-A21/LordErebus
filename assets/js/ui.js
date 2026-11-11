/* Lord Erebus — shared UI helpers: sound, confetti, toasts, dialogs, wheel. */
(function () {
  'use strict';
  const TAU = Math.PI * 2;

  /* ---------- Sound (Web Audio, no files) ---------- */
  class Sound {
    constructor() {
      this.ctx = null; this.last = 0;
      try { this.enabled = localStorage.getItem('le_sound') !== 'off'; } catch (e) { this.enabled = true; }
      document.addEventListener('pointerdown', () => this.unlock(), { once: true });
    }
    unlock() {
      try {
        this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { this.ctx = null; }
    }
    setEnabled(v) { this.enabled = v; try { localStorage.setItem('le_sound', v ? 'on' : 'off'); } catch (e) {} }
    ok() { return this.enabled && this.ctx && this.ctx.state === 'running'; }
    tick(intensity = 1) {
      if (!this.ok()) return;
      const now = this.ctx.currentTime;
      if (now - this.last < 0.035) return;
      this.last = now;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'triangle'; o.frequency.value = 1500 + Math.random() * 300;
      g.gain.setValueAtTime(0.05 * Math.min(intensity, 1.5), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      o.connect(g).connect(this.ctx.destination); o.start(now); o.stop(now + 0.06);
    }
    fanfare() {
      if (!this.ok()) return;
      const now = this.ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = now + i * 0.11;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + 0.65);
      });
    }
  }

  /* ---------- Confetti ---------- */
  function confetti(duration = 3800) {
    let canvas = document.getElementById('confettiCanvas');
    if (!canvas) { canvas = document.createElement('canvas'); canvas.id = 'confettiCanvas'; document.body.appendChild(canvas); }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = (canvas.width = innerWidth * dpr), H = (canvas.height = innerHeight * dpr);
    const colors = ['#ff1f3d', '#ffcf5a', '#b03cff', '#ffffff', '#ff7a90', '#2fd47c'];
    const parts = [];
    const burst = (x, dir) => {
      for (let i = 0; i < 90; i++) {
        const a = -Math.PI / 2 + dir * (0.25 + Math.random() * 0.65), sp = (9 + Math.random() * 14) * dpr;
        parts.push({ x, y: H, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: (5 + Math.random() * 7) * dpr, r: Math.random() * TAU, vr: (Math.random() - .5) * .4, c: colors[(Math.random() * colors.length) | 0], shape: Math.random() < .3, wob: Math.random() * TAU });
      }
    };
    burst(W * 0.08, 1); burst(W * 0.92, -1);
    const start = performance.now();
    (function frame(t) {
      const el = t - start;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.32 * dpr; p.vx *= .985; p.vy *= .985; p.wob += .1;
        p.x += p.vx + Math.sin(p.wob) * dpr; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, el - duration + 900) / 900);
        ctx.fillStyle = p.c;
        if (p.shape) { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, TAU); ctx.fill(); }
        else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, (p.s / 2) * (.4 + Math.abs(Math.sin(p.wob))));
        ctx.restore();
      }
      if (el < duration) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(start);
  }

  /* ---------- Toast + confirm ---------- */
  function toast(msg, type = '') {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg; box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, type === 'error' ? 5000 : 3200);
  }

  function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="dlgT">
        <h3 id="dlgT">${esc(title)}</h3><p>${esc(message)}</p>
        <div class="actions"><button class="btn ghost" data-a="no" type="button">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes" type="button">${esc(confirmText)}</button></div></div>`;
      const done = v => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') done(false); };
      wrap.addEventListener('click', e => {
        if (e.target === wrap || e.target.dataset.a === 'no') done(false);
        if (e.target.dataset.a === 'yes') done(true);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      wrap.querySelector('[data-a="yes"]').focus();
    });
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function money(n, cur = '₹') {
    return cur + Number(n || 0).toLocaleString('en-IN');
  }
  function ago(sec) {
    const s = Math.max(0, Date.now() / 1000 - sec);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return new Date(sec * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>' + (label ? esc(label) : ''); }
    else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  }

  /* ---------- Wheel ---------- */
  const PALETTE = [['#ff1f3d', '#fff'], ['#16121b', '#f1e9f3'], ['#8f0e25', '#ffe3e8'], ['#221630', '#e9d6ff'], ['#c8123a', '#fff'], ['#0f0d13', '#ff8193']];

  class Wheel {
    constructor(canvas, { onTick, logo = 'assets/logo.jpg', emptyText = 'Waiting for entries' } = {}) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.onTick = onTick; this.emptyText = emptyText;
      this.segments = []; this.rot = 0; this.spinning = false; this.lastIndex = -1; this.face = null; this.idle = 0;
      this.hub = new Image(); this.hub.src = logo; this.hub.onload = () => this.draw();
      this.resize();
      new ResizeObserver(() => this.resize()).observe(canvas);
    }
    resize() {
      const w = this.canvas.getBoundingClientRect().width || 420;
      const size = Math.max(280, Math.floor(w * Math.min(2, devicePixelRatio || 1)));
      if (this.canvas.width !== size) { this.canvas.width = this.canvas.height = size; this.face = null; this.draw(); }
    }
    setSegments(list) {
      const key = JSON.stringify(list.map(s => s.label));
      if (key === this._key) return;
      this._key = key; this.segments = list; this.face = null; this.draw();
    }
    colorIndex(i, n) { let p = i % PALETTE.length; if (i === n - 1 && n > 1 && p === 0) p = 2; return p; }
    renderFace() {
      const S = this.canvas.width, R = S / 2, rim = R * 0.94, n = this.segments.length, seg = n ? TAU / n : TAU;
      const off = document.createElement('canvas'); off.width = off.height = S;
      const c = off.getContext('2d'); c.translate(R, R);
      if (!n) { c.beginPath(); c.arc(0, 0, rim, 0, TAU); c.fillStyle = '#16121b'; c.fill(); }
      for (let i = 0; i < n; i++) {
        const a0 = i * seg - Math.PI / 2;
        c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, rim, a0, a0 + seg); c.closePath();
        c.fillStyle = PALETTE[this.colorIndex(i, n)][0]; c.fill();
        if (n > 1) { c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = Math.max(1, S / 700); c.stroke(); }
      }
      const shade = c.createRadialGradient(0, 0, rim * .15, 0, 0, rim);
      shade.addColorStop(0, 'rgba(0,0,0,.45)'); shade.addColorStop(.55, 'rgba(0,0,0,0)'); shade.addColorStop(.92, 'rgba(255,255,255,.06)'); shade.addColorStop(1, 'rgba(0,0,0,.35)');
      c.fillStyle = shade; c.beginPath(); c.arc(0, 0, rim, 0, TAU); c.fill();
      if (n && n <= 90) {
        const maxW = rim * .58, fs = Math.max(9, Math.min(rim * .075, seg * rim * .72 * .62));
        c.textAlign = 'right'; c.textBaseline = 'middle'; c.font = `600 ${fs}px Inter, sans-serif`;
        for (let i = 0; i < n; i++) {
          let label = this.segments[i].label;
          while (c.measureText(label).width > maxW && label.length > 3) label = label.slice(0, -1);
          if (label !== this.segments[i].label) label = label.slice(0, -1) + '…';
          c.save(); c.rotate((i + .5) * seg - Math.PI / 2);
          c.fillStyle = PALETTE[this.colorIndex(i, n)][1]; c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = fs * .3;
          c.fillText(label, rim * .9, 0); c.restore();
        }
      }
      c.lineWidth = S * .012; c.strokeStyle = '#ff1f3d'; c.shadowColor = '#ff1f3d'; c.shadowBlur = S * .03;
      c.beginPath(); c.arc(0, 0, rim, 0, TAU); c.stroke(); c.shadowBlur = 0;
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * TAU;
        c.beginPath(); c.arc(Math.cos(a) * R * .97, Math.sin(a) * R * .97, S * .0085, 0, TAU);
        c.fillStyle = i % 2 ? '#ffcf5a' : '#fff'; c.shadowColor = c.fillStyle; c.shadowBlur = S * .012; c.fill();
      }
      this.face = off;
    }
    draw() {
      const S = this.canvas.width, R = S / 2, x = this.ctx;
      if (!this.face) this.renderFace();
      x.clearRect(0, 0, S, S);
      x.save(); x.translate(R, R); x.rotate(this.rot); x.drawImage(this.face, -R, -R); x.restore();
      const hubR = R * .17;
      x.save(); x.translate(R, R);
      x.shadowColor = 'rgba(255,31,61,.8)'; x.shadowBlur = S * .04;
      x.beginPath(); x.arc(0, 0, hubR + S * .012, 0, TAU); x.fillStyle = '#0a0709'; x.fill();
      x.shadowBlur = 0; x.lineWidth = S * .008; x.strokeStyle = '#ff1f3d'; x.stroke();
      x.beginPath(); x.arc(0, 0, hubR, 0, TAU); x.clip();
      if (this.hub.complete && this.hub.naturalWidth) x.drawImage(this.hub, -hubR * 1.15, -hubR * 1.15, hubR * 2.3, hubR * 2.3);
      x.restore();
      if (!this.segments.length) {
        x.save(); x.translate(R, R); x.fillStyle = 'rgba(255,255,255,.55)';
        x.font = `500 ${S * .036}px Inter, sans-serif`; x.textAlign = 'center'; x.fillText(this.emptyText, 0, R * .45); x.restore();
      }
    }
    indexAtPointer() {
      const n = this.segments.length; if (!n) return -1;
      return Math.floor((((-this.rot) % TAU) + TAU) % TAU / (TAU / n)) % n;
    }
    /** Slow idle rotation while waiting for the draw. */
    startIdle() {
      if (this.idle || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const step = () => { if (!this.spinning) { this.rot += 0.0025; this.draw(); } this.idle = requestAnimationFrame(step); };
      this.idle = requestAnimationFrame(step);
    }
    stopIdle() { cancelAnimationFrame(this.idle); this.idle = 0; }
    spinTo(index, { duration = 6500 } = {}) {
      const n = this.segments.length;
      if (!n || index < 0) return Promise.resolve();
      const seg = TAU / n, jitter = n > 1 ? (Math.random() - .5) * seg * .6 : 0;
      const target = -(index + .5) * seg + jitter, from = this.rot;
      const mod = (a, b) => ((a % b) + b) % b;
      const to = from + (5 + Math.floor(Math.random() * 3)) * TAU + mod(target - from, TAU);
      const ease = t => 1 - Math.pow(1 - t, 4.2);
      this.spinning = true;
      return new Promise(resolve => {
        const t0 = performance.now();
        const step = now => {
          const t = Math.min(1, (now - t0) / duration);
          this.rot = from + (to - from) * ease(t); this.draw();
          const idx = this.indexAtPointer();
          if (idx !== this.lastIndex) { this.lastIndex = idx; this.onTick && this.onTick(1 - t); }
          if (t < 1) requestAnimationFrame(step); else { this.spinning = false; resolve(); }
        };
        requestAnimationFrame(step);
      });
    }
  }

  window.LE = { Sound, Wheel, confetti, toast, confirmDialog, esc, money, ago, setBusy };
})();
