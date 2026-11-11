/* Moose Crossing — rendering, input, UI, saves. The rules live in core.js / gen.js. */
(function () {
  'use strict';
  var MG = window.MG, MC = window.MC, Art = window.Art, Snd = window.Snd;
  var COLS = MG.COLS, K = 0.024;
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv'), ctx = cv.getContext('2d'), stage = $('stage');

  // ------------------------------------------------------------ layout (once per orientation / width change)
  var W = 390, H = 844, DPR = 1, S = 45, LH = 53, anchorBase = 0.68, topY = 110, lastVW = 0, lastVH = 0, landscape = false;
  var anchorY = 574, anchorT = 0.68; // anchorT eases between title and play framing
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    lastVW = vw; lastVH = vh; landscape = vw > vh;
    W = vw; H = vh; DPR = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    stage.style.width = W + 'px'; stage.style.height = H + 'px';
    S = Math.min(W / 8.6, H / 11); LH = S * 1.18; topY = H * 0.13;
    var u = Math.max(0.75, Math.min(W / 390, H / 720, 1.5));
    document.documentElement.style.setProperty('--u', u + 'px');
  }
  var relayoutTimer = 0;
  function maybeRelayout(force) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    var orient = (vw > vh) !== landscape;
    var widthChanged = Math.abs(vw - lastVW) > 1;
    if (force || orient || widthChanged || (!coarse && Math.abs(vh - lastVH) > 1) || (G.mode !== 'play' && Math.abs(vh - lastVH) > 1)) layout();
  }
  window.addEventListener('resize', function () { clearTimeout(relayoutTimer); relayoutTimer = setTimeout(function () { maybeRelayout(false); }, 120); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { maybeRelayout(true); }, 250); });
  layout();

  // ------------------------------------------------------------ save
  var KEY = 'moosecrossing.save.v1';
  var save = { best: 0, daily: { d: 0, best: 0 }, leaves: 0, owned: ['moose'], pick: 'moose', runs: 0, tutTap: 0, tutSwipe: 0 };
  try { var raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (raw) for (var k in raw) save[k] = raw[k]; } catch (e) { /* ignore */ }
  if (!Array.isArray(save.owned) || save.owned.indexOf('moose') < 0) save.owned = ['moose'].concat(Array.isArray(save.owned) ? save.owned : []);
  if (!Art.CRITTERS[save.pick] || save.owned.indexOf(save.pick) < 0) save.pick = 'moose';
  if (!save.daily || typeof save.daily !== 'object') save.daily = { d: 0, best: 0 };
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
  function dateKey(off) { var d = new Date(); if (off) d.setDate(d.getDate() + off); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  function bestFor(daily) { return daily ? (save.daily.d === dateKey() ? save.daily.best : 0) : save.best; }

  // ------------------------------------------------------------ errands (three small goals at a time; they pay leaves)
  // run: progress resets every run. max: progress is the best value seen this run, not a running sum.
  var ERR = {
    rows:   { run: 1, max: 1, n: [15, 25, 35, 50, 70, 90, 120], t: function (n) { return 'Hop ' + n + ' rows in one run'; } },
    leaves: { run: 1, n: [2, 3, 5, 7, 10, 14], t: function (n) { return 'Grab ' + n + ' leaves in one run'; } },
    close:  { run: 1, n: [1, 2, 3, 5, 7], t: function (n) { return 'Get ' + n + ' close call' + (n > 1 ? 's' : '') + ' in one run'; } },
    rails:  { run: 1, n: [1, 2, 3, 5, 8], t: function (n) { return 'Cross ' + n + ' rail line' + (n > 1 ? 's' : '') + ' in one run'; } },
    rides:  { run: 1, n: [2, 4, 6, 9, 12], t: function (n) { return 'Ride ' + n + ' logs or floes in one run'; } },
    reach:  { run: 1, max: 1, n: [32, 64, 96, 128], t: function (n) { return n === 32 ? 'Reach the snow' : n === 64 ? 'Reach mud season' : n === 96 ? 'Make it back to autumn' : 'Reach row ' + n; } },
    streak: { run: 1, max: 1, n: [8, 12, 16, 20, 25], t: function (n) { return 'Hit a ×' + n + ' hop streak'; } },
    gold:   { n: [1, 2, 3], t: function (n) { return n > 1 ? 'Grab ' + n + ' gold leaves' : 'Grab a gold leaf'; } },
    daily:  { n: [1], t: function () { return 'Play the Daily Route'; } },
    total:  { n: [100, 250, 500, 1000, 2000], t: function (n) { return 'Hop ' + n + ' rows in total'; } }
  };
  var ERR_PAY = [4, 6, 8, 11, 14, 18, 22];

  // ------------------------------------------------------------ critter perks: each critter plays a little differently
  var PERKS = {
    moose:     { grace: 3, gap: 0.6, txt: 'Unbothered: the blizzard starts late and lags' },
    deer:      { hopT: 0.09, txt: 'Spring-loaded: much quicker hops' },
    woodchuck: { gap: 2.2, txt: 'Burrower: the blizzard hangs 2 rows further back' },
    loon:      { land: 0.38, sweep: 0.9, txt: 'Paddler: lands on logs it would miss' },
    bear:      { armor: 1, txt: 'Thick hide: shrugs off one car per run' },
    fox:       { close: 3, txt: 'Sly: close calls pay triple' }
  };
  function applyPerk(s) {
    var pk = PERKS[save.pick] || {};
    s.hopT = pk.hopT || MC.HOP_T; s.grace = MC.GRACE + (pk.grace || 0); s.gapMax = MC.GAP_MAX + (pk.gap || 0);
    s.landSlack = 0.1 + (pk.land || 0); s.sweep = pk.sweep || 0; s.armor = pk.armor || 0; s.invuln = 0;
  }
  // Daily Route medals: each pays once a day
  var MEDALS = [{ row: 20, name: 'BRONZE', pay: 5, col: '#c98a4b' }, { row: 40, name: 'SILVER', pay: 10, col: '#b9c3cc' }, { row: 70, name: 'GOLD', pay: 20, col: '#ffcf3a' }];
  function errText(e) { return ERR[e.k].t(e.n); }
  function newErrand(taken) {
    var tier = Math.floor(save.err.done / 3), keys = Object.keys(ERR).filter(function (k) { return taken.indexOf(k) < 0 && !(k === 'daily' && save.daily.d === dateKey()); });
    if (save.err.done < 3) keys = keys.filter(function (k) { return k !== 'reach' && k !== 'gold' && k !== 'total' && k !== 'streak'; }); // the first few are gentle
    var k = keys[Math.floor(Math.random() * keys.length)], ns = ERR[k].n;
    var ni = Math.min(ns.length - 1, Math.max(0, tier + (Math.random() < 0.35 ? 1 : 0) - (k === 'reach' ? 1 : 0)));
    return { k: k, n: ns[ni], p: 0, pay: ERR_PAY[Math.min(ERR_PAY.length - 1, ni + (k === 'reach' || k === 'total' ? 1 : 0))] };
  }
  if (!save.err || !Array.isArray(save.err.list)) save.err = { done: 0, list: [] };
  save.err.list = save.err.list.filter(function (e) { return e && ERR[e.k]; });
  while (save.err.list.length < 3) save.err.list.push(newErrand(save.err.list.map(function (e) { return e.k; })));
  if (!save.streak || typeof save.streak !== 'object') save.streak = { d: 0, n: 0 };

  // ------------------------------------------------------------ state
  var G = {
    mode: 'title', world: null, sim: null, daily: false, prevBest: 0, newBest: false, runLeaves: 0, shopFrom: 'title',
    time: 0, hitPause: 0, shake: 0, flash: 0, death: null, lastBiome: 0, god: false, noPause: false, scoreShown: -1, retryT: 0,
    bonus: 0, nm: null, closeCalls: 0, errDone: [], runLeavesErr: 0, streakPay: 0
  };
  var cam = { row: 0, x: 5, tgtRow: 0 };
  var pl = { sq: 0, lift: 0, facing: 1, bump: 0, bumpDir: 'F', hopT: 0, dip: 0, lastHop: 0, crouch: 0 };
  var parts = [], pops = [], amb = [], rings = [];
  var CS = { moose: 0.94, deer: 0.9, woodchuck: 1.05, loon: 1.0, bear: 0.92, fox: 0.98 };

  function newWorld(seed) { G.world = new MG.World(seed); }
  function newSim(tCarry) {
    var s = new MC.Sim(G.world, { noFront: true }); s.t = tCarry || 0; s.t0 = s.t; G.sim = s;
    cam.row = 0; cam.x = 5; cam.tgtRow = 0; pl.sq = 0; pl.lift = 0; pl.facing = 1; parts.length = 0; pops.length = 0; rings.length = 0;
  }

  // ------------------------------------------------------------ projection
  function sc(d) { return 1 / (1 + K * d); }
  function yAt(d) { return anchorY - LH * d / (1 + K * d); }
  function xAt(col, d) { return W / 2 + (col - cam.x) * S * sc(d); }

  // ------------------------------------------------------------ colour helpers
  function hex(h) { var n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function mixHex(a, b, t) { var x = hex(a), y = hex(b); return 'rgb(' + Math.round(x[0] + (y[0] - x[0]) * t) + ',' + Math.round(x[1] + (y[1] - x[1]) * t) + ',' + Math.round(x[2] + (y[2] - x[2]) * t) + ')'; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t * t * (3 - 2 * t); }
  var hash = Art.hash;

  // ------------------------------------------------------------ sprite blit
  function blit(sp, col, d, up, flip, k) {
    var s = sc(d), ts = S * s, x = xAt(col, d), y = yAt(d - 0.2) - (up || 0) * ts;
    if (x < -ts * 6 || x > W + ts * 6) return;
    if (k) ts *= k;
    if (flip) {
      ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1);
      ctx.drawImage(sp.cv, -(sp.w - sp.ax) * ts, -sp.ay * ts, sp.w * ts, sp.h * ts); ctx.restore();
    } else ctx.drawImage(sp.cv, x - sp.ax * ts, y - sp.ay * ts, sp.w * ts, sp.h * ts);
  }

  // ------------------------------------------------------------ effects
  function puff(wx, wr, kind, n, power) {
    var cols = kind === 'snow' ? ['#ffffff', '#e6f2fa'] : kind === 'mud' ? ['#8a6a45', '#6b4e33', '#a98760'] : kind === 'road' ? ['#d0d0d0', '#b0b0b0'] : kind === 'river' ? ['#cfeefa', '#ffffff', '#8fd0ea'] : ['#e2cf88', '#c8ae5a', '#e69a3d'];
    for (var i = 0; i < n && parts.length < 260; i++) {
      var a = Math.random() * 6.28, sp = (0.6 + Math.random() * 1.2) * (power || 1);
      parts.push({ x: wx, r: wr, h: 0.1, vx: Math.cos(a) * sp, vr: Math.sin(a) * sp * 0.5, vh: (kind === 'river' ? 2.2 : 1.1) * (0.5 + Math.random()) * (power || 1), g: kind === 'river' ? 6 : 3.2,
        life: 0.35 + Math.random() * 0.25, max: 0.6, sz: (kind === 'river' ? 0.07 : 0.1) + Math.random() * 0.08, col: cols[(Math.random() * cols.length) | 0], k: kind === 'leaf' ? 1 : 0 });
    }
  }
  function leafBurst(wx, wr, n, gold) {
    for (var i = 0; i < n && parts.length < 260; i++) {
      var a = Math.random() * 6.28;
      parts.push({ x: wx, r: wr, h: 0.3, vx: Math.cos(a) * 1.4, vr: Math.sin(a) * 0.7, vh: 1.5 + Math.random() * 1.5, g: 3, life: 0.9, max: 0.9, sz: 0.13, col: gold ? '#ffd23a' : ['#e8472a', '#f08a2e', '#ffb23f'][i % 3], k: 1, rot: Math.random() * 6 });
    }
  }
  function sparkle(wx, wr, n) {
    for (var i = 0; i < n && parts.length < 260; i++) { var a = (i / n) * 6.28; parts.push({ x: wx, r: wr, h: 0.5, vx: Math.cos(a) * 1.1, vr: Math.sin(a) * 0.5, vh: 0.6, g: 0, life: 0.5, max: 0.5, sz: 0.09, col: '#fff7b0', k: 2 }); }
  }
  function pop(wx, wr, text, col, size, h0) { pops.push({ x: wx, r: wr, h: h0 || 0.9, text: text, col: col || '#fff', life: 1.0, max: 1.0, size: size || 22 }); }
  function ring(wx, wr, col) { rings.push({ x: wx, r: wr, t: 0, col: col || 'rgba(255,255,255,.8)' }); }
  function surfaceKind(L) {
    if (L.type === 'river') return 'river'; if (L.type === 'road' || L.type === 'rail') return 'road';
    return L.biome === 1 ? 'snow' : L.biome === 2 ? 'mud' : 'grass';
  }

  // ------------------------------------------------------------ toast / hint
  var toastTimer = 0;
  var toastQ = [], toastBusy = 0;
  function toast(title, sub) {
    if (G.mode === 'play' && performance.now() < toastBusy) { if (toastQ.length < 3) toastQ.push([title, sub]); return; }
    showToast(title, sub);
  }
  function showToast(title, sub) {
    var el = $('toast'); $('toastT').textContent = title; $('toastS').textContent = sub || '';
    el.classList.toggle('top', G.mode === 'shop'); // in the shop it sits up by the header, not over the cards
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    toastBusy = performance.now() + 1250;
  }
  function setHint(text, hand, swipe) {
    var h = $('hint');
    if (!text) { h.classList.remove('on'); return; }
    $('hintT').textContent = text; $('hintH').textContent = hand || '👆'; $('hintH').className = 'hand' + (swipe ? ' swipe' : '');
    h.classList.add('on');
  }
  var hintStage = 0; // 0 none, 1 tap, 2 swipe

  // ------------------------------------------------------------ run control
  function show(id, on) { var el = $(id); if (on) el.classList.add('show'); else el.classList.remove('show'); }
  function hideAll() { ['title', 'pause', 'over', 'shop'].forEach(function (i) { show(i, false); }); }
  function syncHudVis(on) { $('hud').classList.toggle('on', on); $('leafbox').style.display = on ? 'flex' : 'none'; $('hudbtns').style.display = on ? 'flex' : 'none'; }

  function toTitle() {
    G.mode = 'title'; hideAll(); show('title', true); syncHudVis(false); setHint(null);
    if (!G.sim || G.sim.hops > 0 || !G.sim.alive) { newWorld((Math.random() * 4e9) >>> 0); newSim(G.sim ? G.sim.t : 0); }
    G.sim.noFront = true; G.death = null; G.daily = false; Snd.wind(0); Snd.setSong(3); Snd.setIntensity(0);
    updateTitleBest();
  }
  function updateTitleBest() {
    $('titleBest').innerHTML = 'Best <b>' + save.best + '</b> &nbsp;·&nbsp; Today <b>' + bestFor(true) + '</b>';
    updateNewBadges();
  }
  // the next critter you don't own yet (cheapest first), or null
  function nextCritter() {
    var next = null;
    Art.ORDER.forEach(function (k) { if (save.owned.indexOf(k) < 0 && (!next || Art.CRITTERS[k].cost < Art.CRITTERS[next].cost)) next = k; });
    return next;
  }
  // a "NEW!" tag on the CRITTERS buttons whenever you can afford someone
  function updateNewBadges() {
    var n = nextCritter(), can = !!n && save.leaves >= Art.CRITTERS[n].cost;
    ['btnShop', 'ovShop'].forEach(function (id) { $(id).classList.toggle('has-new', can); });
    // Daily Route: today's streak gift waiting, or the streak you're on
    var today = save.streak.d === dateKey(), nextN = save.streak.d === dateKey(-1) ? save.streak.n + 1 : 1;
    $('btnDaily').setAttribute('data-badge', today ? (save.streak.n > 1 ? save.streak.n + ' DAYS' : '') : '+' + streakPay(nextN));
  }
  function streakPay(n) { return 5 * Math.min(5, n); }

  // errands: progress, completion, the little banner under the score
  function errProgress(k, v) {
    if (G.mode !== 'play' && k !== 'total' && k !== 'daily') return;
    var L = save.err.list, changed = false;
    for (var i = 0; i < L.length; i++) {
      var e = L[i]; if (e.k !== k || e.fresh || e.p >= e.n) continue;
      var np = Math.min(e.n, ERR[k].max ? Math.max(e.p, v) : e.p + v);
      if (np !== e.p) { e.p = np; changed = true; if (e.p >= e.n) errDone(i); }
    }
    if (changed) persist();
  }
  function errDone(i) {
    var e = save.err.list[i];
    save.leaves += e.pay; save.err.done++; G.runLeavesErr += e.pay;
    G.errDone.push({ t: errText(e), pay: e.pay });
    errBanner('ERRAND DONE · ' + errText(e), '+' + e.pay, true);
    Snd.errand(); Snd.buzz(20);
    var ne = newErrand(save.err.list.map(function (x) { return x.k; }));
    ne.fresh = true; // starts counting next run, so one good run can't chain-complete everything
    save.err.list[i] = ne;
  }
  var errbT = 0;
  function showStreak() {
    var el = $('streak'); el.textContent = '×' + G.streak; el.classList.add('on');
    el.style.fontSize = 'calc(var(--u) * ' + Math.min(36, 20 + G.streak * 0.7) + ')';
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  function errBanner(text, right, done) {
    var b = $('errb'); $('errbT').textContent = text; $('errbR').textContent = right || '';
    b.classList.toggle('done', !!done); b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
    clearTimeout(errbT); errbT = setTimeout(function () { b.classList.remove('on'); }, done ? 2600 : 3200);
  }
  function errListHTML(withDone) {
    var h = '';
    if (withDone) G.errDone.forEach(function (d) { h += '<div class="er done"><i></i><span>' + d.t + '</span><b>+' + d.pay + '</b></div>'; });
    save.err.list.forEach(function (e) {
      if (withDone && G.errDone.length >= 3) return;
      h += '<div class="er' + (e.fresh ? ' fresh' : '') + '"><i></i><span>' + errText(e) + '</span><b>' + (e.fresh ? 'NEW' : e.p + '/' + e.n) + '</b></div>';
    });
    return h;
  }
  function startRun(fresh, daily) {
    Snd.unlock();
    G.daily = !!daily;
    if (fresh || daily || !G.sim || G.sim.hops > 0 || !G.sim.alive) {
      newWorld(daily ? (dateKey() * 7919) >>> 0 : (Math.random() * 4e9) >>> 0);
      newSim(daily ? 0 : (G.sim ? G.sim.t : 0));
    }
    var s = G.sim; s.noFront = false; s.t0 = s.t; applyPerk(s);
    if (daily && save.daily.d !== dateKey()) save.daily = { d: dateKey(), best: 0, m: 0 };
    G.prevBest = bestFor(G.daily); G.newBest = false; G.runLeaves = 0; G.death = null; G.lastBiome = 0; G.scoreShown = -1; G.retryT = 0;
    G.bonus = 0; G.nm = null; G.closeCalls = 0; G.medalPay = 0; G.streak = 0; G.lastScoreT = -9; G.bestStreak = 0; G.errDone = []; G.runLeavesErr = 0; G.streakPay = 0;
    save.err.list.forEach(function (e) { delete e.fresh; if (ERR[e.k].run) e.p = 0; });
    hideAll(); syncHudVis(true); G.mode = 'play'; save.runs++; persist(); $('streak').classList.remove('on');
    Snd.setSong(0); Snd.setIntensity(0);
    if (G.daily) {
      errProgress('daily', 1);
      if (save.streak.d !== dateKey()) { // first Daily Route of the day: the streak gift
        save.streak.n = save.streak.d === dateKey(-1) ? save.streak.n + 1 : 1; save.streak.d = dateKey();
        G.streakPay = streakPay(save.streak.n); save.leaves += G.streakPay; persist();
        toast(save.streak.n > 1 ? save.streak.n + '-DAY STREAK!' : 'DAILY ROUTE', '+' + G.streakPay + ' leaves · come back tomorrow');
        Snd.leaf(true);
      }
    }
    if (save.runs > 2) { var fe = save.err.list[0]; setTimeout(function () { if (G.mode === 'play' && G.sim.hops < 6) errBanner('ERRAND · ' + errText(fe), fe.p + '/' + fe.n); }, 900); }
    updateHud(true);
    hintStage = save.tutTap < 1 ? 1 : 0;
    if (hintStage === 1) setHint('TAP TO HOP', '👆'); else setHint(null);
    G.flash = 0.5;
  }
  // forget fingers we may never hear back from (app switched mid-touch), so the critter can't stay crouched
  function dropPointers() { for (var k in ptrs) delete ptrs[k]; }
  function pauseGame() {
    dropPointers();
    if (G.mode !== 'play') return;
    G.mode = 'pause'; $('pErr').innerHTML = errListHTML(false); show('pause', true); Snd.wind(0); Snd.suspend(); persist();
  }
  function resumeGame() { if (G.mode !== 'pause') return; show('pause', false); G.mode = 'play'; Snd.resume(); last = performance.now(); G.freeze = 0.9; toast('READY…', ''); }
  function openShop(from) { G.shopFrom = from; hideAll(); show('shop', true); G.mode = 'shop'; buildShop(); Snd.click(); }
  function closeShop() {
    hideAll(); Snd.click(); updateNewBadges();
    if (G.shopFrom === 'over') { G.mode = 'dead'; show('over', true); fillOver(); }
    else { G.mode = 'title'; show('title', true); }
  }

  // ------------------------------------------------------------ HUD
  var lastLeafN = -1;
  function updateHud(force) {
    var sc_ = G.sim.maxRow;
    if (sc_ !== G.scoreShown || force) {
      var el = $('score'); el.textContent = sc_;
      if (G.scoreShown >= 0) { el.classList.add('bump'); setTimeout(function () { el.classList.remove('bump'); }, 90); }
      G.scoreShown = sc_;
      $('bestline').textContent = (G.daily ? 'DAILY · ' : '') + 'BEST ' + Math.max(G.prevBest, sc_);
    }
    if (save.leaves !== lastLeafN) {
      $('leafn').textContent = save.leaves;
      if (lastLeafN >= 0) { var lb = $('leafbox'); lb.classList.remove('pop'); void lb.offsetWidth; lb.classList.add('pop'); }
      lastLeafN = save.leaves;
    }
  }

  // ------------------------------------------------------------ events from the rules
  var BIOME_NAMES = [['AUTUMN', 'the leaves are turning'], ['SNOWFALL', 'watch the blizzard'], ['MUD SEASON', 'splish, splash']];
  function handleEvents() {
    var s = G.sim, ev = s.ev, i;
    for (i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e.k === 'hop') {
        Snd.hop(); pl.hopT = 0; if (e.dir === 'F') pl.kick = 1;
        // remember where we just left a road / track: if traffic sweeps through that spot a moment later, it was close
        var Lfrom = s.w.lane(e.fr);
        if (e.fr !== e.tr && (Lfrom.type === 'road' || Lfrom.type === 'rail')) G.nm = { row: e.fr, x: e.fx, t: s.t, rail: Lfrom.type === 'rail' };
        if (e.dir === 'L') pl.facing = -1; else if (e.dir === 'R') pl.facing = 1;
        var Lf = s.w.lane(e.fr);
        puff(s.x, e.fr, surfaceKind(Lf), 3, 0.8);
        if (G.autoSide && (e.dir === 'L' || e.dir === 'R')) G.autoSide = false;
        else if (hintStage === 2 && (e.dir === 'L' || e.dir === 'R')) { hintStage = 0; save.tutSwipe = 1; persist(); setHint(null); }
        if (hintStage === 1 && s.hops >= 3) { hintStage = 0; save.tutTap = 1; persist(); setHint(null); }
      } else if (e.k === 'land') {
        pl.sq = 0.16;
        var Ll = s.w.lane(e.row), kind = surfaceKind(Ll);
        puff(e.x, e.row, kind, kind === 'river' ? 6 : 4, 1);
        Snd.land(kind === 'grass' ? 'grass' : kind);
        if (kind === 'river') { ring(e.x, e.row); pl.dip = 1; errProgress('rides', 1); }
        if (kind === 'mud') puff(e.x, e.row, 'mud', 3, 1);
        if (e.row % 1 === 0) G.shakeMin = 0;
      } else if (e.k === 'bump') {
        pl.bump = 0.14; pl.bumpDir = e.dir; Snd.bump(); Snd.buzz(8);
        if (hintStage === 2 && e.dir === 'F') { // a tap-only player keeps bumping: after a few, show them the sidestep
          G.lessonBumps = (G.lessonBumps || 0) + 1;
          if (G.lessonBumps >= 4) {
            G.lessonBumps = 0;
            var Lh = s.w.lane(s.row), Lf = s.w.lane(s.row + 1), cx0 = Math.round(s.x), side = 0;
            [1, -1].forEach(function (d) { if (!side && !s.blocked(Lh, cx0 + d) && !s.blocked(Lf, cx0 + d)) side = d; });
            if (side) { G.autoSide = true; s.push(side > 0 ? 'R' : 'L'); pop(s.x, s.row, 'SWIPE!', '#fff6dc', 26, 1.5); setHint('SWIPE ← OR → TO SIDESTEP', '👆', true); }
          }
        }
        if (!save.tutSwipe && hintStage !== 2 && (e.dir === 'F')) { if (hintStage === 1) save.tutTap = 1; hintStage = 2; setHint('SWIPE TO SIDESTEP', '👆', true); }
      } else if (e.k === 'shrug') { // the bear's thick hide
        G.shake = 7; G.hitPause = 0.06; Snd.squish(); Snd.buzz(30); puff(e.x, e.row, 'road', 10, 1.3);
        pop(e.x, e.row, 'THICK HIDE!', '#ffd23a', 22, 1.4);
      } else if (e.k === 'leaf') {
        Snd.leaf(e.v > 1); Snd.buzz(10);
        save.leaves += e.v; G.runLeaves += e.v; persist();
        errProgress('leaves', e.v); if (e.v > 1) errProgress('gold', 1);
        leafBurst(e.x, e.row, e.v > 1 ? 12 : 7, e.v > 1);
        pop(e.x, e.row, '+' + e.v, e.v > 1 ? '#ffd23a' : '#ffb23f', e.v > 1 ? 30 : 24, 1.2);
        if (e.v > 1) sparkle(e.x, e.row, 8);
      } else if (e.k === 'score') {
        if (G.daily) {
          if (save.daily.d !== dateKey()) save.daily = { d: dateKey(), best: 0, m: 0 };
          if (e.row > save.daily.best) { save.daily.best = e.row; if (e.row % 5 === 0) persist(); }
          MEDALS.forEach(function (md, mi) {
            if (e.row >= md.row && !((save.daily.m || 0) & (1 << mi))) {
              save.daily.m = (save.daily.m || 0) | (1 << mi); save.leaves += md.pay; G.medalPay += md.pay; persist();
              toast(md.name + ' MEDAL', 'Daily Route · +' + md.pay + ' leaves'); Snd.best(); leafBurst(s.x, e.row, 16, true);
            }
          });
        }
        else if (e.row > save.best) { save.best = e.row; if (e.row % 5 === 0) persist(); }
        if (e.row === G.prevBest + 1 && G.prevBest > 0 && !G.newBest) {
          G.newBest = true; Snd.best(); toast('NEW BEST!', 'you passed your flag'); leafBurst(s.x, e.row, 14, true);
        }
        if (e.row % 25 === 0) { toast(String(e.row), e.row % 100 === 0 ? 'moose of legend' : 'keep hopping'); Snd.season(1); }
        var b = MG.biomeOf(e.row);
        if (b !== G.lastBiome && e.row >= 1) { G.lastBiome = b; toast(BIOME_NAMES[b][0], BIOME_NAMES[b][1]); Snd.season(b); Snd.setSong(b); }
        errProgress('rows', e.row); errProgress('reach', e.row);
        // hop streak: new rows in quick succession build a counter; every 10 pays a leaf
        G.streak = s.t - G.lastScoreT < 0.55 ? G.streak + 1 : 1; G.lastScoreT = s.t; G.bestStreak = Math.max(G.bestStreak, G.streak);
        if (G.streak >= 5) { showStreak(); errProgress('streak', G.streak); }
        if (G.streak % 10 === 0) { save.leaves += 1; G.runLeaves += 1; pop(s.x, e.row, 'STREAK +1', '#ffd23a', 20, 1.6); Snd.streak(G.streak / 10); Snd.buzz(12); }
        if (s.w.lane(e.row - 1).type === 'rail') errProgress('rails', 1);
        if (e.row === 1 && hintStage === 1) { /* keep tap hint until 3 hops */ }
      } else if (e.k === 'die') {
        startDeath(e);
      }
    }
    ev.length = 0;
  }

  // ------------------------------------------------------------ death + game over
  var DEATH_WORDS = { car: ['SPLAT!', 'FLATTENED!', 'POW!'], train: ['CHOO-CHOO!', 'BLAMMO!'], drown: ['SPLASH!', 'BLOOP!'], swept: ['SWEPT AWAY!', 'DOWNSTREAM!'], frozen: ['BRRR!', 'WHITEOUT!', 'FROZEN!'] };
  function startDeath(e) {
    var s = G.sim; $('streak').classList.remove('on');
    G.mode = 'dead'; G.hitPause = 0.09; G.shake = e.cause === 'drown' || e.cause === 'swept' ? 4 : 9; G.retryT = 0; setHint(null);
    var words = DEATH_WORDS[e.cause] || ['OOF!'];
    G.death = { at: performance.now(), cause: e.cause, info: e.info || {}, t: 0, x: s.x, row: s.row, word: words[(Math.random() * words.length) | 0], panel: false, hx: s.xf(), hr: s.rowf() };
    Snd.wind(0);
    if (e.cause === 'car' || e.cause === 'train') { Snd.squish(); Snd.buzz(40); puff(G.death.hx, G.death.hr, 'road', 10, 1.4); }
    else if (e.cause === 'frozen') { Snd.freeze(); Snd.buzz(30); }
    else { Snd.splash(); Snd.buzz(30); puff(G.death.hx, G.death.hr, 'river', 14, 1.5); ring(G.death.hx, G.death.hr); }
    // save results (+1 leaf for every 10 rows, so every run nudges you toward the next critter)
    var r = s.maxRow;
    G.bonus = G.god ? 0 : Math.floor(r / 10);
    save.leaves += G.bonus;
    errProgress('total', r);
    Snd.duck(1.8); Snd.setIntensity(0);
    if (G.daily) { if (save.daily.d !== dateKey()) save.daily = { d: dateKey(), best: 0 }; if (r > save.daily.best) save.daily.best = r; }
    else if (r > save.best) save.best = r;
    persist();
  }
  function fillOver(animate) {
    var s = G.sim, d = G.death;
    $('ovWord').textContent = d ? d.word : 'OOF!';
    $('ovScore').textContent = s.maxRow;
    var best = bestFor(G.daily);
    $('ovBest').textContent = best;
    var nb = s.maxRow > G.prevBest && s.maxRow > 0;
    $('ovBadge').style.display = nb ? 'inline-block' : 'none';
    var got = G.runLeaves + G.bonus;
    var lv = $('ovLeaves'); lv.innerHTML = '<svg class="lf" viewBox="-1 -1 2 2"><use href="#leafsym" x="-1" y="-1" width="2" height="2"/></svg> +' + got;
    var got2 = got + G.runLeavesErr + G.streakPay + (G.medalPay || 0), parts2 = [];
    if (G.runLeaves) parts2.push(G.runLeaves + ' found'); if (G.bonus) parts2.push('+' + G.bonus + ' rows');
    if (G.runLeavesErr) parts2.push('+' + G.runLeavesErr + ' errands'); if (G.streakPay) parts2.push('+' + G.streakPay + ' streak'); if (G.medalPay) parts2.push('+' + G.medalPay + ' medals');
    lv.lastChild.nodeValue = ' +' + got2;
    $('ovLeafSub').textContent = parts2.length > 1 ? parts2.join('  ·  ') : '';
    $('ovErr').innerHTML = errListHTML(true);
    var mh = '';
    if (G.daily) MEDALS.forEach(function (md, mi) { var got3 = (save.daily.m || 0) & (1 << mi); mh += '<span class="md' + (got3 ? ' on' : '') + '" style="--mc:' + md.col + '">' + md.name + ' <b>' + md.row + '</b></span>'; });
    $('ovMed').innerHTML = mh; $('ovMed').style.display = mh ? 'flex' : 'none';
    // progress toward the next critter, with their portrait
    var next = nextCritter(), u = $('ovUnlock');
    G.ovNext = next;
    if (next) {
      var c = Art.CRITTERS[next], have = save.leaves, ready = have >= c.cost, bar = $('ovBar');
      u.style.display = 'flex'; u.classList.toggle('ready', ready);
      $('ovUnName').textContent = ready ? c.name + ' — ready!' : 'Next: ' + c.name;
      $('ovUnTxt').textContent = ready ? 'Tap CRITTERS to unlock' : have + ' / ' + c.cost + ' leaves';
      var pct = function (v) { return Math.min(100, Math.max(0, v / c.cost * 100)) + '%'; };
      // start where you were before this run, then grow (or just snap into place when coming back from the shop)
      bar.style.transition = 'none'; bar.style.width = pct(animate ? Math.max(0, have - got2) : have); void bar.offsetWidth; bar.style.transition = '';
      if (animate) bar.style.width = pct(have);
      drawOvCritter();
    } else u.style.display = 'none';
    updateNewBadges();
  }
  function drawOvCritter() {
    var k = G.ovNext; if (!k) return;
    var cv2 = $('ovCrit'), g = cv2.getContext('2d'), w = cv2.width, h = cv2.height, ready = save.leaves >= Art.CRITTERS[k].cost;
    var ph = (G.time * 0.6) % 1, hp = ready && ph < 0.25 ? ph / 0.25 : -1, lift = hp >= 0 ? Math.sin(hp * Math.PI) * Art.CRITTERS[k].hopH * 0.6 : 0;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    g.save(); g.translate(w * 0.5, h * 0.88); var u = h * 0.5 * (CS[k] || 0.8) / 0.8; g.scale(u, u);
    g.fillStyle = 'rgba(60,40,20,.22)'; g.beginPath(); g.ellipse(0, 0.02, 0.45, 0.1, 0, 0, 6.3); g.fill();
    g.translate(0, -lift); g.lineJoin = 'round'; g.lineCap = 'round';
    Art.critter(g, k, { t: G.time, hop: hp });
    g.restore();
  }
  function showOver() {
    show('over', true); fillOver(true); // shown first, so the bar can actually animate
    $('toast').classList.remove('go'); toastQ.length = 0; $('errb').classList.remove('on'); // a season / milestone toast must never sit on top of the death word
    if (G.sim.maxRow > G.prevBest && G.sim.maxRow > 0 && !G.newBest) Snd.best(); else Snd.over();
  }

  // ------------------------------------------------------------ input
  var ptrs = {};
  var SWIPE = 20;
  function inputDir(dir) {
    if (G.mode === 'play') { if (G.sim.push(dir)) { /* ok */ } }
  }
  cv.addEventListener('pointerdown', function (e) {
    e.preventDefault(); Snd.unlock();
    try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    if (G.mode === 'title') { startRun(false, false); ptrs[e.pointerId] = { x: e.clientX, y: e.clientY, done: true }; inputDir('F'); return; }
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY, t: performance.now(), done: false };
  });
  cv.addEventListener('pointermove', function (e) {
    var p = ptrs[e.pointerId]; if (!p || p.done || G.mode !== 'play') return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (dx * dx + dy * dy >= SWIPE * SWIPE) {
      p.done = true;
      inputDir(Math.abs(dx) > Math.abs(dy) * 0.9 ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'B' : 'F'));
    }
  });
  function endPtr(e, cancel) {
    Snd.unlock();
    var p = ptrs[e.pointerId]; delete ptrs[e.pointerId];
    if (!p) return;
    if (G.mode === 'dead') { if (!cancel && G.death && G.death.panel && p.t > G.death.panelAt && !p.done) retry(); return; }
    if (cancel || p.done || G.mode !== 'play') return;
    inputDir('F');
  }
  cv.addEventListener('pointerup', function (e) { endPtr(e, false); });
  cv.addEventListener('pointercancel', function (e) { endPtr(e, true); });
  cv.addEventListener('lostpointercapture', function (e) { delete ptrs[e.pointerId]; });
  ['contextmenu', 'gesturestart', 'dblclick'].forEach(function (n) { document.addEventListener(n, function (e) { e.preventDefault(); }); });
  document.addEventListener('touchmove', function (e) { if (e.target === cv || G.mode === 'play') e.preventDefault(); }, { passive: false });

  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'Escape' || k === 'p' || k === 'P') { if (G.mode === 'play') pauseGame(); else if (G.mode === 'pause') resumeGame(); return; }
    if (k === 'm' || k === 'M') { toggleSfx(); return; }
    var map = { ArrowUp: 'F', w: 'F', W: 'F', ' ': 'F', ArrowLeft: 'L', a: 'L', A: 'L', ArrowRight: 'R', d: 'R', D: 'R', ArrowDown: 'B', s: 'B', S: 'B' };
    if (G.mode === 'title' && (map[k] || k === 'Enter')) { e.preventDefault(); Snd.unlock(); startRun(false, false); if (map[k] === 'F') inputDir('F'); return; }
    if (G.mode === 'dead' && (k === ' ' || k === 'Enter') && G.death && G.death.panel) { e.preventDefault(); retry(); return; }
    if (G.mode === 'play' && map[k]) { e.preventDefault(); Snd.unlock(); if (!e.repeat || G.sim.q.length < 1) inputDir(map[k]); }
  });
  function retry() { Snd.click(); startRun(true, G.daily); }

  // buttons
  function bind(id, fn) { var el = $(id); el.addEventListener('click', function (e) { e.stopPropagation(); if (el._swiped) { el._swiped = false; return; } Snd.unlock(); fn(e); }); }
  bind('btnPlay', function () { Snd.click(); startRun(false, false); });
  bind('btnDaily', function () { Snd.click(); startRun(true, true); });
  bind('btnShop', function () { openShop('title'); });
  ['btnPause', 'btnSound'].forEach(function (id) {
    var el = $(id), sp = null;
    el.addEventListener('pointerdown', function (e) { el._swiped = false; sp = { x: e.clientX, y: e.clientY, id: e.pointerId }; try { el.setPointerCapture(e.pointerId); } catch (x) { /* */ } });
    el.addEventListener('pointermove', function (e) {
      if (!sp || e.pointerId !== sp.id || G.mode !== 'play') return;
      var dx = e.clientX - sp.x, dy = e.clientY - sp.y;
      if (dx * dx + dy * dy >= SWIPE * SWIPE) { sp = null; el._swiped = true; inputDir(Math.abs(dx) > Math.abs(dy) * 0.9 ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'B' : 'F')); }
    });
    el.addEventListener('pointerup', function () { sp = null; }); el.addEventListener('pointercancel', function () { sp = null; });
  });
  bind('btnPause', pauseGame);
  bind('pResume', resumeGame);
  bind('pRestart', function () { show('pause', false); startRun(true, G.daily); });
  bind('pHome', function () { show('pause', false); toTitle(); });
  bind('ovAgain', function () { retry(); });
  bind('ovShop', function () { openShop('over'); });
  bind('ovHome', function () { Snd.click(); toTitle(); });
  bind('shopBack', closeShop);
  function sndIcons() {
    ['btnSound', 'tSfx', 'pSfx'].forEach(function (id) { $(id).classList.toggle('off', !Snd.sfxOn); });
    ['tMusic', 'pMusic'].forEach(function (id) { $(id).classList.toggle('off', !Snd.musicOn); });
  }
  function toggleSfx() { Snd.setSfx(!Snd.sfxOn); sndIcons(); if (Snd.sfxOn) Snd.click(); }
  function toggleMusic() { Snd.setMusic(!Snd.musicOn); sndIcons(); }
  bind('btnSound', toggleSfx); bind('tSfx', toggleSfx); bind('pSfx', toggleSfx); bind('tMusic', toggleMusic); bind('pMusic', toggleMusic);
  sndIcons();

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { dropPointers(); if (!G.noPause) pauseGame(); Snd.suspend(); persist(); } else if (G.mode !== 'pause') Snd.resume();
  });
  window.addEventListener('pagehide', persist);
  window.addEventListener('blur', function () { if (!G.noPause && G.mode === 'play') pauseGame(); });

  // ------------------------------------------------------------ shop
  var shopCards = [];
  function buildShop() {
    var grid = $('shopGrid'); grid.innerHTML = ''; shopCards = [];
    $('shopN').textContent = save.leaves;
    Art.ORDER.forEach(function (key) {
      var c = Art.CRITTERS[key], owned = save.owned.indexOf(key) >= 0, cur = save.pick === key;
      var b = document.createElement('button'); b.className = 'crit' + (cur ? ' cur' : '') + (!owned ? ' locked' : '') + (!owned && save.leaves >= c.cost ? ' can' : '');
      var cvs = document.createElement('canvas'); cvs.width = 240; cvs.height = 144; b.appendChild(cvs);
      var nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = c.name; b.appendChild(nm);
      var bl = document.createElement('div'); bl.className = 'bl'; bl.textContent = (PERKS[key] || {}).txt || c.blurb; b.appendChild(bl);
      var tg = document.createElement('div'); tg.className = 'tagc'; b.appendChild(tg);
      var card = { el: b, cv: cvs, key: key, tg: tg, hopAt: -9 };
      b.addEventListener('click', function () {
        Snd.unlock();
        if (save.owned.indexOf(key) >= 0) { save.pick = key; persist(); Snd.click(); card.hopAt = G.time; refreshShop(); toast(c.name.toUpperCase(), (PERKS[key] || {}).txt || ''); }
        else if (save.leaves >= c.cost) { save.leaves -= c.cost; save.owned.push(key); save.pick = key; persist(); Snd.buy(); card.hopAt = G.time; refreshShop(); toast('UNLOCKED!', c.name + ' · ' + ((PERKS[key] || {}).txt || '')); lastLeafN = -1; }
        else { Snd.no(); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }
      });
      grid.appendChild(b); shopCards.push(card);
    });
    refreshShop();
  }
  function refreshShop() {
    $('shopN').textContent = save.leaves;
    shopCards.forEach(function (cd) {
      var c = Art.CRITTERS[cd.key], owned = save.owned.indexOf(cd.key) >= 0, cur = save.pick === cd.key;
      cd.el.className = 'crit' + (cur ? ' cur' : '') + (!owned ? ' locked' : '') + (!owned && save.leaves >= c.cost ? ' can' : '');
      cd.tg.innerHTML = cur ? 'PICKED' : owned ? 'PICK' : '<svg class="lf" viewBox="-1 -1 2 2"><use href="#leafsym" x="-1" y="-1" width="2" height="2"/></svg>' + c.cost;
    });
  }
  function drawShop() {
    for (var i = 0; i < shopCards.length; i++) {
      var c = shopCards[i], g = c.cv.getContext('2d'), w = c.cv.width, h = c.cv.height;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
      var tt = G.time + i * 0.7, ph = (tt * 0.42) % 1, hp = ph < 0.2 ? ph / 0.2 : -1;
      if (G.time - c.hopAt < 0.45) hp = (G.time - c.hopAt) / 0.45;
      var hopH = Art.CRITTERS[c.key].hopH * 0.7, lift = hp >= 0 ? Math.sin(hp * Math.PI) * hopH : 0, sq = 1;
      g.save(); g.translate(w * 0.5, h * 0.86); var u = h * 0.4 * (CS[c.key] || 0.8) / 0.8; g.scale(u, u);
      g.fillStyle = 'rgba(60,40,20,.22)'; g.beginPath(); g.ellipse(0, 0.02, 0.5 - lift * 0.2, 0.12, 0, 0, 6.3); g.fill();
      g.translate(0, -lift); g.lineJoin = 'round'; g.lineCap = 'round';
      Art.critter(g, c.key, { t: tt, hop: hp });
      g.restore();
    }
  }

  // ------------------------------------------------------------ camera
  function updateCamera(dt) {
    var s = G.sim, tr = Math.max(cam.tgtRow, s.rowf());
    cam.tgtRow = tr;
    var kk = 1 - Math.exp(-9 * dt);
    cam.row += (tr - cam.row) * kk;
    var tx = clamp(s.xf() * 0.6 + 5 * 0.4, 3.6, 6.4);
    if (G.mode === 'title') tx = 5 + Math.sin(G.time * 0.4) * 0.25;
    cam.x += (tx - cam.x) * (1 - Math.exp(-5 * dt));
    var at = G.mode === 'title' || (G.mode === 'shop' && G.shopFrom === 'title') ? 0.56 : 0.68;
    if (G.mode === 'dead' && G.death && G.death.panel && H > W) at = 0.82;
    anchorT += (at - anchorT) * (1 - Math.exp(-4 * dt));
    anchorY = H * anchorT + (pl.kick || 0) * S * 0.07; // a tiny forward lurch on each hop
  }

  // ------------------------------------------------------------ update
  var last = performance.now(), ambT = 0;
  var honked = {}, railState = {};
  function update(dt) {
    G.time += dt;
    var s = G.sim;
    pl.sq = Math.max(0, pl.sq - dt); pl.bump = Math.max(0, pl.bump - dt); pl.dip = Math.max(0, pl.dip - dt * 4); pl.kick = Math.max(0, (pl.kick || 0) - dt * 7);
    // crouch the instant a finger lands; the hop itself fires on release (so a swipe never also hops forward)
    var pressing = false;
    if (G.mode === 'play') for (var pk in ptrs) if (!ptrs[pk].done) { pressing = true; break; }
    pl.crouch += ((pressing ? 1 : 0) - pl.crouch) * (1 - Math.exp(-dt * (pressing ? 45 : 30)));
    G.shake = Math.max(0, G.shake - dt * 30); G.flash = Math.max(0, G.flash - dt * 2.5);
    if (G.hitPause > 0) G.hitPause -= dt;
    else if (G.freeze > 0) G.freeze -= dt;
    else if (G.mode === 'play' || G.mode === 'dead' || G.mode === 'title' || G.mode === 'shop') {
      s.step(dt);
      handleEvents();
      if (G.god && !s.alive) { s.alive = true; s.cause = null; G.mode = 'play'; G.death = null; s.front = Math.min(s.front, s.maxRow - 5); }
    }
    if (G.mode === 'dead') updateHud(false);
    if (G.mode === 'play') {
      updateHud(false);
      // wind + sound of the blizzard coming
      var gap = s.rowf() - s.front, wind = clamp(1 - (gap - 0.5) / 3.6, 0, 1);
      Snd.wind(wind); G.frost = wind;
      Snd.setIntensity(wind * 1.2 + Math.min(0.3, s.maxRow / 300));
      levelSounds(dt);
      closeCall();
      if (G.streak >= 5 && s.t - G.lastScoreT > 0.6) { G.streak = 0; $('streak').classList.remove('on'); }
      if (toastQ.length && performance.now() >= toastBusy) showToast.apply(null, toastQ.shift());
      // hint management
      if (hintStage === 1 && s.hops >= 3) { hintStage = 0; save.tutTap = 1; persist(); setHint(null); }
      if (hintStage === 2 && ((s.idleT > 7 && save.tutSwipe) || s.maxRow >= 7)) { hintStage = 0; setHint(null); } // past the lesson spot: let them play (it comes back next run)
      // the blizzard waits while a new player is still learning (first couple of runs, and the sidestep lesson)
      if ((hintStage === 2 && !save.tutSwipe && s.maxRow <= 3) || (save.runs <= 2 && s.maxRow < 4)) s.front = Math.min(s.front, s.maxRow - MC.GAP_MAX);
    } else G.frost = G.mode === 'dead' ? (G.frost || 0) * 0.95 : 0;
    if (G.mode === 'dead' && G.death) {
      G.death.t += dt;
      if (!G.death.panel && G.death.t > 0.8) { G.death.panel = true; G.death.panelAt = performance.now(); syncHudVis(false); showOver(); }
      else if (G.death.panel) drawOvCritter();
    }
    if (G.mode !== 'pause') updateCamera(dt);
    // particles
    var i;
    for (i = parts.length - 1; i >= 0; i--) {
      var p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.r += p.vr * dt; p.h = Math.max(0, p.h + p.vh * dt); p.vh -= p.g * dt; if (p.rot !== undefined) p.rot += dt * 6;
    }
    for (i = pops.length - 1; i >= 0; i--) { var q = pops[i]; q.life -= dt; q.h += dt * 0.9; if (q.life <= 0) pops.splice(i, 1); }
    for (i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > 0.6) rings.splice(i, 1); }
    ambient(dt);
    if (G.mode === 'shop') drawShop();
  }

  // near miss: traffic sweeps through the spot you hopped out of a moment ago
  function closeCall() {
    var nm = G.nm, s = G.sim, i;
    if (!nm || !s.alive) return;
    if (s.t - nm.t > (nm.rail ? 0.7 : 0.4)) { G.nm = null; return; }
    var L = G.world.lane(nm.row), hit = false;
    if (nm.rail) { var tx = MG.trainX(L, s.t); hit = tx !== null && Math.abs(tx - nm.x) < MG.TRAIN_LEN * 0.5 + 0.3; }
    else for (i = 0; i < L.items.length && !hit; i++) { var it = L.items[i]; hit = Math.abs(MG.itemX(L, it, s.t) - nm.x) < it.len * 0.5 * 0.88 + 0.34; }
    if (!hit) return;
    G.nm = null; G.closeCalls++;
    var cp = (nm.rail ? 2 : 1) * ((PERKS[save.pick] || {}).close || 1); save.leaves += cp; G.runLeaves += cp;
    pop(s.xf(), s.rowf(), (nm.rail ? 'WHEW! +' : 'CLOSE! +') + cp, '#a8f0ff', nm.rail ? 24 : 20, 1.35);
    errProgress('close', 1);
    Snd.whoosh(nm.rail); Snd.buzz(12); G.shake = Math.max(G.shake, nm.rail ? 4 : 2);
  }

  // honks, bells, train horns, rush hour
  function levelSounds(dt) {
    var s = G.sim, t = s.t, r;
    for (r = Math.max(0, s.row - 3); r <= s.row + 6; r++) {
      var L = G.world.lane(r), dr = Math.abs(r - s.rowf());
      if (L.type === 'road') {
        if (dr > 2.5) continue;
        for (var i = 0; i < L.items.length; i++) {
          var it = L.items[i], cx = MG.itemX(L, it, t), dx = s.xf() - cx, toward = dx * L.dir > 0;
          if (toward && Math.abs(dx) < 3.4 && Math.abs(dx) > 1.0) {
            var key = r + ':' + i;
            if (!honked[key] || t - honked[key] > 3) {
              honked[key] = t;
              if (Math.random() < (dr < 0.6 ? 0.9 : 0.45) && L.vmax >= 1.6) { Snd.honk(dr > 0.6); pop(cx, r, 'HONK!', '#ffe36a', 16, 1.0); }
            }
          }
        }
      } else if (L.type === 'rail') {
        var ph = MG.railPhase(L, t), cyc = Math.floor((t + L.off) / L.cycle), st = railState[r] || (railState[r] = { cyc: -1, bellT: 0, horn: -1 });
        if (dr > 7) continue;
        var vol = clamp(1.05 - dr / 7, 0.12, 1);
        if (ph.s === 1) { st.bellT -= dt; if (st.bellT <= 0) { Snd.bell(vol); st.bellT = 0.3; } }
        if (ph.s === 2 && st.horn !== cyc) { st.horn = cyc; Snd.trainHorn(vol); Snd.rumble(vol); G.shake = Math.max(G.shake, dr < 3 ? 3 : 0); }
      } else if (L.rushM) {
        var rw = MG.rushWeight(L, t), stt = railState['r' + r] || (railState['r' + r] = { on: 0 });
        if (rw > 0.5 && !stt.on && dr < 6) { stt.on = 1; Snd.honk(true); } else if (rw < 0.1) stt.on = 0;
      }
    }
  }

  // ------------------------------------------------------------ ambient weather
  function ambient(dt) {
    var b = MG.biomeOf(Math.max(0, Math.floor(cam.row + 3))), want = 34;
    var kind = b === 0 ? 'leaf' : b === 1 ? 'snow' : 'rain';
    ambT += dt;
    while (amb.length < want && Math.random() < 0.6) {
      amb.push({ k: kind, x: Math.random() * (W + 80) - 40, y: -20 - Math.random() * 60, vx: kind === 'rain' ? -40 : (Math.random() - 0.3) * 40, vy: kind === 'rain' ? 520 + Math.random() * 120 : kind === 'snow' ? 60 + Math.random() * 60 : 50 + Math.random() * 50,
        sz: kind === 'rain' ? 12 + Math.random() * 10 : 3 + Math.random() * 4, ph: Math.random() * 6, rot: Math.random() * 6, col: ['#e8472a', '#f08a2e', '#ffb23f', '#c9552a'][(Math.random() * 4) | 0] });
    }
    for (var i = amb.length - 1; i >= 0; i--) {
      var a = amb[i]; a.ph += dt * 2;
      a.y += a.vy * dt; a.x += (a.vx + (a.k === 'rain' ? 0 : Math.sin(a.ph) * 30)) * dt; a.rot += dt * 3;
      if (a.y > H + 20 || a.x < -60 || a.x > W + 60) amb.splice(i, 1);
    }
  }
  function drawAmbient() {
    for (var i = 0; i < amb.length; i++) {
      var a = amb[i];
      if (a.k === 'snow') { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(a.x, a.y, a.sz * 0.6, 0, 6.3); ctx.fill(); }
      else if (a.k === 'rain') { ctx.strokeStyle = 'rgba(190,220,240,.55)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + 2, a.y + a.sz); ctx.stroke(); }
      else {
        ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.rot); ctx.scale(Math.cos(a.ph) * 0.8 + 0.2, 1);
        ctx.fillStyle = a.col; Art.leafPath(ctx, a.sz * 1.3); ctx.fill(); ctx.restore();
      }
    }
  }

  // ------------------------------------------------------------ drawing the world
  function paletteBlend() {
    var bf = (cam.row + 7) / MG.BIOME_LEN, fl = Math.floor(bf), fr = bf - fl, b0 = ((fl % 3) + 3) % 3, b1 = (b0 + 1) % 3;
    var t = fr > 0.86 ? ease((fr - 0.86) / 0.14) : 0;
    if (cam.row + 7 < 0) { b0 = 0; t = 0; }
    var A = Art.PAL[b0], B = Art.PAL[b1];
    return { sky0: mixHex(A.sky0, B.sky0, t), sky1: mixHex(A.sky1, B.sky1, t), mtn: mixHex(A.mtn, B.mtn, t), mtn2: mixHex(A.mtn2, B.mtn2, t), fog: t > 0.5 ? B.fog : A.fog };
  }
  function drawSky(pb) {
    var g = ctx.createLinearGradient(0, 0, 0, topY + 40);
    g.addColorStop(0, pb.sky0); g.addColorStop(1, pb.sky1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, topY + 60);
    // mountains: two layers drifting a little with the camera
    var sh = cam.x * 6 + cam.row * 1.2;
    for (var layer = 0; layer < 2; layer++) {
      ctx.fillStyle = layer ? pb.mtn2 : pb.mtn; ctx.beginPath(); ctx.moveTo(0, topY + 50);
      var base = topY - 6 - layer * 4, amp = layer ? 24 : 36;
      for (var x = 0; x <= W + 20; x += 20) {
        var yy = base - amp * (0.55 + 0.45 * Math.sin((x + sh * (1 + layer * 0.5)) * 0.012 + layer * 2)) * (0.7 + 0.3 * Math.sin((x + sh) * 0.031 + layer));
        ctx.lineTo(x, yy);
      }
      ctx.lineTo(W, topY + 50); ctx.closePath(); ctx.fill();
    }
  }

  function drawWorld() {
    var s = G.sim, t = s.t, pb = paletteBlend();
    drawSky(pb);
    var m = (anchorY - topY) / LH, dFar = m / (1 - K * m);
    var rHi = Math.floor(cam.row + dFar + 0.5), rLo = Math.floor(cam.row - 8);
    var pr = Math.round(s.rowf());
    if (G.mode === 'title') pr = 0;
    var r, drewPlayer = false;
    // ground under the lane stack so no gaps show
    ctx.fillStyle = Art.PAL[0].g1; ctx.fillRect(0, topY - 2, W, H);
    for (r = rHi; r >= rLo; r--) {
      drawLane(r, t);
      if (r === pr) { drawPlayerLayer(); drewPlayer = true; }
    }
    if (!drewPlayer) drawPlayerLayer();
    // horizon: the hills sit in front of the farthest rows, so tree tops never poke up into the sky
    ctx.save(); ctx.beginPath(); ctx.rect(-40, -40, W + 80, topY - 2 + 40); ctx.clip(); drawSky(pb); ctx.restore();
    // far fog
    var fg = ctx.createLinearGradient(0, topY - 34, 0, topY + H * 0.2);
    fg.addColorStop(0, pb.fog + '1)'); fg.addColorStop(0.12, pb.fog + '1)'); fg.addColorStop(1, pb.fog + '0)');
    ctx.fillStyle = fg; ctx.fillRect(0, topY - 34, W, H * 0.2 + 34);
  }

  function edgeCol(d, side, margin) { return cam.x + side * (W / 2 - margin) / (S * sc(d)); }
  function laneBox(d) { var y0 = yAt(d + 0.5), y1 = yAt(d - 0.5); return [y0, y1]; }

  function drawLane(r, t) {
    var L = G.world.lane(r), P = Art.PAL[L.biome || 0], d = r - cam.row, s = sc(d), ts = S * s, b = laneBox(d), y0 = b[0], y1 = b[1], lh = y1 - y0;
    if (y1 < topY + S * 0.25 || y0 > H) return;
    if (L.type === 'grass') drawGrass(L, P, y0, y1, d, ts);
    else if (L.type === 'road') drawRoad(L, P, y0, y1, d, ts, t);
    else if (L.type === 'rail') drawRail(L, P, y0, y1, d, ts, t);
    else drawRiver(L, P, y0, y1, d, ts, t);
    // best flag
    if (r > 0 && r === G.prevBest && G.mode !== 'title') { blit(Art.flag(), edgeCol(d, 1, 34), d, 0, false); }
    if (L.sign || L.bsign !== undefined) {
      if (L.bsign !== undefined && r > 0) blit(Art.sign(['FALL', 'SNOW', 'MUD'][L.bsign]), edgeCol(d, -1, 40), d, 0, false);
      else if (L.sign) blit(Art.sign(L.sign), edgeCol(d, -1, 40), d, 0, false);
    }
    // things standing in the lane
    if (L.type === 'grass') drawGrassObjects(L, d, ts);
    else if (L.type === 'road') drawVehicles(L, d, ts, t);
    else if (L.type === 'rail') drawTrain(L, d, ts, t);
    else drawPlatforms(L, d, ts, t);
  }

  function drawGrass(L, P, y0, y1, d, ts) {
    ctx.fillStyle = (L.r & 1) ? P.g1 : P.g2; ctx.fillRect(0, y0, W, y1 - y0 + 1);
    var g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, 'rgba(0,0,0,.06)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(255,255,255,.08)');
    ctx.fillStyle = g; ctx.fillRect(0, y0, W, y1 - y0 + 1);
    var seed = L.seed % 1000, i, b = L.biome || 0;
    // soft bits of ground detail
    for (i = 0; i < 16; i++) {
      var col = -3 + hash(seed + i) * 17, x = xAt(col, d), y = y0 + (y1 - y0) * (0.2 + 0.7 * hash(seed + i * 7));
      if (x < -20 || x > W + 20) continue;
      if (b === 0) { ctx.fillStyle = ['#e0823a', '#d6592c', '#f0b43a', '#c9a23d'][i & 3]; ctx.save(); ctx.translate(x, y); ctx.rotate(hash(seed + i * 3) * 6); ctx.beginPath(); ctx.ellipse(0, 0, ts * 0.1, ts * 0.05, 0, 0, 6.3); ctx.fill(); ctx.restore(); }
      else if (b === 1) { ctx.fillStyle = 'rgba(160,190,215,.35)'; ctx.beginPath(); ctx.ellipse(x, y, ts * 0.4, ts * 0.09, 0, 0, 6.3); ctx.fill(); if (i % 5 === 0) { ctx.fillStyle = '#fff'; ctx.fillRect(x, y - ts * 0.1, ts * 0.04, ts * 0.04); } }
      else { ctx.strokeStyle = 'rgba(40,110,40,.55)'; ctx.lineWidth = Math.max(1, ts * 0.04); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ts * 0.04, y - ts * 0.16); ctx.moveTo(x + ts * 0.05, y); ctx.lineTo(x + ts * 0.08, y - ts * 0.13); ctx.stroke(); }
    }
    if (L.mud) for (i = 0; i < L.mud.length; i++) {
      var mx = xAt(L.mud[i], d), my = y1 - (y1 - y0) * 0.42;
      ctx.fillStyle = '#7a5a3a'; ctx.beginPath(); ctx.ellipse(mx, my, ts * 0.52, ts * 0.23, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = 'rgba(160,200,215,.5)'; ctx.beginPath(); ctx.ellipse(mx - ts * 0.08, my - ts * 0.03, ts * 0.3, ts * 0.1, 0, 0, 6.3); ctx.fill();
    }
  }

  function drawGrassObjects(L, d, ts) {
    var b = L.biome || 0, c;
    var lo = -6, hi = COLS + 5, pRow = G.sim.rowf(), pCol = G.sim.xf();
    // flag-less leaf pickup first, trees after
    for (c = lo; c <= hi; c++) {
      var o = L.obs[c];
      if (!o) continue;
      var x = xAt(c, d);
      if (x < -ts * 2.2 || x > W + ts * 2.2) continue;
      var v = L.obsV[c] || 0;
      var sp = o === 'rock' ? Art.rock(b, v) : Art.tree(b, v);
      // trees in front of the moose turn see-through so you never lose him behind one
      var fade = G.mode !== 'title' && o !== 'rock' && L.r < pRow && L.r >= pRow - 3 && Math.abs(c - pCol) < 1.7;
      if (fade) ctx.globalAlpha = 0.32;
      blit(sp, c, d, 0, ((c * 7 + L.r) & 3) === 0, o === 'rock' ? 0.85 : 0.8);
      if (fade) ctx.globalAlpha = 1;
    }
    if (L.leaf >= 0 && !G.sim.taken[L.r]) {
      var bob = Math.sin(G.time * 3.2 + L.r) * 0.06 + 0.2;
      var x2 = xAt(L.leaf, d), y2 = yAt(d - 0.2);
      ctx.fillStyle = 'rgba(40,25,10,.25)'; ctx.beginPath(); ctx.ellipse(x2, y2, ts * 0.22, ts * 0.07, 0, 0, 6.3); ctx.fill();
      var gold = L.leafV > 1;
      if (gold) { ctx.fillStyle = 'rgba(255,230,110,' + (0.25 + 0.15 * Math.sin(G.time * 5)) + ')'; ctx.beginPath(); ctx.arc(x2, y2 - ts * (bob + 0.3), ts * 0.55, 0, 6.3); ctx.fill(); }
      blit(Art.leaf(gold), L.leaf, d, bob, false);
    }
  }

  // diorama depth: grass lanes are raised slabs, so where one sits behind a road or track you see its earth face
  // and a ragged grassy lip hanging over the edge, with a soft shadow on the asphalt below
  function drawVerge(L, y0, lh, d, ts) {
    var F = G.world.lane(L.r + 1); if (F.type !== 'grass') return false;
    var FP = Art.PAL[F.biome || 0], fh = Math.max(3, lh * 0.2);
    var g = ctx.createLinearGradient(0, y0, 0, y0 + fh); g.addColorStop(0, FP.face); g.addColorStop(1, FP.face2);
    ctx.fillStyle = g; ctx.fillRect(0, y0, W, fh);
    var sg = ctx.createLinearGradient(0, y0 + fh, 0, y0 + fh + lh * 0.22); sg.addColorStop(0, 'rgba(20,12,6,.28)'); sg.addColorStop(1, 'rgba(20,12,6,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, y0 + fh, W, lh * 0.22);
    // pebbles in the earth face
    var seed = F.seed % 997;
    ctx.fillStyle = 'rgba(255,240,210,.18)';
    for (var i = 0; i < 10; i++) { var px = xAt(-3 + hash(seed + i * 3) * 17, d); ctx.beginPath(); ctx.ellipse(px, y0 + fh * (0.45 + 0.4 * hash(seed + i)), ts * 0.05, ts * 0.025, 0, 0, 6.3); ctx.fill(); }
    // grassy lip: scallops in the far lane's own colour (snowdrift in winter)
    ctx.fillStyle = (F.r & 1) ? FP.g1 : FP.g2;
    var step = 0.34, c0 = Math.floor(cam.x - W / (S * sc(d)) / 2) - 2;
    for (var c = c0; c < c0 + W / (S * sc(d) * step) + 8; c += step) {
      var hx = xAt(c, d), wob = hash(Math.round(c * 7) + seed);
      ctx.beginPath(); ctx.ellipse(hx, y0, ts * (0.15 + 0.06 * wob), fh * (0.35 + 0.3 * wob), 0, 0, 3.15); ctx.fill();
    }
    return true;
  }
  function drawRoad(L, P, y0, y1, d, ts, t) {
    ctx.fillStyle = (L.r & 1) ? P.road : P.road2; ctx.fillRect(0, y0, W, y1 - y0 + 1);
    var lh = y1 - y0, i;
    // grit
    var seed = L.seed % 1000;
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    for (i = 0; i < 12; i++) { var x = xAt(-3 + hash(seed + i) * 17, d); ctx.fillRect(x, y0 + lh * hash(seed + i * 5), ts * 0.12, 1.2); }
    if (L.segLast) { if (!drawVerge(L, y0, lh, d, ts)) { ctx.fillStyle = P.edge; ctx.fillRect(0, y0, W, Math.max(2, lh * 0.1)); ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(0, y0 + lh * 0.1, W, 2); } }
    else { // dashed lane divider on the far edge
      ctx.fillStyle = P.line; var dash = ts * 0.7, gap = ts * 0.55, x0 = ((-cam.x * S * sc(d)) % (dash + gap));
      for (var x2 = x0 - dash; x2 < W + dash; x2 += dash + gap) ctx.fillRect(x2, y0 - 1, dash, Math.max(2, lh * 0.07));
    }
    if (L.segFirst) { ctx.fillStyle = P.edge; ctx.fillRect(0, y1 - Math.max(2, lh * 0.1), W, Math.max(2, lh * 0.1)); }
    // rush-hour lamp
    if (L.rushM) {
      var warn = MG.rushWarn(L, t), on = MG.rushWeight(L, t) > 0.05 || warn, blink = Math.floor(t * 5) % 2;
      var lx = xAt(edgeCol(d, 1, 22), d), ly = y1 - lh * 0.15;
      ctx.fillStyle = '#3a2e22'; ctx.fillRect(lx - ts * 0.03, ly - ts * 0.55, ts * 0.06, ts * 0.55);
      ctx.fillStyle = on && blink ? '#ffb21f' : '#6b4f1c'; ctx.beginPath(); ctx.arc(lx, ly - ts * 0.62, ts * 0.13, 0, 6.3); ctx.fill();
      if (on && blink) { ctx.fillStyle = 'rgba(255,190,50,.3)'; ctx.beginPath(); ctx.arc(lx, ly - ts * 0.62, ts * 0.38, 0, 6.3); ctx.fill(); }
    }
  }

  function drawVehicles(L, d, ts, t) {
    var rw = MG.rushWeight(L, t), flip = L.dir < 0, i;
    for (i = 0; i < L.items.length; i++) {
      var it = L.items[i], cx = MG.itemX(L, it, t), px = xAt(cx, d);
      if (px < -ts * 5 || px > W + ts * 5) continue;
      var sp = it.kind === 'plow' ? Art.plow() : it.kind === 'bus' ? Art.bus(it.color) : Art.car(it.kind, MG.VEH[it.kind].len, it.color, it.variant, L.biome);
      // road wobble & speed streaks in rush hour
      var wob = Math.sin(t * 22 + i) * 0.012 * (L.v > 2.5 ? 1 : 0.5);
      if (rw > 0.15) {
        var yS = yAt(d - 0.2), len = MG.VEH[it.kind].len;
        ctx.strokeStyle = 'rgba(255,255,255,' + 0.35 * rw + ')'; ctx.lineWidth = Math.max(1, ts * 0.04);
        for (var k = 0; k < 3; k++) { var xs = px - L.dir * (len * 0.5 + 0.2) * ts, yy = yS - ts * (0.2 + k * 0.17); ctx.beginPath(); ctx.moveTo(xs, yy); ctx.lineTo(xs - L.dir * ts * (0.6 + 0.3 * k) * rw * 1.5, yy); ctx.stroke(); }
      }
      blit(sp, cx, d, wob, flip);
      if (it.kind === 'plow') {
        var bk = Art.VEH_BEACON.plow, on = Math.floor(t * 4 + i) % 2, bx = px + (flip ? -bk.x : bk.x) * ts, by = yAt(d - 0.2) + bk.y * ts;
        ctx.fillStyle = on ? 'rgba(255,190,40,.9)' : 'rgba(255,190,40,.25)'; ctx.beginPath(); ctx.arc(bx, by, ts * 0.1, 0, 6.3); ctx.fill();
        if (on) { ctx.fillStyle = 'rgba(255,190,40,.25)'; ctx.beginPath(); ctx.arc(bx, by, ts * 0.32, 0, 6.3); ctx.fill(); }
      }
    }
  }

  function drawRail(L, P, y0, y1, d, ts, t) {
    var lh = y1 - y0, i;
    ctx.fillStyle = P.ballast; ctx.fillRect(0, y0, W, lh + 1);
    var seed = L.seed % 1000;
    ctx.fillStyle = 'rgba(0,0,0,.1)'; for (i = 0; i < 26; i++) ctx.fillRect(xAt(-3 + hash(seed + i) * 17, d), y0 + lh * hash(seed + i * 3), ts * 0.1, 2);
    // sleepers
    ctx.fillStyle = P.rail; var step = ts * 0.5, x0 = ((-cam.x * S * sc(d)) % step), sw = Math.max(2, ts * 0.12);
    for (var x = x0 - step; x < W + step; x += step) ctx.fillRect(x, y0 + lh * 0.1, sw, lh * 0.8);
    // rails
    [0.3, 0.68].forEach(function (f) {
      var y = y0 + lh * f; ctx.fillStyle = '#2d2f34'; ctx.fillRect(0, y, W, Math.max(3, lh * 0.12));
      ctx.fillStyle = '#c9ced6'; ctx.fillRect(0, y, W, Math.max(1.5, lh * 0.06));
    });
    drawVerge(L, y0, lh, d, ts);
    // signal
    var ph = MG.railPhase(L, t), flash = ph.s === 1 || (ph.s === 2), a = Math.floor(t * 4) % 2;
    var sp = Art.signal(), scol = edgeCol(d, -1, 24), sx = xAt(scol, d), sy = yAt(d - 0.2);
    blit(sp, scol, d, 0, false);
    var lampY = sy - 1.39 * ts;
    [-0.14, 0.14].forEach(function (o, i2) {
      var onL = flash && (a === i2);
      ctx.fillStyle = onL ? '#ff3b2f' : '#4a1512'; ctx.beginPath(); ctx.arc(sx + o * ts, lampY, ts * 0.075, 0, 6.3); ctx.fill();
      if (onL) { ctx.fillStyle = 'rgba(255,60,40,.3)'; ctx.beginPath(); ctx.arc(sx + o * ts, lampY, ts * 0.3, 0, 6.3); ctx.fill(); }
    });
    if (ph.s === 1) { // warning chevrons on the ground so you can read it at a glance
      ctx.fillStyle = 'rgba(255,60,40,' + (0.12 + 0.1 * a) + ')'; ctx.fillRect(0, y0, W, lh);
    }
  }
  function drawTrain(L, d, ts, t) {
    var tx = MG.trainX(L, t);
    if (tx === null) return;
    blit(Art.train(), tx, d, 0, L.dir < 0);
  }

  function drawRiver(L, P, y0, y1, d, ts, t) {
    var lh = y1 - y0, i;
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, P.w2); g.addColorStop(1, P.w1);
    ctx.fillStyle = g; ctx.fillRect(0, y0, W, lh + 1);
    // far bank wall (earth face dropping into the water)
    var prevFar = G.world.lane(L.r + 1);
    var fh = Math.max(4, lh * 0.34);
    var bg = ctx.createLinearGradient(0, y0, 0, y0 + fh); bg.addColorStop(0, P.face); bg.addColorStop(1, P.face2);
    ctx.fillStyle = bg; ctx.fillRect(0, y0, W, fh);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(0, y0 + fh, W, 2);
    // current ripples
    var seed = L.seed % 1000, flow = L.dir * L.v * t * S * sc(d);
    ctx.strokeStyle = P.ripple; ctx.lineWidth = Math.max(1.2, ts * 0.045); ctx.lineCap = 'round';
    for (i = 0; i < 14; i++) {
      var base = hash(seed + i * 3) * W * 1.5, x = (((base + flow * (0.8 + hash(i) * 0.4)) % (W * 1.5)) + W * 1.5) % (W * 1.5) - W * 0.25;
      var y = y0 + fh + (lh - fh) * (0.15 + 0.75 * hash(seed + i * 9)), len = ts * (0.3 + 0.35 * hash(seed + i));
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + len * 0.5, y - ts * 0.05, x + len, y); ctx.stroke();
    }
    // near-bank foam line
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(1.5, ts * 0.05); ctx.beginPath();
    for (var x2 = -10; x2 <= W + 10; x2 += 14) { var yy = y1 - 2 + Math.sin(x2 * 0.05 + t * 2) * 1.5; if (x2 === -10) ctx.moveTo(x2, yy); else ctx.lineTo(x2, yy); }
    ctx.stroke();
    if (L.biome === 1) { ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, y0, W, lh); }
  }

  function drawPlatforms(L, d, ts, t) {
    var s = G.sim, ride = s.ride && s.ride.row === L.r ? s.ride.idx : -1, flip = L.dir < 0;
    for (var i = 0; i < L.items.length; i++) {
      var it = L.items[i], cx = MG.itemX(L, it, t), px = xAt(cx, d);
      if (px < -ts * 6 || px > W + ts * 6) continue;
      var bob = Math.sin(t * 1.6 + it.off) * 0.025 - (ride === i ? 0.05 + pl.dip * 0.05 : 0);
      var sp = L.kind === 'log' ? Art.log(it.len, it.variant, L.biome) : Art.floe(it.len, it.seed, L.biome);
      blit(sp, cx, d, bob + 0.03, flip);
    }
  }

  // ------------------------------------------------------------ the player
  function drawPlayerLayer() {
    var s = G.sim, d0 = G.death, kind = save.pick;
    var row = s.rowf(), d = row - cam.row, col = s.xf();
    if (G.mode === 'title') { row = 0; d = -cam.row; col = 5; }
    var sc_ = sc(d), ts = S * sc_, x = xAt(col, d), yBase = yAt(d - 0.2);
    var onLane = G.world.lane(Math.round(row)), lift = 0;
    var targetLift = !s.hop && onLane.type === 'river' ? (onLane.kind === 'log' ? 0.2 : 0.1) : 0;
    pl.lift += (targetLift - pl.lift) * 0.5;
    lift = pl.lift - pl.dip * 0.05;
    var hp = s.hop ? s.hop.p : -1, hopH = Art.CRITTERS[kind].hopH;
    var h = hp >= 0 ? Math.sin(hp * Math.PI) * hopH : 0;
    var t = G.time;
    // dead states
    if (d0) { drawDeadPlayer(d0, kind, d, ts, x, yBase); return; }
    // a soft pool of warm light under the hero so they always read against busy ground
    var hg = ctx.createRadialGradient(x, yBase, 0, x, yBase, ts * 0.95);
    hg.addColorStop(0, 'rgba(255,246,214,.34)'); hg.addColorStop(1, 'rgba(255,246,214,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(x, yBase, ts * 0.95, ts * 0.42, 0, 0, 6.3); ctx.fill();
    // shadow
    ctx.fillStyle = 'rgba(30,20,10,' + (0.3 - h * 0.25) + ')'; ctx.beginPath(); ctx.ellipse(x, yBase - lift * ts * 0.0, ts * (0.4 - h * 0.12), ts * 0.12, 0, 0, 6.3); ctx.fill();
    // squash & stretch
    var sx = 1, sy = 1;
    if (hp >= 0) { var e = Math.sin(hp * Math.PI); sy = 1 + 0.12 * e; sx = 1 - 0.08 * e; }
    if (pl.sq > 0) { var q = pl.sq / 0.16, e2 = Math.sin(q * Math.PI * 0.5); var kind2 = kind === 'bear' ? 1.4 : 1; sy = 1 - 0.26 * e2 * kind2; sx = 1 + 0.2 * e2 * kind2; }
    var bx = 0;
    if (pl.bump > 0) { var bq = pl.bump / 0.14; bx = Math.sin(bq * Math.PI) * 0.12 * (pl.bumpDir === 'L' ? -1 : 1); sx *= 1 + 0.12 * Math.sin(bq * Math.PI); sy *= 1 - 0.1 * Math.sin(bq * Math.PI); }
    if (!s.hop && pl.crouch > 0.01) { sy *= 1 - 0.17 * pl.crouch; sx *= 1 + 0.1 * pl.crouch; } // finger down: wind up
    ctx.save();
    ctx.translate(x + bx * ts, yBase - (h + lift) * ts);
    var cs = CS[kind] || 0.8, lean = 0, loonRoll = 0;
    if (kind === 'loon' && hp >= 0) loonRoll = Math.sin(hp * Math.PI * 2) * 0.22;
    if (hp >= 0 && kind !== 'loon') lean = (s.hop.dir === 'F' ? -0.06 : s.hop.dir === 'B' ? 0.06 : 0) * Math.sin(hp * Math.PI);
    ctx.rotate(lean + loonRoll);
    ctx.scale(ts * cs * pl.facing * sx, ts * cs * sy);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (s.invuln > 0 && Math.floor(G.time * 16) % 2) ctx.globalAlpha = 0.45;
    Art.critter(ctx, kind, { t: t, hop: hp });
    ctx.restore();
    // ripple rings and popups live in screen layer below
  }

  function drawDeadPlayer(dd, kind, d, ts, x, yBase) {
    var t = dd.t, cs = CS[kind] || 0.8, s = G.sim;
    if (dd.cause === 'car' || dd.cause === 'train') {
      var px = x, e = Math.min(1, t / 0.12), bounce = t < 0.12 ? 0 : Math.max(0, Math.sin((t - 0.12) * 14) * 0.08 * Math.exp(-(t - 0.12) * 5));
      if (dd.cause === 'train') {
        var L = G.world.lane(dd.row), tx = MG.trainX(L, s.t);
        if (tx !== null) { px = xAt(tx + L.dir * (MG.TRAIN_LEN * 0.5 + 0.1), d); }
        else px = xAt(dd.hx + L.dir * 40 * t, d);
      }
      var sy = 1 - 0.7 * ease(e) + bounce, sx = 1 + 0.42 * ease(e); // a pancake you can still recognise
      ctx.save(); ctx.translate(px, yBase); ctx.scale(ts * cs * pl.facing * sx, ts * cs * sy);
      Art.critter(ctx, kind, { t: dd.t * 0.2, hop: -1 }); ctx.restore();
      // stars orbit
      if (t > 0.1) { // dizzy stars keep circling while the card is up
        for (var i = 0; i < 3; i++) {
          var a = t * 7 + i * 2.1, sx2 = px + Math.cos(a) * ts * 0.4, sy2 = yBase - ts * 0.35 + Math.sin(a) * ts * 0.1;
          starShape(sx2, sy2, ts * 0.1, '#ffe36a');
        }
      }
    } else if (dd.cause === 'frozen') {
      var shiver = Math.sin(t * 60) * 0.015 * Math.max(0, 1 - t * 1.2);
      ctx.save(); ctx.translate(x + shiver * ts, yBase); ctx.scale(ts * cs * pl.facing, ts * cs);
      Art.critter(ctx, kind, { t: 0, hop: -1 });
      ctx.restore();
      var grow = Math.min(1, t / 0.35);
      ctx.save(); ctx.translate(x, yBase); ctx.scale(ts * 0.9 * grow, ts * 0.9 * grow);
      Art.rr(ctx, -0.6, -1.15, 1.2, 1.2, 0.22); ctx.fillStyle = 'rgba(190,235,255,.6)'; ctx.fill(); ctx.lineWidth = 0.07; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.stroke();
      Art.limb(ctx, -0.4, -0.95, -0.2, -0.78, 0.05, 'rgba(255,255,255,.85)'); Art.limb(ctx, 0.3, -0.3, 0.5, -0.52, 0.05, 'rgba(255,255,255,.75)');
      ctx.restore();
    } else { // drown / swept
      var sink = Math.min(1, t / 0.5);
      ctx.save(); ctx.beginPath(); ctx.rect(x - ts * 2, yBase - ts * 3, ts * 4, ts * 3 + ts * 0.05); ctx.clip();
      ctx.translate(x, yBase + sink * ts * 0.9); ctx.rotate(sink * 0.5 * pl.facing); ctx.scale(ts * cs * pl.facing, ts * cs);
      Art.critter(ctx, kind, { t: dd.t, hop: -1 }); ctx.restore();
      if (t < 1.2) for (var j = 0; j < 4; j++) { var bt = (t * 1.4 + j * 0.25) % 1; ctx.fillStyle = 'rgba(255,255,255,' + (0.7 * (1 - bt)) + ')'; ctx.beginPath(); ctx.arc(x + Math.sin(j * 2 + bt * 6) * ts * 0.25, yBase - bt * ts * 0.8, ts * (0.04 + 0.03 * j * 0.3), 0, 6.3); ctx.fill(); }
    }
  }
  function starShape(x, y, r, col) {
    ctx.fillStyle = col; ctx.strokeStyle = '#8a5a05'; ctx.lineWidth = 1; ctx.beginPath();
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // ------------------------------------------------------------ overlays drawn in screen space
  function drawFx() {
    var s = G.sim, i;
    // sidestep lesson: big pulsing arrows either side of the critter
    if (G.mode === 'play' && hintStage === 2 && !s.hop) {
      var dA = s.rowf() - cam.row, tA = S * sc(dA), xA = xAt(s.xf(), dA), yA = yAt(dA - 0.2) - tA * 0.45, pu = 0.5 + 0.5 * Math.sin(G.time * 7);
      [-1, 1].forEach(function (sd) {
        var ax = xA + sd * tA * (0.95 + 0.12 * pu);
        ctx.save(); ctx.translate(ax, yA); ctx.scale(sd, 1); ctx.globalAlpha = 0.75 + 0.25 * pu;
        ctx.beginPath(); ctx.moveTo(tA * 0.32, 0); ctx.lineTo(0, -tA * 0.26); ctx.lineTo(0, -tA * 0.11); ctx.lineTo(-tA * 0.2, -tA * 0.11); ctx.lineTo(-tA * 0.2, tA * 0.11); ctx.lineTo(0, tA * 0.11); ctx.lineTo(0, tA * 0.26); ctx.closePath();
        ctx.fillStyle = '#fff6dc'; ctx.fill(); ctx.lineWidth = Math.max(2, tA * 0.06); ctx.lineJoin = 'round'; ctx.strokeStyle = '#3a2412'; ctx.stroke();
        ctx.restore();
      });
    }
    for (i = 0; i < rings.length; i++) {
      var rg = rings[i], d = rg.r - cam.row, ts = S * sc(d), k = rg.t / 0.6;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.8 * (1 - k)) + ')'; ctx.lineWidth = Math.max(1.5, ts * 0.05);
      ctx.beginPath(); ctx.ellipse(xAt(rg.x, d), yAt(d - 0.2), ts * (0.2 + k * 0.7), ts * (0.07 + k * 0.22), 0, 0, 6.3); ctx.stroke();
    }
    for (i = 0; i < parts.length; i++) {
      var p = parts[i], dd = p.r - cam.row, ts2 = S * sc(dd), px = xAt(p.x, dd), py = yAt(dd - 0.2) - p.h * ts2, a = Math.min(1, p.life / (p.max * 0.5));
      ctx.globalAlpha = a;
      if (p.k === 1) { ctx.fillStyle = p.col; ctx.save(); ctx.translate(px, py); ctx.rotate(p.rot || 0); Art.leafPath(ctx, p.sz * ts2 * 1.4); ctx.fill(); ctx.restore(); }
      else if (p.k === 2) { starShape(px, py, p.sz * ts2 * 1.6, p.col); }
      else { ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(px, py, p.sz * ts2 * (0.6 + 0.4 * (p.life / p.max)), 0, 6.3); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (i = 0; i < pops.length; i++) {
      var q = pops[i], dq = q.r - cam.row, tq = S * sc(dq), qx = xAt(q.x, dq), qy = yAt(dq - 0.2) - q.h * tq, al = Math.min(1, q.life / (q.max * 0.45)), sca = 1 + (1 - Math.min(1, (q.max - q.life) * 7)) * 0.5;
      ctx.globalAlpha = al; ctx.font = '700 ' + Math.round(q.size * sca) + 'px Fredoka, sans-serif';
      ctx.lineWidth = 5; ctx.strokeStyle = '#3a2412'; ctx.strokeText(q.text, qx, qy); ctx.fillStyle = q.col; ctx.fillText(q.text, qx, qy); ctx.globalAlpha = 1;
    }
    // edge-of-world warning while a log or floe is carrying you toward the bank
    if (G.mode === 'play' && s.ride) {
      var dl = s.x + 0.75, dr = (COLS - 0.25) - s.x, nearest = Math.min(dl, dr);
      if (nearest < 2.2) {
        var a2 = (0.25 + 0.2 * Math.sin(G.time * 12)) * (1 - nearest / 2.2) + 0.1, left = dl < dr;
        var eg = ctx.createLinearGradient(left ? 0 : W, 0, left ? W * 0.35 : W * 0.65, 0);
        eg.addColorStop(0, 'rgba(255,60,40,' + a2 * 1.6 + ')'); eg.addColorStop(1, 'rgba(255,60,40,0)');
        ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H);
        ctx.font = '400 ' + Math.round(S * 0.7) + 'px "Luckiest Guy", Impact, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d9442a'; ctx.lineWidth = 5;
        var ex = left ? S * 0.45 : W - S * 0.45; ctx.strokeText('!', ex, H * 0.5); ctx.fillText('!', ex, H * 0.5);
      }
    }
    // comic burst on death
    var dd2 = G.death;
    if (dd2 && dd2.t < 0.8) {
      var tt = dd2.t, sca2 = tt < 0.18 ? 0.2 + 5 * tt : 1.1 - Math.min(0.1, (tt - 0.18) * 0.3), alpha2 = tt > 0.6 ? Math.max(0, 1 - (tt - 0.6) / 0.2) : 1;
      var d3 = dd2.hr - cam.row, bx = xAt(dd2.hx, d3), by = yAt(d3 - 0.2) - S * 1.95;
      ctx.save(); ctx.globalAlpha = alpha2; ctx.translate(bx, by); ctx.scale(sca2, sca2); ctx.rotate(-0.12);
      ctx.beginPath(); for (var k2 = 0; k2 < 20; k2++) { var a = k2 / 20 * 6.2832, rad = k2 % 2 ? S * 0.62 : S * 0.95; ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad * 0.8); }
      ctx.closePath(); var cool = dd2.cause === 'frozen' || dd2.cause === 'drown' || dd2.cause === 'swept';
      ctx.fillStyle = cool ? '#c7ecff' : '#ffe14a'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#3a2412'; ctx.stroke();
      ctx.font = '400 ' + Math.round(S * 0.52) + 'px "Luckiest Guy", Impact, sans-serif'; ctx.fillStyle = cool ? '#2a79b5' : '#d9442a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.strokeText(dd2.word, 0, 2); ctx.fillText(dd2.word, 0, 2); ctx.restore();
    }
  }

  function drawBlizzard() {
    var s = G.sim; if (G.mode === 'title' || s.noFront) return;
    var d = s.front - cam.row + 0.5, yE = yAt(d), t = G.time;
    var gap = s.rowf() - s.front;
    if (yE < H + 80) {
      var top = yE - S * 0.9;
      var g = ctx.createLinearGradient(0, top, 0, yE + S * 1.0);
      g.addColorStop(0, 'rgba(240,248,255,0)'); g.addColorStop(0.55, 'rgba(240,248,255,.88)'); g.addColorStop(1, 'rgba(244,250,255,.98)');
      ctx.fillStyle = g; ctx.fillRect(0, top, W, H - top + 2);
      // billowing puffs along the edge
      for (var i = -1; i < 9; i++) {
        var bx = i * W / 7 + Math.sin(t * 0.9 + i * 1.7) * 18, by = yE - S * 0.1 + Math.sin(t * 1.4 + i * 2.3) * 12, r = S * (0.75 + 0.2 * Math.sin(t + i));
        var rg = ctx.createRadialGradient(bx, by, 0, bx, by, r);
        rg.addColorStop(0, 'rgba(255,255,255,.95)'); rg.addColorStop(0.7, 'rgba(236,246,255,.7)'); rg.addColorStop(1, 'rgba(236,246,255,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(bx, by, r, 0, 6.3); ctx.fill();
      }
      // wind streaks
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (var j = 0; j < 22; j++) {
        var sx = ((j * 97 + t * 420) % (W + 200)) - 100, sy = yE - S * 0.6 + ((j * 53) % 100) / 100 * Math.max(0, H - yE + S * 1.5), len = 40 + (j % 5) * 14;
        if (sy > H) continue; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - len, sy + len * 0.18); ctx.stroke();
      }
    }
    // frost vignette as it closes in
    var amt = clamp(1 - (gap - 0.8) / 3.4, 0, 1);
    if (amt > 0.02) {
      var vg = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.8);
      vg.addColorStop(0, 'rgba(220,240,255,0)'); vg.addColorStop(1, 'rgba(220,240,255,' + (0.55 * amt) + ')');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      if (amt > 0.5 && G.mode === 'play' && Math.floor(t * 3) % 2) { ctx.font = '400 ' + Math.round(S * 0.5) + 'px "Luckiest Guy", Impact, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = '#2a79b5'; ctx.fillStyle = '#fff'; ctx.strokeText('KEEP HOPPING!', W / 2, H * 0.88); ctx.fillText('KEEP HOPPING!', W / 2, H * 0.88); }
    }
  }

  // lighting: a low warm sun from the upper left (cool in winter, fresh in spring) and a soft vignette.
  // Plain alpha blending (no blend modes) and cached gradients, so it stays cheap on mid-range phones.
  var LIGHT = [['rgba(255,214,150,.20)', 'rgba(70,35,10,.20)'], ['rgba(225,238,255,.20)', 'rgba(20,40,70,.18)'], ['rgba(240,255,210,.18)', 'rgba(30,50,20,.16)']];
  var lightCache = { key: '', g: null, v: null };
  function drawLight() {
    var b = MG.biomeOf(Math.max(0, Math.floor(cam.row + 3))), L = LIGHT[b], key = b + ':' + W + 'x' + H;
    if (lightCache.key !== key) {
      var g = ctx.createRadialGradient(W * 0.1, -H * 0.05, 0, W * 0.1, -H * 0.05, H * 0.9);
      g.addColorStop(0, L[0]); g.addColorStop(1, 'rgba(255,255,255,0)');
      var v = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.45, W / 2, H * 0.55, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, L[1]);
      lightCache = { key: key, g: g, v: v };
    }
    ctx.fillStyle = lightCache.g; ctx.fillRect(0, 0, W, H * 0.9);
    ctx.fillStyle = lightCache.v; ctx.fillRect(0, 0, W, H);
  }
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var sh = G.shake;
    ctx.save();
    if (sh > 0.1) ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    var dz = G.death;
    if (dz) { // a quick punch-in on whatever got you
      var zk = 1 + 0.08 * ease(Math.min(1, dz.t / 0.3)), zd = dz.hr - cam.row, zx = xAt(dz.hx, zd), zy = yAt(zd - 0.2) - S * 0.4;
      ctx.translate(zx, zy); ctx.scale(zk, zk); ctx.translate(-zx, -zy);
    }
    drawWorld();
    drawLight();
    drawFx();
    drawAmbient();
    drawBlizzard();
    if (G.death && G.death.cause === 'frozen') { drawPlayerLayer(); }
    ctx.restore();
    if (G.flash > 0) { ctx.fillStyle = 'rgba(255,248,230,' + G.flash * 0.8 + ')'; ctx.fillRect(0, 0, W, H); }
  }

  // ------------------------------------------------------------ main loop
  var lastSizeCheck = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastSizeCheck > 400) { lastSizeCheck = now; maybeRelayout(false); }
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    if (G.mode === 'pause') { render(); return; }
    update(dt);
    render();
  }

  // ------------------------------------------------------------ test hooks
  function nearestGrass(r) {
    for (var i = 0; i < 40; i++) { var L = G.world.lane(r + i); if (L.type === 'grass') { for (var c = 5; c < COLS; c++) if (!L.obs[c]) return { row: r + i, col: c }; for (c = 4; c >= 0; c--) if (!L.obs[c]) return { row: r + i, col: c }; } }
    return { row: r, col: 5 };
  }
  window.__T = {
    start: function (o) { o = o || {}; Snd.unlock(); if (o.seed) { newWorld(o.seed); newSim(0); } startRun(!!o.fresh && !o.seed, !!o.daily); if (o.god) G.god = true; },
    step: function (ms) { var n = Math.ceil(ms / 16.6667); for (var i = 0; i < n; i++) update(1 / 60); render(); },
    state: function () { var s = G.sim; return { mode: G.mode, row: s.row, rowf: s.rowf(), x: s.x, maxRow: s.maxRow, alive: s.alive, cause: s.cause, t: s.t, leaves: save.leaves, runLeaves: G.runLeaves, front: s.front, hops: s.hops, q: s.q.length, biome: MG.biomeOf(s.row), best: save.best, hint: hintStage }; },
    input: inputDir, sim: function () { return G.sim; }, world: function () { return G.world; }, G: G, save: save, cam: cam,
    god: function (v) { G.god = v !== false; },
    noPause: function (v) { G.noPause = v !== false; },
    warp: function (r) { var g = nearestGrass(r), s = G.sim; s.row = g.row; s.maxRow = g.row; s.x = g.col; s.hop = null; s.ride = null; s.q.length = 0; s.front = g.row - 6; cam.row = g.row; cam.tgtRow = g.row; cam.x = g.col; G.scoreShown = -1; updateHud(true); return g; },
    giveLeaves: function (n) { save.leaves += n; persist(); updateHud(false); },
    resetSave: function () { try { localStorage.removeItem(KEY); } catch (e) { /* */ } },
    setPick: function (k) { save.pick = k; if (save.owned.indexOf(k) < 0) save.owned.push(k); },
    shopOpen: openShop, toTitle: toTitle, retry: retry, pause: pauseGame, resume: resumeGame,
    bot: function (n) { return botRun(n); }
  };

  // a tiny autoplayer used for quick tests (not a real player)
  function botRun(secs) {
    var s = G.sim, steps = Math.round(secs * 60), f = 0;
    for (var i = 0; i < steps && s.alive; i++) {
      if (i % 4 === 0) s.push('F');
      update(1 / 60); f++;
    }
    return { frames: f, alive: s.alive, maxRow: s.maxRow };
  }

  // ------------------------------------------------------------ boot
  Art.loadAssets();
  newWorld((Math.random() * 4e9) >>> 0); newSim(0);
  toTitle();
  updateHud(true);
  requestAnimationFrame(function (n) { last = n; frame(n); });
})();
