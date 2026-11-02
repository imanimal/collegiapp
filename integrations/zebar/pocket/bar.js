/* Pocket bar for Zebar: the taskbar ("key deck") from the Pocket for Windows design, as a working bar.
   Classic script, no build step. Inside Zebar it reads Zebar's providers. Opened in a plain browser it runs on the
   design canvas's sample values, so the look can be checked without Zebar (?theme=night; ?desk draws the desk).
   Edit THEME, PINS and ACTIONS to taste. A new program or argument pattern also needs an entry in zpack.json's
   privileges.shellCommands: `program` must equal the string used here exactly, and `argsRegex` is searched in the
   arguments joined by spaces (an empty regex allows no arguments at all). */
(function () {
  "use strict";

  // "auto" follows Windows light/dark mode: Cream (P9) by day, Night (P11) after dark. Or "cream" / "night".
  const THEME = "auto";
  // Collegiapp's presence endpoint (docs/PLATFORM_PRESENCE.md). Nothing shows until it answers.
  const PRESENCE_URL = "http://127.0.0.1:4747/presence";

  // Program keys, used unless the GlazeWM widget has workspaces to show. `open` is handed to explorer.exe, so a
  // shell:AppsFolder\<AppID> target (PowerShell's Get-StartApps lists them), a URL or a path all work; "" opens
  // File Explorer. `exe` lights the key's LED while one of those processes runs (Edge is left out because it
  // idles in the background). `presence` marks the key that shows Collegiapp's progress bar.
  const PINS = [
    { label: "File explorer", icon: "folder", open: "", exe: [] },
    { label: "Browser", icon: "globe", open: "https://www.google.com/", exe: ["chrome.exe", "firefox.exe", "brave.exe", "arc.exe"] },
    { label: "Terminal", icon: "terminal", open: "shell:AppsFolder\\Microsoft.WindowsTerminal_8wekyb3d8bbwe!App", exe: ["WindowsTerminal.exe"] },
    { label: "Code", icon: "code", open: "shell:AppsFolder\\Microsoft.VisualStudioCode", exe: ["Code.exe"] },
    { label: "Collegiapp", tile: "C", open: "shell:AppsFolder\\io.github.imanimal.collegiapp", exe: ["collegiapp.exe"], presence: true },
  ];

  // What the fixed keys run. Start sends Ctrl+Esc, which opens Start (typing there searches); PowerShell takes
  // about half a second to do it. ms-actioncenter: opens notifications and the calendar, and
  // ms-actioncenter:controlcenter/ opens quick settings.
  const ACTIONS = {
    start: ["powershell", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", "(New-Object -ComObject WScript.Shell).SendKeys('^{ESC}')"]],
    quick: ["explorer", ["ms-actioncenter:controlcenter/&showFooter=true"]],
    notifications: ["explorer", ["ms-actioncenter:"]],
  };
  ACTIONS.search = ACTIONS.start;
  ACTIONS.calendar = ACTIONS.notifications;

  // 9×9 pixel icons, one path per glyph (the same bitmaps as the design canvas).
  const ICONS = {
    start: "M0 0h4v1h-4zM5 0h4v1h-4zM0 1h4v1h-4zM5 1h4v1h-4zM0 2h4v1h-4zM5 2h4v1h-4zM0 3h4v1h-4zM5 3h4v1h-4zM0 5h4v1h-4zM5 5h4v1h-4zM0 6h4v1h-4zM5 6h4v1h-4zM0 7h4v1h-4zM5 7h4v1h-4zM0 8h4v1h-4zM5 8h4v1h-4z",
    search: "M2 0h3v1h-3zM1 1h1v1h-1zM5 1h1v1h-1zM0 2h1v1h-1zM6 2h1v1h-1zM0 3h1v1h-1zM6 3h1v1h-1zM0 4h1v1h-1zM6 4h1v1h-1zM1 5h1v1h-1zM5 5h1v1h-1zM2 6h4v1h-4zM6 7h2v1h-2zM7 8h2v1h-2z",
    folder: "M0 1h4v1h-4zM0 2h9v1h-9zM0 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1zM0 7h9v1h-9z",
    globe: "M2 0h5v1h-5zM1 1h1v1h-1zM4 1h1v1h-1zM7 1h1v1h-1zM0 2h1v1h-1zM3 2h1v1h-1zM5 2h1v1h-1zM8 2h1v1h-1zM0 3h9v1h-9zM0 4h1v1h-1zM3 4h1v1h-1zM5 4h1v1h-1zM8 4h1v1h-1zM0 5h9v1h-9zM0 6h1v1h-1zM3 6h1v1h-1zM5 6h1v1h-1zM8 6h1v1h-1zM1 7h1v1h-1zM4 7h1v1h-1zM7 7h1v1h-1zM2 8h5v1h-5z",
    terminal: "M0 1h9v1h-9zM0 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM2 3h1v1h-1zM8 3h1v1h-1zM0 4h1v1h-1zM3 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM2 5h1v1h-1zM4 5h3v1h-3zM8 5h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1zM0 7h9v1h-9z",
    code: "M2 2h1v1h-1zM6 2h1v1h-1zM1 3h1v1h-1zM5 3h1v1h-1zM7 3h1v1h-1zM0 4h1v1h-1zM4 4h1v1h-1zM8 4h1v1h-1zM1 5h1v1h-1zM3 5h1v1h-1zM7 5h1v1h-1zM2 6h1v1h-1zM6 6h1v1h-1z",
    music: "M3 0h6v1h-6zM3 1h6v1h-6zM3 2h1v1h-1zM8 2h1v1h-1zM3 3h1v1h-1zM8 3h1v1h-1zM3 4h1v1h-1zM8 4h1v1h-1zM1 5h3v1h-3zM6 5h3v1h-3zM0 6h4v1h-4zM5 6h4v1h-4zM1 7h2v1h-2zM6 7h2v1h-2z",
    play: "M2 0h1v1h-1zM2 1h2v1h-2zM2 2h3v1h-3zM2 3h4v1h-4zM2 4h5v1h-5zM2 5h4v1h-4zM2 6h3v1h-3zM2 7h2v1h-2zM2 8h1v1h-1z",
    pause: "M1 1h2v7h-2zM6 1h2v7h-2z",
    up: "M4 2h1v1h-1zM3 3h3v1h-3zM2 4h2v1h-2zM5 4h2v1h-2zM1 5h2v1h-2zM6 5h2v1h-2zM1 6h1v1h-1zM7 6h1v1h-1z",
    wifi: "M2 1h5v1h-5zM1 2h1v1h-1zM7 2h1v1h-1zM0 3h1v1h-1zM3 3h3v1h-3zM8 3h1v1h-1zM2 4h1v1h-1zM6 4h1v1h-1zM3 6h3v1h-3zM3 7h3v1h-3z",
    wifiLow: "M3 3h3v1h-3zM2 4h1v1h-1zM6 4h1v1h-1zM3 6h3v1h-3zM3 7h3v1h-3z",
    lan: "M3 0h3v1h-3zM3 1h1v1h-1zM5 1h1v1h-1zM3 2h3v1h-3zM4 3h1v1h-1zM1 4h7v1h-7zM1 5h1v1h-1zM7 5h1v1h-1zM0 6h3v1h-3zM6 6h3v1h-3zM0 7h1v1h-1zM2 7h1v1h-1zM6 7h1v1h-1zM8 7h1v1h-1zM0 8h3v1h-3zM6 8h3v1h-3z",
    volume: "M3 1h1v1h-1zM2 2h2v1h-2zM6 2h1v1h-1zM0 3h4v1h-4zM7 3h1v1h-1zM0 4h4v1h-4zM5 4h1v1h-1zM7 4h1v1h-1zM0 5h4v1h-4zM7 5h1v1h-1zM2 6h2v1h-2zM6 6h1v1h-1zM3 7h1v1h-1z",
    mute: "M3 1h1v1h-1zM2 2h2v1h-2zM0 3h4v1h-4zM5 3h1v1h-1zM7 3h1v1h-1zM0 4h4v1h-4zM6 4h1v1h-1zM0 5h4v1h-4zM5 5h1v1h-1zM7 5h1v1h-1zM2 6h2v1h-2zM3 7h1v1h-1z",
    now: "M5 0h3v1h-3zM4 1h3v1h-3zM3 2h3v1h-3zM2 3h6v1h-6zM5 4h2v1h-2zM4 5h2v1h-2zM3 6h2v1h-2zM2 7h2v1h-2zM1 8h2v1h-2z",
    bell: "M4 0h1v1h-1zM3 1h3v1h-3zM2 2h5v1h-5zM2 3h5v1h-5zM2 4h5v1h-5zM1 5h7v1h-7zM0 6h9v1h-9zM4 8h1v1h-1z",
  };
  // battery: the outline plus 0–4 columns of charge
  for (let n = 0; n <= 4; n++) {
    ICONS["bat" + n] = "M0 2h8v1h-8zM0 3h1v1h-1zM7 3h2v1h-2zM0 4h1v1h-1zM7 4h2v1h-2zM0 5h1v1h-1zM7 5h2v1h-2zM0 6h8v1h-8z" + (n ? `M2 3h${n}v3h-${n}z` : "");
  }

  const params = new URLSearchParams(location.search);
  const WM = document.documentElement.dataset.wm === "glazewm";
  const IN_ZEBAR = "__TAURI_INTERNALS__" in window || "__ZEBAR_STATE" in window;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const svg = (name) => `<svg class="i" viewBox="0 0 9 9" aria-hidden="true"><path d="${ICONS[name] || ""}"></path></svg>`;
  const tf = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const df = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

  let run = (program, args) => console.info("[demo]", program, args.join(" "));  // zebar.shellExec inside Zebar
  let last = {};          // the latest provider outputs
  let mode = "pins";      // or "ws" while GlazeWM reports workspaces
  let pres = null, presAt = 0, trayOpen = false;

  // only touch the DOM when a value changes: render runs every second
  function set(id, text) { const el = $(id); if (el.textContent !== text) el.textContent = text; }
  function attr(el, name, val) { if (el.getAttribute(name) !== val) el.setAttribute(name, val); }
  function html(el, markup) { if (el.dataset.html !== markup) { el.dataset.html = markup; el.innerHTML = markup; } }
  function icon(el, name) { html(el, svg(name)); }

  // ───── theme ─────
  const darkMq = matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    const t = params.get("theme") || THEME;
    document.documentElement.classList.toggle("night", t === "night" || (t === "auto" && darkMq.matches));
  }
  darkMq.addEventListener("change", applyTheme);
  applyTheme();
  if (params.has("desk")) document.documentElement.classList.add("desk");

  // ───── the deck ─────
  function build() {
    $("deck").innerHTML = `
      <button class="k primary start" data-act="start">${svg("start")}Start</button>
      <button class="srch" data-act="search" title="Opens Start; type to search">${svg("search")}<span class="st">Search apps and files</span></button>
      <div class="slot" id="keys"></div>
      <div class="mid">
        <div class="np" id="np" hidden>
          <button class="k sm sq" id="npKey" aria-label="Play or pause"></button>
          <div class="lcd row npl">${svg("music")}<span class="npt" id="npText"></span></div>
        </div>
        <div class="slot trayx" id="trayx" hidden></div>
        <span class="sp"></span>
        <span class="engr">Pocket CA-1</span>
        <span class="grille" aria-hidden="true"></span>
      </div>
      <button class="lcd clk pres" id="pres" data-act="collegiapp" hidden><span class="ln" id="presN"></span><span class="ll" id="presL"></span></button>
      <button class="k sm sq more" id="more" aria-label="Show hidden icons" aria-expanded="false">${svg("up")}</button>
      <button class="lcd row tray" id="tray" data-act="quick"><span id="netI"></span><span id="volI"></span><span id="batI"></span><span class="ll" id="batT"></span></button>
      <button class="lcd clk" id="clock" data-act="calendar" aria-label="Clock, notifications and calendar"><span class="ln" id="time"></span><span class="ll" id="date"></span></button>
      <button class="k sq" data-act="notifications" aria-label="Notifications">${svg("bell")}</button>`;
  }

  function drawPins() {
    $("keys").innerHTML = PINS.map((p, i) => {
      const glyph = p.tile ? `<span class="tile">${esc(p.tile)}</span>` : svg(p.icon);
      const label = i === 0 ? `<span class="lbl">${esc(p.label)}</span>` : "";
      const prog = p.presence ? `<span class="kprog" hidden><i></i></span>` : "";
      return `<button class="pk ${i === 0 ? "named" : "sq"}" data-act="pin" data-i="${i}" title="${esc(p.label)}" aria-label="${esc(p.label)}">${glyph}${label}<span class="led" hidden></span>${prog}</button>`;
    }).join("");
  }

  function lightPins(running) {
    document.querySelectorAll('#keys [data-act="pin"]').forEach((b) => {
      b.querySelector(".led").hidden = !PINS[+b.dataset.i].exe.some((x) => running.has(x.toLowerCase()));
    });
  }

  // GlazeWM workspaces on this monitor: the focused one is pressed; an LED marks one that holds windows
  let wsSig = "";
  function drawWorkspaces(g) {
    const list = g.currentWorkspaces || [];
    const sig = list.map((w) => `${w.name}:${w.hasFocus ? 1 : 0}:${w.children && w.children.length ? 1 : 0}`).join("|");
    if (sig === wsSig) return;
    wsSig = sig;
    $("keys").innerHTML = list.map((w) => {
      const name = w.displayName || w.name;
      const led = !w.hasFocus && w.children && w.children.length ? `<span class="led"></span>` : "";
      return `<button class="pk ws${w.hasFocus ? " on" : ""}" data-ws="${esc(w.name)}" aria-label="Workspace ${esc(name)}">${esc(name)}${led}</button>`;
    }).join("");
  }

  function drawClock(d) {
    set("time", tf.format(d));
    set("date", df.format(d));
  }

  function drawNet(n) {
    const iface = n && n.defaultInterface, gw = n && n.defaultGateway;
    const wifi = !!iface && iface.type === "wifi", sig = gw && gw.signalStrength;
    icon($("netI"), !iface ? "wifi" : wifi ? (sig != null && sig < 45 ? "wifiLow" : "wifi") : "lan");
    $("netI").classList.toggle("dim", !iface);
    if (!n) return "";
    if (!iface) return "Not connected";
    return wifi ? `Wi-Fi${gw && gw.ssid ? `: ${gw.ssid}` : ""}${sig != null ? ` (${Math.round(sig)}%)` : ""}` : "Ethernet";
  }

  function drawVol(a) {
    const d = a && a.defaultPlaybackDevice;
    $("volI").hidden = !d;
    if (!d) return "";
    const muted = d.isMuted || d.volume === 0;
    icon($("volI"), muted ? "mute" : "volume");
    return muted ? "Muted" : `Volume ${Math.round(d.volume)}%`;
  }

  // the tray LCD turns amber at 20% and red at 10% while on battery
  function drawBat(b) {
    const tray = $("tray");
    $("batI").hidden = $("batT").hidden = !b;
    if (!b) { tray.classList.remove("hot", "bad"); return ""; }
    const pct = Math.round(b.chargePercent), charging = !!b.isCharging;
    icon($("batI"), charging ? "now" : "bat" + (pct > 5 ? Math.max(1, Math.round(pct / 25)) : 0));
    set("batT", `${pct}%`);
    tray.classList.toggle("hot", !charging && pct <= 20 && pct > 10);
    tray.classList.toggle("bad", !charging && pct <= 10);
    return `Battery ${pct}%${charging ? ", charging" : ""}`;
  }

  function drawMedia(m) {
    const s = m && m.currentSession;
    $("np").hidden = !(s && s.title);
    if (!s || !s.title) return;
    icon($("npKey"), s.isPlaying ? "pause" : "play");
    attr($("npKey"), "aria-label", s.isPlaying ? "Pause" : "Play");
    html($("npText"), `${esc(s.title)}${s.artist ? ` <span>· ${esc(s.artist)}</span>` : ""}`);
    attr($("np"), "title", [s.title, s.artist].filter(Boolean).join(" · "));
  }

  // the hidden tray icons open in a strip inside the deck; left and right clicks go to the real icon
  function drawTrayIcons(st) {
    const icons = (st && st.icons) || [];
    $("more").hidden = !icons.length;
    if (!icons.length && trayOpen) toggleTray(false);
    if (!trayOpen) return;
    html($("trayx"), icons.map((t) => `<button class="ti" data-tray="${esc(t.id)}" title="${esc(t.tooltip)}" aria-label="${esc(t.tooltip || "Tray icon")}"><img src="${esc(t.iconUrl)}" alt=""></button>`).join(""));
  }

  function toggleTray(open) {
    trayOpen = open;
    $("trayx").hidden = !open;
    $("deck").classList.toggle("tray-open", open);
    attr($("more"), "aria-expanded", String(open));
    attr($("more"), "aria-label", open ? "Hide hidden icons" : "Show hidden icons");
    if (open) drawTrayIcons(last.systray);
  }

  // Collegiapp: the next class or focus session. Amber within 15 minutes of a start, or while focus runs.
  function drawPresence() {
    const p = pres, el = $("pres");
    const prog = document.querySelector("#keys .kprog");
    el.hidden = !(p && (p.short || p.label));
    if (el.hidden) { if (prog) prog.hidden = true; return; }
    const startsIn = p.starts_in_secs == null ? null : p.starts_in_secs - (Date.now() - presAt) / 1000;
    set("presN", p.short || p.label);
    set("presL", p.due_today ? `${p.due_today} due today` : p.detail || "");
    el.classList.toggle("hot", (startsIn != null && startsIn > 0 && startsIn <= 900) || !!(p.focus && p.focus.active));
    const lines = [p.label, p.detail, p.do_first && `Do first: ${p.do_first}`].filter(Boolean);
    attr(el, "title", lines.join("\n"));
    attr(el, "aria-label", `Collegiapp: ${lines.join(". ")}`);
    if (prog) {
      const f = p.progress == null ? null : p.progress > 1 ? p.progress / 100 : p.progress;
      prog.hidden = f == null;
      if (f != null) prog.firstChild.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
    }
  }

  async function pollPresence() {
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 2000);
      const r = await fetch(PRESENCE_URL, { cache: "no-store", signal: ctl.signal });
      clearTimeout(timer);
      pres = r.ok ? await r.json() : null;
    } catch (_) {
      pres = null;
    }
    presAt = Date.now();
    drawPresence();
  }

  function render(out) {
    last = out || {};
    if (last.date) drawClock(new Date(last.date.now));
    const tips = [drawNet(last.network), drawVol(last.audio), drawBat(last.battery)].filter(Boolean);
    if (last.audio && last.audio.defaultPlaybackDevice) tips.push("Scroll to change the volume");
    attr($("tray"), "title", tips.join("\n"));
    attr($("tray"), "aria-label", `Quick settings. ${tips.join(". ")}`);
    drawMedia(last.media);
    drawTrayIcons(last.systray);
    if (WM && last.glazewm) {
      mode = "ws";
      drawWorkspaces(last.glazewm);
    } else if (mode === "ws") {
      mode = "pins";
      wsSig = "";
      drawPins();
    }
    if (pres) drawPresence();
  }

  // ───── input ─────
  function bind() {
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    $("deck").addEventListener("click", (e) => {
      const el = e.target.closest("[data-act], [data-ws], [data-tray]");
      if (!el) return;
      if (el.dataset.ws) return last.glazewm && last.glazewm.runCommand(`focus --workspace ${el.dataset.ws}`);
      if (el.dataset.tray) return last.systray && last.systray.onLeftClick(el.dataset.tray);
      const act = el.dataset.act;
      if (act === "pin") return openPin(PINS[+el.dataset.i]);
      if (act === "collegiapp") return openPin(PINS.find((p) => p.presence));
      if (ACTIONS[act]) run(ACTIONS[act][0], ACTIONS[act][1]);
    });
    $("trayx").addEventListener("contextmenu", (e) => {
      const el = e.target.closest("[data-tray]");
      if (el && last.systray) last.systray.onRightClick(el.dataset.tray);
    });
    $("more").addEventListener("click", () => toggleTray(!trayOpen));
    $("npKey").addEventListener("click", () => last.media && last.media.togglePlayPause());
    $("tray").addEventListener("wheel", (e) => {
      const a = last.audio, d = a && a.defaultPlaybackDevice;
      if (!d) return;
      e.preventDefault();
      a.setVolume(Math.max(0, Math.min(100, Math.round(d.volume - Math.sign(e.deltaY) * 2))));
    }, { passive: false });
  }

  function openPin(p) {
    if (p) run("explorer", p.open ? [p.open] : []);
  }

  // ───── Zebar ─────
  async function start() {
    build();
    drawPins();
    bind();
    if (!IN_ZEBAR) return demo();
    try {
      const zebar = await import("https://esm.sh/zebar@3.0");
      run = (program, args) => zebar.shellExec(program, args).catch((err) => console.warn("Pocket bar:", program, err));
      const cfg = {
        date: { type: "date", formatting: "t" },
        network: { type: "network" },
        audio: { type: "audio" },
        battery: { type: "battery" },
        media: { type: "media" },
        systray: { type: "systray" },
      };
      if (WM) cfg.glazewm = { type: "glazewm" };
      const group = zebar.createProviderGroup(cfg);
      group.onOutput(() => render(group.outputMap));
      render(group.outputMap);
      // which pinned apps are running: tasklist runs without a window every 10 s
      const poll = async () => {
        if (mode !== "pins") return;
        try {
          const res = await zebar.shellExec("tasklist", ["/FO", "CSV", "/NH"]);
          lightPins(new Set(String(res.stdout).split(/\r?\n/).map((l) => l.split('","')[0].replace(/^"/, "").toLowerCase())));
        } catch (err) {
          console.warn("Pocket bar: tasklist", err);
        }
      };
      poll();
      setInterval(poll, 10000);
    } catch (err) {
      console.error("Pocket bar: Zebar providers didn't start", err);
    }
    pollPresence();
    setInterval(pollPresence, 30000);
  }

  // ───── demo: the design canvas's values, for checking the look in a browser ─────
  function demo() {
    const dot = (c) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="3" fill="${c}"/></svg>`);
    const out = {
      date: { now: new Date(2026, 10, 1, 13, 42).getTime() },
      network: { defaultInterface: { type: "wifi" }, defaultGateway: { ssid: "eduroam", signalStrength: 82 } },
      audio: { defaultPlaybackDevice: { volume: 42, isMuted: false }, setVolume: (v) => { out.audio.defaultPlaybackDevice.volume = v; render(out); } },
      battery: { chargePercent: 84, isCharging: false },
      media: { currentSession: { title: "Lo-fi study mix", artist: "Focus radio", isPlaying: true }, togglePlayPause: () => { out.media.currentSession.isPlaying = !out.media.currentSession.isPlaying; render(out); } },
      systray: { icons: ["#2f6fde", "#2e8b57", "#b03aa8"].map((c, i) => ({ id: String(i), iconUrl: dot(c), tooltip: `Tray icon ${i + 1}` })), onLeftClick: (id) => console.info("[demo] tray", id), onRightClick: (id) => console.info("[demo] tray menu", id) },
    };
    if (WM) {
      out.glazewm = {
        currentWorkspaces: ["1", "2", "3", "4"].map((name) => ({ name, hasFocus: name === "2", children: name === "4" ? [] : [{}] })),
        runCommand: (c) => console.info("[demo] glazewm", c),
      };
    }
    render(out);
    lightPins(new Set(["chrome.exe", "windowsterminal.exe", "collegiapp.exe"]));
    pres = { label: "Midterm 2 review session", short: "Review 18m", detail: "in 18m · Phelps 1160", starts_in_secs: 1080, progress: null, focus: { active: false }, due_today: 3, do_first: "Reading response: memory hierarchy" };
    presAt = Date.now();
    drawPresence();
  }

  start();
})();
