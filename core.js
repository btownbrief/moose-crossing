/* Moose Crossing — game rules (movement, collisions, rivers, blizzard). Pure; no drawing, so node can run it. */
(function (root) {
  'use strict';
  var MG = root.MG || (typeof require !== 'undefined' ? require('./gen.js') : null);
  var COLS = MG.COLS;

  var HOP_T = 0.115;          // seconds per hop
  var PW = 0.24;              // player half-width, a little generous (smaller than the visual)
  var SUB = 1 / 120;          // fixed sub-step
  var QMAX = 3;               // buffered inputs
  var BACK_MAX = 3;           // how far behind the best row you may hop
  var GAP_MAX = 5.2;          // the blizzard never trails further than this
  var GRACE = 3.2;            // seconds before the blizzard starts moving

  function frontSpeed(maxRow) { return Math.min(1.6, 0.58 + 0.005 * maxRow); }

  function Sim(world, opt) {
    this.w = world;
    opt = opt || {};
    this.noFront = !!opt.noFront;
    this.t = 0; this.t0 = 0; this.acc = 0;
    this.row = 0; this.x = 5; this.maxRow = 0;
    this.hop = null; this.q = [];
    this.ride = null;
    this.alive = true; this.cause = null; this.dInfo = null;
    this.front = -(GAP_MAX + 1.6);
    this.leaves = 0; this.taken = {};
    this.hops = 0; this.bumpT = 0; this.facing = 1;
    this.ev = [];
    this.idleT = 0;
    // critter perks (all optional; tests run without them)
    var pk = opt.perk || {};
    this.hopT = pk.hopT || HOP_T; this.grace = GRACE + (pk.grace || 0); this.gapMax = GAP_MAX + (pk.gap || 0);
    this.landSlack = 0.1 + (pk.land || 0); this.sweep = pk.sweep || 0; this.armor = pk.armor || 0; this.invuln = 0;
    this.front = -(this.gapMax + 1.6);
  }
  Sim.prototype.clone = function () {
    var s = Object.create(Sim.prototype);
    for (var k in this) s[k] = this[k];
    s.q = this.q.slice();
    if (this.hop) s.hop = Object.assign({}, this.hop);
    if (this.ride) s.ride = Object.assign({}, this.ride);
    s.taken = Object.assign({}, this.taken);
    s.ev = [];
    return s;
  };

  Sim.prototype.push = function (dir) { // 'F' 'B' 'L' 'R'
    if (!this.alive) return false;
    if (this.q.length >= QMAX) return false;
    this.q.push(dir);
    return true;
  };

  Sim.prototype.rowf = function () {
    if (!this.hop) return this.row;
    return this.hop.fr + (this.hop.tr - this.hop.fr) * this.hop.p;
  };
  Sim.prototype.xf = function () {
    if (!this.hop) return this.x;
    return this.hop.fx + (this.hop.tx - this.hop.fx) * this.hop.p;
  };

  Sim.prototype.blocked = function (lane, c) {
    if (c < 0 || c > COLS - 1) return true;
    return lane.type === 'grass' && !!lane.obs[c];
  };

  Sim.prototype._begin = function (dir) {
    var w = this.w, L0 = w.lane(this.row), dr = 0, dx = 0;
    if (dir === 'F') dr = 1; else if (dir === 'B') dr = -1; else if (dir === 'L') dx = -1; else dx = 1;
    var trow = this.row + dr;
    if (dx) this.facing = dx;
    var tx = this.x, bump = false;
    if (trow < 0 || trow < this.maxRow - BACK_MAX) bump = true;
    else if (dr < 0 && trow <= this.front + 1.1) bump = true;
    var Ld = w.lane(Math.max(trow, 0));
    if (!bump) {
      if (dx) {
        tx = this.x + dx;
        if (Ld.type === 'river') { if (tx < -0.2 || tx > COLS - 0.8) bump = true; }
        else { tx = Math.round(this.x) + dx; if (this.blocked(Ld, tx)) bump = true; }
      } else if (Ld.type === 'river') {
        tx = this.x;
        if (L0.type !== 'river') tx = Math.round(this.x);
      } else {
        var fx = Math.floor(this.x + 1e-6), cx = Math.ceil(this.x - 1e-6);
        if (fx === cx) tx = fx;
        else { // coming off a moving platform: pick the nearer free cell
          var a = this.x - fx < cx - this.x ? fx : cx, b2 = a === fx ? cx : fx;
          tx = !this.blocked(Ld, a) ? a : b2;
        }
        if (this.blocked(Ld, tx)) bump = true;
      }
    }
    if (bump) {
      this.bumpT = 0.14; this.bumpDir = dir;
      this.ev.push({ k: 'bump', dir: dir });
      return false;
    }
    this.hop = { fr: this.row, fx: this.x, tr: trow, tx: tx, p: 0, dir: dir };
    this.ride = null; this.hops++; this.idleT = 0;
    this.ev.push({ k: 'hop', dir: dir, fr: this.row, tr: trow, lane: Ld.type, fx: this.x });
    return true;
  };

  Sim.prototype._die = function (cause, info) {
    if (!this.alive) return;
    this.alive = false; this.cause = cause; this.dInfo = info || null;
    this.q.length = 0;
    this.ev.push({ k: 'die', cause: cause, info: info });
  };

  Sim.prototype._land = function () {
    var h = this.hop; this.hop = null;
    this.row = h.tr; this.x = h.tx;
    var L = this.w.lane(this.row);
    if (this.row > this.maxRow) { this.maxRow = this.row; this.ev.push({ k: 'score', row: this.row }); }
    if (L.type === 'river') {
      var best = -1, bd = 1e9, t = this.t;
      for (var i = 0; i < L.items.length; i++) {
        var it = L.items[i], cx = MG.itemX(L, it, t), d = Math.abs(this.x - cx);
        if (d <= it.len / 2 + this.landSlack && d < bd) { bd = d; best = i; }
      }
      if (best < 0) { this._die('drown', { row: this.row, x: this.x }); return; }
      var itm = L.items[best];
      this.ride = { row: this.row, idx: best, off: this.x - MG.itemX(L, itm, t) };
      this.ev.push({ k: 'land', row: this.row, x: this.x, lane: 'river', kind: itm.kind });
    } else {
      this.ride = null;
      this.ev.push({ k: 'land', row: this.row, x: this.x, lane: L.type });
      if (L.type === 'grass' && L.leaf === Math.round(this.x) && !this.taken[this.row]) {
        this.taken[this.row] = 1; this.leaves += L.leafV;
        this.ev.push({ k: 'leaf', row: this.row, x: this.x, v: L.leafV });
      }
    }
  };

  Sim.prototype._hazards = function () {
    var t = this.t, row = this.hop ? (this.hop.p < 0.5 ? this.hop.fr : this.hop.tr) : this.row;
    var x = this.xf();
    if (this.hop && this.hop.p >= 0.55) return; // landing handles the destination in _land, then steady state
    var L = this.w.lane(row), i, it, cx, half;
    if (L.type === 'road') {
      for (i = 0; i < L.items.length; i++) {
        it = L.items[i]; cx = MG.itemX(L, it, t); half = it.len * 0.5 * 0.88 + PW;
        if (Math.abs(x - cx) < half) {
          if (this.invuln > 0) return;
          if (this.armor > 0) { this.armor--; this.invuln = 1.3; this.ev.push({ k: 'shrug', row: row, x: x, cx: cx }); return; }
          this._die('car', { row: row, idx: i, x: x, cx: cx, kind: it.kind, dir: L.dir }); return;
        }
      }
    } else if (L.type === 'rail') {
      var tx = MG.trainX(L, t);
      if (tx !== null && Math.abs(x - tx) < MG.TRAIN_LEN * 0.5 + PW * 0.5) this._die('train', { row: row, x: x, dir: L.dir });
    } else if (L.type === 'river' && !this.hop) {
      if (this.x < -0.75 - this.sweep || this.x > COLS - 0.25 + this.sweep) this._die('swept', { row: row, x: this.x });
    }
  };

  Sim.prototype._sub = function (h) {
    this.t += h; this.idleT += h; if (this.invuln > 0) this.invuln -= h;
    if (this.bumpT > 0) this.bumpT -= h;
    if (this.ride) { // carried by a log or floe
      var L = this.w.lane(this.ride.row), it = L.items[this.ride.idx];
      this.x = MG.itemX(L, it, this.t) + this.ride.off;
    }
    if (this.hop) {
      this.hop.p += h / this.hopT;
      if (this.hop.p >= 1) {
        this._land();
        if (!this.alive) return;
      }
    }
    if (!this.hop && this.alive && this.q.length) {
      var d = this.q.shift();
      this._begin(d);
    }
    if (!this.alive) return;
    this._hazards();
    // the blizzard
    if (!this.noFront && this.alive) {
      if (this.t - this.t0 > this.grace || this.hops > 0 && this.t - this.t0 > 1.2 + (this.grace - GRACE)) this.front += frontSpeed(this.maxRow) * (this.idleT > 3.5 ? 1.5 : 1) * h;
      if (this.front < this.maxRow - this.gapMax) this.front = this.maxRow - this.gapMax;
      if (this.rowf() <= this.front + 0.15) this._die('frozen', { row: this.row, x: this.x });
    }
  };

  Sim.prototype.step = function (dt) {
    if (!this.alive) { this.t += dt; return; }
    this.acc += dt;
    var n = 0;
    while (this.acc >= SUB && n < 60) {
      this.acc -= SUB; n++;
      this._sub(SUB);
      if (!this.alive) { this.acc = 0; break; }
    }
  };

  var api = { Sim: Sim, HOP_T: HOP_T, PW: PW, GAP_MAX: GAP_MAX, GRACE: GRACE, frontSpeed: frontSpeed, BACK_MAX: BACK_MAX, QMAX: QMAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MC = api;
})(typeof window !== 'undefined' ? window : globalThis);
