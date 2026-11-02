/* Collegiapp — CRT effect controller: noise texture, barrel-warp displacement map,
   glow/aberration text-shadow composition, and the power / degauss sequences. */
(function () {
  const CA = (window.CA = window.CA || {});
  const fx = (CA.fx = {});
  let noiseURL = null, warpURL = null;

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
    sc.dataset.curve = ui.curve; sc.dataset.mask = ui.mask;
    sc.style.setProperty("--scan", ui.scan / 100); sc.style.setProperty("--flicker", ui.flicker / 100);
    sc.style.setProperty("--noise", ui.noise / 100); sc.style.setProperty("--vig", ui.vig / 100);
    sc.style.setProperty("--glow", ui.glow / 100); // retro-modern display inlays scale their glow with this
    const g = ui.glow / 100, a = ui.ab / 100, parts = [];
    if (g > 0) parts.push(`0 0 ${(1 + g * 3).toFixed(1)}px rgba(var(--glow-rgb), ${(0.25 + g * 0.5).toFixed(2)})`, `0 0 ${(g * 14).toFixed(1)}px rgba(var(--glow-rgb), ${(g * 0.35).toFixed(2)})`);
    if (a > 0) parts.push(`${(a * 1.6).toFixed(2)}px 0 rgba(255, 40, 70, ${(a * 0.45).toFixed(2)})`, `${(-a * 1.6).toFixed(2)}px 0 rgba(40, 200, 255, ${(a * 0.45).toFixed(2)})`);
    document.documentElement.style.setProperty("--ts", parts.length ? parts.join(", ") : "none");
    if (ui.curve === "2") {
      if (!warpURL) warpURL = makeWarp();
      const fe = document.getElementById("warpMap");
      if (fe && warpURL) { fe.setAttribute("href", warpURL); fe.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", warpURL); }
    }
  };

  function seq(cls, ms, done) {
    const sc = document.getElementById("screen"); if (!sc) return;
    sc.classList.remove(cls); void sc.offsetWidth; sc.classList.add(cls);
    const m = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--m")) || 0;
    setTimeout(() => { done && done(); sc.classList.remove(cls); }, ms * m + 80);
  }
  fx.degauss = () => { CA.sound.degauss(); seq("degauss", 700); };
  fx.powerOn = (done) => { const sc = document.getElementById("screen"); sc.classList.remove("off"); CA.sound.power(true); seq("powering-on", 760, done); };
  fx.powerOff = (done) => {
    CA.sound.power(false);
    seq("powering-off", 520, () => { document.getElementById("screen").classList.add("off"); done && done(); });
  };
})();
