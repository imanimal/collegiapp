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
  S.ok = () => { tone(880, 0.07, "square", 0.6); tone(1320, 0.09, "square", 0.6, null, 0.07); };
  S.done = () => { tone(660, 0.06, "triangle", 1); tone(990, 0.06, "triangle", 1, null, 0.06); tone(1320, 0.12, "triangle", 1, null, 0.12); };
  S.beep = () => { tone(880, 0.14, "square", 0.8); tone(660, 0.18, "square", 0.8, null, 0.16); };
  S.alarm = () => { for (let i = 0; i < 3; i++) { tone(1046, 0.12, "square", 1, null, i * 0.32); tone(784, 0.12, "square", 1, null, i * 0.32 + 0.14); } };
  S.degauss = () => { tone(120, 0.6, "sawtooth", 0.9, 38); noise(0.25, 180, 1.4); };
  S.power = (on) => { if (on) { tone(55, 0.5, "sine", 1.2, 110); noise(0.12, 600, 0.8); } else { tone(900, 0.35, "sine", 0.5, 60); } };
  S.whoosh = () => noise(0.18, 1200, 0.7);
})();
