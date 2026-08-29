/* ============================================================================
   Aelloo.in — premium cinematic script.js
   ----------------------------------------------------------------------------
   Sections in this file:
     0.  Utilities & globals
     1.  Capability detection (reduced motion, touch, DPR)
     2.  Persistent ambient canvas (background stars + gradient orbs)
     3.  Hero Three.js galaxy (loads only if THREE is available; else fallback)
     4.  Custom cursor
     5.  Magnetic hover on [data-magnetic] elements
     6.  3D tilt on [data-tilt] elements (pointer-driven)
     7.  Scroll reveal (IntersectionObserver, staggered)
     8.  Reveal lines (hero h1 split via --i)
     9.  Parallax on [data-parallax] elements
    10.  Stats counter (data-count)
    11.  Nav scrolled state + mobile menu
    12.  FAQ single-open accordion nicety
    13.  Contact form micro-interactions
    14.  Smooth in-page anchor scroll with nav offset
    15.  Boot order & master tick
   ============================================================================ */

(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  0. Utilities & globals
   * ------------------------------------------------------------------ */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  const raf = (fn) => requestAnimationFrame(fn);

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp  = (a, b, t) => a + (b - a) * t;

  const prefersReducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch =
    ('ontouchstart' in window) ||
    (navigator.maxTouchPoints > 0) ||
    (window.matchMedia && window.matchMedia('(hover: none)').matches);
  const isCoarsePointer =
    window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  // DPR capped so very high-density phones don't melt
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  // Persistent rAF clock (one master tick) — any subsystem can subscribe.
  const subscribers = new Set();
  let lastT = performance.now();
  function tick(now) {
    const dt = Math.min(64, now - lastT); // clamp huge gaps (tab returns)
    lastT = now;
    subscribers.forEach((fn) => {
      try { fn(now, dt); } catch (e) { /* never let one subscriber kill the loop */ }
    });
    raf(tick);
  }
  raf(tick);
  function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }

  // Global pointer state — everything that responds to the cursor reads from here.
  const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, nx: 0.5, ny: 0.5 };
  on(window, 'pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.nx = e.clientX / window.innerWidth;
    pointer.ny = e.clientY / window.innerHeight;
  }, { passive: true });

  /* ------------------------------------------------------------------ *
   *  1. Capability detection
   * ------------------------------------------------------------------ */
  function applyCapabilityClasses() {
    const html = document.documentElement;
    if (prefersReducedMotion) html.classList.add('rm');
    if (isTouch) {
      html.classList.add('is-touch');
      document.body.classList.add('no-cursor'); // CSS hides .cursor
    } else {
      html.classList.add('has-cursor');
    }
    if (isCoarsePointer) html.classList.add('coarse-pointer');
  }
  applyCapabilityClasses();

  /* ------------------------------------------------------------------ *
   *  2. Persistent nature-journey scene
   *     One full-page canvas, entirely hand-drawn (no images, no 3D
   *     library) driven by scroll position. The journey:
   *       mountain valley (golden hour) → descent through the water's
   *       surface → underwater world → ocean floor at the footer.
   *     Always behind everything (z-index 0). Pauses on hidden tab.
   * ------------------------------------------------------------------ */
  function initNatureScene() {
    const canvas = $('#ambient-canvas');
    if (!canvas) return () => {};

    const ctx = canvas.getContext('2d', { alpha: true });
    let w = 0, h = 0;
    let visible = true;
    let t = 0;

    const dense = !isCoarsePointer; // fewer particles on phones/tablets

    /* ---- tuning: journey zone boundaries, as a fraction of total scroll --- */
    const ZONE = {
      mountainFadeStart: 0.05,
      mountainFadeEnd:   0.22,
      waterStart:        0.08,
      waterEnd:          0.34,
      floorStart:        0.80,
      floorEnd:          1.00,
    };
    const smoothstep = (a, b, x) => {
      const tt = clamp((x - a) / (b - a || 1), 0, 1);
      return tt * tt * (3 - 2 * tt);
    };
    const lerpColor = (c1, c2, tt) => [
      Math.round(lerp(c1[0], c2[0], tt)),
      Math.round(lerp(c1[1], c2[1], tt)),
      Math.round(lerp(c1[2], c2[2], tt)),
    ];
    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    /* ---- color stops for the journey ---- */
    const SKY_TOP    = [255, 217, 150]; // warm gold, high sky
    const SKY_HORIZON = [255, 140, 120]; // coral near the sun
    const DUSK_LOW   = [108, 60, 190];  // violet dusk near the mountains
    const WATER_TOP  = [10, 130, 165];  // teal just under the surface
    const WATER_MID  = [8, 60, 120];    // mid-depth blue
    const WATER_DEEP = [6, 16, 36];     // near-black deep blue at the floor

    /* ---- persistent particle state, seeded once per resize ---- */
    let birds = [], waterfallDrops = [], mist = [], fish = [], bubbles = [],
        seaweed = [], godRays = [], boulders = [], bioSpecks = [], treeLayers = [];

    let sunX = 0, sunY = 0, sunR = 0;
    let waterfallX = 0, waterfallTopY = 0, waterfallBaseY = 0;

    function seedScene() {
      // ---- Birds: a handful of simple V-silhouettes drifting across the sky
      const birdCount = dense ? 5 : 3;
      birds = Array.from({ length: birdCount }, () => ({
        x: Math.random() * w,
        y: h * (0.10 + Math.random() * 0.22),
        speed: 0.010 + Math.random() * 0.014,
        amp: 8 + Math.random() * 14,
        phase: Math.random() * Math.PI * 2,
        flap: Math.random() * Math.PI * 2,
        size: 5 + Math.random() * 4,
      }));

      // ---- Waterfall: falls down the right third of the mountain scene
      waterfallX = w * 0.72;
      waterfallTopY = h * 0.06;
      waterfallBaseY = h * 0.46;
      const dropCount = dense ? 46 : 26;
      waterfallDrops = Array.from({ length: dropCount }, () => ({
        x: waterfallX + (Math.random() - 0.5) * 22,
        y: waterfallTopY + Math.random() * (waterfallBaseY - waterfallTopY),
        len: 10 + Math.random() * 18,
        speed: 0.55 + Math.random() * 0.5,
        alpha: 0.25 + Math.random() * 0.35,
      }));
      const mistCount = dense ? 22 : 12;
      mist = Array.from({ length: mistCount }, () => ({
        x: waterfallX + (Math.random() - 0.5) * 60,
        y: waterfallBaseY - Math.random() * 20,
        r: 6 + Math.random() * 14,
        vy: -0.01 - Math.random() * 0.02,
        life: Math.random(),
        speed: 0.002 + Math.random() * 0.003,
      }));

      // ---- Foreground tree/greenery silhouette (layered soft hill shapes)
      treeLayers = [
        { baseY: h, amp: h * 0.05, color: [22, 14, 30], speed: 0.00018 },
        { baseY: h, amp: h * 0.035, color: [14, 9, 20], speed: 0.00026 },
      ];

      // ---- Fish: simple silhouettes at varied depth/speed/direction
      const fishCount = dense ? 12 : 7;
      fish = Array.from({ length: fishCount }, () => ({
        x: Math.random() * w,
        y: h * (0.3 + Math.random() * 0.6),
        dir: Math.random() < 0.5 ? 1 : -1,
        speed: 0.02 + Math.random() * 0.05,
        size: 7 + Math.random() * 10,
        wob: Math.random() * Math.PI * 2,
        color: Math.random() < 0.5 ? [255, 217, 61] : [0, 210, 255],
      }));

      // ---- Bubbles: continuous rising stream
      const bubbleCount = dense ? 40 : 22;
      bubbles = Array.from({ length: bubbleCount }, () => ({
        x: Math.random() * w,
        y: h + Math.random() * h,
        r: 1.5 + Math.random() * 4,
        speed: 0.03 + Math.random() * 0.05,
        wobPhase: Math.random() * Math.PI * 2,
        wobSpeed: 0.5 + Math.random() * 1.2,
      }));

      // ---- Seaweed at the edges
      const weedCount = dense ? 12 : 7;
      seaweed = Array.from({ length: weedCount }, (_, i) => ({
        x: i % 2 === 0 ? w * (0.02 + Math.random() * 0.10) : w * (0.88 + Math.random() * 0.10),
        baseY: h,
        segs: 5 + Math.floor(Math.random() * 3),
        segLen: 14 + Math.random() * 10,
        phase: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 0.6,
        hue: Math.random() < 0.5 ? [0, 150, 130] : [80, 60, 190],
      }));

      // ---- God rays
      godRays = Array.from({ length: 4 }, (_, i) => ({
        x: w * (0.15 + i * 0.24),
        width: w * 0.10,
        drift: Math.random() * Math.PI * 2,
      }));

      // ---- Ocean-floor boulders (fixed silhouette shapes)
      boulders = Array.from({ length: 5 }, (_, i) => ({
        x: w * (0.06 + i * 0.22 + Math.random() * 0.05),
        rx: 30 + Math.random() * 46,
        ry: 16 + Math.random() * 20,
      }));

      // ---- Bioluminescent specks near the floor
      const speckCount = dense ? 16 : 8;
      bioSpecks = Array.from({ length: speckCount }, () => ({
        x: Math.random() * w,
        yFrac: 0.75 + Math.random() * 0.25, // fraction down the floor band
        r: 1 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
        speed: 0.8 + Math.random() * 1.4,
        hue: Math.random() < 0.5 ? [255, 217, 61] : [0, 210, 255],
      }));

      sunX = w * 0.30;
      sunY = h * 0.22;
      sunR = Math.min(w, h) * 0.09;
    }

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width  = Math.floor(w * DPR);
      canvas.height = Math.floor(h * DPR);
      canvas.style.width  = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      seedScene();
    }

    /* ---- drawing helpers ---- */
    function drawMountainLayer(baseY, ampl, offsetPx, color, alpha) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      const step = w / 8;
      for (let i = 0; i <= 8; i++) {
        const x = i * step;
        const peak = baseY - ampl * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7 + offsetPx)));
        ctx.lineTo(x, peak);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = rgba(color, alpha);
      ctx.fill();
    }

    function drawSun(alpha) {
      const grad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 3.2);
      grad.addColorStop(0, `rgba(255,246,214,${0.9 * alpha})`);
      grad.addColorStop(0.35, `rgba(255,204,120,${0.35 * alpha})`);
      grad.addColorStop(1, 'rgba(255,204,120,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunR * 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = `rgba(255,250,235,${alpha})`;
      ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawBird(b, alpha) {
      const flapY = Math.sin(b.flap) * b.size * 0.5;
      ctx.strokeStyle = `rgba(30,22,20,${alpha})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(b.x - b.size, b.y + flapY);
      ctx.quadraticCurveTo(b.x, b.y - b.size * 0.6, b.x + b.size, b.y + flapY);
      ctx.stroke();
    }

    function drawWaterfall(alpha) {
      ctx.strokeStyle = `rgba(220,240,255,${alpha})`;
      ctx.lineWidth = 1.4;
      for (const d of waterfallDrops) {
        ctx.globalAlpha = d.alpha * alpha;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x, d.y + d.len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const m of mist) {
        const grad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
        grad.addColorStop(0, `rgba(255,255,255,${0.22 * alpha * (1 - m.life)})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawForeground(alpha) {
      for (const layer of treeLayers) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        const step = w / 10;
        for (let i = 0; i <= 10; i++) {
          const x = i * step;
          const sway = Math.sin(t * layer.speed + i) * 4;
          const peak = layer.baseY - layer.amp * (0.5 + 0.5 * Math.sin(i * 2.3)) + sway - h * 0.06;
          ctx.lineTo(x, peak);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = rgba(layer.color, alpha);
        ctx.fill();
      }
    }

    function drawFish(f, alpha) {
      ctx.save();
      ctx.translate(f.x, f.y + Math.sin(f.wob) * 6);
      ctx.scale(f.dir, 1);
      ctx.fillStyle = rgba(f.color, alpha * 0.85);
      ctx.beginPath();
      ctx.ellipse(0, 0, f.size, f.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-f.size, 0);
      ctx.lineTo(-f.size - f.size * 0.7, -f.size * 0.4);
      ctx.lineTo(-f.size - f.size * 0.7, f.size * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawBubble(b, alpha) {
      ctx.strokeStyle = `rgba(220,245,255,${0.35 * alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    function drawSeaweed(s, alpha) {
      ctx.strokeStyle = rgba(s.hue, 0.55 * alpha);
      ctx.lineWidth = 3;
      ctx.beginPath();
      let x = s.x, y = s.baseY;
      ctx.moveTo(x, y);
      for (let i = 1; i <= s.segs; i++) {
        const sway = Math.sin(t * s.speed * 0.001 + s.phase + i * 0.6) * (6 + i * 1.5);
        x += sway * 0.12;
        y -= s.segLen;
        ctx.quadraticCurveTo(x + sway, y + s.segLen / 2, x, y);
      }
      ctx.stroke();
    }

    function drawGodRays(alpha) {
      if (alpha <= 0.02) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const r of godRays) {
        const drift = Math.sin(t * 0.00015 + r.drift) * 30;
        const grad = ctx.createLinearGradient(r.x + drift, 0, r.x + drift + r.width, h);
        grad.addColorStop(0, `rgba(180,230,255,${0.05 * alpha})`);
        grad.addColorStop(1, 'rgba(180,230,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(r.x + drift - r.width * 0.3, 0);
        ctx.lineTo(r.x + drift + r.width * 0.3, 0);
        ctx.lineTo(r.x + drift + r.width * 1.4, h);
        ctx.lineTo(r.x + drift - r.width * 1.4, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    function drawFloor(riseAlpha) {
      if (riseAlpha <= 0.01) return;
      const floorY = h - h * 0.26 * riseAlpha;

      // ---- sand bed: a real warm sand color, not a near-black rectangle ----
      const SAND_LIT  = [196, 168, 118];  // sunlit sand, near the surface line
      const SAND_DEEP = [58, 46, 34];     // shadowed sand near the very bottom
      const sandGrad = ctx.createLinearGradient(0, floorY, 0, h);
      sandGrad.addColorStop(0, rgba(SAND_LIT, 0.0));
      sandGrad.addColorStop(0.18, rgba(SAND_LIT, 0.55 * riseAlpha));
      sandGrad.addColorStop(1, rgba(SAND_DEEP, 0.95 * riseAlpha));
      ctx.fillStyle = sandGrad;
      ctx.beginPath();
      ctx.moveTo(0, floorY);
      const step = w / 12;
      for (let i = 0; i <= 12; i++) {
        const x = i * step;
        const ripple = Math.sin(i * 1.3 + t * 0.0002) * h * 0.008;
        ctx.lineTo(x, floorY + ripple);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();

      // ---- fine sand ripple lines for texture ----
      ctx.strokeStyle = rgba([120, 96, 68], 0.25 * riseAlpha);
      ctx.lineWidth = 1;
      for (let r = 0; r < 5; r++) {
        const ry = floorY + (h - floorY) * (0.25 + r * 0.16);
        ctx.beginPath();
        for (let i = 0; i <= 12; i++) {
          const x = i * step;
          const wob = Math.sin(i * 0.9 + r * 1.7 + t * 0.00015) * 5;
          if (i === 0) ctx.moveTo(x, ry + wob); else ctx.lineTo(x, ry + wob);
        }
        ctx.stroke();
      }

      // ---- boulders: lit top / shadowed underside, actually visible now ----
      for (const b of boulders) {
        const by = h - b.ry * 0.55;
        const boulderGrad = ctx.createRadialGradient(
          b.x - b.rx * 0.3, by - b.ry * 0.4, 2,
          b.x, by, b.rx * 1.1
        );
        boulderGrad.addColorStop(0, rgba([132, 122, 112], 0.95 * riseAlpha));
        boulderGrad.addColorStop(0.55, rgba([84, 76, 70], 0.95 * riseAlpha));
        boulderGrad.addColorStop(1, rgba([38, 34, 32], 0.95 * riseAlpha));
        ctx.fillStyle = boulderGrad;
        ctx.beginPath();
        ctx.ellipse(b.x, by, b.rx, b.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        // contact shadow grounds it in the sand
        ctx.fillStyle = rgba([20, 16, 14], 0.4 * riseAlpha);
        ctx.beginPath();
        ctx.ellipse(b.x, by + b.ry * 0.75, b.rx * 0.9, b.ry * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const s of bioSpecks) {
        const y = floorY + (h - floorY) * s.yFrac;
        const tw = 0.5 + 0.5 * Math.sin(t * 0.002 * s.speed + s.phase);
        ctx.fillStyle = rgba(s.hue, riseAlpha * tw * 0.9);
        ctx.beginPath();
        ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function render(now, dt) {
      if (!visible) return;
      t += dt;

      const docH = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const p = clamp(window.scrollY / docH, 0, 1);

      const mountainAlpha = 1 - smoothstep(ZONE.mountainFadeStart, ZONE.mountainFadeEnd, p);
      const waterLevel   = smoothstep(ZONE.waterStart, ZONE.waterEnd, p);
      const floorRise    = smoothstep(ZONE.floorStart, ZONE.floorEnd, p);

      // ---- background vertical gradient: warm sky → underwater → deep floor
      const topColor = lerpColor(SKY_TOP, WATER_TOP, waterLevel);
      const midColor = lerpColor(SKY_HORIZON, WATER_MID, waterLevel);
      const lowColor = lerpColor(DUSK_LOW, WATER_DEEP, Math.max(waterLevel, floorRise));

      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgba(topColor, 1));
      grad.addColorStop(0.55, rgba(midColor, 1));
      grad.addColorStop(1, rgba(lowColor, 1));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // ---- mountain scene (fades out on descent) ----
      if (mountainAlpha > 0.02) {
        drawMountainLayer(h * 0.62, h * 0.16, t * 0.00004, DUSK_LOW, 0.35 * mountainAlpha);
        drawMountainLayer(h * 0.70, h * 0.20, t * 0.00007 + 3, [70, 40, 120], 0.55 * mountainAlpha);
        drawSun(mountainAlpha);
        drawMountainLayer(h * 0.78, h * 0.22, t * 0.00010 + 6, [40, 22, 70], 0.85 * mountainAlpha);
        drawWaterfall(mountainAlpha);
        for (const b of birds) drawBird(b, mountainAlpha);
        drawForeground(mountainAlpha);
      }

      // ---- underwater scene (fades in on descent, present through mid-page) ----
      if (waterLevel > 0.03) {
        drawGodRays(waterLevel);
        for (const f of fish) drawFish(f, waterLevel);
        for (const b of bubbles) drawBubble(b, waterLevel);
        for (const s of seaweed) drawSeaweed(s, waterLevel);
      }

      // ---- ocean floor (rises in near the footer) ----
      drawFloor(floorRise);

      // ---- update particle motion ----
      for (const b of birds) {
        b.x += b.speed * dt;
        if (b.x > w + 30) b.x = -30;
        b.flap += 0.01 * dt;
      }
      for (const d of waterfallDrops) {
        d.y += d.speed * dt;
        if (d.y > waterfallBaseY) { d.y = waterfallTopY - Math.random() * 20; d.x = waterfallX + (Math.random() - 0.5) * 22; }
      }
      for (const m of mist) {
        m.y += m.vy * dt;
        m.life += m.speed * dt * 0.02;
        if (m.life >= 1) { m.life = 0; m.y = waterfallBaseY; m.x = waterfallX + (Math.random() - 0.5) * 60; }
      }
      for (const f of fish) {
        f.x += f.speed * f.dir * dt;
        f.wob += 0.004 * dt;
        if (f.dir > 0 && f.x > w + 40) f.x = -40;
        if (f.dir < 0 && f.x < -40) f.x = w + 40;
      }
      for (const b of bubbles) {
        b.y -= b.speed * dt;
        b.x += Math.sin(t * 0.001 * b.wobSpeed + b.wobPhase) * 0.15;
        if (b.y < -10) { b.y = h + 10; b.x = Math.random() * w; }
      }

      // ---- zone class for CSS text theming ----
      const zone = p < ZONE.mountainFadeStart ? 'mountain'
        : p < ZONE.waterEnd ? (waterLevel < 0.5 ? 'descent' : 'underwater')
        : p < ZONE.floorStart ? 'underwater'
        : 'floor';
      if (document.body.dataset.zone !== zone) document.body.dataset.zone = zone;
    }

    on(window, 'resize', resize, { passive: true });
    on(document, 'visibilitychange', () => { visible = !document.hidden; });

    resize();

    if (prefersReducedMotion) {
      // Draw one static frame so the page still looks intentional, then stop.
      render(performance.now(), 16);
      return () => {};
    }

    const unsub = subscribe(render);
    return unsub;
  }
  /* ------------------------------------------------------------------ *
   *  4. Custom cursor
   *     - mix-blend-mode: difference
   *     - grows on hoverable elements
   *     - never on touch
   * ------------------------------------------------------------------ */
  function initCursor() {
    if (isTouch) return;
    const cursor = $('#cursor');
    if (!cursor) return;

    const dot  = $('.cursor__dot',   cursor);
    const ring = $('.cursor__ring',  cursor);

    let tx = pointer.x, ty = pointer.y;
    let rx = pointer.x, ry = pointer.y;

    on(window, 'pointermove', (e) => {
      tx = e.clientX;
      ty = e.clientY;
    }, { passive: true });

    on(window, 'pointerdown', () => cursor.classList.add('is-down'));
    on(window, 'pointerup',   () => cursor.classList.remove('is-down'));

    // Anything "interactive" should grow the cursor.
    const hoverSel = 'a, button, [data-magnetic], [data-tilt], .reel__frame, summary, .faq, .pillar, .plan, .quote, .field input, .field select, .field textarea';
    on(document, 'pointerover', (e) => {
      if (e.target.closest && e.target.closest(hoverSel)) {
        cursor.classList.add('is-hover');
      }
    }, { passive: true });
    on(document, 'pointerout', (e) => {
      if (e.target.closest && e.target.closest(hoverSel)) {
        cursor.classList.remove('is-hover');
      }
    }, { passive: true });

    // Hide when leaving the window
    on(document, 'mouseleave', () => { cursor.style.opacity = '0'; });
    on(document, 'mouseenter', () => { cursor.style.opacity = '1'; });

    subscribe((now, dt) => {
      // Dot tracks the pointer fast; ring follows with lag.
      // (Fixed: use the dt the master tick already computed, rather than
      // re-diffing against the shared `lastT`, which has already been
      // advanced to `now` by the time subscribers run — that always gave
      // ~0 and froze the ring.)
      const dtFactor = Math.min(1, dt / 16);
      tx = lerp(tx, pointer.x, 1);
      ty = lerp(ty, pointer.y, 1);
      rx = lerp(rx, tx, 0.22 * dtFactor);
      ry = lerp(ry, ty, 0.22 * dtFactor);

      dot.style.transform  = `translate3d(${tx}px, ${ty}px, 0)`;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    });
  }

  /* ------------------------------------------------------------------ *
   *  5. Magnetic hover — elements marked [data-magnetic] gently
   *     pull toward the cursor and spring back when left.
   * ------------------------------------------------------------------ */
  function initMagnetics() {
    if (isTouch || prefersReducedMotion) return;
    const els = $$('[data-magnetic]');
    if (!els.length) return;

    els.forEach((el) => {
      let tx = 0, ty = 0, cx = 0, cy = 0;
      const strength = parseFloat(el.dataset.magneticStrength || '0.35');

      function onMove(e) {
        const r = el.getBoundingClientRect();
        // Offset from element center, normalized to [-1, 1]
        const dx = (e.clientX - (r.left + r.width  / 2)) / (r.width  / 2 || 1);
        const dy = (e.clientY - (r.top  + r.height / 2)) / (r.height / 2 || 1);
        tx = clamp(dx, -1, 1) * r.width  * strength * 0.18;
        ty = clamp(dy, -1, 1) * r.height * strength * 0.18;
      }
      function onLeave() { tx = 0; ty = 0; }

      on(el, 'pointermove', onMove);
      on(el, 'pointerleave', onLeave);

      subscribe(() => {
        cx = lerp(cx, tx, 0.18);
        cy = lerp(cy, ty, 0.18);
        if (Math.abs(cx) < 0.05 && Math.abs(cy) < 0.05 && tx === 0 && ty === 0) {
          el.style.transform = '';
        } else {
          el.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0)`;
        }
      });
    });
  }

  /* ------------------------------------------------------------------ *
   *  6. 3D tilt on [data-tilt]
   *     Same data as magnetic but different transform — combine via
   *     composition in CSS by writing to a CSS variable.
   * ------------------------------------------------------------------ */
  function initTilt() {
    if (isTouch || prefersReducedMotion) return;
    const els = $$('[data-tilt]');
    if (!els.length) return;

    els.forEach((el) => {
      let tx = 0, ty = 0, cx = 0, cy = 0;

      on(el, 'pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width  / 2)) / (r.width  / 2 || 1);
        const dy = (e.clientY - (r.top  + r.height / 2)) / (r.height / 2 || 1);
        tx = clamp(dy, -1, 1) * 8;   // rotateX
        ty = clamp(-dx, -1, 1) * 8;  // rotateY
      });
      on(el, 'pointerleave', () => { tx = 0; ty = 0; });

      subscribe(() => {
        cx = lerp(cx, tx, 0.14);
        cy = lerp(cy, ty, 0.14);
        el.style.transform = `perspective(900px) rotateX(${cx.toFixed(2)}deg) rotateY(${cy.toFixed(2)}deg) translateZ(0)`;
      });
    });
  }

  /* ------------------------------------------------------------------ *
   *  7. Scroll reveal — IntersectionObserver, staggered via --i
   *     Reveals: [data-reveal], .reveal, .reveal-line
   * ------------------------------------------------------------------ */
  function initReveal() {
    const targets = $$('[data-reveal], .reveal, .reveal-line, .stat, .pillar, .plan, .step, .faq, .quote');
    if (!targets.length) return;

    // Tag the children of any [data-stagger] container so they cascade.
    $$('[data-stagger]').forEach((parent) => {
      const kids = parent.querySelectorAll('[data-reveal], .reveal');
      kids.forEach((kid, i) => { kid.style.setProperty('--i', i); });
    });

    // For hero reveal-lines, set --i so they cascade 0,1,2...
    $$('.reveal-line').forEach((el, i) => { el.style.setProperty('--i', i); });

    if (prefersReducedMotion) {
      // Just mark everything as inview immediately.
      targets.forEach((el) => el.classList.add('is-inview'));
      return;
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-inview');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });

    targets.forEach((el) => io.observe(el));
  }

  /* ------------------------------------------------------------------ *
   *  8. Parallax on [data-parallax] elements
   *     data-parallax="0.08" → ~8% of scroll distance.
   * ------------------------------------------------------------------ */
  function initParallax() {
    const els = $$('[data-parallax]');
    if (!els.length || prefersReducedMotion) return;

    const items = els.map((el) => {
      const amount = parseFloat(el.dataset.parallax) || 0.06;
      return { el, amount };
    });

    function update() {
      const vh = window.innerHeight;
      for (const it of items) {
        const r = it.el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) continue;
        const center = r.top + r.height / 2;
        const offset = (center - vh / 2) * it.amount;
        it.el.style.setProperty('--py', `${offset.toFixed(2)}px`);
        // Compose with anything CSS may have written
        const existing = it.el.style.transform;
        const newTransform = `translate3d(0, var(--py, 0), 0)`;
        // If CSS already has a transform (e.g. from .is-inview), keep that + ours
        // by using the CSS var we just set. The CSS rule on .is-inview already
        // overrides us, so instead we only apply this when not inview yet.
        if (!it.el.classList.contains('is-inview') && !existing) {
          it.el.style.transform = newTransform;
        } else {
          it.el.style.setProperty('--py', `${offset.toFixed(2)}px`);
        }
      }
    }
    on(window, 'scroll', update, { passive: true });
    on(window, 'resize', update);
    update();
  }

  /* ------------------------------------------------------------------ *
   *  9. Stats counter — easeOutExpo to data-count
   * ------------------------------------------------------------------ */
  function initCounters() {
    const nums = $$('[data-count]');
    if (!nums.length) return;

    const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

    nums.forEach((el) => {
      const target = parseFloat(el.dataset.count) || 0;
      const suffix = el.dataset.suffix || '';
      const decimals = parseInt(el.dataset.decimals || '0', 10);
      const duration = 1600;

      function run() {
        if (prefersReducedMotion) {
          el.textContent = format(target, decimals) + suffix;
          return;
        }
        const start = performance.now();
        function frame(now) {
          const t = clamp((now - start) / duration, 0, 1);
          const v = target * easeOutExpo(t);
          el.textContent = format(v, decimals) + suffix;
          if (t < 1) raf(frame);
          else el.textContent = format(target, decimals) + suffix;
        }
        raf(frame);
      }
      function format(v, d) {
        if (d > 0) return v.toFixed(d);
        // Integer formatting with thin-space thousands separator for "+" suffix
        return Math.round(v).toLocaleString('en-IN').replace(/,/g, ' ');
      }

      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            run();
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.4 });
      io.observe(el);
    });
  }

  /* ------------------------------------------------------------------ *
   *  10. Nav scrolled state + mobile menu
   * ------------------------------------------------------------------ */
  function initNav() {
    const nav  = $('#nav');
    const btn  = $('#nav-menu');
    if (!nav) return;

    function onScroll() {
      if (window.scrollY > 24) nav.classList.add('is-scrolled');
      else nav.classList.remove('is-scrolled');
    }
    on(window, 'scroll', onScroll, { passive: true });
    onScroll();

    if (!btn) return;
    on(btn, 'click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      document.body.classList.toggle('nav-open', !open);
    });

    // Close mobile nav when a link is tapped
    $$('.nav__links a').forEach((a) => {
      on(a, 'click', () => {
        btn.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('nav-open');
      });
    });
  }

  /* ------------------------------------------------------------------ *
   *  11. FAQ accordion nicety — close others when one opens
   * ------------------------------------------------------------------ */
  function initFaqs() {
    const faqs = $$('.faq');
    if (!faqs.length) return;
    faqs.forEach((f) => {
      on(f, 'toggle', () => {
        if (f.open) {
          faqs.forEach((other) => { if (other !== f) other.open = false; });
        }
      });
    });
  }

  /* ------------------------------------------------------------------ *
   *  12. Contact form — Netlify submission + micro‑interactions
   * ------------------------------------------------------------------ */
  function initContactForm() {
    const form = document.querySelector('.contact__form');
    if (!form) return;

    // Float‑label state tracking
    const fields = form.querySelectorAll('.field input, .field select, .field textarea');
    fields.forEach((field) => {
      field.addEventListener('focus', () => {
        field.closest('.field')?.classList.add('is-focus');
      });
      field.addEventListener('blur', () => {
        field.closest('.field')?.classList.remove('is-focus');
        if (field.value && field.value.length) {
          field.closest('.field')?.classList.add('has-value');
        } else {
          field.closest('.field')?.classList.remove('has-value');
        }
      });
      field.addEventListener('input', () => {
        if (field.value && field.value.length) {
          field.closest('.field')?.classList.add('has-value');
        } else {
          field.closest('.field')?.classList.remove('has-value');
        }
      });
    });

    // Netlify‑compatible submit
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const btn = form.querySelector('button[type="submit"]');
      if (!btn || btn.disabled) return;

      btn.disabled = true;
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<span>Sending…</span>';

      const data = new URLSearchParams(new FormData(form));

      fetch('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: data.toString(),
      })
        .then((res) => {
          if (!res.ok) throw new Error('Netlify form error');
          btn.innerHTML = '<span>Sent ✓ We\'ll reply soon</span>';
          btn.classList.add('is-sent');
          form.reset();
          document.querySelectorAll('.field').forEach((f) => f.classList.remove('has-value'));

          setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove('is-sent');
            btn.disabled = false;
          }, 2400);
        })
        .catch(() => {
          btn.innerHTML = '<span>Error — please try again</span>';
          btn.classList.add('is-sent');
          setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove('is-sent');
            btn.disabled = false;
          }, 2400);
        });
    });
  }

  /* ------------------------------------------------------------------ *
   *  13. Anchor scrolling with nav offset (smooth w/ offset)
   * ------------------------------------------------------------------ */
  function initSmoothAnchors() {
    const links = $$('a[href^="#"]');
    links.forEach((a) => {
      on(a, 'click', (e) => {
        const href = a.getAttribute('href');
        if (!href || href === '#') return;
        const target = document.querySelector(href);
        if (!target) return;
        e.preventDefault();
        const nav = $('#nav');
        const offset = (nav ? nav.offsetHeight : 0) + 8;
        const y = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: y, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      });
    });
  }

  /* ------------------------------------------------------------------ *
   *  14. Hero title parallax — very subtle, scroll-linked
   * ------------------------------------------------------------------ */
  function initHeroParallax() {
    if (prefersReducedMotion) return;
    const inner = $('.hero__inner');
    const title = $('.hero__title');
    if (!inner && !title) return;

    function update() {
      const hero = $('#hero');
      if (!hero) return;
      const r = hero.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r.bottom < 0 || r.top > vh) return;
      const t = clamp(1 - r.bottom / vh, 0, 1);
      const y = (t * 80).toFixed(2);
      if (inner) inner.style.transform = `translate3d(0, ${y}px, 0)`;
      if (title) title.style.setProperty('--title-shift', `${(t * 24).toFixed(2)}px`);
    }
    on(window, 'scroll', update, { passive: true });
    update();
  }

  /* ------------------------------------------------------------------ *
   *  15. Boot
   * ------------------------------------------------------------------ */
  function boot() {
    initNatureScene();
    initCursor();
    initMagnetics();
    initTilt();
    initReveal();
    initParallax();
    initCounters();
    initNav();
    initFaqs();
    initContactForm();
    initSmoothAnchors();
    initHeroParallax();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

