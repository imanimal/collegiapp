/* Collegiapp — Pocket Start (start.html): a `›` prompt that opens apps or adds a task, the pinned keys, the live
   Do first list and a work deck with Power. src-tauri/src/start.rs opens it on a lone Win key, reads the apps from
   Windows and launches them; Do first is the core's ranking (`list_items`, score.rs), and "+ text" goes through the
   core's quick add (quickadd.rs). In a plain browser it shows the sample data (the web demo).
   Script order: data → engine → store → start. */
(function () {
  const CA = window.CA, E = CA.E, LIVE = CA.store.live;
  const { MIN, HR, DAY } = E;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const invoke = (cmd, args) => CA.store.invoke(cmd, args);

  // 9×9 pixel icons from the Pocket for Windows canvas (exams and flag from app.js)
  const IC = {
    all: "M0 1h2v1h-2zM3 1h6v1h-6zM0 3h2v1h-2zM3 3h6v1h-6zM0 5h2v1h-2zM3 5h6v1h-6zM0 7h2v1h-2zM3 7h6v1h-6z",
    back: "M3 1h1v1h-1zM2 2h1v1h-1zM1 3h1v1h-1zM0 4h9v1h-9zM1 5h1v1h-1zM2 6h1v1h-1zM3 7h1v1h-1z",
    chat: "M0 0h9v1h-9zM0 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM2 2h5v1h-5zM8 2h1v1h-1zM0 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h9v1h-9zM1 7h2v1h-2zM1 8h1v1h-1z",
    check: "M8 1h1v1h-1zM7 2h2v1h-2zM6 3h2v1h-2zM0 4h1v1h-1zM5 4h2v1h-2zM0 5h2v1h-2zM4 5h2v1h-2zM1 6h4v1h-4zM2 7h2v1h-2z",
    chevl: "M6 1h2v1h-2zM5 2h2v1h-2zM4 3h2v1h-2zM3 4h2v1h-2zM4 5h2v1h-2zM5 6h2v1h-2zM6 7h2v1h-2z",
    chevr: "M1 1h2v1h-2zM2 2h2v1h-2zM3 3h2v1h-2zM4 4h2v1h-2zM3 5h2v1h-2zM2 6h2v1h-2zM1 7h2v1h-2z",
    clock: "M2 0h5v1h-5zM1 1h1v1h-1zM4 1h1v1h-1zM7 1h1v1h-1zM0 2h1v1h-1zM4 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM4 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM4 4h3v1h-3zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1zM1 7h1v1h-1zM7 7h1v1h-1zM2 8h5v1h-5z",
    code: "M2 2h1v1h-1zM6 2h1v1h-1zM1 3h1v1h-1zM5 3h1v1h-1zM7 3h1v1h-1zM0 4h1v1h-1zM4 4h1v1h-1zM8 4h1v1h-1zM1 5h1v1h-1zM3 5h1v1h-1zM7 5h1v1h-1zM2 6h1v1h-1zM6 6h1v1h-1z",
    copy: "M0 0h6v1h-6zM0 1h1v1h-1zM5 1h1v1h-1zM0 2h1v1h-1zM3 2h6v1h-6zM0 3h1v1h-1zM3 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM3 4h1v1h-1zM8 4h1v1h-1zM0 5h4v1h-4zM8 5h1v1h-1zM3 6h1v1h-1zM8 6h1v1h-1zM3 7h1v1h-1zM8 7h1v1h-1zM3 8h6v1h-6z",
    download: "M4 0h1v1h-1zM4 1h1v1h-1zM2 2h1v1h-1zM4 2h1v1h-1zM6 2h1v1h-1zM3 3h3v1h-3zM0 4h1v1h-1zM4 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h3v1h-3zM6 6h3v1h-3zM0 7h1v1h-1zM8 7h1v1h-1zM0 8h9v1h-9z",
    exams: "M4 0h1v1h-1zM3 1h1v1h-1zM5 1h1v1h-1zM3 2h1v1h-1zM5 2h1v1h-1zM2 3h1v1h-1zM4 3h1v1h-1zM6 3h1v1h-1zM2 4h1v1h-1zM4 4h1v1h-1zM6 4h1v1h-1zM1 5h1v1h-1zM4 5h1v1h-1zM7 5h1v1h-1zM1 6h1v1h-1zM7 6h1v1h-1zM0 7h1v1h-1zM4 7h1v1h-1zM8 7h1v1h-1zM0 8h9v1h-9z",
    ext: "M4 0h5v1h-5zM7 1h2v1h-2zM6 2h1v1h-1zM8 2h1v1h-1zM5 3h1v1h-1zM8 3h1v1h-1zM4 4h1v1h-1zM8 4h1v1h-1zM3 5h1v1h-1zM2 6h1v1h-1zM1 7h1v1h-1zM0 8h1v1h-1z",
    eye: "M2 1h5v1h-5zM1 2h1v1h-1zM7 2h1v1h-1zM0 3h1v1h-1zM4 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM3 4h3v1h-3zM8 4h1v1h-1zM0 5h1v1h-1zM4 5h1v1h-1zM8 5h1v1h-1zM1 6h1v1h-1zM7 6h1v1h-1zM2 7h5v1h-5z",
    flag: "M0 0h8v1h-8zM0 1h7v1h-7zM0 2h6v1h-6zM0 3h7v1h-7zM0 4h8v1h-8zM0 5h1v1h-1zM0 6h1v1h-1zM0 7h1v1h-1zM0 8h1v1h-1z",
    folder: "M0 1h4v1h-4zM0 2h9v1h-9zM0 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1zM0 7h9v1h-9z",
    game: "M1 1h7v1h-7zM0 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM2 3h1v1h-1zM6 3h1v1h-1zM8 3h1v1h-1zM0 4h3v1h-3zM4 4h1v1h-1zM6 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM2 5h1v1h-1zM8 5h1v1h-1zM0 6h1v1h-1zM4 6h3v1h-3zM8 6h1v1h-1zM1 7h3v1h-3zM7 7h2v1h-2z",
    gear: "M4 0h1v1h-1zM1 1h1v1h-1zM3 1h3v1h-3zM7 1h1v1h-1zM2 2h5v1h-5zM1 3h2v1h-2zM6 3h2v1h-2zM0 4h3v1h-3zM6 4h3v1h-3zM1 5h2v1h-2zM6 5h2v1h-2zM2 6h5v1h-5zM1 7h1v1h-1zM3 7h3v1h-3zM7 7h1v1h-1zM4 8h1v1h-1z",
    globe: "M2 0h5v1h-5zM1 1h1v1h-1zM4 1h1v1h-1zM7 1h1v1h-1zM0 2h1v1h-1zM3 2h1v1h-1zM5 2h1v1h-1zM8 2h1v1h-1zM0 3h9v1h-9zM0 4h1v1h-1zM3 4h1v1h-1zM5 4h1v1h-1zM8 4h1v1h-1zM0 5h9v1h-9zM0 6h1v1h-1zM3 6h1v1h-1zM5 6h1v1h-1zM8 6h1v1h-1zM1 7h1v1h-1zM4 7h1v1h-1zM7 7h1v1h-1zM2 8h5v1h-5z",
    image: "M0 0h9v1h-9zM0 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM2 2h2v1h-2zM8 2h1v1h-1zM0 3h1v1h-1zM2 3h2v1h-2zM8 3h1v1h-1zM0 4h1v1h-1zM6 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM3 5h1v1h-1zM5 5h4v1h-4zM0 6h1v1h-1zM2 6h7v1h-7zM0 7h9v1h-9z",
    info: "M0 0h9v1h-9zM0 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM4 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM3 4h2v1h-2zM8 4h1v1h-1zM0 5h1v1h-1zM4 5h1v1h-1zM8 5h1v1h-1zM0 6h1v1h-1zM3 6h3v1h-3zM8 6h1v1h-1zM0 7h1v1h-1zM8 7h1v1h-1zM0 8h9v1h-9z",
    lock: "M3 0h3v1h-3zM2 1h1v1h-1zM6 1h1v1h-1zM2 2h1v1h-1zM6 2h1v1h-1zM1 3h7v1h-7zM1 4h3v1h-3zM5 4h3v1h-3zM1 5h3v1h-3zM5 5h3v1h-3zM1 6h7v1h-7zM1 7h7v1h-7z",
    mail: "M0 1h9v1h-9zM0 2h2v1h-2zM7 2h2v1h-2zM0 3h1v1h-1zM2 3h1v1h-1zM6 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM3 4h1v1h-1zM5 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM4 5h1v1h-1zM8 5h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1zM0 7h9v1h-9z",
    monitor: "M0 0h9v1h-9zM0 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM8 4h1v1h-1zM0 5h9v1h-9zM4 6h1v1h-1zM2 7h5v1h-5z",
    moon: "M2 0h4v1h-4zM1 1h2v1h-2zM0 2h2v1h-2zM0 3h2v1h-2zM0 4h2v1h-2zM0 5h2v1h-2zM8 5h1v1h-1zM1 6h2v1h-2zM7 6h2v1h-2zM2 7h6v1h-6z",
    music: "M3 0h6v1h-6zM3 1h6v1h-6zM3 2h1v1h-1zM8 2h1v1h-1zM3 3h1v1h-1zM8 3h1v1h-1zM3 4h1v1h-1zM8 4h1v1h-1zM1 5h3v1h-3zM6 5h3v1h-3zM0 6h4v1h-4zM5 6h4v1h-4zM1 7h2v1h-2zM6 7h2v1h-2z",
    now: "M5 0h3v1h-3zM4 1h3v1h-3zM3 2h3v1h-3zM2 3h6v1h-6zM5 4h2v1h-2zM4 5h2v1h-2zM3 6h2v1h-2zM2 7h2v1h-2zM1 8h2v1h-2z",
    pen: "M7 0h2v1h-2zM6 1h3v1h-3zM5 2h3v1h-3zM4 3h3v1h-3zM3 4h3v1h-3zM2 5h3v1h-3zM1 6h3v1h-3zM1 7h2v1h-2zM0 8h1v1h-1z",
    pin: "M2 0h5v1h-5zM1 1h1v1h-1zM7 1h1v1h-1zM0 2h1v1h-1zM3 2h3v1h-3zM8 2h1v1h-1zM0 3h1v1h-1zM3 3h1v1h-1zM5 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM3 4h3v1h-3zM8 4h1v1h-1zM1 5h1v1h-1zM7 5h1v1h-1zM2 6h1v1h-1zM6 6h1v1h-1zM3 7h1v1h-1zM5 7h1v1h-1zM4 8h1v1h-1z",
    power: "M4 0h1v1h-1zM1 1h1v1h-1zM4 1h1v1h-1zM7 1h1v1h-1zM0 2h1v1h-1zM4 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM4 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM1 6h1v1h-1zM7 6h1v1h-1zM2 7h5v1h-5z",
    search: "M2 0h3v1h-3zM1 1h1v1h-1zM5 1h1v1h-1zM0 2h1v1h-1zM6 2h1v1h-1zM0 3h1v1h-1zM6 3h1v1h-1zM0 4h1v1h-1zM6 4h1v1h-1zM1 5h1v1h-1zM5 5h1v1h-1zM2 6h4v1h-4zM6 7h2v1h-2zM7 8h2v1h-2z",
    shield: "M0 0h9v1h-9zM0 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM4 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM3 3h3v1h-3zM8 3h1v1h-1zM0 4h1v1h-1zM4 4h1v1h-1zM8 4h1v1h-1zM1 5h1v1h-1zM7 5h1v1h-1zM2 6h1v1h-1zM6 6h1v1h-1zM3 7h1v1h-1zM5 7h1v1h-1zM4 8h1v1h-1z",
    star: "M4 0h1v1h-1zM3 1h3v1h-3zM0 2h9v1h-9zM1 3h7v1h-7zM2 4h5v1h-5zM2 5h2v1h-2zM5 5h2v1h-2zM1 6h2v1h-2zM6 6h2v1h-2zM1 7h1v1h-1zM7 7h1v1h-1z",
    terminal: "M0 1h9v1h-9zM0 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM2 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM3 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM2 5h1v1h-1zM4 5h3v1h-3zM8 5h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1zM0 7h9v1h-9z",
    trash: "M3 0h3v1h-3zM0 1h9v1h-9zM1 2h1v1h-1zM7 2h1v1h-1zM1 3h1v1h-1zM3 3h1v1h-1zM5 3h1v1h-1zM7 3h1v1h-1zM1 4h1v1h-1zM3 4h1v1h-1zM5 4h1v1h-1zM7 4h1v1h-1zM1 5h1v1h-1zM3 5h1v1h-1zM5 5h1v1h-1zM7 5h1v1h-1zM1 6h1v1h-1zM3 6h1v1h-1zM5 6h1v1h-1zM7 6h1v1h-1zM1 7h1v1h-1zM7 7h1v1h-1zM1 8h7v1h-7z",
    update: "M3 0h4v1h-4zM2 1h1v1h-1zM7 1h1v1h-1zM1 2h1v1h-1zM6 2h3v1h-3zM1 3h1v1h-1zM7 3h1v1h-1zM1 4h1v1h-1zM1 5h1v1h-1zM7 5h1v1h-1zM2 6h1v1h-1zM6 6h1v1h-1zM3 7h3v1h-3z",
    week: "M2 0h1v1h-1zM6 0h1v1h-1zM0 1h9v1h-9zM0 2h9v1h-9zM0 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM2 4h1v1h-1zM4 4h1v1h-1zM6 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h1v1h-1zM2 6h1v1h-1zM4 6h1v1h-1zM8 6h1v1h-1zM0 7h1v1h-1zM8 7h1v1h-1zM0 8h9v1h-9z",
    wmax: "M1 1h7v1h-7zM1 2h7v1h-7zM1 3h1v1h-1zM7 3h1v1h-1zM1 4h1v1h-1zM7 4h1v1h-1zM1 5h1v1h-1zM7 5h1v1h-1zM1 6h1v1h-1zM7 6h1v1h-1zM1 7h7v1h-7z",
    work: "M1 0h5v1h-5zM1 1h1v1h-1zM5 1h2v1h-2zM1 2h1v1h-1zM5 2h3v1h-3zM1 3h1v1h-1zM7 3h1v1h-1zM1 4h1v1h-1zM3 4h3v1h-3zM7 4h1v1h-1zM1 5h1v1h-1zM7 5h1v1h-1zM1 6h1v1h-1zM3 6h3v1h-3zM7 6h1v1h-1zM1 7h1v1h-1zM7 7h1v1h-1zM1 8h7v1h-7z",
    x: "M0 0h2v1h-2zM7 0h2v1h-2zM1 1h2v1h-2zM6 1h2v1h-2zM2 2h2v1h-2zM5 2h2v1h-2zM3 3h3v1h-3zM4 4h1v1h-1zM3 5h3v1h-3zM2 6h2v1h-2zM5 6h2v1h-2zM1 7h2v1h-2zM6 7h2v1h-2zM0 8h2v1h-2zM7 8h2v1h-2z",
  };
  const ic = (n, c) => `<svg class="i${c ? " " + c : ""}" viewBox="0 0 9 9" aria-hidden="true"><path d="${IC[n] || IC.wmax}"/></svg>`;

  // Palettes come from lab.js (localStorage "capp.palettes", written whenever the main window applies its look).
  // These copies of P9 Cream and P11 Night cover a first launch before the main window has ever shown.
  const KEYS = { bg: 0, bg2: 1, "chrome-bg": 2, "chrome-fg": 3, warn: 4, bad: 5, ok: 6, k1: 7, k2: 8, k3: 9, k4: 10, k5: 11, k6: 12,
    "p-surface": 13, "p-surface2": 14, "p-line": 15, "p-text": 16, "p-text2": 17, "p-text3": 18, "p-acc": 19, "p-on-acc": 20, "p-disp-bg": 21, "p-disp-fg": 22 };
  const FALLBACK = {
    P9: ["#e6e2d8", "#fbf9f4", "#2a2722", "#f6f3ec", "#9a5b00", "#c8341b", "#2e7d32", "#2f6fde", "#ff5b1f", "#2e8b57", "#b03aa8", "#c27a00", "#5b5548",
      "#f6f3ec", "#ebe7dd", "#d3ccbd", "#1b1915", "#4a453c", "#6a645a", "#ff5b1f", "#1b1915", "#b1bd93", "#1f2a17"],
    P11: ["#1a1917", "#2a2926", "#0f0e0d", "#ece6da", "#f0b54a", "#ff7a5c", "#62c470", "#7aa5ff", "#ff7a3d", "#4fbf86", "#d77bd0", "#e3a640", "#a39c8d",
      "#262522", "#302e2a", "#3f3c36", "#f4efe5", "#d0c9ba", "#a39c8d", "#ff6a2b", "#1b1915", "#45b3a1", "#04211c"],
  };
  const darkMQ = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  let shellNight = null; // Windows' own mode, from start.rs; null = follow prefers-color-scheme
  function theme() {
    const night = shellNight != null ? shellNight : !!(darkMQ && darkMQ.matches), id = night ? "P11" : "P9", root = document.documentElement;
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem("capp.palettes") || "null"); } catch (e) {}
    for (const k in KEYS) root.style.setProperty("--" + k, (stored && stored[id] && stored[id][k]) || FALLBACK[id][KEYS[k]]);
    root.dataset.scheme = night ? "dark" : "light";
  }

  const S = {
    view: "home", q: "", cur: 0, results: [], menu: null, showHidden: false,
    apps: { pinned: [], all: [], settings: [], custom: false, hidden: [], loaded: !LIVE },
    rows: [], total: 0, open: [], courses: [], user: "You", note: null, winKey: LIVE ? null : true,
  };
  const cById = (id) => S.courses.find((c) => c.id === id);

  // ─────────── apps: a pixel icon and key colour by name ───────────
  const LOOKS = [
    [/collegiapp/i, "tile", 2],
    [/file explorer|^files$/i, "folder", 6],
    [/firefox|chrome|edge|brave|opera|vivaldi|browser|\barc\b/i, "globe", 1],
    [/terminal|powershell|command prompt|\bcmd\b|wsl|ubuntu|bash/i, "terminal", 6],
    [/code|visual studio|cursor|intellij|pycharm|clion|webstorm|rider|sublime|notepad\+\+|antigravity|\bzed\b|android studio|github|\bgit\b/i, "code", 1],
    [/spotify|music|itunes|media player|audacity|vlc|winamp|tidal/i, "music", 3],
    [/discord|slack|teams|whatsapp|telegram|messenger|signal|zoom|chat/i, "chat", 4],
    [/mail|outlook|thunderbird/i, "mail", 1],
    [/calendar/i, "week", 2],
    [/photo|paint|gimp|lightroom|krita|image|snipping|figma|blender|camera/i, "image", 5],
    [/note|notion|onenote|obsidian|\bword\b|wordpad|sticky|docs/i, "pen", 5],
    [/settings|control panel/i, "gear", 6],
    [/steam|epic|xbox|game|riot|battle\.net|minecraft|roblox|ea app|ubisoft|gog/i, "game", 3],
    [/store/i, "star", 2],
    [/remote desktop|vnc|parsec|anydesk|teamviewer/i, "monitor", 1],
    [/clock|alarm|timer/i, "clock", 5],
    [/download|torrent/i, "download", 3],
    [/explorer/i, "folder", 6],
  ];
  function look(name) {
    for (const [re, icon, k] of LOOKS) if (re.test(name)) return { icon, k };
    let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return { icon: "wmax", k: 1 + (h % 6) };
  }
  // Windows' own icon for the app (start.rs serves it on appicon:) over the pixel glyph, which stays when Windows
  // has none. Icons that loaded once are drawn loaded on the next render, so typing doesn't flicker them.
  const icons = { ok: new Set(), none: new Set() };
  const iconSrc = (id) => (LIVE && !icons.none.has(id) && window.__TAURI__ ? window.__TAURI__.core.convertFileSrc(id, "appicon") : "");
  function well(a, sm) {
    const l = look(a.name), src = iconSrc(a.id);
    if (l.icon === "tile") return `<span class="appg bare${sm ? " sm" : ""}"><span class="tile">C</span></span>`;
    const img = src ? `<img class="ai" src="${esc(src)}" data-id="${esc(a.id)}" alt="" loading="lazy" decoding="async">` : "";
    return `<span class="appg${sm ? " sm" : ""}${icons.ok.has(a.id) ? " real" : ""}" style="--kc: var(--k${l.k});">${ic(l.icon)}${img}</span>`;
  }

  // ─────────── Do first: the core's ranking ───────────
  function loadItems() {
    if (!LIVE) {
      const d = CA.sampleData(), ranked = E.rank(d.items.filter((it) => E.matchItem(it, [], { now: Date.now(), courses: d.courses })), Date.now());
      S.courses = d.courses; S.total = ranked.length; S.open = ranked.map((r) => r.it);
      S.rows = ranked.slice(0, 4).map((r) => ({ it: r.it, why: r.sc.reasons }));
      return Promise.resolve(render());
    }
    return Promise.all([invoke("list_items", { query: "is:open is:actionable", sort: "score" }), invoke("list_courses")]).then(([rows, courses]) => {
      const ranked = rows.filter((r) => r.score);
      S.courses = courses.map(CA.store.convert.courseIn);
      S.total = ranked.length;
      S.open = ranked.map((r) => CA.store.convert.itemIn(r.item));
      S.rows = ranked.slice(0, 4).map((r, i) => ({ it: S.open[i], why: r.score.reasons }));
      render();
    }).catch((e) => say(`Could not read Do first · ${esc(e)}`, "bad"));
  }
  const KIND = { assignment: "Assignment", exam: "Exam", quiz: "Quiz", lab: "Lab", reading: "Reading", project: "Project", errand: "Errand", application: "Application", task: "Task" };
  function kindIcon(it) {
    if (/^(e-?mail|email|mail)\b/i.test(it.title)) return "mail";
    return { exam: "exams", quiz: "exams", assignment: "work", lab: "work", project: "work", reading: "work", application: "flag" }[it.kind] || "check";
  }
  const DNM = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MNM = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dayName(t, now) {
    const diff = Math.round((E.startOfDay(t) - E.startOfDay(now)) / DAY), d = new Date(t);
    if (diff === 0) return "today"; if (diff === 1) return "tomorrow";
    return diff > 0 && diff < 7 ? DNM[d.getDay()] : `${DNM[d.getDay()]}, ${MNM[d.getMonth()]} ${d.getDate()}`;
  }
  function dueState(it, now) {
    if (it.due == null) return { t: "No date", c: "" };
    const d = it.due - now;
    if (d < 0) return { t: E.fmtDur(d) + " overdue", c: "over" };
    if (d < 24 * HR) return { t: "in " + E.fmtDur(d), c: d < 3 * HR ? "hot" : "soon" };
    return { t: "Due " + dayName(it.due, now), c: "" };
  }
  const estText = (m) => (m < 60 ? `~${m} min` : `~${E.fmtDur(m * MIN)}`);
  function itemRow(r, i, now) {
    const it = r.it, c = cById(it.course), ds = dueState(it, now);
    const meta = [c ? `<span style="--kc: var(--k${c.color});"><span class="cdot"></span>${esc(c.code)}</span>` : `<span>Personal</span>`,
      `<span>${KIND[it.kind] || "Task"}</span>`, it.est ? `<span>${estText(it.est)}</span>` : ""].join("");
    const why = r.why && r.why.length ? ` title="Why first: ${esc(r.why.join(" · "))}"` : "";
    return `<div class="frow${i === 0 ? " sel" : ""}" data-item="${esc(it.id)}"${why}>${ic(i === 0 ? "now" : kindIcon(it))}<div style="min-width: 0;"><div class="fn">${esc(it.title)}</div><div class="fm">${meta}</div></div><span class="pill ${ds.c}">${esc(ds.t)}</span></div>`;
  }
  function doFirst() {
    const now = Date.now();
    const body = S.rows.length ? S.rows.map((r, i) => itemRow(r, i, now)).join("")
      : `<div class="note"><b>Nothing to do first</b>Add one here: start with + and type it, like + read ch 4 thu</div>`;
    return `<div class="band hot"><span class="bt">${ic("now")}Do first</span><span class="cnt">${S.total ? `${S.rows.length} of ${S.total}` : "All clear"}</span><span class="sp"></span>
      <button class="k ghost sm" data-act="main">Open Collegiapp${ic("chevr")}</button></div><div class="rows">${body}</div>`;
  }

  // ─────────── pinned, All apps, search ───────────
  function pinned() {
    const pins = S.apps.pinned.slice(0, 12), slots = [];
    for (let i = 0; i < 12; i++) {
      const a = pins[i];
      slots.push(a ? `<button class="k pin" data-app="${esc(a.id)}" title="${esc(a.name)}">${well(a)}<span class="lb">${esc(a.name)}</span></button>` : `<span class="k pin empty" aria-hidden="true"></span>`);
    }
    const cnt = S.apps.loaded ? `${pins.length} of ${S.apps.all.length || pins.length}` : "Reading your apps";
    const grid = S.apps.loaded && !pins.length
      ? `<div class="note"><b>No pinned apps</b>Open All apps and right-click an app to pin it.</div>`
      : `<div class="grid">${slots.join("")}</div>`;
    return `<div class="band"><span class="bt">${ic("pin")}Pinned</span><span class="cnt">${cnt}</span><span class="sp"></span>
      <button class="k ghost sm" data-act="all">All apps${ic("chevr")}</button></div><div class="mb" style="padding-top: 0;">${grid}</div>`;
  }
  const appRow = (a, k, extra) => `<div class="frow app${hiddenHas(a) ? " gone" : ""}" data-app="${esc(a.id)}" data-k="${k}">${well(a, true)}<div class="fn">${esc(a.name)}</div><span class="fd">${extra || ""}</span></div>`;
  // apps you hid (right-click › Hide from All apps) stay out of All apps and search until "N hidden" shows them
  const hiddenHas = (a) => (S.apps.hidden || []).includes(a.id);
  const shown = (list) => (S.showHidden ? list : list.filter((a) => !hiddenHas(a)));
  function allApps() {
    const groups = new Map(), list = shown(S.apps.all), nHidden = S.apps.all.filter(hiddenHas).length;
    for (const a of list) {
      const ch = a.name.charAt(0).toUpperCase(), key = /[A-Z]/.test(ch) ? ch : /[0-9]/.test(ch) ? "#" : "&";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    S.results = []; let html = "";
    for (const [key, list] of groups) {
      html += `<div class="grp">${esc(key)}</div>`;
      for (const a of list) { html += appRow(a, S.results.length, pinnedHas(a) ? ic("pin", "s9") : ""); S.results.push({ type: "app", a }); }
    }
    const body = list.length ? html : `<div class="note"><b>${S.apps.loaded ? "No apps found" : "Reading your apps"}</b>${S.apps.loaded ? "Windows didn't list any Start apps." : "This takes a second the first time."}</div>`;
    const hiddenKey = nHidden ? `<button class="k ghost sm" data-act="hidden" title="${S.showHidden ? "Leave hidden apps out" : "Show the apps you hid"}">${ic("eye")}${S.showHidden ? "Hide them" : `${nHidden} hidden`}</button>` : "";
    return `<div class="band"><span class="bt">${ic("all")}All apps</span><span class="cnt">${list.length} apps</span><span class="sp"></span>
      ${hiddenKey}<button class="k ghost sm" data-act="home">${ic("chevl")}Pinned</button></div><div class="scroll" id="list">${body}</div>`;
  }
  function rank(list, q, name) { return list.map((x) => ({ x, s: E.fuzzy(q, name(x)) })).filter((r) => r.s > 1).sort((a, b) => b.s - a.s).map((r) => r.x); }
  function search() {
    const q = S.q.trim();
    const apps = rank(shown(S.apps.all.length ? S.apps.all : S.apps.pinned), q, (a) => a.name).slice(0, 8);
    const sets = rank(S.apps.settings, q, (a) => a.name + " settings").slice(0, 4);
    const tasks = rank(S.open, q, (it) => it.title).slice(0, 3);
    S.results = []; let html = "";
    const add = (r) => { S.results.push(r); return S.results.length - 1; };
    if (apps.length) html += `<div class="grp">Apps <span>${apps.length}</span></div>` + apps.map((a) => appRow(a, add({ type: "app", a }), "App")).join("");
    if (sets.length) html += `<div class="grp">Settings <span>${sets.length}</span></div>` + sets.map((a) => `<div class="frow app" data-app="${esc(a.id)}" data-k="${add({ type: "app", a })}"><span class="appg sm" style="--kc: var(--k6);">${ic("gear")}</span><div class="fn">${esc(a.name)}</div><span class="fd">Settings</span></div>`).join("");
    if (tasks.length) html += `<div class="grp">Do first <span>${tasks.length}</span></div>` + tasks.map((it) => { const c = cById(it.course); return `<div class="frow app" data-item="${esc(it.id)}" data-k="${add({ type: "item", it })}"><span class="appg sm" style="--kc: var(--k${c ? c.color : 2});">${ic(kindIcon(it))}</span><div class="fn">${esc(it.title)}</div><span class="fd">${esc(c ? c.code : "Task")}</span></div>`; }).join("");
    if (LIVE) html += `<div class="grp">Windows</div><div class="frow app" data-act="winsearch" data-k="${add({ type: "winsearch" })}"><span class="appg sm" style="--kc: var(--k1);">${ic("search")}</span><div class="fn">Search Windows for “${esc(q)}”</div><span class="fd">Win S</span></div>`;
    if (S.cur >= S.results.length) S.cur = 0;
    const found = S.results.filter((r) => r.type !== "winsearch").length;
    return `<div class="band"><span class="bt">${ic("search")}Results</span><span class="cnt">${found ? found + " found" : "Nothing in Start"}</span></div><div class="scroll" id="list">${html}</div>`;
  }
  const pinnedHas = (a) => S.apps.pinned.some((p) => p.id === a.id);

  // ─────────── deck ───────────
  function weekLine() {
    const q = CA.quarter, now = Date.now();
    if (q) {
      const wk = Math.floor((E.startOfDay(now) - q.week1.getTime()) / (7 * DAY)) + 1;
      if (wk >= 1 && wk <= q.weeks) return `${q.name} · week ${wk}`;
      if (wk === q.weeks + 1) return `${q.name} · finals week`;
    }
    const d = new Date(now); return `${DNM[d.getDay()]}, ${MNM[d.getMonth()]} ${d.getDate()}`;
  }
  function deck() {
    return `<button class="k ghost who" data-act="account" title="Your account"><span class="tile">${esc(S.user.charAt(0).toUpperCase())}</span><span class="nm"><span class="hi">${esc(S.user)}</span><span class="sub">${esc(weekLine())}</span></span></button>
      <span class="sp"></span>
      <button class="k sq" data-act="settings" aria-label="Settings" title="Settings">${ic("gear")}</button>
      <button class="k sq" data-act="files" aria-label="File explorer" title="File explorer">${ic("folder")}</button>
      <button class="k sq" data-act="lock" aria-label="Lock" title="Lock">${ic("lock")}</button>
      <button class="k dark" data-act="power" id="powerKey" aria-haspopup="menu">${ic("power")}Power</button>`;
  }

  // ─────────── hint line under the prompt ───────────
  const HINT = `Type a name to open it. Start with <span class="kb">+</span> to add a task to Do first, like <span class="mono">+ hw7 fri 5pm #cs130a</span>`;
  function say(html, cls) { S.note = { html, cls }; hint(); }
  function hint() {
    const h = $("hint");
    if (S.note) { h.innerHTML = `<span class="${S.note.cls || ""}">${S.note.html}</span>`; return; }
    if (S.q.startsWith("+")) return previewAdd();
    if (S.q.trim()) { const r = S.results[S.cur]; h.innerHTML = r ? `Enter opens <b>${esc(label(r))}</b> · ↑ ↓ to choose · Esc clears` : "Nothing matches. Esc clears."; return; }
    h.innerHTML = S.view === "all" ? `Type to search every app. Right-click one, or press <span class="kb">Shift F10</span>, for everything it can do.` : HINT;
  }
  const label = (r) => (r.type === "app" ? r.a.name : r.type === "item" ? r.it.title : "Windows search");
  let previewSeq = 0;
  function previewAdd() {
    const text = S.q.slice(1).trim(), h = $("hint"), seq = ++previewSeq;
    if (!text) { h.innerHTML = `Type the task after the +, like <span class="mono">+ pa3 130a fri 11:59p ~4h !!</span>`; return; }
    const show = (d) => {
      if (seq !== previewSeq) return;
      const c = d.course && cById(d.course), parts = [`<b>${esc(d.title || "(untitled)")}</b>`];
      if (c) parts.push(esc(c.code));
      if (d.due) parts.push(esc(`${dayName(d.due, Date.now()).replace(/^./, (x) => x.toUpperCase())} ${E.fmtTime(d.due).replace(/([AP])$/, " $1M")}`));
      if (d.est) parts.push(estText(d.est));
      if (d.pri) parts.push("!".repeat(d.pri));
      h.innerHTML = `Enter adds ${parts.join(" · ")}`;
    };
    if (!LIVE) return show(E.parseQuick(text, Date.now(), S.courses));
    invoke("quick_add_preview", { text }).then((d) => show({ title: d.title, course: d.course_id, due: d.due ? Date.parse(d.due) : null, est: d.est_minutes, pri: d.priority }), () => {});
  }

  // ─────────── render ───────────
  function render() {
    const m1 = $("m1"), m2 = $("m2"), searching = !!S.q.trim() && !S.q.startsWith("+");
    const mode = searching ? "search" : S.view;
    m1.classList.toggle("grow", mode !== "home");
    m2.hidden = mode !== "home";
    m1.innerHTML = mode === "search" ? search() : mode === "all" ? allApps() : pinned();
    if (mode === "home") { S.results = []; m2.innerHTML = doFirst(); }
    markCur();
    $("deck").innerHTML = deck();
    hint();
  }
  function markCur(scroll) {
    document.querySelectorAll("#m1 .frow.cur").forEach((el) => el.classList.remove("cur"));
    const el = document.querySelector(`#m1 .frow[data-k="${S.cur}"]`);
    if (el && (S.q.trim() || scroll)) { el.classList.add("cur"); if (scroll) el.scrollIntoView({ block: "nearest" }); }
  }

  // ─────────── actions ───────────
  // Start goes blank as it hides, so the next open deals the board in instead of flashing the last one (start.css)
  function hide() { closeMenu(); if (LIVE) { $("fly").classList.add("closed"); invoke("hide_start").catch(() => {}); } }
  // the main window's motion (lab.js leaves it in capp.tokens); M0 or reduced motion keeps Start still
  const stillMQ = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function motion() {
    let m = 1;
    try { const t = JSON.parse(localStorage.getItem("capp.tokens") || "null"); if (t && t.m != null) m = +t.m; } catch (e) {}
    if (stillMQ && stillMQ.matches) m = 0;
    document.documentElement.style.setProperty("--m", m);
    return m;
  }
  function fail(e) { say(esc(String(e)), "bad"); }
  function launch(id) { if (!LIVE) return say("Opening apps works inside the app.", "bad"); invoke("launch_app", { id }).catch(fail); }
  function act(a, text) { if (!LIVE) return say("This key works inside the app.", "bad"); closeMenu(); invoke("start_action", { action: a, text: text || null }).catch(fail); }
  // with no id this just shows the main window
  // Off: the Win key and the taskbar's Start key open Windows' Start again (start.rs `set_win_key`; the tray has it too)
  function setWinKey(on) {
    if (!LIVE) return say("This switch works inside the app.", "bad");
    invoke("set_start_win_key", { on }).then(() => {
      S.winKey = on;
      say(on ? "The Win key and the Start key open Pocket Start." : `The Win key and the Start key open Windows' Start now. <span class="kb">Ctrl Alt Space</span> still opens this one.`, "ok");
    }, fail);
  }
  function openItem(id) { if (LIVE) invoke("open_item", { id: id || null }).catch(fail); }
  function activate(r) {
    if (!r) return;
    if (r.type === "app") launch(r.a.id);
    else if (r.type === "item") openItem(r.it.id);
    else if (r.type === "winsearch") act("search", S.q.trim());
  }
  function addTask() {
    const text = S.q.slice(1).trim(); if (!text) return;
    const done = (title) => { setQ(""); say(`Added to Do first: <b>${esc(title)}</b>`, "ok"); loadItems(); };
    if (!LIVE) return done(E.parseQuick(text, Date.now(), S.courses).title || text);
    invoke("quick_add", { text }).then((it) => done(it.title), fail);
  }
  function setQ(v) { S.q = v; $("q").value = v; S.cur = 0; S.note = null; render(); }
  // Back and forward (the mouse's side buttons, Alt+← →, a keyboard's Browser keys): back steps out like Esc (menu,
  // search, All apps) but never closes Start; forward retraces those steps until you go somewhere new.
  const ahead = [];
  function back() {
    if (S.menu) { closeMenu(); return $("q").focus(); }
    if (S.q) { ahead.push({ q: S.q }); return setQ(""); }
    if (S.view !== "home") { ahead.push({ view: S.view }); S.view = "home"; S.cur = 0; render(); }
  }
  function forward() {
    const a = !S.menu && ahead.pop(); if (!a) return;
    if (a.q != null) return setQ(a.q);
    S.view = a.view; S.cur = 0; render();
  }
  function setPins(list) {
    if (!LIVE) return;
    invoke("set_start_pins", { pins: list }).then((apps) => { S.apps = apps; render(); }, fail);
  }
  function togglePin(a) {
    const list = S.apps.pinned.slice(), i = list.findIndex((p) => p.id === a.id);
    if (i >= 0) list.splice(i, 1); else list.push({ id: a.id, name: a.name });
    setPins(list);
  }
  function movePin(a, d) {
    const list = S.apps.pinned.map((p) => ({ id: p.id, name: p.name })), i = list.findIndex((p) => p.id === a.id), j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setPins(list);
  }
  // one of the right-click menu's commands for an app (start/menu.rs); a note comes back for the hint line
  function appDo(a, what) {
    if (!LIVE) return say("This works inside the app.", "bad");
    invoke("start_app_do", { id: a.id, what }).then((d) => {
      if (d && d.apps) { S.apps = d.apps; render(); }
      if (d && d.note) say(esc(d.note), "ok");
    }, fail);
  }
  function copy(text, what) {
    const done = () => say(`Copied ${what}: <span class="mono">${esc(text)}</span>`, "ok"), no = () => say("Couldn't copy that.", "bad");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, no); else no();
  }
  function markDone(it) {
    if (!LIVE) return say(`Done: <b>${esc(it.title)}</b>`, "ok");
    const item = CA.store.convert.itemOut(Object.assign({}, it, { status: "done" }));
    invoke("update_item", { item }).then(() => { say(`Done: <b>${esc(it.title)}</b>`, "ok"); loadItems(); }, fail);
  }

  // ─────────── menus ───────────
  // place: { x, y } (top-left, a right-click) or { right, bottom } (above a key), in window px; focus: an item to keep focused
  function openMenu(html, place, focus) {
    const m = $("menu"); m.innerHTML = html; m.hidden = false;
    const fly = $("fly").getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    const left = place.right != null ? place.right - w : place.x, top = place.bottom != null ? place.bottom - h : place.y;
    m.style.left = Math.max(8, Math.min(fly.width - w - 8, left - fly.left)) + "px";
    m.style.top = Math.max(8, Math.min(fly.height - h - 8, top - fly.top)) + "px";
    S.menu = true;
    const first = (focus && m.querySelector(`.mi[data-mact="${focus}"]`)) || m.querySelector(".mi"); if (first) first.focus();
  }
  let menuApp = null, menuInfo = null, menuItem = null, menuAsk = false, menuPlace = null, infoSeq = 0;
  function closeMenu() {
    const m = $("menu"); if (!m.hidden) { m.hidden = true; m.innerHTML = ""; }
    S.menu = null; menuApp = menuInfo = menuItem = null; menuAsk = false;
  }
  // opt: { kb: a key hint, on: a switch's state, bad: ends or removes something }
  function mi(act, icon, text, opt) {
    const o = opt || {}, sw = o.on != null;
    const end = sw ? `<span class="tog${o.on ? " on" : ""}">${o.on ? "On" : "Off"}</span>` : o.kb ? `<span class="kb">${o.kb}</span>` : "";
    return `<button class="mi${o.bad ? " bad" : ""}" role="${sw ? "menuitemcheckbox" : "menuitem"}"${sw ? ` aria-checked="${!!o.on}"` : ""} data-mact="${act}">${ic(icon)}<span class="mt">${esc(text)}</span>${end}</button>`;
  }
  const menuBand = (icon, name) => `<div class="band"><span class="bt">${ic(icon)}<span class="mname">${esc(name)}</span></span><span class="sp"></span></div>`;
  function powerMenu() {
    closeMenu();
    const k = $("powerKey").getBoundingClientRect();
    openMenu(`${menuBand("power", "Power")}<div class="its">
      ${mi("sleep", "moon", "Sleep")}${mi("restart", "update", "Restart")}${mi("shutdown", "power", "Shut down")}<div class="msep"></div>${mi("signout", "back", "Sign out")}
      ${S.winKey != null ? `<div class="msep"></div>${mi("winkey", "gear", "Win key opens Pocket Start", { on: S.winKey })}` : ""}</div>`,
    { right: k.right, bottom: k.top - 8 });
  }
  const isPath = (id) => /^([a-z]:\\|\\\\)/i.test(id);
  const isSettingsPage = (a) => S.apps.settings.some((s) => s.id === a.id);
  // An app's menu opens at once with what start.js knows, then fills in Windows' own commands (Run as administrator,
  // Open file location, Uninstall …) and the program's state when start_app_info answers.
  function appMenu(a, place) {
    closeMenu(); menuApp = a; menuPlace = place;
    drawAppMenu();
    if (!LIVE || isSettingsPage(a)) return;
    const seq = ++infoSeq;
    invoke("start_app_info", { id: a.id }).then((info) => {
      if (seq !== infoSeq || menuApp !== a) return;
      menuInfo = info; drawAppMenu(true);
    }, () => { if (seq === infoSeq && menuApp === a) { menuInfo = { verbs: [] }; drawAppMenu(true); } });
  }
  function drawAppMenu(keep) {
    const a = menuApp, info = menuInfo || {}, has = (v) => (info.verbs || []).includes(v), l = look(a.name);
    const head = menuBand(l.icon === "tile" ? "now" : l.icon, a.name);
    const focus = keep && document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.mact : null;
    if (menuAsk) {
      return openMenu(`${head}<div class="ask">Uninstall <b>${esc(a.name)}</b>? Windows takes it from here.</div><div class="its">
        ${mi("uninstall-yes", "trash", "Uninstall", { bad: true })}${mi("cancel", "back", "Keep it", { kb: "Esc" })}</div>`, menuPlace, "cancel");
    }
    const setting = isSettingsPage(a), pin = S.apps.pinned.findIndex((p) => p.id === a.id), path = info.program || (isPath(a.id) ? a.id : "");
    const groups = [
      [mi("open", "ext", "Open", { kb: "Enter" }), has("opennewwindow") && mi("opennewwindow", "wmax", "Open new window"),
        has("runas") && mi("runas", "shield", "Run as administrator", { kb: "Ctrl Shift Enter" })],
      [mi("pin", "pin", pin >= 0 ? "Unpin from Start" : "Pin to Start"), pin > 0 && mi("left", "chevl", "Move left"),
        pin >= 0 && pin < S.apps.pinned.length - 1 && mi("right", "chevr", "Move right"),
        !setting && mi(hiddenHas(a) ? "unhide" : "hide", "eye", hiddenHas(a) ? "Show in All apps" : "Hide from All apps")],
      [has("openfilelocation") && mi("openfilelocation", "folder", "Open file location"), info.program && mi("folder", "folder", "Open program folder"),
        info.program && mi("terminal", "terminal", "Open terminal here"), path && mi("copy", "copy", "Copy path"), path && mi("properties", "info", "Properties")],
      [info.blocked != null && mi("block", "lock", "Close during focus", { on: info.blocked }),
        info.signin && mi("signin", "clock", "Start at sign-in", { on: info.signin !== "off" }), LIVE && !setting && mi("desktop", "monitor", "Add to desktop")],
      [info.running && mi("relaunch", "update", "Restart"), info.running && mi("endtask", "x", "End task", { bad: true })],
      [has("taskbarunpin") && mi("taskbarunpin", "pin", "Unpin from taskbar"), info.package && mi("appsettings", "gear", "App settings"),
        has("uninstall") && mi("uninstall", "trash", "Uninstall…", { bad: true })],
      [S.apps.custom && mi("winpins", "update", "Use Windows pins")],
    ];
    const body = groups.map((g) => g.filter(Boolean).join("")).filter(Boolean).join(`<div class="msep"></div>`);
    const asking = LIVE && !setting && !menuInfo ? `<div class="mload">Asking Windows what else it can do…</div>` : "";
    openMenu(`${head}<div class="its">${body}${asking}</div>`, menuPlace, focus);
  }
  function itemMenu(it, place) {
    closeMenu(); menuItem = it; menuPlace = place;
    openMenu(`${menuBand(kindIcon(it), it.title)}<div class="its">${mi("openitem", "ext", "Open in Collegiapp", { kb: "Enter" })}
      ${it.status !== "done" ? mi("done", "check", "Mark done") : ""}${mi("copytitle", "copy", "Copy title")}</div>`, place);
  }
  // Start's own menu, from a right-click anywhere that isn't an app or a task
  function startMenu(place) {
    closeMenu();
    const all = S.view === "all", nHidden = S.apps.all.filter(hiddenHas).length;
    openMenu(`${menuBand("now", "Pocket Start")}<div class="its">${mi("main", "ext", "Open Collegiapp")}
      ${mi(all ? "pinned" : "allapps", all ? "chevl" : "all", all ? "Pinned" : "All apps")}${all && nHidden ? mi("showhidden", "eye", S.showHidden ? "Leave hidden apps out" : "Show hidden apps") : ""}
      ${S.apps.custom ? mi("winpins", "update", "Use Windows pins") : ""}<div class="msep"></div>
      ${mi("settings", "gear", "Settings")}${mi("files", "folder", "File Explorer")}
      ${S.winKey != null ? `<div class="msep"></div>${mi("winkey", "gear", "Win key opens Pocket Start", { on: S.winKey })}` : ""}</div>`, place);
  }
  function onMenu(m) {
    const app = menuApp, info = menuInfo || {}, it = menuItem;
    if (app && m === "uninstall") { menuAsk = true; return drawAppMenu(); }
    if (app && m === "cancel") { menuAsk = false; return drawAppMenu(); }
    closeMenu();
    if (it) {
      if (m === "openitem") openItem(it.id);
      else if (m === "done") markDone(it);
      else if (m === "copytitle") copy(it.title, "the title");
      return;
    }
    if (m === "winkey") return setWinKey(!S.winKey);
    if (!app) {
      if (m === "main") return openItem(null);
      if (m === "allapps" || m === "pinned") { ahead.length = 0; S.view = m === "allapps" ? "all" : "home"; S.cur = 0; return render(); }
      if (m === "showhidden") { S.showHidden = !S.showHidden; S.cur = 0; return render(); }
      if (m === "winpins") return setPins(null);
      if (["sleep", "restart", "shutdown", "signout", "settings", "files"].includes(m)) act(m);
      return;
    }
    if (m === "open") return launch(app.id);
    if (m === "pin") return togglePin(app);
    if (m === "left" || m === "right") return movePin(app, m === "left" ? -1 : 1);
    if (m === "winpins") return setPins(null);
    if (m === "copy") return copy(info.program || app.id, "the path");
    appDo(app, m === "uninstall-yes" ? "uninstall" : m === "relaunch" ? "restart" : m);
  }
  const findApp = (id) => S.apps.pinned.concat(S.apps.all, S.apps.settings).find((a) => a.id === id);
  // the app or task the keyboard is on: a focused pinned key, or the picked row
  function picked() {
    const f = document.activeElement && document.activeElement.closest ? document.activeElement.closest("[data-app]") : null, a = f && findApp(f.dataset.app);
    if (a) return { type: "app", a, el: f };
    const row = document.querySelector("#m1 .frow.cur");
    return row && S.results[S.cur] ? Object.assign({ el: row }, S.results[S.cur]) : null;
  }
  function keyMenu() {
    const r = picked(); if (!r) return;
    const b = r.el.getBoundingClientRect(), place = { x: b.left + 24, y: b.bottom - 4 };
    if (r.type === "app") appMenu(r.a, place); else if (r.type === "item") itemMenu(r.it, place);
  }

  // ─────────── events ───────────
  function bind() {
    document.addEventListener("load", (e) => {
      const img = e.target;
      if (!img.classList || !img.classList.contains("ai")) return;
      icons.ok.add(img.dataset.id); img.parentNode.classList.add("real");
    }, true);
    document.addEventListener("error", (e) => {
      const img = e.target;
      if (!img.classList || !img.classList.contains("ai")) return;
      icons.none.add(img.dataset.id); img.remove();
    }, true);
    const q = $("q");
    q.addEventListener("input", () => { ahead.length = 0; S.q = q.value; S.cur = 0; S.note = null; render(); });
    document.addEventListener("keydown", (e) => {
      const k = e.key, alt = e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey;
      if (k === "BrowserBack" || (alt && k === "ArrowLeft")) { e.preventDefault(); return back(); }
      if (k === "BrowserForward" || (alt && k === "ArrowRight")) { e.preventDefault(); return forward(); }
      if (S.menu) {
        const items = Array.from(document.querySelectorAll("#menu .mi")), i = items.indexOf(document.activeElement);
        if (e.key === "Escape") { e.preventDefault(); closeMenu(); q.focus(); }
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]; if (n) n.focus(); }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (S.q) return setQ("");
        if (S.view !== "home") { S.view = "home"; return render(); }
        return hide();
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && S.results.length) {
        e.preventDefault(); S.cur = (S.cur + (e.key === "ArrowDown" ? 1 : S.results.length - 1)) % S.results.length; markCur(true); hint(); return;
      }
      // the menu key or Shift+F10: the menu of the app or task the keyboard is on
      if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) { e.preventDefault(); return keyMenu(); }
      // Ctrl+Shift+Enter runs the picked app as administrator, as in Windows' Start
      if (e.key === "Enter" && e.ctrlKey && e.shiftKey) {
        const r = picked();
        if (r && r.type === "app" && !isSettingsPage(r.a)) { e.preventDefault(); return appDo(r.a, "runas"); }
      }
      if (e.key === "Enter" && document.activeElement === q) {
        e.preventDefault();
        if (S.q.startsWith("+")) return addTask();
        // in All apps, Enter opens the row picked with the arrows
        if (S.results.length && (S.q.trim() || document.querySelector("#m1 .frow.cur"))) return activate(S.results[S.cur]);
      }
      // typing anywhere goes to the prompt
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && document.activeElement !== q) q.focus();
    });
    document.addEventListener("mousedown", (e) => {
      if (e.button === 3 || e.button === 4) return e.preventDefault(); // acts on release, below
      if (!e.target.closest("#fly")) { e.preventDefault(); return hide(); }
      if (S.menu && !e.target.closest("#menu")) closeMenu();
    });
    document.addEventListener("mouseup", (e) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); if (e.button === 3) back(); else forward(); } });
    document.addEventListener("contextmenu", (e) => {
      if (e.target.closest("input")) return;
      e.preventDefault();
      const place = { x: e.clientX, y: e.clientY };
      const el = e.target.closest("[data-app]"), a = el && findApp(el.dataset.app);
      if (a) return appMenu(a, place);
      const row = e.target.closest("[data-item]"), it = row && S.open.find((x) => x.id === row.dataset.item);
      if (it) return itemMenu(it, place);
      if (e.target.closest("#fly") && !e.target.closest("#menu")) startMenu(place);
    });
    $("esc").addEventListener("click", () => (S.q ? setQ("") : hide()));
    $("fly").addEventListener("click", (e) => {
      const m = e.target.closest("[data-mact]"); if (m) return onMenu(m.dataset.mact);
      const b = e.target.closest("[data-act]");
      if (b) {
        const a = b.dataset.act;
        if (a === "all" || a === "home") { ahead.length = 0; S.view = a; S.cur = 0; return render(); }
        if (a === "hidden") { S.showHidden = !S.showHidden; S.cur = 0; return render(); }
        if (a === "main") return openItem(null);
        if (a === "power") return S.menu ? closeMenu() : powerMenu();
        if (a === "winsearch") return act("search", S.q.trim());
        return act(a);
      }
      const app = e.target.closest("[data-app]"); if (app) return launch(app.dataset.app);
      const item = e.target.closest("[data-item]"); if (item) return openItem(item.dataset.item);
    });
    if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener("change", theme);
    window.addEventListener("focus", () => { $("fly").classList.remove("closed"); if (!S.menu) q.focus(); });
    if (LIVE) document.addEventListener("visibilitychange", () => { if (document.hidden) $("fly").classList.add("closed"); });
  }
  // Each time Start shows: a clean prompt, Windows' light/dark mode, fresh Do first.
  function onOpen(info) {
    closeMenu();
    if (info) { shellNight = info.night; S.user = info.user || S.user; S.winKey = info.win_key; }
    theme();
    S.view = "home"; S.note = null; $("q").value = ""; S.q = ""; S.cur = 0; S.showHidden = false; ahead.length = 0;
    render(); loadItems();
    const fly = $("fly"); fly.classList.remove("closed", "opening");
    if (motion()) { void fly.offsetWidth; fly.classList.add("opening"); setTimeout(() => fly.classList.remove("opening"), 900); }
    setTimeout(() => $("q").focus(), 0);
  }

  bind(); theme(); render();
  if (LIVE) {
    CA.store.on("start-open", onOpen);
    CA.store.on("start-apps", (apps) => { S.apps = apps; render(); });
    CA.store.on("items-changed", () => loadItems());
    CA.store.on("start-win-key", (on) => { S.winKey = on; });
    invoke("start_apps").then((apps) => { S.apps = apps; render(); }, () => {});
  } else {
    S.user = "Dobson";
    S.apps = { pinned: ["File Explorer", "Firefox", "Terminal", "Visual Studio Code", "Collegiapp", "Spotify", "Discord", "Outlook", "Calendar", "Photos", "Notion", "Settings"].map((n) => ({ id: n, name: n })), all: [], settings: [], custom: false, hidden: [], loaded: true };
    S.apps.all = S.apps.pinned.slice().sort((a, b) => a.name.localeCompare(b.name));
  }
  loadItems();
})();
