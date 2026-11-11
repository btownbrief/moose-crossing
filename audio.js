/* Moose Crossing — WebAudio synth sounds, a light plucky music loop, a blizzard wind bed, haptics. No audio files. */
(function () {
  'use strict';
  var KEY = 'moosecrossing.audio';
  var Snd = {
    ctx: null, master: null, sfxGain: null, musicGain: null, windGain: null,
    sfxOn: true, musicOn: true, started: false, _noise: null, _timer: null, _next: 0, _step: 0,
    _lastHonk: 0, _chain: 0, _chainT: 0, _leafChain: 0, _leafT: 0, _tempo: 1,

    load: function () {
      try {
        var s = JSON.parse(localStorage.getItem(KEY) || '{}');
        if (typeof s.sfx === 'boolean') this.sfxOn = s.sfx;
        if (typeof s.music === 'boolean') this.musicOn = s.music;
      } catch (e) { /* ignore */ }
    },
    save: function () { try { localStorage.setItem(KEY, JSON.stringify({ sfx: this.sfxOn, music: this.musicOn })); } catch (e) { /* ignore */ } },

    unlock: function () { // call from a user gesture (iOS)
      try {
        if (!this.ctx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          var c = this.ctx = new AC();
          this.master = c.createGain(); this.master.gain.value = 0.9;
          var comp = c.createDynamicsCompressor();
          this.master.connect(comp); comp.connect(c.destination);
          this.sfxGain = c.createGain(); this.sfxGain.gain.value = this.sfxOn ? 0.8 : 0;
          this.musicGain = c.createGain(); this.musicGain.gain.value = this.musicOn ? 0.45 : 0;
          this.sfxGain.connect(this.master); this.musicGain.connect(this.master);
          var len = c.sampleRate * 1.5;
          this._noise = c.createBuffer(1, len, c.sampleRate);
          var d = this._noise.getChannelData(0);
          for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
          // wind bed: looping noise through a band-pass, volume driven by the blizzard
          var src = c.createBufferSource(); src.buffer = this._noise; src.loop = true;
          var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 0.7;
          this.windGain = c.createGain(); this.windGain.gain.value = 0;
          src.connect(f); f.connect(this.windGain); this.windGain.connect(this.sfxGain);
          src.start();
          this._windF = f;
        }
        if (this.ctx.state !== 'running') this.ctx.resume();
        this.started = true;
        this.startMusic();
      } catch (e) { /* no audio */ }
    },
    suspend: function () { try { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); } catch (e) { /* */ } },
    resume: function () { try { if (this.ctx && this.ctx.state !== 'running' && this.started) this.ctx.resume(); } catch (e) { /* */ } },
    setSfx: function (on) { this.sfxOn = on; if (this.sfxGain) this.sfxGain.gain.value = on ? 0.8 : 0; this.save(); },
    setMusic: function (on) { this.musicOn = on; if (this.musicGain) this.musicGain.gain.value = on ? 0.45 : 0; this.save(); },

    tone: function (freq, dur, type, vol, slideTo, delay, dest) {
      if (!this.ctx || (!this.sfxOn && !dest)) return;
      var t0 = this.ctx.currentTime + (delay || 0);
      var o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(dest || this.sfxGain);
      o.start(t0); o.stop(t0 + dur + 0.03);
    },
    noise: function (dur, vol, freq, type, delay, slideTo) {
      if (!this.ctx || !this.sfxOn) return;
      var t0 = this.ctx.currentTime + (delay || 0);
      var s = this.ctx.createBufferSource(); s.buffer = this._noise;
      var f = this.ctx.createBiquadFilter(); f.type = type || 'highpass'; f.frequency.setValueAtTime(freq || 2000, t0);
      if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(vol || 0.2, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f); f.connect(g); g.connect(this.sfxGain);
      s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.03);
    },

    ladder: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24],
    pitch: function (step, base) { var s = this.ladder[Math.min(step, this.ladder.length - 1)]; return (base || 392) * Math.pow(2, s / 12); },

    // ---- game sounds ----
    hop: function (surface) {
      var now = this.ctx ? this.ctx.currentTime : 0;
      if (now - this._chainT > 0.7) this._chain = 0; else this._chain = Math.min(this._chain + 1, 10);
      this._chainT = now;
      var f = this.pitch(this._chain, 300);
      this.tone(f, 0.11, 'sine', 0.2, f * 1.7);
      this.tone(f * 2, 0.05, 'triangle', 0.05);
    },
    land: function (surface) {
      if (surface === 'river') { this.tone(190, 0.12, 'sine', 0.16, 110); this.noise(0.1, 0.05, 1400, 'bandpass'); }
      else if (surface === 'road') { this.tone(150, 0.07, 'sine', 0.14, 100); this.noise(0.03, 0.05, 2500); }
      else if (surface === 'snow') { this.noise(0.08, 0.1, 1800, 'lowpass'); this.tone(130, 0.07, 'sine', 0.1, 90); }
      else if (surface === 'mud') { this.noise(0.1, 0.12, 500, 'lowpass'); this.tone(100, 0.09, 'sine', 0.12, 70); }
      else { this.tone(140, 0.07, 'sine', 0.13, 95); this.noise(0.04, 0.05, 3000); }
    },
    bump: function () { this.tone(120, 0.08, 'square', 0.1, 70); this.noise(0.04, 0.08, 800, 'bandpass'); },
    errand: function () { [0, 4, 7, 12, 7, 12, 16].forEach(function (st, i) { Snd.tone(659 * Math.pow(2, st / 12), 0.16, i % 2 ? 'sine' : 'triangle', 0.12, 0, i * 0.055); }); },
    streak: function (lv) { var b = 523 * Math.pow(2, Math.min(lv - 1, 6) * 2 / 12); [0, 4, 7, 12].forEach(function (st, i) { Snd.tone(b * Math.pow(2, st / 12), 0.14, 'triangle', 0.11, 0, i * 0.045); }); },
    whoosh: function (big) { // a near miss: air rushing past, then a relieved little chirp
      this.noise(big ? 0.45 : 0.28, big ? 0.22 : 0.16, 600, 'bandpass', 0, 2600);
      this.tone(880, 0.08, 'triangle', 0.08, 1320, 0.12); this.tone(1320, 0.1, 'triangle', 0.07, 1760, 0.19);
    },
    leaf: function (gold) {
      var now = this.ctx ? this.ctx.currentTime : 0;
      if (now - this._leafT > 2.5) this._leafChain = 0; else this._leafChain = Math.min(this._leafChain + 1, 8);
      this._leafT = now;
      var f = this.pitch(this._leafChain, 523);
      this.tone(f, 0.18, 'triangle', 0.2); this.tone(f * 2, 0.14, 'sine', 0.08, 0, 0.04);
      if (gold) { this.tone(f * 1.5, 0.2, 'triangle', 0.15, 0, 0.07); this.tone(f * 2, 0.3, 'sine', 0.12, 0, 0.13); }
    },
    honk: function (far) {
      var now = this.ctx ? this.ctx.currentTime : 0;
      if (now - this._lastHonk < 0.7) return; this._lastHonk = now;
      var v = far ? 0.07 : 0.12;
      this.tone(392, 0.28, 'square', v, 0, 0); this.tone(311, 0.28, 'square', v, 0, 0);
      this.tone(396, 0.28, 'sawtooth', v * 0.5, 0, 0.005);
    },
    squish: function () {
      this.noise(0.22, 0.32, 700, 'bandpass', 0, 200);
      this.tone(260, 0.35, 'sine', 0.22, 60);
      this.tone(90, 0.2, 'square', 0.12, 50);
      this.tone(520, 0.5, 'triangle', 0.1, 130, 0.1);
    },
    splash: function () {
      this.noise(0.4, 0.3, 1500, 'bandpass', 0, 400);
      this.tone(480, 0.25, 'sine', 0.2, 180);
      this.tone(320, 0.2, 'sine', 0.15, 520, 0.12);
    },
    freeze: function () {
      this.noise(0.5, 0.2, 5000, 'highpass');
      [0, 3, 7, 10].forEach(function (s, i) { Snd.tone(1046 * Math.pow(2, s / 12), 0.35, 'sine', 0.1, 0, i * 0.05); });
      this.tone(220, 0.6, 'triangle', 0.12, 140);
    },
    bell: function (vol) {
      this.tone(1180, 0.34, 'sine', (vol || 1) * 0.11); this.tone(1770, 0.2, 'sine', (vol || 1) * 0.05);
    },
    trainHorn: function (vol) {
      var v = (vol || 1) * 0.12;
      this.tone(233, 0.9, 'sawtooth', v, 228); this.tone(293, 0.9, 'sawtooth', v * 0.8, 288); this.tone(175, 0.9, 'square', v * 0.5, 172);
    },
    rumble: function (vol) { this.noise(1.1, (vol || 1) * 0.3, 260, 'lowpass', 0, 160); },
    season: function (n) {
      var sets = [[0, 4, 7, 12], [0, 3, 7, 14], [0, 4, 9, 12]];
      sets[n % 3].forEach(function (s, i) { Snd.tone(523 * Math.pow(2, s / 12), 0.4, 'triangle', 0.14, 0, i * 0.09); });
    },
    best: function () { [0, 4, 7, 12, 16].forEach(function (s, i) { Snd.tone(523 * Math.pow(2, s / 12), 0.25, 'triangle', 0.18, 0, i * 0.07); }); },
    buy: function () { [0, 7, 12, 16, 19, 24].forEach(function (s, i) { Snd.tone(523 * Math.pow(2, s / 12), 0.22, 'triangle', 0.17, 0, i * 0.065); }); },
    no: function () { this.tone(180, 0.18, 'square', 0.1, 120); },
    click: function () { this.tone(620, 0.05, 'triangle', 0.11); },
    over: function () { [392, 330, 262, 196].forEach(function (f, i) { Snd.tone(f, 0.3, 'triangle', 0.15, 0, i * 0.16); }); },
    wind: function (amt) { // 0..1
      if (!this.windGain || !this.ctx) return;
      var v = this.sfxOn ? amt * amt * 0.55 : 0;
      this.windGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.15);
      this._windF.frequency.setTargetAtTime(380 + amt * 500, this.ctx.currentTime, 0.2);
    },

    // ---- music: plucky folk-ish loop in C, steady and quiet ----
    setTempo: function (k) { this._tempo = k; },
    startMusic: function () {
      if (this._timer || !this.ctx) return;
      this._next = this.ctx.currentTime + 0.25; this._step = 0;
      var self = this;
      this._timer = setInterval(function () { self._sched(); }, 110);
    },
    // A small sequencer: one song per season (plus a calm title song). Each song is 8 bars of eighth notes:
    // phrase A then phrase B over a 4-chord loop, with bass, a soft pad, light drums, and an "intensity" layer
    // (16th hats + octave bass) that the game raises as the blizzard closes in. Songs switch on a bar line.
    SONGS: [
      { name: 'autumn', bpm: 112, key: 67, lead: 'triangle', leadVol: 0.06, swing: 0, drums: 1,
        chords: [[55, 59, 62], [50, 54, 57], [52, 55, 59], [48, 52, 55]], // G D Em C
        mel: [[7, -1, 4, 7, 9, -1, 7, 4], [7, -1, 11, 9, 7, -1, 2, -1], [4, -1, 7, 4, 9, -1, 7, 4], [5, 4, 0, -1, 4, -1, 0, -1],
              [12, -1, 11, 12, 14, -1, 12, 7], [11, -1, 9, 7, 9, -1, 2, -1], [7, -1, 4, 7, 11, -1, 9, 7], [4, -1, 2, 0, 2, -1, 0, -1]] },
      { name: 'snow', bpm: 96, key: 74, lead: 'sine', leadVol: 0.07, swing: 0, drums: 0.55, bell: 1,
        chords: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], // Dm Bb F C
        mel: [[0, -1, -1, -5, -2, -1, -5, -9], [-4, -1, -1, -7, -9, -1, -12, -1], [-5, -1, -9, -5, 0, -1, -2, -5], [-7, -1, -10, -1, -2, -1, -1, -1],
              [3, -1, 2, 0, -2, -1, 0, -1], [-2, -1, -4, -1, -7, -1, -9, -1], [-5, -1, 0, -1, -2, -5, -9, -1], [-10, -1, -7, -1, -12, -1, -1, -1]] },
      { name: 'mud', bpm: 128, key: 65, lead: 'square', leadVol: 0.03, swing: 0.14, drums: 1,
        chords: [[53, 57, 60], [48, 52, 55], [50, 53, 57], [46, 50, 53]], // F C Dm Bb
        mel: [[0, 4, 7, 4, 12, -1, 7, 4], [7, 11, 14, 11, 7, -1, 2, -1], [9, -1, 12, 9, 16, -1, 12, 9], [5, -1, 9, 5, 2, -1, 0, -1],
              [12, -1, 16, 12, 19, -1, 16, 12], [14, -1, 11, 7, 11, -1, 7, -1], [9, 12, 16, 12, 9, -1, 5, -1], [5, -1, 2, -1, 0, -1, -1, -1]] },
      { name: 'title', bpm: 92, key: 67, lead: 'triangle', leadVol: 0.05, swing: 0, drums: 0,
        chords: [[55, 59, 62], [52, 55, 59], [48, 52, 55], [50, 54, 57]], // G Em C D
        mel: [[7, -1, -1, 4, 7, -1, 9, -1], [7, -1, -1, -1, 4, -1, 2, -1], [0, -1, 4, -1, 7, -1, 4, -1], [2, -1, -1, -1, -1, -1, -1, -1],
              [12, -1, -1, 11, 9, -1, 7, -1], [4, -1, -1, 7, 9, -1, 7, -1], [5, -1, 4, -1, 0, -1, 4, -1], [7, -1, -1, -1, -1, -1, -1, -1]] }
    ],
    _song: 3, _want: 3, _intensity: 0, _duckUntil: 0,
    setSong: function (k) { this._want = k; },
    setIntensity: function (v) { this._intensity = v < 0 ? 0 : v > 1 ? 1 : v; },
    duck: function (sec) { if (this.ctx) this._duckUntil = this.ctx.currentTime + sec; },
    _drum: function (kind, del, vol) {
      var c = this.ctx, t0 = c.currentTime + del, dest = this.musicGain;
      if (kind === 'kick') { this.tone(120, 0.16, 'sine', 0.16 * vol, 42, del, dest); return; }
      var s = c.createBufferSource(); s.buffer = this._noise;
      var f = c.createBiquadFilter(), g = c.createGain(), dur = kind === 'hat' ? 0.035 : kind === 'crash' ? 0.8 : 0.09;
      f.type = kind === 'snare' ? 'bandpass' : 'highpass'; f.frequency.value = kind === 'hat' ? 7500 : kind === 'crash' ? 4200 : 1900;
      g.gain.setValueAtTime((kind === 'hat' ? 0.05 : kind === 'crash' ? 0.045 : 0.07) * vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f); f.connect(g); g.connect(dest); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
    },
    _sched: function () {
      var c = this.ctx;
      if (!c || c.state !== 'running') { if (c) this._next = Math.max(this._next, c.currentTime); return; }
      var hz = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };
      while (this._next < c.currentTime + 0.5) {
        var i = this._step % 8;
        if (i === 0 && this._want !== this._song) { this._song = this._want; this._step = 0; } // change songs on a bar line
        // 16-bar form: the 8 written bars, then the same 8 with a lift (counter-voice, arpeggio, octave sparkle)
        var S = this.SONGS[this._song] || this.SONGS[0], bar16 = Math.floor(this._step / 8) % 16, bar = bar16 % 8, lift = bar16 >= 8 && S.drums, ch = S.chords[bar % 4], fill = bar === 7 && i >= 4;
        var sd = 30 / S.bpm, del = Math.max(0, this._next - c.currentTime) + (i % 2 ? S.swing * sd : 0);
        var I = this._intensity, quiet = c.currentTime < this._duckUntil;
        if (!quiet) {
          // pad: the chord, soft and long, once a bar
          if (i === 0) for (var k = 0; k < 3; k++) this.tone(hz(ch[k]), sd * 7.5, 'sine', 0.022, 0, del, this.musicGain);
          // bass: root on 1, fifth on 3, a walk-up on the last eighth; octave pumps when it gets intense
          if (i === 0 || i === 4) this.tone(hz(ch[0] - 12 + (i === 4 ? 7 : 0)), sd * 1.8, 'triangle', 0.11, 0, del, this.musicGain);
          if (i === 7) this.tone(hz(ch[0] - 10), sd * 0.8, 'triangle', 0.07, 0, del, this.musicGain);
          if (I > 0.45 && (i === 2 || i === 6)) this.tone(hz(ch[0]), sd * 0.7, 'triangle', 0.06, 0, del, this.musicGain);
          // melody
          var m = S.mel[bar][i], hv = 0.88 + Math.random() * 0.24; // a little human velocity
          if (m !== -1) {
            var f = hz(S.key + m);
            this.tone(f, S.lead === 'square' ? sd * 0.7 : sd * 1.6, S.lead, S.leadVol * hv, 0, del, this.musicGain);
            if (S.bell || lift) this.tone(f * 2, sd * 2.5, 'sine', 0.018, 0, del, this.musicGain);
          }
          if (lift) {
            if (i === 0 || i === 4) this.tone(hz(ch[2] + 12), sd * 3.6, 'sine', 0.026, 0, del, this.musicGain);
            if (i % 2 === 1) this.tone(hz(ch[(i >> 1) % 3] + 24), sd * 0.5, 'triangle', 0.016, 0, del, this.musicGain);
          }
          // drums
          if (S.drums) {
            if (i === 0 || i === 4) this._drum('kick', del, S.drums);
            if (fill) this._drum('snare', del, S.drums * (0.45 + 0.15 * (i - 4))); // a fill into the next phrase
            else if (i === 2 || i === 6) this._drum('snare', del, S.drums * 0.8);
            if (bar === 0 && i === 0 && this._step > 0) this._drum('crash', del, S.drums);
            if (i % 2 === 1) this._drum('hat', del, S.drums * 0.7);
            if (I > 0.3) this._drum('hat', del + sd * 0.5, S.drums * 0.5 * I);
          }
        }
        this._next += sd; this._step++;
      }
    },
    buzz: function (ms) { try { if (navigator.vibrate && this.sfxOn && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(ms); } catch (e) { /* iOS etc. */ } }
  };
  Snd.load();
  window.Snd = Snd;
})();
