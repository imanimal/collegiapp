/* Collegiapp — CRT effect controller: noise texture, barrel-warp displacement map,
   glow/aberration text-shadow composition, the power sequences (a tube TV on and off) and the blips between
   programmes (a channel change, tape tracking, the OSD, degauss). */
(function () {
  const CA = (window.CA = window.CA || {});
  const fx = (CA.fx = {});
  let noiseURL = null, warpURL = null, lastUI = null;
  // Warped glass (C2) runs an SVG displacement filter over the whole screen. WebKit (Safari, the macOS and iOS
  // webviews) renders it slowly, touch screens would mis-aim taps, and phones are too small for it: those get C1.
  const ua = navigator.userAgent, webkit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
  // The one-column layout (screen ≤ 760 px wide, see pocket.css) scrolls the content box, which a filter would break.
  const screenW = () => { const sc = document.getElementById("screen"); return (sc && sc.clientWidth) || window.innerWidth; };
  fx.warpFallback = () => webkit || window.matchMedia("(pointer: coarse)").matches || screenW() <= 760;

  function makeNoise() {
    try {
      const c = document.createElement("canvas"); c.width = c.height = 192;
      const g = c.getContext("2d"), img = g.createImageData(192, 192);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0); return c.toDataURL();
    } catch (e) { return null; }
  }
  // feDisplacementMap samples src = out + scale * (map - .5): pushing samples outward gives barrel bulge.
  function makeWarp() {
    try {
      const N = 256, c = document.createElement("canvas"); c.width = c.height = N;
      const g = c.getContext("2d"), img = g.createImageData(N, N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const u = (x / (N - 1)) * 2 - 1, v = (y / (N - 1)) * 2 - 1, r2 = u * u + v * v, i = (y * N + x) * 4;
        img.data[i] = 128 + Math.max(-127, Math.min(127, u * r2 * 127 * 0.5));
        img.data[i + 1] = 128 + Math.max(-127, Math.min(127, v * r2 * 127 * 0.5));
        img.data[i + 2] = 128; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0); return c.toDataURL();
    } catch (e) { return null; }
  }

  fx.apply = function (ui) {
    const sc = document.getElementById("screen"); if (!sc) return;
    if (!noiseURL) { noiseURL = makeNoise(); if (noiseURL) sc.style.setProperty("--noise-img", "url(" + noiseURL + ")"); }
    lastUI = ui;
    const curve = ui.curve === "2" && fx.warpFallback() ? "1" : ui.curve;
    sc.dataset.curve = curve; sc.dataset.mask = ui.mask;
    sc.style.setProperty("--scan", ui.scan / 100); sc.style.setProperty("--flicker", ui.flicker / 100);
    sc.style.setProperty("--noise", ui.noise / 100); sc.style.setProperty("--vig", ui.vig / 100);
    sc.style.setProperty("--glow", ui.glow / 100); // retro-modern display inlays scale their glow with this
    const g = ui.glow / 100, a = ui.ab / 100, parts = [];
    if (g > 0) parts.push(`0 0 ${(1 + g * 3).toFixed(1)}px rgba(var(--glow-rgb), ${(0.25 + g * 0.5).toFixed(2)})`, `0 0 ${(g * 14).toFixed(1)}px rgba(var(--glow-rgb), ${(g * 0.35).toFixed(2)})`);
    if (a > 0) parts.push(`${(a * 1.6).toFixed(2)}px 0 rgba(255, 40, 70, ${(a * 0.45).toFixed(2)})`, `${(-a * 1.6).toFixed(2)}px 0 rgba(40, 200, 255, ${(a * 0.45).toFixed(2)})`);
    document.documentElement.style.setProperty("--ts", parts.length ? parts.join(", ") : "none");
    if (curve === "2") {
      if (!warpURL) warpURL = makeWarp();
      const fe = document.getElementById("warpMap");
      if (fe && warpURL) { fe.setAttribute("href", warpURL); fe.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", warpURL); }
      // keep the bulge at ~14 px in the corners at any window size, so text stays sharp and clicks land
      const w = screenW(), scale = Math.min(0.035, 28 / Math.max(400, w));
      document.querySelectorAll("#crtWarp .warpDisp").forEach((dm) => dm.setAttribute("scale", scale.toFixed(4)));
      warpScale = +scale.toFixed(4);
      // supersampling: nudge each copy's map by ¼ device pixel (in map units: one unit moves scale × width CSS px)
      const nudge = 0.25 / (window.devicePixelRatio || 1) / (scale * Math.max(400, w));
      document.querySelectorAll("#crtWarp [data-n]").forEach((f) => f.setAttribute("intercept", (+f.dataset.n * nudge).toFixed(5)));
    }
    follow();
  };
  // C2 warps the picture, not the page: hit tests, hover and the caret stay where things were laid out, up to ~14 px
  // from where they're drawn near the edges. So the content slides by the warp's offset at the pointer (crt.css
  // --warp-x/y), where what's drawn is then what's hit, and #crtShift slides the picture back by the same whole device
  // pixels, so it never moves.
  let warpScale = 0, px = null, py = null, wx = 0, wy = 0;
  function follow() {
    const sc = document.getElementById("screen"), wp = document.getElementById("warp"), ct = document.getElementById("content"), back = document.getElementById("warpBack");
    if (!sc || !wp || !ct || !back) return;
    let tx = 0, ty = 0;
    if (sc.dataset.curve === "2" && px != null) {
      const r = wp.getBoundingClientRect(), d = window.devicePixelRatio || 1, cl = (n) => Math.max(-1, Math.min(1, n));
      const u = cl(((px - r.left) / r.width) * 2 - 1), v = cl(((py - r.top) / r.height) * 2 - 1), r2 = u * u + v * v;
      // makeWarp's map as feDisplacementMap reads it (Chromium scales both axes by the width)
      const off = (t) => (warpScale * r.width * Math.max(-127, Math.min(127, t * r2 * 127 * 0.5))) / 255;
      tx = -Math.round(off(u) * d) / d; ty = -Math.round(off(v) * d) / d;
    }
    if (tx === wx && ty === wy) return;
    wx = tx; wy = ty;
    ct.style.setProperty("--warp-x", tx + "px"); ct.style.setProperty("--warp-y", ty + "px");
    back.setAttribute("dx", -tx); back.setAttribute("dy", -ty);
  }
  const aim = (e) => { px = e.clientX; py = e.clientY; follow(); };
  window.addEventListener("pointermove", aim, { capture: true, passive: true });
  window.addEventListener("pointerdown", aim, { capture: true, passive: true });
  // re-fit when the screen changes size: window resizes, and also the Appearance drawer or desk preview taking room
  let rt = 0;
  const refit = () => { clearTimeout(rt); rt = setTimeout(() => lastUI && fx.apply(lastUI), 150); };
  const scr = document.getElementById("screen");
  if (window.ResizeObserver && scr) new ResizeObserver(refit).observe(scr); else window.addEventListener("resize", refit);

  function seq(cls, ms, done) {
    const sc = document.getElementById("screen"); if (!sc) return;
    sc.classList.remove(cls); void sc.offsetWidth; sc.classList.add(cls);
    const m = CA.motion ? CA.motion.m() : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--m")) || 0;
    setTimeout(() => { done && done(); sc.classList.remove(cls); }, ms * m + 80);
  }

  /* ─────────── power: a tube TV turning on and off ───────────
     Pocket's screen is a CRT, so it comes on like one. A bright line opens into a raster of snow (no signal yet) while
     the degauss coil hums and swirls purity blotches through it; the picture rolls in, the horizontal hold tears and
     settles, the static fades as the signal locks, and colour comes on last, when the burst locks. Off is the zip: the
     picture blooms, the vertical deflection lets go and it collapses to a bright line, the line shrinks to a dot and the
     dot fades on the phosphor; the window goes (GONE) while the dot is still fading, not after. The handheld boots (BOOT_AT) as the static starts to clear, so its modules settle in
     through the last of it. Back on within WARM of going off, the tube is still warm (and the degauss coil's thermistor
     still hot), so it skips the snow and the hum and just opens the line into the picture. Times are ms at Full motion
     and scale with --m (CA.motion.m()); M0 and reduced motion switch at once, and Standard (L8) fades. The content
     keeps its own filter (C2's warp), so brightness, colour and focus run on a veil's backdrop-filter above it. The
     layer (.crt, crt.css) never takes pointer events. */
  const ON = 760, OFF = 820, GONE = 660, BOOT_AT = 380, BOOT = 800, WARM = 60000, WARM_ON = 340;
  let run = null; // the sequence playing: { anims, timers, raf }
  let offAt = 0; // when the screen last went dark
  const screenEl = () => document.getElementById("screen");
  const pocket = () => document.documentElement.dataset.look !== "standard";
  const flick = "steps(1, end)";
  function stop() {
    blipStop();
    if (!run) return;
    const r = run; run = null;
    cancelAnimationFrame(r.raf); r.timers.forEach(clearTimeout); r.anims.forEach((a) => a.cancel());
    const sc = screenEl(); if (sc) sc.classList.remove("crt-run");
  }
  function crtLayer(sc) {
    let el = sc.querySelector(":scope > .crt");
    if (!el) {
      el = document.createElement("div"); el.className = "crt"; el.setAttribute("aria-hidden", "true");
      el.innerHTML = '<i class="crt-band"></i><i class="crt-band"></i><i class="crt-band"></i><canvas class="crt-snow"></canvas><i class="crt-hum"></i><i class="crt-veil"></i><i class="crt-tint"></i><i class="crt-glow"></i><i class="crt-line"></i><i class="crt-dot"></i><b class="crt-osd"></b>';
      sc.appendChild(el);
    }
    const q = (c) => el.querySelector(".crt-" + c);
    return { snow: q("snow"), hum: q("hum"), veil: q("veil"), tint: q("tint"), glow: q("glow"), line: q("line"), dot: q("dot"), osd: q("osd"), bands: el.querySelectorAll(".crt-band") };
  }
  // keyframes as [ms, props, easing to the next]; the offsets come from the times
  const kf = (total, list) => list.map(([t, p, e]) => Object.assign({ offset: Math.min(1, t / total) }, p, e ? { easing: e } : {}));
  function play(el, total, list, m) { const a = el.animate(kf(total, list), { duration: total * m, fill: "both" }); run.anims.push(a); return a; }
  const later = (ms, fn) => run.timers.push(setTimeout(fn, ms));
  const bf = (b, s, c, bl) => { const v = `brightness(${b}) saturate(${s}) contrast(${c}) blur(${bl}px)`; return { backdropFilter: v, webkitBackdropFilter: v }; };
  const looks = (sc) => [sc.querySelector(".content"), sc.querySelector(".layer")].filter(Boolean);

  // Snow: a bandwidth-limited picture of nothing, one row per scanline (3 px, like .fx-scan), smeared sideways like a
  // tuner's. A strip twice the screen's height is made once per size; each frame shows a random window of it.
  let snowSrc = null;
  function snowSource(w, h) {
    if (snowSrc && snowSrc.width === w && snowSrc.height === h * 2) return snowSrc;
    const c = document.createElement("canvas"); c.width = w; c.height = h * 2;
    const g = c.getContext("2d"), img = g.createImageData(w, h * 2), px = new Uint32Array(img.data.buffer);
    for (let y = 0; y < h * 2; y++) {
      let p = Math.random();
      const row = 0.82 + Math.random() * 0.36; // each line a little brighter or darker
      for (let x = 0; x < w; x++) {
        p = p * 0.42 + Math.random() * 0.58;
        const v = Math.random() > 0.993 ? 1 : Math.pow(p, 1.45) * row; // with sparse bright specks
        const b = Math.max(0, Math.min(255, v * 255)) | 0;
        px[y * w + x] = 0xff000000 | (b << 16) | (b << 8) | b;
      }
    }
    g.putImageData(img, 0, 0);
    return (snowSrc = c);
  }
  function snowLoop(cv, sc, m) {
    const w = Math.max(64, Math.ceil(sc.clientWidth / 2)), h = Math.max(48, Math.ceil(sc.clientHeight / 3));
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d"), src = snowSource(w, h), t0 = performance.now();
    const frame = (now) => {
      if (!run) return;
      const t = (now - t0) / m, flip = Math.random() < 0.5;
      g.setTransform(flip ? -1 : 1, 0, 0, 1, 0, 0);
      g.drawImage(src, 0, (Math.random() * h) | 0, w, h, flip ? -w : 0, 0, w, h);
      g.setTransform(1, 0, 0, 1, 0, 0);
      // the horizontal hold tears while the set hunts for sync: bands slide sideways, most while the picture rolls in
      const tear = t > 280 && t < 680 ? 0.55 : 0.12;
      for (let i = 0; i < 3; i++) if (Math.random() < tear) {
        const y = (Math.random() * h) | 0, bh = 1 + ((Math.random() * h * 0.12) | 0), dx = (Math.random() - 0.5) * w * 0.08;
        g.drawImage(cv, 0, y, w, bh, dx, y, w, bh);
      }
      if (t < ON + 80) run.raf = requestAnimationFrame(frame);
    };
    run.raf = requestAnimationFrame(frame);
  }

  fx.powerOn = (done) => {
    stop();
    const sc = screenEl(); if (!sc) return done && done();
    const m = CA.motion ? CA.motion.m() : 1;
    sc.classList.remove("off");
    if (!m) return done && done();
    run = { anims: [], timers: [], raf: 0 };
    if (!pocket()) { // Standard: the picture fades up
      looks(sc).forEach((el) => play(el, 220, [[0, { opacity: 0 }, "ease-out"], [220, { opacity: 1 }]], m));
      return later(220 * m + 30, () => { stop(); done && done(); });
    }
    sc.classList.add("crt-run");
    const L = crtLayer(sc), open = "cubic-bezier(.2, .8, .3, 1)";
    if (offAt && Date.now() - offAt < WARM) { // warm: the line opens straight into the picture, a little bright at first
      looks(sc).forEach((el) => play(el, WARM_ON, [[0, { transform: "scale(1, .004)", opacity: 0 }], [55, { transform: "scale(1, .004)", opacity: 1 }, open],
        [170, { transform: "scale(1, 1.02)", opacity: 1 }, "ease-out"], [220, { transform: "scale(1, 1)", opacity: 1 }], [WARM_ON, { transform: "scale(1, 1)", opacity: 1 }]], m));
      play(L.line, WARM_ON, [[0, { transform: "scale(.2, 1)", opacity: 1 }, "cubic-bezier(.3, 0, .2, 1)"], [50, { transform: "scale(1.02, 1)", opacity: 1 }, "ease-in"],
        [170, { transform: "scale(1.02, 12)", opacity: 0 }], [WARM_ON, { transform: "scale(1.02, 12)", opacity: 0 }]], m);
      play(L.veil, WARM_ON, [[0, bf(2, 0.6, 1.12, 0.5)], [55, bf(2, 0.6, 1.12, 0.5), "ease-out"], [WARM_ON, bf(1, 1, 1, 0)]], m);
      CA.sound.crtOn(m, true);
      return later(WARM_ON * m + 40, () => { stop(); done && done(); });
    }
    // the raster: a line opening top and bottom, blooming a little past full height; then the picture rolls in from
    // above and the hold jitters before it locks
    looks(sc).forEach((el) => play(el, ON, [
      [0, { transform: "translate(0, 0) scale(0, .004)", opacity: 0 }],
      [100, { transform: "translate(0, 0) scale(1, .004)", opacity: 0 }, open],
      [230, { transform: "translate(0, 0) scale(1, 1.03)", opacity: 0 }, "ease-out"],
      [270, { transform: "translate(0, 0) scale(1, 1)", opacity: 0 }],
      [360, { transform: "translate(0, -40%) scale(1, 1)", opacity: 0.14 }, "cubic-bezier(.3, .6, .4, 1)"],
      [430, { transform: "translate(0, -7%) scale(1, 1)", opacity: 0.36 }, "ease-out"],
      [460, { transform: "translate(0, 3.5%) scale(1, 1)", opacity: 0.45 }, "ease-in-out"],
      [490, { transform: "translate(5px, -1.5%) scale(1, 1)", opacity: 0.55 }, flick],
      [515, { transform: "translate(-4px, .6%) scale(1, 1)", opacity: 0.62 }, flick],
      [545, { transform: "translate(3px, 0) scale(1, 1)", opacity: 0.7 }, flick],
      [575, { transform: "translate(-1.5px, 0) scale(1, 1)", opacity: 0.78 }, flick],
      [605, { transform: "translate(.5px, 0) scale(1, 1)", opacity: 0.86 }, flick],
      [635, { transform: "translate(0, 0) scale(1, 1)", opacity: 0.93 }, "ease-out"],
      [ON, { transform: "translate(0, 0) scale(1, 1)", opacity: 1 }],
    ], m));
    play(L.snow, ON, [
      [0, { transform: "scale(0, .004)", opacity: 0 }], [100, { transform: "scale(1, .004)", opacity: 1 }, open],
      [230, { transform: "scale(1, 1.03)", opacity: 1 }, "ease-out"], [270, { transform: "scale(1, 1)", opacity: 1 }],
      [400, { transform: "scale(1, 1)", opacity: 0.9 }, "cubic-bezier(.4, 0, .6, 1)"], [600, { transform: "scale(1, 1)", opacity: 0.3 }, "ease-out"],
      [ON, { transform: "scale(1, 1)", opacity: 0 }],
    ], m);
    // the hum bar: a darker band drifting up through the snow (the supply's ripple beating against the field rate)
    play(L.hum, ON, [[0, { transform: "translateY(380%)", opacity: 0 }, "linear"], [180, { transform: "translateY(280%)", opacity: 1 }, "linear"],
      [520, { transform: "translateY(60%)", opacity: 0.8 }, "linear"], [ON, { transform: "translateY(-120%)", opacity: 0 }]], m);
    // the beam's centre line before the raster opens
    play(L.line, ON, [[0, { transform: "scale(0, 1)", opacity: 0 }], [25, { transform: "scale(.05, 1)", opacity: 1 }, "cubic-bezier(.3, 0, .2, 1)"],
      [95, { transform: "scale(1.02, 1)", opacity: 1 }], [120, { transform: "scale(1.02, 1.4)", opacity: 1 }, "ease-in"],
      [240, { transform: "scale(1.02, 14)", opacity: 0 }], [ON, { transform: "scale(1.02, 14)", opacity: 0 }]], m);
    // overdriven while the tube warms, focus soft, and black and white until the colour burst locks (a touch too rich, then
    // right), so the first modules settle in grey and take their colour as they land
    play(L.veil, ON, [[0, bf(2.6, 0, 1.25, 1.4)], [100, bf(2.6, 0, 1.25, 1.4), "ease-out"], [270, bf(1.6, 0, 1.15, 1.1)], [440, bf(1.25, 0, 1.1, 0.7)],
      [520, bf(1.2, 0.15, 1.06, 0.3), "ease-out"], [600, bf(1.1, 1.35, 1.03, 0)], [680, bf(1.04, 1.1, 1.01, 0)], [ON, bf(1, 1, 1, 0)]], m);
    // the degauss coil: purity blotches swirl and die away with its hum
    play(L.tint, ON, [[0, { transform: "rotate(0deg) scale(1.25)", opacity: 0 }], [80, { transform: "rotate(0deg) scale(1.25)", opacity: 0 }, "ease-out"],
      [160, { transform: "rotate(-6deg) scale(1.2)", opacity: 0.85 }], [260, { transform: "rotate(16deg) scale(1.12)", opacity: 0.72 }],
      [370, { transform: "rotate(-11deg) scale(1.16)", opacity: 0.55 }], [470, { transform: "rotate(7deg) scale(1.1)", opacity: 0.4 }],
      [560, { transform: "rotate(-4deg) scale(1.13)", opacity: 0.24 }], [640, { transform: "rotate(1.5deg) scale(1.1)", opacity: 0.1 }],
      [720, { transform: "rotate(0deg) scale(1.1)", opacity: 0 }]], m);
    snowLoop(L.snow, sc, m);
    CA.sound.crtOn(m);
    // the handheld boots as the static clears: modules settle in through the snow, the LCDs flicker on (pocket.css .booting)
    later(BOOT_AT * m, () => seq("booting", BOOT));
    later(ON * m + 40, stop);
    later((BOOT_AT + BOOT) * m + 120, () => done && done());
  };

  fx.powerOff = (done) => {
    stop();
    const sc = screenEl(); if (!sc) return done && done();
    const m = CA.motion ? CA.motion.m() : 1;
    // gone hands the window back (power_done hides it); end leaves the dark tube behind it
    const gone = () => { offAt = Date.now(); done && done(); }, end = () => { sc.classList.add("off"); stop(); };
    if (!m || sc.classList.contains("off")) { end(); return gone(); }
    run = { anims: [], timers: [], raf: 0 };
    if (!pocket()) { // Standard: the picture fades out
      looks(sc).forEach((el) => play(el, 160, [[0, { opacity: 1 }, "ease-in"], [160, { opacity: 0 }]], m));
      return later(160 * m + 20, () => { end(); gone(); });
    }
    sc.classList.add("crt-run");
    const L = crtLayer(sc), collapse = "cubic-bezier(.62, 0, .88, .42)";
    // the picture blooms as the high voltage sags, then the vertical deflection lets go
    looks(sc).forEach((el) => play(el, OFF, [
      [0, { transform: "scale(1, 1)", opacity: 1 }, "ease-out"], [55, { transform: "scale(1.012, .985)", opacity: 1 }, collapse],
      [250, { transform: "scale(1.035, .006)", opacity: 1 }, "linear"], [266, { transform: "scale(1.035, .006)", opacity: 0 }],
      [OFF, { transform: "scale(1.035, .006)", opacity: 0 }],
    ], m));
    play(L.veil, OFF, [[0, bf(1, 1, 1, 0), "ease-out"], [55, bf(1.25, 0.95, 1.05, 0), "ease-in"], [250, bf(3.2, 0.35, 1.2, 0.7)], [OFF, bf(3.2, 0.35, 1.2, 0.7)]], m);
    // the bright line, held a moment, then the horizontal lets go too and it zips to the centre
    play(L.line, OFF, [[0, { transform: "scale(1.035, 1)", opacity: 0 }], [228, { transform: "scale(1.035, 1)", opacity: 0 }, "ease-out"],
      [252, { transform: "scale(1.035, 1.8)", opacity: 1 }, "ease-out"], [300, { transform: "scale(1.035, 1)", opacity: 1 }, flick],
      [318, { transform: "scale(1.035, 1)", opacity: 0.82 }, flick], [334, { transform: "scale(1.035, 1)", opacity: 1 }, "cubic-bezier(.55, 0, .85, .35)"],
      [515, { transform: "scale(.004, .8)", opacity: 1 }, "linear"], [540, { transform: "scale(.004, .8)", opacity: 0 }], [OFF, { transform: "scale(.004, .8)", opacity: 0 }]], m);
    // the spot: the beam with nothing deflecting it, fading on the phosphor (the window goes partway through the fade)
    play(L.dot, OFF, [[0, { transform: "scale(.3)", opacity: 0 }], [480, { transform: "scale(.3)", opacity: 0 }, "ease-out"], [522, { transform: "scale(1.15)", opacity: 1 }, "ease-in-out"],
      [600, { transform: "scale(1)", opacity: 1 }, "cubic-bezier(.2, .6, .4, 1)"], [OFF, { transform: "scale(.5)", opacity: 0 }]], m);
    // the phosphor's afterglow of the picture that was there
    play(L.glow, OFF, [[0, { opacity: 0 }, "ease-out"], [250, { opacity: 0.24 }, "cubic-bezier(.2, .6, .4, 1)"], [OFF, { opacity: 0 }]], m);
    CA.sound.crtOff(m);
    later(GONE * m, gone);
    later(OFF * m + 30, end);
  };
  fx.powered = () => { const sc = screenEl(); return !!sc && !sc.classList.contains("off"); };

  /* ─────────── between programmes: blips in the gaps ───────────
     The same tube for a moment, while something else is already happening: a lens switch retunes the list (fx.channel),
     undo rewinds the tape and redo fast-forwards it (fx.track), a focus session plays and stops (the OSD alone), and
     degauss wobbles the picture through purity blotches (Degauss in the search, or shaking the window by its top bar).
     None of them flashes: brightness only ever eases, and nothing big blinks. Each run is a little different. Nothing
     waits for them, a new one replaces the last, and none plays during power, at M0, with reduced motion or in
     Standard. .crt-blip shows the layer without the dead tube behind it (crt.css). */
  let blipping = null; // the blip playing: { anims, timers, raf }
  function blipStop() {
    if (!blipping) return;
    const b = blipping; blipping = null;
    cancelAnimationFrame(b.raf); b.timers.forEach(clearTimeout); b.anims.forEach((a) => a.cancel());
    const sc = screenEl(); if (!sc) return;
    sc.classList.remove("crt-blip");
    const cv = sc.querySelector(".crt-snow"); if (cv) { cv.removeAttribute("style"); cv.classList.remove("soft"); }
  }
  // one that lasts `total` ms, or null when the screen can't take one now
  function blipStart(total) {
    const sc = screenEl(), m = CA.motion ? CA.motion.m() : 1;
    if (!sc || !m || !pocket() || run || sc.classList.contains("off")) return null;
    blipStop();
    const b = (blipping = { anims: [], timers: [], raf: 0 }), L = crtLayer(sc);
    sc.classList.add("crt-blip");
    b.timers.push(setTimeout(blipStop, total * m + 40));
    return {
      b, sc, m, L, live: () => blipping === b,
      anim: (el, t, list) => { const a = el.animate(kf(t, list), { duration: t * m, fill: "both" }); b.anims.push(a); return a; },
      // the snow canvas at snowLoop's density (half the width, a row per scanline) for the screen or a box in it, cleared,
      // with the snow strip to draw from
      canvas: (bw, bh) => {
        const w = Math.max(64, Math.ceil((bw || sc.clientWidth) / 2)), h = Math.max(48, Math.ceil((bh || sc.clientHeight) / 3));
        L.snow.width = w; L.snow.height = h;
        return { g: L.snow.getContext("2d"), w, h, src: snowSource(w, h) };
      },
    };
  }
  // the set's on-screen display: dot-matrix lines in the top right of `at` (below the top bar), faded on and off over
  // `ms` (never flickered); it lands a pixel or two off and settles. When `at` is scrolled out of sight (the one-column
  // layout), it goes under the bar. Returns the lines' spans, so a counter can tick.
  function osd(k, at, lines, ms) {
    const el = k.L.osd, s = k.sc.getBoundingClientRect(), r = (at && at.isConnected ? at : k.sc).getBoundingClientRect(), bar = document.getElementById("top");
    const floor = Math.max(s.top, bar && bar.getClientRects().length ? bar.getBoundingClientRect().bottom : s.top), seen = r.top < s.bottom - 80 && r.bottom > floor + 40;
    el.style.top = Math.round((seen ? Math.max(r.top, floor) : floor) - s.top + 12) + "px";
    el.style.right = Math.round((seen ? Math.max(0, s.right - Math.min(r.right, s.right)) : 0) + 16) + "px";
    el.textContent = "";
    const spans = lines.map((t, i) => { const sp = document.createElement("span"); sp.className = "o" + (i + 1); sp.textContent = t || ""; if (t) el.appendChild(sp); return sp; });
    const j = `translateX(${(Math.random() < 0.5 ? -1 : 1) * Math.ceil(Math.random() * 2)}px)`;
    k.anim(el, ms, [[0, { opacity: 0, transform: j }, "ease-out"], [90, { opacity: 1, transform: j }, "ease-out"], [170, { opacity: 1, transform: "none" }],
      [ms - 220, { opacity: 1, transform: "none" }, "ease-in"], [ms, { opacity: 0, transform: "none" }]]);
    return spans;
  }
  // A lens switch: call it just before the new lens renders. Only the part that changes is retuned, and its brightness
  // never jumps: the new picture comes in a touch soft and grey under fine static (blended soft-light, so it textures
  // the picture instead of lighting it), then sharpens and settles as the colour locks, the way the tube comes on, as
  // it swings up a few pixels into place. The channel shows on the OSD. False when it didn't play (the caller crossfades instead).
  fx.channel = (n, label, at) => {
    const T = 440, k = blipStart(1150); if (!k) return false;
    const box = at && at.isConnected ? at : k.sc, s = k.sc.getBoundingClientRect(), r = box.getBoundingClientRect();
    const top = Math.max(r.top, s.top), ht = Math.max(1, Math.min(r.bottom, s.bottom) - top);
    const { g, w, h, src } = k.canvas(r.width, ht);
    Object.assign(k.L.snow.style, { top: top - s.top + "px", left: r.left - s.left + "px", width: r.width + "px", height: ht + "px" });
    k.L.snow.classList.add("soft");
    const t0 = performance.now(), SNOW = 300 + Math.random() * 80;
    const frame = (now) => {
      if (!k.live()) return;
      g.drawImage(src, 0, (Math.random() * h) | 0, w, h, 0, 0, w, h);
      if (now - t0 < SNOW * k.m) k.b.raf = requestAnimationFrame(frame);
    };
    frame(t0); // drawn now, so it's up in the same frame as the new lens
    k.anim(k.L.snow, SNOW, [[0, { opacity: 0.7 }, "ease-out"], [SNOW, { opacity: 0 }]]);
    const rise = `translateY(${(0.3 + Math.random() * 0.35).toFixed(2)}em)`; // a little different every time
    k.anim(box, T, [[0, { transform: rise, filter: "blur(1.4px) saturate(.2) contrast(1.06)" }, "cubic-bezier(.2, .7, .3, 1)"],
      [T * 0.5, { transform: "translateY(-1px)", filter: "blur(.35px) saturate(.75) contrast(1.02)" }, "ease-out"],
      [T, { transform: "none", filter: "blur(0px) saturate(1) contrast(1)" }]]);
    osd(k, at, ["CH " + n, label], 1150);
    CA.sound.static();
    return true;
  };
  // the tape counter: the session as a recording, from when the app opened; rewinding really winds it back
  let tapeOff = 0;
  const tapeNow = () => Math.max(0, performance.now() / 1000 + tapeOff);
  const hms = (t) => { t = Math.max(0, Math.floor(t)); return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
  // Undo rewinds the tape (back) and redo fast-forwards it, like a VCR's search. The transport clunks in and the
  // picture jolts; it judders a pixel at a time while the tape runs, and the colour thins out. Two or three search bars
  // sweep through (up for a rewind, down for fast-forward): grey noise with soft edges and a bright leading edge,
  // smeared sideways row by row and torn by white dropouts, over a smear of the picture itself (.crt-band, a backdrop
  // blur). Head-switching noise frays the bottom few lines. The OSD says ◀◀ Rew or ▶▶ FF over the tape counter, which
  // spins back or on. Then it drops back to play: the bars clear, the picture settles and the colour returns. Every
  // run picks its own bars, speeds, dropouts, judder and wind. False when it didn't play.
  fx.track = (back, at) => {
    const T = 240 + Math.random() * 60, k = blipStart(T + 260); if (!k) return false;
    const { g, w, h, src } = k.canvas(), t0 = performance.now(), dir = back ? -1 : 1, bands = [...k.L.bands];
    const n = Math.random() < 0.55 ? 2 : 3, bars = Array.from({ length: n }, (_, i) => ({
      y: i / n + Math.random() * 0.12, bh: Math.max(4, Math.round(h * (0.06 + Math.random() * 0.07))), speed: 1 + Math.random() * 0.35,
      tears: Array.from({ length: 3 + ((Math.random() * 4) | 0) }, () => [Math.random(), Math.random(), 0.04 + Math.random() * 0.3]), // [row, x, length] as fractions
    }));
    bands.forEach((el, i) => (el.style.display = i < bars.length ? "" : "none"));
    const from = tapeNow(), wind = (2 + Math.random() * 7) * dir;
    tapeOff = Math.max(-performance.now() / 1000, tapeOff + wind);
    const count = osd(k, at, [back ? "◀︎◀︎" : "▶︎▶︎", back ? "Rew" : "FF", hms(from)], T + 260)[2];
    const frame = (now) => {
      if (!k.live()) return;
      const p = Math.min(1, (now - t0) / (T * k.m)), px = k.sc.clientHeight / h;
      g.clearRect(0, 0, w, h);
      bars.forEach((b, i) => {
        // where the bar is: it sweeps most of a screen, wrapping round, up for a rewind
        const f = ((b.y + p * 0.9 * b.speed) % 1.25) - 0.15, y = Math.round((back ? 1 - f : f) * h - (back ? b.bh : 0)), e = Math.max(1, Math.round(b.bh * 0.25));
        // soft edges, and a denser core smeared sideways two rows at a time
        g.globalAlpha = 0.28;
        g.drawImage(src, 0, (Math.random() * h) | 0, w, e, 0, y, w, e); g.drawImage(src, 0, (Math.random() * h) | 0, w, e, 0, y + b.bh - e, w, e);
        g.globalAlpha = 0.62;
        for (let r = y + e; r < y + b.bh - e; r += 2) g.drawImage(src, 0, (Math.random() * h * 1.9) | 0, w, 2, ((Math.random() - 0.5) * w * 0.05) | 0, r, w, 2);
        // white dropouts tearing across it, and its bright leading edge
        g.globalAlpha = 0.85; g.fillStyle = "#fff";
        b.tears.forEach(([ry, rx, len]) => { if (Math.random() < 0.8) g.fillRect(((rx + Math.random() * 0.06) % 1) * w, Math.round(y + ry * b.bh), len * w, 1); });
        g.globalAlpha = 0.55; g.fillRect(0, back ? y : y + b.bh - 1, w, 1);
        if (bands[i]) { bands[i].style.height = b.bh * px + "px"; bands[i].style.transform = `translateY(${y * px}px)`; }
      });
      // head switching: the bottom lines fray and slide right
      const hb = Math.max(2, Math.round(h * 0.022));
      g.globalAlpha = 0.7;
      for (let r = h - hb; r < h; r++) g.drawImage(src, 0, (Math.random() * h) | 0, w, 1, (Math.random() * 0.12 + 0.02) * w, r, w, 1);
      g.globalAlpha = 1;
      if (count) count.textContent = hms(from + wind * (1 - Math.pow(1 - p, 2)));
      if (p < 1) k.b.raf = requestAnimationFrame(frame);
    };
    frame(t0);
    const end = T + 90;
    k.anim(k.L.snow, end, [[0, { opacity: 0 }, flick], [30, { opacity: 0.9 }], [T, { opacity: 0.8 }, "ease-out"], [end, { opacity: 0 }]]);
    bands.forEach((el) => k.anim(el, end, [[0, { opacity: 0 }, flick], [30, { opacity: 1 }], [T, { opacity: 1 }, "ease-out"], [end, { opacity: 0 }]]));
    k.anim(k.L.veil, end, [[0, bf(1, 1, 1, 0), "ease-out"], [50, bf(1.04, 0.5, 1.07, 0)], [T, bf(1.03, 0.55, 1.06, 0), "ease-out"], [end, bf(1, 1, 1, 0)]]);
    // the clunk's jolt, then a judder a pixel at a time while the tape runs, then it settles into play
    const jit = [[0, { transform: `translateY(${-3 * dir}px)` }, flick], [40, { transform: "translateY(0px)" }, flick]];
    for (let t = 70; t < T; t += 35 + Math.random() * 25) jit.push([t, { transform: `translate(${Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0}px, ${Math.random() < 0.5 ? -1 : 1}px)` }, flick]);
    jit.push([T, { transform: `translateY(${-dir}px)` }, "ease-out"], [end, { transform: "translateY(0px)" }]);
    looks(k.sc).forEach((el) => k.anim(el, end, jit));
    CA.sound.tape(back, k.m);
    return true;
  };
  // The OSD alone (a focus session's ▶ Play and ■ Stop)
  fx.osd = (big, small, at) => { const k = blipStart(1100); if (k) osd(k, at, [big, small], 1100); };
  // Degauss: the picture wobbles and its colours swirl, through purity blotches that die away with the coil's hum. It
  // runs on transforms and the veil's backdrop-filter, so C2's warp filter stays on.
  fx.degauss = () => {
    const D = 900, k = blipStart(D); if (!k) return;
    const s = Math.random() < 0.5 ? 1 : -1, a = (Math.random() - 0.5) * 40;
    const hf = (h, sat) => { const v = `hue-rotate(${h}deg) saturate(${sat})`; return { backdropFilter: v, webkitBackdropFilter: v }; };
    CA.sound.degauss();
    looks(k.sc).forEach((el) => k.anim(el, D, [[0, { transform: "none" }, "ease-out"], [90, { transform: `skewX(${3 * s}deg) scale(1.02, .985)` }, "ease-in-out"],
      [230, { transform: `skewX(${-2.2 * s}deg) scale(.99, 1.012)` }, "ease-in-out"], [390, { transform: `skewX(${1.2 * s}deg)` }, "ease-in-out"],
      [560, { transform: `skewX(${-0.5 * s}deg)` }, "ease-out"], [D, { transform: "none" }]]));
    k.anim(k.L.veil, D, [[0, hf(0, 1), "ease-out"], [90, hf(80 * s, 2.6)], [230, hf(-55 * s, 2.1)], [400, hf(28 * s, 1.5)], [600, hf(-10 * s, 1.15)], [D, hf(0, 1)]]);
    k.anim(k.L.tint, D, [[0, { transform: `rotate(${a}deg) scale(1.2)`, opacity: 0 }, "ease-out"], [80, { transform: `rotate(${a - 8 * s}deg) scale(1.18)`, opacity: 0.7 }],
      [260, { transform: `rotate(${a + 14 * s}deg) scale(1.12)`, opacity: 0.5 }], [450, { transform: `rotate(${a - 7 * s}deg) scale(1.15)`, opacity: 0.3 }],
      [650, { transform: `rotate(${a + 3 * s}deg) scale(1.1)`, opacity: 0.12 }], [D, { transform: `rotate(${a}deg) scale(1.1)`, opacity: 0 }]]);
  };
})();
