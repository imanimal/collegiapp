// Pocket for Spotify: marks the page "light" or "dark" from the colour scheme, so user.css can pick Cream's lighter
// shadows. Spicetify injects this file on its own (inject_theme_js = 1). Without it the theme still works and
// assumes Night. Marketplace switches schemes by rewriting --spice-* on :root, so it watches for that too.
(function pocket() {
  const root = document.documentElement;

  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const lin = (v) => (v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  }

  function sync() {
    // --spice-main is the module surface: #262522 (Night) or #f6f3ec (Cream)
    const main = getComputedStyle(root).getPropertyValue("--spice-main");
    const l = luminance(main || "");
    if (l === null) return;
    const scheme = l > 0.4 ? "light" : "dark";
    if (root.getAttribute("data-pk-scheme") !== scheme) root.setAttribute("data-pk-scheme", scheme);
  }

  sync();
  document.addEventListener("DOMContentLoaded", sync);
  window.addEventListener("load", sync);
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["style"] });
})();
