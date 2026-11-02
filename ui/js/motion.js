/* Collegiapp — the device's motion. Pocket moves like hardware: keys travel and spring back, LCDs switch in steps (a
   liquid crystal never tweens), pixel icons wipe and shake one pixel at a time, and modules settle like parts clicking
   into place. app.js renders by replacing markup, so the continuity comes from here:
   - keep() / settle(): any element with data-k is a part, keyed across renders. Parts that moved glide from where
     they were (FLIP), parts that left play their exit on their old element put back in place (a "ghost", .gone.x-*),
     parts that arrived play an entrance (.come-*).
   - ack(): a one-shot class on the part that answered an input (.ack, .boot, .bump, .print, .nope, .stamp, .saved);
     pocket.css says how each part plays it, and the class comes off when its animation ends.
   - press(): the on-screen key for a keyboard key goes down for a beat and springs back.
   - texts() / counts(): numbers and labels marked data-n roll (up or down) or print (data-fx="print") when they change.
   - leave(): an overlay, drawer or menu closing plays its exit on a clone; the real one is already hidden and empty.
   - burst() pixel confetti, count() an LCD number counting up, swap() a whole-screen View Transition (html[data-vt]).
   Durations scale with --m (lab.js sets `level` with it). At M0 or with prefers-reduced-motion every helper is a no-op
   and the UI simply changes. Script order: data → engine → store → sound → fx → motion → app → themes → lab. */
(function () {
  const CA = (window.CA = window.CA || {});
  const reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const EASE = "cubic-bezier(.2, .9, .3, 1)";
  const mo = (CA.motion = { level: 1, pending: null, EASE });
  mo.m = () => (reduce && reduce.matches ? 0 : mo.level);
  // run after a pending swap() has put the new markup in, or now
  mo.after = (fn) => (mo.pending ? mo.pending.then(fn, fn) : fn());

  // Restart a one-shot class. It comes off when the element's own animation ends, or after 1.6 s if none ran.
  mo.ack = (el, cls) => {
    if (!el || !mo.m()) return el;
    cls = cls || "ack";
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    let t = 0;
    const off = () => { clearTimeout(t); el.classList.remove(cls); el.removeEventListener("animationend", end); };
    const end = (e) => { if (e.target === el) off(); };
    t = setTimeout(off, 1600);
    el.addEventListener("animationend", end);
    return el;
  };
  mo.nope = (el) => { mo.ack(el, "nope"); if (CA.sound && CA.sound.nope) CA.sound.nope(); };

  // A keyboard key pressed its on-screen twins (a function, so it finds them in whatever markup is current).
  mo.press = (find) => {
    const m = mo.m(); if (!m) return;
    const els = find(); els.forEach((el) => el.classList.add("down"));
    setTimeout(() => { els.forEach((el) => el.classList.remove("down")); find().forEach((el) => mo.ack(el)); }, 90 * m + 10);
  };

  // Before a render: the keyed parts of `root` and where they are.
  mo.keep = (root, sel) => {
    const out = new Map();
    if (root && mo.m()) root.querySelectorAll(sel || "[data-k]").forEach((el) => out.set(el.dataset.k, { el, r: el.getBoundingClientRect() }));
    return out;
  };
  // After it. o: { sel, move (FLIP the parts that stayed; default true), exit: { key: kind } (default "out"),
  // enter: kind or false (default "drop"), host: where ghosts go (default the root's scrolling body .pb) }.
  mo.settle = (root, kept, o) => {
    const m = mo.m(); if (!m || !root || !kept || !kept.size) return;
    o = o || {};
    const exits = o.exit || {}, now = new Map(), view = root.getBoundingClientRect();
    root.querySelectorAll(o.sel || "[data-k]").forEach((el) => now.set(el.dataset.k, el));
    let gone = 0;
    kept.forEach((b, k) => { if (!now.has(k) && ghost(o.host || root.querySelector(".pb") || root, b, exits[k] || "out")) gone++; });
    // the part that left starts first, then the gap closes
    const delay = gone ? 110 * m : 0;
    now.forEach((el, k) => {
      const b = kept.get(k);
      if (!b) {
        if (o.enter === false) return;
        mo.ack(el, "come-" + (o.enter || "drop"));
        el.querySelectorAll(".display").forEach((d) => mo.ack(d, "boot"));
        return;
      }
      if (o.move === false) return;
      const r = el.getBoundingClientRect(), dx = b.r.left - r.left, dy = b.r.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      if ((r.bottom < view.top && b.r.bottom < view.top) || (r.top > view.bottom && b.r.top > view.bottom)) return; // off screen both times
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 280 * m, delay, easing: EASE, fill: "backwards" });
    });
  };
  // A part that left: its old element, back where it was over the new markup, playing its exit, then removed.
  function ghost(host, b, kind) {
    const hr = host.getBoundingClientRect(), el = b.el;
    if (!b.r.width || b.r.bottom < hr.top || b.r.top > hr.bottom) return false;
    el.classList.add("gone", "x-" + kind); el.setAttribute("aria-hidden", "true"); el.removeAttribute("data-k");
    Object.assign(el.style, {
      position: "absolute", margin: "0", boxSizing: "border-box", width: b.r.width + "px", height: b.r.height + "px", translate: "none", // a swiped row: its drag is in the rect
      left: b.r.left - hr.left - host.clientLeft + host.scrollLeft + "px", top: b.r.top - hr.top - host.clientTop + host.scrollTop + "px",
    });
    host.appendChild(el); cleanup(el, 1400);
    return true;
  }
  function cleanup(el, ms) {
    const end = () => el.remove();
    el.addEventListener("animationend", (e) => { if (e.target === el) end(); });
    setTimeout(end, ms);
  }

  // An overlay, drawer or menu closing: a clone plays .gone.<cls>; the real element is emptied right after.
  mo.leave = (el, cls) => {
    if (!el || el.hidden || !el.firstElementChild || !mo.m()) return;
    const c = el.cloneNode(true);
    c.removeAttribute("id"); c.querySelectorAll("[id]").forEach((x) => x.removeAttribute("id"));
    // a clone forgets what was typed; copy it so the closing dialog doesn't blank first
    const src = el.querySelectorAll("input, textarea"), dst = c.querySelectorAll("input, textarea");
    src.forEach((x, i) => { if (dst[i]) dst[i].value = x.value; });
    c.classList.add("gone", cls || "x-leave"); c.setAttribute("aria-hidden", "true"); c.inert = true;
    el.before(c); cleanup(c, 900); // before it, so whatever opens next paints on top
    // and where its scrolling parts were scrolled to
    const box = (x) => x.querySelectorAll(".pb, .lab-body, .pal-res"), from = box(el);
    box(c).forEach((x, i) => { if (from[i]) x.scrollTop = from[i].scrollTop; });
  };

  // Numbers and labels marked data-n: their text before a render, then a roll or a print for the ones that changed.
  mo.texts = (root) => {
    const t = new Map();
    if (mo.m()) (root || document).querySelectorAll("[data-n]").forEach((el) => t.set(el.dataset.n, el.textContent));
    return t;
  };
  const num = (s) => { const x = String(s).match(/-?\d+(\.\d+)?/); return x ? +x[0] : NaN; };
  mo.counts = (root, before) => {
    if (!before || !before.size || !mo.m()) return;
    (root || document).querySelectorAll("[data-n]").forEach((el) => {
      const was = before.get(el.dataset.n), is = el.textContent;
      if (was == null || was === is) return;
      if (el.dataset.fx === "print") { mo.ack(el, "print"); return; }
      el.dataset.dir = num(is) < num(was) ? "down" : "up";
      mo.ack(el, "bump");
    });
  };

  // Pixel confetti from a point (client coordinates): square pixels thrown out and falling, at a sprite's frame rate.
  mo.burst = (x, y, o) => {
    const m = mo.m(), layer = document.getElementById("layer"); if (!m || !layer || !layer.animate) return;
    o = o || {};
    const lr = layer.getBoundingClientRect(), n = o.n || 10, reach = o.reach || 36;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("i");
      p.className = "px" + (i % 3 === 2 ? " alt" : ""); p.style.left = x - lr.left + "px"; p.style.top = y - lr.top + "px";
      layer.appendChild(p);
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6, d = reach * (0.5 + Math.random() * 0.6);
      const dx = Math.round(Math.cos(a) * d), dy = Math.round(Math.sin(a) * d * 0.75 - 10);
      const anim = p.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${Math.round(dx * 0.8)}px, ${dy}px)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy + 20}px)`, opacity: 0 }], { duration: (o.ms || 560) * m, easing: "steps(8, end)" });
      anim.onfinish = () => p.remove();
    }
  };
  mo.burstAt = (el, o) => { if (!el) return; const r = el.getBoundingClientRect(); if (r.width) mo.burst(r.left + r.width / 2, r.top + r.height / 2, o); };

  // An LCD number counting up to `to` at about 20 frames a second; fmt turns the number into the text.
  mo.count = (el, to, fmt, ms) => {
    const m = mo.m(); fmt = fmt || String;
    if (!el) return;
    if (!m || !to) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = (ms || 700) * m;
    el.textContent = fmt(0);
    const iv = setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / dur);
      el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p >= 1 || !el.isConnected) clearInterval(iv);
    }, 50);
  };

  // A whole-screen change through a View Transition; `kind` picks its CSS (html[data-vt]). The change runs a frame
  // later, so code that reads the new markup goes through after(). Without the API, or with motion off, it just runs.
  mo.swap = (kind, fn) => {
    const root = document.documentElement;
    if (!mo.m() || !document.startViewTransition || mo.pending) { fn(); return; }
    root.dataset.vt = kind;
    let tx;
    try { tx = document.startViewTransition(fn); } catch (e) { delete root.dataset.vt; fn(); return; }
    mo.pending = tx.updateCallbackDone.catch(() => {});
    mo.pending.then(() => { mo.pending = null; });
    tx.finished.catch(() => {}).then(() => { if (!mo.pending) delete root.dataset.vt; });
  };
})();
