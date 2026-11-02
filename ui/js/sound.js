/* Collegiapp — synthesized UI sounds (WebAudio, no assets). Level 0 off · 1 soft · 2 full. */
(function () {
  const CA = (window.CA = window.CA || {});
  let ctx = null;
  const S = (CA.sound = { level: 0 });
  function ac() {
    if (!S.level) return null;
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === "suspended") ctx.resume(); } catch (e) { return null; }
    return ctx;
  }
  const vol = () => (S.level === 2 ? 0.14 : 0.05);
  function tone(freq, dur, type, gain, slideTo, delay) {
    const a = ac(); if (!a) return;
    const t0 = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || "square"; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime((gain || 1) * vol(), t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, freq, gain) {
    const a = ac(); if (!a) return;
    const len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = "bandpass"; f.frequency.value = freq || 3000; g.gain.value = (gain || 1) * vol();
    src.connect(f).connect(g).connect(a.destination); src.start();
  }
  S.click = () => tone(1900, 0.03, "square", 0.6);
  S.key = () => noise(0.012, 3600, 0.9);
  S.tick = () => noise(0.008, 5200, 0.6); // a swipe crossing its threshold
  S.ok = () => { tone(880, 0.07, "square", 0.6); tone(1320, 0.09, "square", 0.6, null, 0.07); };
  S.undo = () => { tone(1320, 0.05, "square", 0.5); tone(880, 0.08, "square", 0.5, null, 0.05); };
  S.nope = () => { tone(196, 0.08, "square", 0.7); tone(147, 0.12, "square", 0.7, null, 0.09); }; // refused: Esc in Lockdown, an empty add
  S.done = () => { tone(660, 0.06, "triangle", 1); tone(990, 0.06, "triangle", 1, null, 0.06); tone(1320, 0.12, "triangle", 1, null, 0.12); };
  S.clear = () => { [660, 880, 990, 1320].forEach((f, i) => tone(f, 0.08, "triangle", 1, null, i * 0.07)); }; // the last Do first item done
  S.beep = () => { tone(880, 0.14, "square", 0.8); tone(660, 0.18, "square", 0.8, null, 0.16); };
  S.alarm = () => { for (let i = 0; i < 3; i++) { tone(1046, 0.12, "square", 1, null, i * 0.32); tone(784, 0.12, "square", 1, null, i * 0.32 + 0.14); } };
  S.degauss = () => { tone(120, 0.6, "sawtooth", 0.9, 38); noise(0.25, 180, 1.4); };
  // the handheld's boot chirp (on) and its power-down (off)
  S.power = (on) => { if (on) { tone(523, 0.05, "square", 0.45); tone(1046, 0.09, "square", 0.45, null, 0.06); } else { tone(900, 0.35, "sine", 0.5, 60); } };
  S.whoosh = () => noise(0.18, 1200, 0.7);
  S.static = () => noise(0.32, 2600, 0.3); // a channel change: the hiss the tuner passes through
  S.ding = () => { tone(2093, 0.5, "sine", 0.55); tone(4186, 0.25, "sine", 0.18); }; // the teletype's bell at the end of a reply
  // a modem's handshake, cut short: the answer tone, the two carriers trading, a burst of scrambled noise
  S.modem = () => { tone(2100, 0.09, "sine", 0.45); tone(1270, 0.05, "square", 0.25, null, 0.1); tone(2225, 0.05, "square", 0.25, null, 0.15); tone(1070, 0.05, "square", 0.25, null, 0.2); setTimeout(() => noise(0.16, 2400, 0.5), 260); };
  // A tube TV, timed with fx.js's power sequences (k scales the times with motion). On: the relay's click and thunk, the
  // degauss coil's 60 Hz hum dying away, the hiss of snow until the signal locks, and the flyback's faint 15.7 kHz whine.
  // Off: a thump, the zip as the picture collapses, static crackling on the glass, and the whine winding down.
  function env(g, t0, k, pts) { g.gain.setValueAtTime(0.0001, t0); pts.forEach(([t, v]) => g.gain.linearRampToValueAtTime(Math.max(0.0001, v * vol()), t0 + t * k)); }
  function osc(a, t0, k, type, f0, f1, pts, filt) {
    const o = a.createOscillator(), g = a.createGain(), end = pts[pts.length - 1][0] * k;
    o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + end);
    env(g, t0, k, pts);
    let n = o; if (filt) { const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filt; n = o.connect(f); }
    n.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + end + 0.05);
  }
  function hiss(a, t0, k, type, freq, q, pts, crackle) {
    const end = pts[pts.length - 1][0] * k, len = Math.max(1, Math.ceil(a.sampleRate * (end + 0.05)));
    const buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    if (crackle) { for (let i = 0; i < len; i++) if (Math.random() < 0.0011) { const amp = (Math.random() * 0.8 + 0.2) * (Math.random() < 0.5 ? -1 : 1); for (let j = 0; j < 40 && i + j < len; j++) d[i + j] += amp * Math.exp(-j / 6); } }
    else for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    env(g, t0, k, pts);
    src.connect(f).connect(g).connect(a.destination); src.start(t0); src.stop(t0 + end + 0.05);
  }
  // Warm (back on within a minute): the coil's thermistor is still hot, so no degauss hum and no snow, only the click
  // and the whine.
  S.crtOn = (k, warm) => {
    const a = ac(); if (!a) return;
    const t0 = a.currentTime + 0.01; k = k || 1;
    hiss(a, t0, 1, "bandpass", 2600, 0.8, [[0.002, 1.3], [0.012, 0.0001]]); // relay click
    if (warm) return osc(a, t0 + 0.03 * k, k, "sine", 15734, 0, [[0.08, 0.08], [0.3, 0.06], [0.5, 0.0001]]);
    osc(a, t0, 1, "sine", 92, 44, [[0.01, 1.1], [0.16, 0.0001]]); // thunk
    osc(a, t0 + 0.02, k, "sawtooth", 60, 0, [[0.02, 0.85], [0.14, 0.55], [0.34, 0.22], [0.62, 0.0001]], 480); // degauss hum
    osc(a, t0 + 0.02, k, "square", 120, 0, [[0.02, 0.22], [0.22, 0.1], [0.56, 0.0001]], 900);
    hiss(a, t0 + 0.09 * k, k, "bandpass", 4800, 0.45, [[0.05, 0.55], [0.32, 0.5], [0.5, 0.24], [0.68, 0.0001]]); // snow
    osc(a, t0 + 0.06 * k, k, "sine", 15734, 0, [[0.18, 0.09], [0.75, 0.07], [1.1, 0.0001]]); // flyback whine
  };
  S.crtOff = (k) => {
    const a = ac(); if (!a) return;
    const t0 = a.currentTime + 0.01; k = k || 1;
    osc(a, t0, 1, "sine", 110, 38, [[0.01, 0.9], [0.2, 0.0001]]); // thump
    osc(a, t0 + 0.04 * k, k, "triangle", 2400, 70, [[0.015, 0.5], [0.22, 0.3], [0.34, 0.0001]]); // the zip
    osc(a, t0 + 0.04 * k, k, "sine", 3600, 105, [[0.015, 0.16], [0.3, 0.0001]]);
    hiss(a, t0 + 0.05 * k, k, "highpass", 1800, 0.7, [[0.02, 1.1], [0.35, 0.7], [0.75, 0.0001]], true); // static on the glass
    osc(a, t0, k, "sine", 15734, 8600, [[0.05, 0.07], [0.6, 0.0001]]); // the whine winding down
  };
  // A VCR's search, timed with fx.js's track (undo rewinds, redo fast-forwards): the solenoid's clunk, the reel motor
  // spinning up (a rewind winds down in pitch, fast-forward up), the tape hissing past the heads, and a softer clunk as
  // it drops back to play.
  S.tape = (back, k) => {
    const a = ac(); if (!a) return;
    const t0 = a.currentTime + 0.01; k = k || 1;
    hiss(a, t0, 1, "bandpass", 1800, 1.2, [[0.003, 1], [0.03, 0.0001]]); // clunk
    osc(a, t0, 1, "sine", 150, 55, [[0.008, 0.9], [0.09, 0.0001]]);
    osc(a, t0 + 0.02 * k, k, "sawtooth", back ? 230 : 160, back ? 140 : 270, [[0.04, 0.2], [0.22, 0.18], [0.27, 0.0001]], 700); // motor
    hiss(a, t0 + 0.02 * k, k, "bandpass", 5200, 0.5, [[0.03, 0.26], [0.23, 0.22], [0.28, 0.0001]]); // tape
    osc(a, t0 + 0.29 * k, 1, "sine", 120, 50, [[0.006, 0.5], [0.07, 0.0001]]); // back to play
  };
})();
