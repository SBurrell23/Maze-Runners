// Every sound in the game is synthesised here with the Web Audio API.
// No audio files are loaded.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi -> Hz

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.muted = false;
    this.music = null;
    this.amb = null;
    this.torchLevel = 0;
    this._popTimer = 0;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0.55; this.musicGain.connect(this.master);
    this.ambGain = ctx.createGain(); this.ambGain.gain.value = 0.8; this.ambGain.connect(this.master);
    // shared reverb
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this._impulse(2.2, 2.5);
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.master);
    this.noise = this._noiseBuffer(2);
    return ctx;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05); }
  toggleMute() { this.muted = !this.muted; this.setVolume(this.volume); return this.muted; }

  _noiseBuffer(seconds) {
    const ctx = this.ctx, n = ctx.sampleRate * seconds, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _impulse(seconds, decay) {
    const ctx = this.ctx, n = ctx.sampleRate * seconds, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  _env(gain, t, a, peak, d, sustain = 0, r = 0.05, hold = 0) {
    const g = gain.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d);
    if (hold) g.setValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d + hold);
    g.exponentialRampToValueAtTime(0.0001, t + a + d + hold + r);
  }
  _tone(freq, t, { type = 'sine', a = 0.01, d = 0.2, peak = 0.3, sustain = 0, r = 0.05, hold = 0, dest = null, detune = 0, lp = 0 } = {}) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    let node = o;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f; }
    node.connect(g); g.connect(dest || this.sfx);
    this._env(g, t, a, peak, d, sustain, r, hold);
    o.start(t); o.stop(t + a + d + hold + r + 0.05);
    return o;
  }
  _noiseBurst(t, { dur = 0.08, peak = 0.3, lp = 800, hp = 0, dest = null } = {}) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    let node = s;
    if (hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
    const g = ctx.createGain(); node.connect(g); g.connect(dest || this.sfx);
    this._env(g, t, 0.005, peak, dur);
    s.start(t, Math.random()); s.stop(t + dur + 0.1);
  }

  // ------------------------------------------------------------ UI / SFX
  click() { if (!this.ctx) return; const t = this.ctx.currentTime; this._tone(620, t, { type: 'square', d: 0.05, peak: 0.08, lp: 1800 }); }
  join() { if (!this.ctx) return; const t = this.ctx.currentTime; this._tone(523, t, { d: 0.15, peak: 0.18 }); this._tone(784, t + 0.11, { d: 0.25, peak: 0.18 }); }
  leave() { if (!this.ctx) return; const t = this.ctx.currentTime; this._tone(784, t, { d: 0.15, peak: 0.15 }); this._tone(523, t + 0.11, { d: 0.25, peak: 0.15 }); }
  countdown(n) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    if (n > 0) this._tone(880, t, { type: 'triangle', d: 0.18, peak: 0.25 });
    else { for (const f of [1046, 1318, 1568]) this._tone(f, t, { type: 'triangle', d: 0.6, peak: 0.2, dest: this.reverb }); this._tone(1318, t, { type: 'triangle', d: 0.5, peak: 0.25 }); }
  }
  step(sprint) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this._noiseBurst(t, { dur: sprint ? 0.09 : 0.11, peak: sprint ? 0.22 : 0.16, lp: 420 + Math.random() * 200 });
    this._tone(70 + Math.random() * 20, t, { d: 0.08, peak: 0.12 });
  }
  chime() { // someone escaped
    if (!this.ctx) return; const t = this.ctx.currentTime;
    [72, 76, 79, 84].forEach((n, i) => this._tone(NOTE(n), t + i * 0.09, { type: 'triangle', d: 0.5, peak: 0.16, dest: this.reverb }));
  }
  win() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const seq = [[60, 0], [64, 0.14], [67, 0.28], [72, 0.42], [67, 0.62], [72, 0.76]];
    for (const [n, dt] of seq) { this._tone(NOTE(n), t + dt, { type: 'sawtooth', d: 0.22, peak: 0.12, lp: 2400, dest: this.reverb }); this._tone(NOTE(n), t + dt, { type: 'triangle', d: 0.25, peak: 0.12 }); }
    for (const n of [60, 64, 67, 72, 76]) { this._tone(NOTE(n), t + 1.0, { type: 'sawtooth', a: 0.02, d: 0.3, sustain: 0.06, hold: 1.2, r: 0.8, peak: 0.1, lp: 2200, dest: this.reverb }); }
  }
  lose() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    [67, 63, 60, 55].forEach((n, i) => this._tone(NOTE(n), t + i * 0.22, { type: 'triangle', d: 0.4, peak: 0.16, dest: this.reverb }));
  }
  sign() { if (!this.ctx) return; const t = this.ctx.currentTime; this._noiseBurst(t, { dur: 0.05, peak: 0.12, lp: 2500, hp: 400 }); }

  // ------------------------------------------------------------ AMBIENCE
  startAmbience() {
    if (!this.ctx || this.amb) return;
    const ctx = this.ctx;
    const amb = { nodes: [] };
    // wind: noise -> bandpass (slowly wandering) -> gain (slow swell)
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06; const lfoG = ctx.createGain(); lfoG.gain.value = 220; lfo.connect(lfoG); lfoG.connect(bp.frequency);
    const wg = ctx.createGain(); wg.gain.value = 0.05;
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.045; const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.03; lfo2.connect(lfo2G); lfo2G.connect(wg.gain);
    src.connect(bp); bp.connect(wg); wg.connect(this.ambGain);
    src.start(); lfo.start(); lfo2.start();
    amb.wind = wg; amb.nodes.push(src, lfo, lfo2);
    // torch crackle: noise -> highpass -> gain (driven by proximity), pops scheduled from tick()
    const ts = ctx.createBufferSource(); ts.buffer = this.noise; ts.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2400; hp.Q.value = 0.5;
    const tg = ctx.createGain(); tg.gain.value = 0;
    const tlevel = ctx.createGain(); tlevel.gain.value = 0;
    ts.connect(hp); hp.connect(tg); tg.connect(tlevel); tlevel.connect(this.ambGain); ts.start();
    amb.torchPop = tg; amb.torchLevel = tlevel; amb.nodes.push(ts);
    // low fire rumble
    const rs = ctx.createBufferSource(); rs.buffer = this.noise; rs.loop = true;
    const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 160;
    const rg = ctx.createGain(); rg.gain.value = 0.5; rs.connect(rl); rl.connect(rg); rg.connect(tlevel); rs.start(); amb.nodes.push(rs);
    amb.crickets = 0; amb.birds = 0; amb.nextCricket = 0; amb.nextBird = 0;
    this.amb = amb;
  }

  stopAmbience() {
    if (!this.amb) return;
    for (const n of this.amb.nodes) { try { n.stop(); } catch (e) { /* already stopped */ } }
    this.amb = null;
  }

  /** Called from the game loop. night/day in 0..1, torch proximity in 0..1. */
  tick(dt, { night = 0, day = 1, torch = 0 } = {}) {
    if (!this.ctx || !this.amb) return;
    const ctx = this.ctx, t = ctx.currentTime, amb = this.amb;
    if (!Number.isFinite(torch)) torch = 0;
    if (!Number.isFinite(night)) night = 0;
    if (!Number.isFinite(day)) day = 0;
    amb.torchLevel.gain.setTargetAtTime(torch * 0.9, t, 0.15);
    this._popTimer -= dt;
    if (this._popTimer <= 0) {
      this._popTimer = 0.03 + Math.random() * 0.14;
      if (torch > 0.02) { const g = amb.torchPop.gain; const v = 0.05 + Math.random() * 0.35 * torch; g.cancelScheduledValues(t); g.setValueAtTime(0.02, t); g.linearRampToValueAtTime(v, t + 0.004); g.exponentialRampToValueAtTime(0.02, t + 0.03 + Math.random() * 0.03); }
    }
    amb.nextCricket -= dt;
    if (amb.nextCricket <= 0) {
      amb.nextCricket = 0.35 + Math.random() * 0.5;
      if (night > 0.05 && Math.random() < 0.85) this._cricket(t, night * 0.08);
    }
    amb.nextBird -= dt;
    if (amb.nextBird <= 0) {
      amb.nextBird = 2 + Math.random() * 7;
      if (day > 0.2 && Math.random() < 0.8) this._bird(t + Math.random(), day * 0.06);
    }
  }
  _cricket(t, vol) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 3900 + Math.random() * 700; o.connect(g); g.connect(this.ambGain);
    const n = 5 + (Math.random() * 6) | 0; const sp = 0.028;
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) { g.gain.linearRampToValueAtTime(vol, t + i * sp + 0.006); g.gain.linearRampToValueAtTime(0, t + i * sp + sp * 0.8); }
    o.start(t); o.stop(t + n * sp + 0.05);
  }
  _bird(t, vol) {
    const ctx = this.ctx; const n = 2 + (Math.random() * 3) | 0; const base = 1800 + Math.random() * 1400;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
      const st = t + i * (0.12 + Math.random() * 0.1);
      o.frequency.setValueAtTime(base, st); o.frequency.linearRampToValueAtTime(base * 1.6, st + 0.05); o.frequency.linearRampToValueAtTime(base * 1.1, st + 0.13);
      o.connect(g); g.connect(this.reverb); g.connect(this.ambGain);
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(vol, st + 0.02); g.gain.linearRampToValueAtTime(0, st + 0.14);
      o.start(st); o.stop(st + 0.2);
    }
  }

  // ------------------------------------------------------------ MUSIC
  startMusic(mode = 'lobby') {
    if (!this.ctx) return;
    if (this.music) { this.music.mode = mode; return; }
    const ctx = this.ctx;
    const m = { mode, bpm: 78, step: 0, nextTime: ctx.currentTime + 0.1, chordIdx: 0, arpNote: 62, timer: 0 };
    // delay for the plucks
    m.delay = ctx.createDelay(1.5); m.delay.delayTime.value = (60 / m.bpm) * 0.75;
    m.fb = ctx.createGain(); m.fb.gain.value = 0.38;
    m.dlp = ctx.createBiquadFilter(); m.dlp.type = 'lowpass'; m.dlp.frequency.value = 1800;
    m.delay.connect(m.dlp); m.dlp.connect(m.fb); m.fb.connect(m.delay); m.dlp.connect(this.musicGain);
    m.pluckBus = ctx.createGain(); m.pluckBus.gain.value = 1; m.pluckBus.connect(this.musicGain); m.pluckBus.connect(m.delay); m.pluckBus.connect(this.reverb);
    m.padBus = ctx.createGain(); m.padBus.gain.value = 0.7; m.padBus.connect(this.musicGain); m.padBus.connect(this.reverb);
    m.padLP = ctx.createBiquadFilter(); m.padLP.type = 'lowpass'; m.padLP.frequency.value = 700; m.padLP.connect(m.padBus);
    // D minor-ish progression (midi): Dm, Bb, F, C | Dm, Gm, Bb, A
    m.chords = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55], [50, 53, 57], [43, 46, 50], [46, 50, 53], [45, 49, 52]];
    m.scale = [50, 52, 53, 55, 57, 58, 60, 62, 64, 65, 67, 69, 70, 72, 74];
    this.music = m;
    m.timer = setInterval(() => this._musicTick(), 30);
  }

  stopMusic() {
    if (!this.music) return;
    clearInterval(this.music.timer);
    const m = this.music; this.music = null;
    const t = this.ctx.currentTime;
    m.padBus.gain.setTargetAtTime(0, t, 0.4); m.pluckBus.gain.setTargetAtTime(0, t, 0.4);
    setTimeout(() => { try { m.padBus.disconnect(); m.pluckBus.disconnect(); m.dlp.disconnect(); } catch (e) { /* noop */ } }, 3000);
  }

  _musicTick() {
    const m = this.music; if (!m) return;
    const ctx = this.ctx, beat = 60 / m.bpm, stepDur = beat / 2; // 8th-note grid
    while (m.nextTime < ctx.currentTime + 0.15) {
      const t = m.nextTime, s = m.step;
      const chord = m.chords[m.chordIdx % m.chords.length];
      if (s % 16 === 0) { this._pad(chord, t, 16 * stepDur); this._bass(chord[0] - 12, t, 16 * stepDur); }
      // arpeggio: random walk on the scale, favouring chord tones
      const game = m.mode === 'game';
      const density = game ? 0.8 : 0.5;
      if (Math.random() < density || s % 4 === 0) {
        const tones = chord.map(n => n + 12).concat(chord.map(n => n + 24));
        let n;
        if (Math.random() < 0.6) n = tones[(Math.random() * tones.length) | 0];
        else { const i = m.scale.indexOf(m.arpNote); const j = Math.max(0, Math.min(m.scale.length - 1, (i < 0 ? 6 : i) + ((Math.random() * 5) | 0) - 2)); n = m.scale[j] + 12; }
        m.arpNote = n - 12;
        this._pluck(n, t, game ? 0.09 : 0.075);
      }
      if (game) {
        if (s % 4 === 0) this._kick(t, 0.22);
        if (s % 4 === 2) this._noiseBurst(t, { dur: 0.03, peak: 0.035, hp: 6000, dest: this.musicGain });
        if (s % 16 === 8 && Math.random() < 0.5) this._noiseBurst(t, { dur: 0.12, peak: 0.05, hp: 1500, lp: 5000, dest: this.musicGain });
      }
      m.step++;
      if (m.step % 16 === 0) m.chordIdx++;
      m.nextTime += stepDur;
    }
  }
  _pad(chord, t, dur) {
    const m = this.music;
    for (const n of chord) for (const det of [-6, 6]) {
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = NOTE(n); o.detune.value = det;
      const g = this.ctx.createGain(); o.connect(g); g.connect(m.padLP);
      const a = 1.2, r = 1.6;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.045, t + a); g.gain.setValueAtTime(0.045, t + dur - 0.2); g.gain.linearRampToValueAtTime(0, t + dur + r);
      o.start(t); o.stop(t + dur + r + 0.1);
    }
  }
  _bass(n, t, dur) {
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = NOTE(n);
    const g = this.ctx.createGain(); o.connect(g); g.connect(this.musicGain);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.08); g.gain.exponentialRampToValueAtTime(0.03, t + dur * 0.8); g.gain.linearRampToValueAtTime(0, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _pluck(n, t, vol) {
    const m = this.music;
    const f = NOTE(n);
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = this.ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2; const g2 = this.ctx.createGain(); g2.gain.value = 0.25;
    const g = this.ctx.createGain(); o.connect(g); o2.connect(g2); g2.connect(g); g.connect(m.pluckBus);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.55);
    o.start(t); o2.start(t); o.stop(t + 0.6); o2.stop(t + 0.6);
  }
  _kick(t, vol) {
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    const g = this.ctx.createGain(); o.connect(g); g.connect(this.musicGain);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.start(t); o.stop(t + 0.3);
  }
}
