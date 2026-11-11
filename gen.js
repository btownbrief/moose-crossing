/* Moose Crossing — world generator. Pure + deterministic from a seed, so it also runs in node for tests.
   Lanes are made one at a time; every dynamic thing (cars, logs, trains) is a pure function of time,
   so nothing has to be ticked and a bot can look into the future. */
(function (root) {
  'use strict';

  var COLS = 11;            // playable columns 0..10
  var RING_LO = -7;         // dynamic things live on a ring that sticks out well past the screen
  var RING = 24;
  var BIOME_LEN = 32;       // rows per season: autumn -> snow -> spring mud -> repeat
  var TRAIN_LEN = 15, TRAIN_V = 30, WARN_T = 1.5;
  var BACK_ROWS = 10;       // scenery rows behind the start

  var VEH = {
    hatch: { len: 1.1 }, wagon: { len: 1.4 }, plow: { len: 2.4 }, bus: { len: 3.2 }
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function mix(a, b) {
    var h = (a ^ Math.imul(b + 0x7F4A7C15, 0x9E3779B1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85EBCA6B);
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function biomeOf(r) { return r < 0 ? 0 : Math.floor(r / BIOME_LEN) % 3; }
  function mod(a, n) { return ((a % n) + n) % n; }

  // ---------- time functions (pure) ----------
  var RAMP = 0.7;
  function Wcum(l, u) { // integral of the rush weight (0..1) from 0 to u
    var P = l.rushP, d = l.rushDur, full = d + RAMP;
    var n = Math.floor(u / P), rem = u - n * P, w;
    if (rem < RAMP) w = rem * rem / (2 * RAMP);
    else if (rem < RAMP + d) w = RAMP / 2 + (rem - RAMP);
    else if (rem < 2 * RAMP + d) { var q = rem - RAMP - d; w = RAMP / 2 + d + q - q * q / (2 * RAMP); }
    else w = full;
    return n * full + w;
  }
  function laneS(l, t) { // distance travelled by the lane's conveyor, tiles
    if (!l.rushM) return l.v * t;
    return l.v * (t + (l.rushM - 1) * (Wcum(l, t + l.rushOff) - Wcum(l, l.rushOff)));
  }
  function rushWeight(l, t) { // 0..1 how hard the rush is right now
    if (!l.rushM) return 0;
    var rem = mod(t + l.rushOff, l.rushP), d = l.rushDur;
    if (rem < RAMP) return rem / RAMP;
    if (rem < RAMP + d) return 1;
    if (rem < 2 * RAMP + d) return 1 - (rem - RAMP - d) / RAMP;
    return 0;
  }
  function rushWarn(l, t) { // lamp flashes just before a rush starts
    if (!l.rushM) return false;
    var rem = mod(t + l.rushOff, l.rushP);
    return rem > l.rushP - 1.3;
  }
  function itemX(l, it, t) {
    return RING_LO + mod(it.off + l.dir * laneS(l, t), RING);
  }
  // rail: 0 idle, 1 warning, 2 train passing
  function railPhase(l, t) {
    var ph = mod(t + l.off, l.cycle);
    if (ph < l.idle) return { s: 0, ph: ph };
    if (ph < l.idle + WARN_T) return { s: 1, ph: ph - l.idle };
    return { s: 2, ph: ph - l.idle - WARN_T };
  }
  function trainX(l, t) { // centre of the train, or null
    var p = railPhase(l, t);
    if (p.s !== 2) return null;
    var f = p.ph / l.pass;
    if (f > 1) return null;
    var from = RING_LO - TRAIN_LEN / 2, to = RING_LO + RING + TRAIN_LEN / 2;
    return l.dir > 0 ? from + f * (to - from) : to - f * (to - from);
  }

  // ---------- builders ----------
  function solveGaps(rng, n, target, gmin, gmax) { // n gaps in [gmin,gmax] summing to target
    var base = [], i;
    for (i = 0; i < n; i++) base.push(gmin + (gmax - gmin) * rng());
    var lo = -10, hi = 10;
    for (var k = 0; k < 40; k++) {
      var m = (lo + hi) / 2, s = 0;
      for (i = 0; i < n; i++) s += clamp(base[i] + m, gmin, gmax);
      if (s < target) lo = m; else hi = m;
    }
    var out = [];
    for (i = 0; i < n; i++) out.push(clamp(base[i] + (lo + hi) / 2, gmin, gmax));
    return out;
  }
  function layRing(rng, kinds, lens, gaps) { // item list with .off = centre on the ring
    var items = [], pos = rng() * RING;
    for (var i = 0; i < kinds.length; i++) {
      items.push({ kind: kinds[i], len: lens[i], off: mod(pos, RING) });
      var nxt = (i + 1) % kinds.length;
      pos += lens[i] / 2 + gaps[i] + lens[nxt] / 2;
    }
    return items;
  }

  function makeRoad(rng, r, diff, b, dir, arch, vcache) {
    var kinds, v;
    if (arch === 'heavy') { kinds = b === 1 ? ['plow', 'plow', 'bus'] : ['bus', 'plow', 'bus']; v = 1.0 + rng() * 0.7; }
    else if (arch === 'mix') { kinds = ['hatch', 'wagon', 'plow', 'bus', 'hatch']; v = 1.2 + rng() * 0.8; }
    else { kinds = ['hatch', 'wagon', 'hatch']; v = (1.25 + rng() * 2.0) * (0.78 + 0.5 * diff); }
    v = clamp(v, 0.9, 4.4);
    if (r < 10) v = Math.min(v, 1.2 + 0.06 * r); // a gentle first wave: the opening roads are slow (1.4-1.7 tiles/s)
    var rushM = 0, rushP = 0, rushDur = 0, rushOff = 0;
    if (arch === 'car' && v <= 2.5 && r > 14 && rng() < 0.12 + 0.3 * diff) {
      rushM = 1.75; rushP = 13 + rng() * 9; rushDur = 3 + rng() * 2; rushOff = rng() * rushP;
    }
    var vmax = v * (rushM || 1);
    var gapMin = 1.7 + 0.5 * vmax;
    var gapMul = (1.55 - 0.45 * diff) * (r < 10 ? 1.45 : 1); // the opening roads have roomier gaps
    var avgLen = 0, i, n, lens, ks, sum;
    for (i = 0; i < kinds.length; i++) avgLen += VEH[kinds[i]].len; avgLen /= kinds.length;
    n = Math.max(1, Math.floor(RING / (avgLen + gapMin * gapMul)));
    for (var tries = 0; tries < 30; tries++) {
      ks = []; lens = []; sum = 0;
      for (i = 0; i < n; i++) { var k = pick(rng, kinds); ks.push(k); lens.push(VEH[k].len); sum += VEH[k].len; }
      if (RING - sum >= n * gapMin) break;
      n = Math.max(1, n - 1);
    }
    if (RING - sum < n * gapMin) { n = 1; ks = ['hatch']; lens = [VEH.hatch.len]; sum = lens[0]; }
    var free = RING - sum, extra = free - n * gapMin, w = [], ws = 0;
    for (i = 0; i < n; i++) { var x = -Math.log(1 - rng()) + 0.35; w.push(x); ws += x; }
    var gaps = [];
    for (i = 0; i < n; i++) gaps.push(gapMin + extra * w[i] / ws);
    var items = layRing(rng, ks, lens, gaps);
    var cols = ['#d9534f', '#3f8f9b', '#e6a82d', '#6a8f4e', '#7b5ea7', '#e8e2d0', '#2f6db0', '#c96b2c'];
    for (i = 0; i < items.length; i++) {
      var kd = items[i].kind;
      items[i].color = kd === 'plow' ? '#f2a516' : kd === 'bus' ? (rng() < 0.5 ? '#f3efe2' : '#e9d9a8') : pick(rng, cols);
      items[i].variant = Math.floor(rng() * 3);
    }
    return { type: 'road', dir: dir, v: v, rushM: rushM, rushP: rushP, rushDur: rushDur, rushOff: rushOff, items: items, gapMin: gapMin, vmax: vmax, arch: arch };
  }

  function makeRiver(rng, r, diff, b, dir) {
    var kind = b === 1 ? (rng() < 0.8 ? 'floe' : 'log') : b === 2 ? (rng() < 0.65 ? 'log' : 'floe') : (rng() < 0.8 ? 'log' : 'floe');
    var v = (kind === 'log' ? 0.8 + rng() * 0.8 : 0.7 + rng() * 0.7) * (0.85 + 0.35 * diff);
    var gmin = 0.95 + 0.35 * diff, gmax = 1.8 + 0.15 * diff;
    var n, kinds, lens, sum, i, ok = false, gaps;
    for (var tries = 0; tries < 60 && !ok; tries++) {
      n = 4 + Math.floor(rng() * 4);
      kinds = []; lens = []; sum = 0;
      for (i = 0; i < n; i++) {
        var len = kind === 'log' ? pick(rng, [2.4, 3.0, 3.0, 3.6, 4.0]) : 1.9 + rng() * 0.8;
        kinds.push(kind); lens.push(len); sum += len;
      }
      var t = RING - sum;
      if (t >= n * gmin && t <= n * gmax) { ok = true; gaps = solveGaps(rng, n, t, gmin, gmax); }
    }
    if (!ok) { // deterministic fallback
      n = 5; kinds = []; lens = [];
      for (i = 0; i < n; i++) { kinds.push(kind); lens.push(3); }
      gaps = []; for (i = 0; i < n; i++) gaps.push((RING - 15) / n);
    }
    var items = layRing(rng, kinds, lens, gaps);
    for (i = 0; i < items.length; i++) { items[i].variant = Math.floor(rng() * 3); items[i].seed = rng(); }
    return { type: 'river', dir: dir, v: v, rushM: 0, rushP: 0, rushDur: 0, rushOff: 0, items: items, kind: kind, gmax: gmax };
  }

  function makeRail(rng, r, diff, dir, prev) {
    var pass = (RING + TRAIN_LEN) / TRAIN_V;
    var l = { type: 'rail', dir: dir, pass: pass };
    if (prev) { // double track: windows never overlap, so there is always a gap to cross
      l.cycle = prev.cycle; l.idle = prev.idle; l.off = prev.off + (WARN_T + pass);
      l.dir = -prev.dir;
    } else {
      l.idle = clamp(3.2 - 1.2 * diff + rng() * 3.5, 2.6, 7);
      l.cycle = l.idle + WARN_T + pass;
      l.off = rng() * l.cycle;
    }
    return l;
  }

  // ---------- the world ----------
  // the opening: hops 1 and 2 straight ahead always land; the tree on row 3 (right in front) teaches the sidestep
  var FORCED_OBS = { 0: [0, 1, 9, 10], 1: [2, 8], 2: [0, 3, 7, 10], 3: [1, 5, 9] };

  function World(seed) {
    this.seed = seed >>> 0;
    this.lanes = [];
    this.scenery = {};
    this.st = {
      R: [], segType: 'grass', segLeft: 0, segLen: 0, segIdx: 0, hazRun: 0, lastSeg: 'grass',
      dir: 1, arch: 'car', prevRail: null, nextSign: 10, nextB: BIOME_LEN, lastLeaf: -9
    };
    for (var i = 0; i < COLS; i++) this.st.R.push(true);
  }
  World.prototype.lane = function (r) {
    if (r < 0) return this.sceneryLane(r);
    while (this.lanes.length <= r) this._gen(this.lanes.length);
    return this.lanes[r];
  };
  World.prototype.sceneryLane = function (r) {
    var l = this.scenery[r];
    if (l) return l;
    var rng = mulberry32(mix(this.seed, 5000 + r));
    var obs = {}, c;
    for (c = -6; c <= COLS + 5; c++) if (rng() < 0.38 || c < -1 || c > COLS) obs[c] = pick(rng, ['tree', 'tree', 'rock']);
    if (r >= -2) for (c = 2; c <= 8; c++) delete obs[c];
    l = { r: r, type: 'grass', biome: 0, obs: obs, obsV: {}, leaf: -1, seed: mix(this.seed, r + 9000), scenery: true };
    for (c in obs) l.obsV[c] = Math.floor(rng() * 3);
    this.scenery[r] = l;
    return l;
  };
  World.prototype._chooseSeg = function (r, rng) {
    var st = this.st, b = biomeOf(r), diff = Math.min(1, r / 140);
    var type, len, chain = st.lastSeg !== 'grass';
    if (r < 4) { type = 'grass'; len = 4 - r; }
    else if (chain && !(st.hazRun <= 2 && rng() < 0.3)) { type = 'grass'; len = rng() < 0.55 ? 1 : (rng() < 0.7 ? 2 : 3); }
    else {
      var w = b === 0 ? { road: 52, river: 16, rail: 11 } : b === 1 ? { road: 40, river: 30, rail: 14 } : { road: 40, river: 30, rail: 18 };
      if (r < 10) w.river = 0;
      if (r < 13) w.rail = 0;
      if (r < 6) w.road = 60;
      if (chain) w[st.lastSeg] = 0;
      var tot = w.road + w.river + w.rail, x = rng() * tot;
      // nothing allowed here yet (e.g. a road chained to a road before rivers/rails open up): rest on grass.
      // (Without this the fallback below picked 'rail', putting trains at rows 5-7.)
      if (tot <= 0) { st.segType = 'grass'; st.segLeft = 1; st.segLen = 1; st.segIdx = 0; return; }
      type = x < w.road ? 'road' : x < w.road + w.river ? 'river' : 'rail';
      var room = 4 - st.hazRun;
      if (type === 'road') len = 1 + Math.floor(rng() * (2 + diff * 2));
      else if (type === 'river') len = 1 + Math.floor(rng() * (2 + diff));
      else len = rng() < 0.3 + 0.3 * diff ? 2 : 1;
      len = Math.max(1, Math.min(len, 3, room));
      if (r < 8) len = 1;
    }
    st.segType = type; st.segLeft = len; st.segLen = len; st.segIdx = 0;
    if (type === 'road') {
      st.dir = rng() < 0.5 ? 1 : -1;
      var a = rng();
      st.arch = r < 12 ? 'car' : (b === 1 ? (a < 0.4 ? 'heavy' : a < 0.65 ? 'mix' : 'car') : (a < 0.22 ? 'heavy' : a < 0.4 ? 'mix' : 'car'));
    } else if (type === 'river') st.dir = rng() < 0.5 ? 1 : -1;
    else if (type === 'rail') { st.dir = rng() < 0.5 ? 1 : -1; st.prevRail = null; }
  };
  World.prototype._gen = function (r) {
    var st = this.st, rng = mulberry32(mix(this.seed, r * 31 + 7));
    var b = biomeOf(r), diff = Math.min(1.5, r / 140), first = false;
    if (st.segLeft <= 0) { this._chooseSeg(r, rng); first = true; }
    var type = st.segType, lane, c;
    var segFirst = st.segIdx === 0, segLast = st.segLeft === 1;
    if (type === 'grass') {
      var forced = FORCED_OBS[r];
      var dens = b === 0 ? 0.15 : b === 1 ? 0.19 : 0.14;
      var obs = {}, obsV = {};
      for (c = 0; c < COLS; c++) {
        var has = forced ? forced.indexOf(c) >= 0 : rng() < dens;
        if (has) { obs[c] = rng() < (b === 2 ? 0.2 : 0.28) ? 'rock' : 'tree'; obsV[c] = Math.floor(rng() * 3); }
      }
      // keep a path: some column of the previous reachable set must be free
      var enter = [], anyEnter = false;
      for (c = 0; c < COLS; c++) { enter[c] = st.R[c] && !obs[c]; if (enter[c]) anyEnter = true; }
      if (!anyEnter) {
        var cand = []; for (c = 0; c < COLS; c++) if (st.R[c]) cand.push(c);
        var kc = pick(rng, cand); delete obs[kc]; delete obsV[kc]; enter[kc] = true;
      }
      // flood sideways through free cells
      var R = [], flag = false;
      for (c = 0; c < COLS; c++) R[c] = false;
      for (c = 0; c < COLS; c++) if (enter[c]) {
        R[c] = true;
        for (var d = c - 1; d >= 0 && !obs[d]; d--) R[d] = true;
        for (d = c + 1; d < COLS && !obs[d]; d++) R[d] = true;
      }
      // edge forest (decor, blocks nothing that matters)
      for (c = -6; c < 0; c++) { obs[c] = rng() < 0.7 ? 'tree' : 'rock'; obsV[c] = Math.floor(rng() * 3); }
      for (c = COLS; c < COLS + 6; c++) { obs[c] = rng() < 0.7 ? 'tree' : 'rock'; obsV[c] = Math.floor(rng() * 3); }
      lane = { r: r, type: 'grass', obs: obs, obsV: obsV, leaf: -1, leafV: 1 };
      // maple leaf on a reachable cell
      if (r === 2) { lane.leaf = 5; st.lastLeaf = r; } // the opening hands you a leaf on your second hop
      else if (r >= 1 && r - st.lastLeaf >= 2 && rng() < (b === 0 ? 0.62 : 0.5)) {
        var rc = []; for (c = 0; c < COLS; c++) if (R[c] && !obs[c]) rc.push(c);
        if (rc.length) { lane.leaf = pick(rng, rc); lane.leafV = rng() < 0.07 ? 3 : 1; st.lastLeaf = r; }
      }
      if (r >= st.nextSign) { lane.sign = r; st.nextSign = (Math.floor(r / 10) + 1) * 10; }
      if (r >= st.nextB) { lane.bsign = biomeOf(r); st.nextB = (Math.floor(r / BIOME_LEN) + 1) * BIOME_LEN; }
      st.R = R; st.hazRun = 0;
      // mud patches in spring
      if (b === 2) { lane.mud = []; for (c = 0; c < COLS; c++) if (rng() < 0.3 && !obs[c]) lane.mud.push(c); }
    } else {
      for (c = 0; c < COLS; c++) st.R[c] = true;
      if (type === 'road') {
        if (!segFirst) st.dir = -st.dir;
        lane = makeRoad(rng, r, diff, b, st.dir, st.arch);
      } else if (type === 'river') {
        if (!segFirst) st.dir = -st.dir;
        lane = makeRiver(rng, r, Math.min(1, diff), b, st.dir);
      } else {
        lane = makeRail(rng, r, diff, st.dir, segFirst ? null : st.prevRail);
        st.prevRail = lane;
      }
      st.hazRun++;
      lane.r = r; lane.leaf = -1;
    }
    lane.r = r; lane.biome = b; lane.seed = mix(this.seed, r + 777);
    lane.segFirst = segFirst; lane.segLast = segLast; lane.segIdx = st.segIdx;
    st.segLeft--; st.segIdx++;
    if (st.segLeft <= 0) st.lastSeg = type;
    this.lanes[r] = lane;
  };

  var api = {
    COLS: COLS, RING_LO: RING_LO, RING: RING, BIOME_LEN: BIOME_LEN, TRAIN_LEN: TRAIN_LEN, WARN_T: WARN_T,
    BACK_ROWS: BACK_ROWS, VEH: VEH, World: World, biomeOf: biomeOf, mulberry32: mulberry32, mix: mix,
    laneS: laneS, itemX: itemX, rushWeight: rushWeight, rushWarn: rushWarn, railPhase: railPhase, trainX: trainX
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MG = api;
})(typeof window !== 'undefined' ? window : globalThis);
