/* Moose Crossing — code-drawn art (stand-ins for painted art). Everything is drawn in "tile units"
   (1 = one column), origin at the thing's feet, y up is negative. Sprites are cached to offscreen canvases.
   ASSETS: key -> PNG path. If a PNG is listed it replaces the code-drawn sprite (see IMAGE-PROMPTS.md). */
(function () {
  'use strict';
  var U = 96; // sprite pixels per tile

  var ASSETS = { /* e.g. 'tree.autumn.0': { src: 'art/tree-autumn-0.png', ax: 0.5, ay: 1, w: 1.4, h: 2.1 } */ };

  // ---------- palettes: autumn, snow, spring mud ----------
  var PAL = [
    { name: 'Autumn', g1: '#a6b64a', g2: '#9aab42', face: '#6a4a2c', face2: '#52371f', road: '#5b626d', road2: '#555c67', edge: '#454b55', line: '#efe6c9',
      w1: '#58a8bf', w2: '#3f8aa6', wdeep: '#2b6c8a', ripple: 'rgba(255,255,255,.28)', bank: '#7a5a38', sky0: '#f7cf94', sky1: '#fbe8c8', mtn: '#c99a78', mtn2: '#dcb394',
      fog: 'rgba(251,232,200,', tint: '#3a2412', rail: '#6d5b49', ballast: '#8e8374', ink: '#2e2016', amb: 'leaf' },
    { name: 'Snowfall', g1: '#eef5f9', g2: '#e1edf4', face: '#a9bdce', face2: '#8ea6ba', road: '#6c7685', road2: '#656f7e', edge: '#f5fafc', line: '#f7fbff',
      w1: '#3f86ac', w2: '#2e6f96', wdeep: '#1e5478', ripple: 'rgba(255,255,255,.3)', bank: '#c9d9e6', sky0: '#bcd3e6', sky1: '#eef5fa', mtn: '#9db6cc', mtn2: '#bfd1e0',
      fog: 'rgba(238,245,250,', tint: '#1d3350', rail: '#6c7787', ballast: '#c9d3dd', ink: '#1e2c40', amb: 'snow' },
    { name: 'Mud Season', g1: '#82c05c', g2: '#76b552', face: '#6b4e33', face2: '#523b26', road: '#596270', road2: '#535b69', edge: '#424955', line: '#e9eadb',
      w1: '#6aa5a3', w2: '#528e92', wdeep: '#3c7378', ripple: 'rgba(255,255,255,.26)', bank: '#7d5c3b', sky0: '#c6e2ec', sky1: '#ecf6f0', mtn: '#8fb49b', mtn2: '#b2cdb9',
      fog: 'rgba(236,246,240,', tint: '#2a3a2a', rail: '#6a5b4b', ballast: '#8f8576', ink: '#27301f', amb: 'rain' }
  ];

  // ---------- tiny drawing helpers ----------
  function rr(c, x, y, w, h, r) { // rounded rect path
    r = Math.min(r, w / 2, h / 2);
    c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }
  function ell(c, x, y, rx, ry, rot, fill, stroke, lw) {
    c.beginPath(); c.ellipse(x, y, Math.max(0.001, rx), Math.max(0.001, ry), rot || 0, 0, 6.2832);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.lineWidth = lw || 0.04; c.strokeStyle = stroke; c.stroke(); }
  }
  function lin(c, x0, y0, x1, y1, stops) {
    var g = c.createLinearGradient(x0, y0, x1, y1);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  }
  function rad(c, x, y, r0, r1, stops, x1, y1) {
    var g = c.createRadialGradient(x, y, r0, x1 === undefined ? x : x1, y1 === undefined ? y : y1, r1);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  }
  function shadow(c, rx, ry, a) { ell(c, 0.04, 0.03, rx, ry, 0, 'rgba(30,20,10,' + (a || 0.26) + ')'); }
  function shade(hex, k) { // k<0 darker, k>0 lighter
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function f(v) { return Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))); }
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }
  function limb(c, x0, y0, x1, y1, w, col) {
    c.lineCap = 'round'; c.lineWidth = w; c.strokeStyle = col; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
  function poly(c, pts, fill, stroke, lw) {
    c.beginPath(); c.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.lineWidth = lw || 0.04; c.lineJoin = 'round'; c.strokeStyle = stroke; c.stroke(); }
  }
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  // ---------- sprite cache ----------
  var cache = {};
  // makes a canvas covering [-ax .. w-ax] x [-ay .. h-ay] tile units; draw(ctx) works in tile units
  function sprite(key, w, h, ax, ay, draw) {
    var s = cache[key];
    if (s) return s;
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(w * U); cv.height = Math.ceil(h * U);
    var c = cv.getContext('2d');
    c.scale(U, U); c.translate(ax, ay);
    c.lineJoin = 'round'; c.lineCap = 'round';
    var asset = ASSETS[key];
    if (asset && asset.img && asset.img.complete && asset.img.naturalWidth) {
      s = { cv: asset.img, w: asset.w || w, h: asset.h || h, ax: asset.ax !== undefined ? asset.ax : ax, ay: asset.ay !== undefined ? asset.ay : ay, png: true };
    } else {
      draw(c);
      s = { cv: cv, w: w, h: h, ax: ax, ay: ay };
    }
    cache[key] = s;
    return s;
  }
  function loadAssets() {
    Object.keys(ASSETS).forEach(function (k) {
      var a = ASSETS[k]; if (a.img) return;
      a.img = new Image(); a.img.onload = function () { delete cache[k]; }; a.img.src = a.src;
    });
  }

  // ---------- scenery ----------
  function blobs(c, circles, fills, ink, lw) {
    var i, b;
    for (i = 0; i < circles.length; i++) { b = circles[i]; ell(c, b[0], b[1], b[2], b[3] || b[2], 0, ink, ink, lw); }
    for (i = 0; i < circles.length; i++) {
      b = circles[i];
      ell(c, b[0], b[1], b[2], b[3] || b[2], 0, rad(c, b[0] - b[2] * 0.35, b[1] - b[2] * 0.4, 0.02, b[2] * 1.25, fills));
    }
  }
  function treeSprite(biome, v) {
    return sprite('tree.' + biome + '.' + v, 1.7, 2.7, 0.85, 2.55, function (c) {
      var ink = PAL[biome].ink;
      shadow(c, 0.5, 0.17, 0.28);
      if (biome === 0) {
        if (v === 2) { conifer(c, '#3b7a4c', '#2a5a38', ink, false); return; }
        var cols = v === 0 ? [['#f6b24a', '#e9822b'], ['#ee8d33', '#c9552a']] : [['#ea6a3a', '#bd3b27'], ['#f09a45', '#d1642b']];
        trunk(c, '#6e4a2c', 0.11, 0.8, ink);
        var A = cols[0], B = cols[1];
        var f1 = [[0, A[0]], [1, A[1]]], f2 = [[0, B[0]], [1, B[1]]];
        blobs(c, [[-0.34, -1.2, 0.42], [0.36, -1.22, 0.44], [0, -1.62, 0.52], [-0.18, -2.0, 0.38], [0.24, -1.98, 0.4], [0, -1.15, 0.5]], f1, ink, 0.07);
        blobs(c, [[0.12, -1.4, 0.2], [-0.25, -1.75, 0.16]], f2, 'rgba(0,0,0,0)', 0.001);
        for (var i = 0; i < 14; i++) ell(c, -0.6 + hash(i + v * 9) * 1.2, -2.3 + hash(i * 3 + 1) * 1.3, 0.05, 0.03, hash(i) * 3, 'rgba(255,230,150,.7)');
      } else if (biome === 1) {
        if (v === 2) { bare(c, ink); return; }
        conifer(c, v === 0 ? '#2f6a55' : '#33705b', '#1f4a3c', ink, true);
      } else {
        if (v === 2) { birch(c, ink); return; }
        trunk(c, '#6a4a2d', 0.1, 0.8, ink);
        var g = v === 0 ? [['#a6e07a', '#58b04a']] : [['#f7c1d2', '#e58bab']];
        var fl = [[0, g[0][0]], [1, g[0][1]]];
        blobs(c, [[-0.32, -1.2, 0.4], [0.34, -1.22, 0.42], [0, -1.62, 0.5], [-0.15, -2.0, 0.36], [0.22, -1.98, 0.38], [0, -1.15, 0.48]], fl, ink, 0.07);
        for (var j = 0; j < 10; j++) ell(c, -0.5 + hash(j + 4) * 1.0, -2.1 + hash(j * 5) * 1.0, 0.06, 0.04, 0, v === 0 ? 'rgba(220,255,170,.7)' : 'rgba(255,255,255,.6)');
      }
    });
  }
  function trunk(c, col, w, h, ink) {
    poly(c, [-w * 1.1, 0, -w * 0.7, -h, w * 0.7, -h, w * 1.1, 0], lin(c, -w, 0, w, 0, [[0, shade(col, 0.15)], [1, shade(col, -0.25)]]), ink, 0.05);
  }
  function conifer(c, col, dark, ink, snow) {
    trunk(c, '#5a3e27', 0.1, 0.4, ink);
    var tiers = [[0, -0.3, 0.62, 0.72], [0, -0.82, 0.52, 0.66], [0, -1.32, 0.4, 0.62], [0, -1.78, 0.26, 0.5]];
    tiers.forEach(function (t, i) {
      var x = t[0], y = t[1], hw = t[2], h = t[3];
      c.beginPath(); c.moveTo(x, y - h); c.quadraticCurveTo(x + hw * 0.5, y - h * 0.4, x + hw, y); c.quadraticCurveTo(x, y + 0.14, x - hw, y); c.quadraticCurveTo(x - hw * 0.5, y - h * 0.4, x, y - h); c.closePath();
      c.fillStyle = lin(c, x - hw, y - h, x + hw, y, [[0, shade(col, 0.18)], [0.5, col], [1, dark]]); c.fill();
      c.lineWidth = 0.06; c.strokeStyle = ink; c.stroke();
      if (snow) {
        c.beginPath(); c.moveTo(x, y - h); c.quadraticCurveTo(x + hw * 0.4, y - h * 0.55, x + hw * 0.62, y - h * 0.3);
        c.quadraticCurveTo(x + hw * 0.35, y - h * 0.4, x + hw * 0.18, y - h * 0.22); c.quadraticCurveTo(x, y - h * 0.38, x - hw * 0.2, y - h * 0.2);
        c.quadraticCurveTo(x - hw * 0.4, y - h * 0.42, x - hw * 0.62, y - h * 0.3); c.quadraticCurveTo(x - hw * 0.4, y - h * 0.55, x, y - h); c.closePath();
        c.fillStyle = '#fbfeff'; c.fill();
      }
    });
  }
  function bare(c, ink) {
    c.strokeStyle = ink; c.lineCap = 'round';
    function br(x0, y0, x1, y1, w) { c.lineWidth = w + 0.07; c.strokeStyle = ink; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.lineWidth = w; c.strokeStyle = '#8b7a6a'; c.stroke(); }
    br(0, 0, 0.02, -1.3, 0.14); br(0.02, -1.3, -0.5, -2.0, 0.08); br(0.02, -1.2, 0.5, -1.9, 0.08); br(-0.1, -1.7, -0.1, -2.4, 0.06); br(0.2, -1.6, 0.55, -2.2, 0.05); br(-0.25, -1.55, -0.62, -1.75, 0.05);
    ell(c, -0.5, -2.05, 0.2, 0.07, 0.4, '#fbfeff'); ell(c, 0.5, -1.95, 0.2, 0.07, -0.4, '#fbfeff'); ell(c, 0, -1.5, 0.22, 0.06, 0, '#fbfeff');
  }
  function birch(c, ink) {
    poly(c, [-0.09, 0, -0.07, -1.9, 0.07, -1.9, 0.09, 0], lin(c, -0.09, 0, 0.09, 0, [[0, '#ffffff'], [1, '#cfd6d2']]), ink, 0.05);
    for (var i = 0; i < 6; i++) ell(c, 0, -0.3 - i * 0.28, 0.05, 0.02, 0, '#37332d');
    blobs(c, [[-0.2, -2.0, 0.34], [0.22, -2.05, 0.34], [0, -2.35, 0.36], [0, -1.8, 0.32]], [[0, '#b6ea8a'], [1, '#69bb52']], ink, 0.06);
  }
  function rockSprite(biome, v) {
    return sprite('rock.' + biome + '.' + v, 1.4, 1.1, 0.7, 1.0, function (c) {
      var ink = PAL[biome].ink; shadow(c, 0.5, 0.15, 0.28);
      var base = biome === 1 ? '#a9b3bf' : biome === 2 ? '#8c9484' : '#9a948a';
      var pts = v === 0 ? [-0.5, 0, -0.55, -0.3, -0.25, -0.62, 0.2, -0.66, 0.52, -0.34, 0.5, 0] : v === 1 ? [-0.55, 0, -0.45, -0.38, -0.1, -0.5, 0.15, -0.72, 0.5, -0.4, 0.55, 0] : [-0.45, 0, -0.5, -0.4, -0.2, -0.6, 0.3, -0.55, 0.55, -0.25, 0.5, 0];
      c.beginPath(); c.moveTo(pts[0], pts[1]);
      for (var i = 2; i < pts.length; i += 2) { var nx = pts[(i + 2) % pts.length], ny = pts[(i + 3) % pts.length]; c.quadraticCurveTo(pts[i], pts[i + 1], (pts[i] + nx) / 2, (pts[i + 1] + ny) / 2); }
      c.quadraticCurveTo(pts[0], pts[1], (pts[0] + pts[pts.length - 2]) / 2, (pts[1] + pts[pts.length - 1]) / 2); c.closePath();
      c.fillStyle = lin(c, -0.5, -0.7, 0.5, 0, [[0, shade(base, 0.35)], [0.5, base], [1, shade(base, -0.3)]]); c.fill();
      c.lineWidth = 0.06; c.strokeStyle = ink; c.stroke();
      limb(c, -0.1, -0.3, 0.1, -0.1, 0.03, 'rgba(0,0,0,.2)'); limb(c, 0.2, -0.45, 0.3, -0.28, 0.025, 'rgba(0,0,0,.18)');
      if (biome === 1) { c.beginPath(); c.moveTo(-0.45, -0.34); c.quadraticCurveTo(-0.2, -0.78, 0.3, -0.68); c.quadraticCurveTo(0.5, -0.56, 0.4, -0.42); c.quadraticCurveTo(0.1, -0.5, -0.1, -0.4); c.quadraticCurveTo(-0.25, -0.5, -0.45, -0.34); c.fillStyle = '#fbfeff'; c.fill(); }
      if (biome === 2) { ell(c, -0.25, -0.5, 0.2, 0.08, -0.2, '#5fa047'); ell(c, 0.15, -0.62, 0.13, 0.05, 0.2, '#74b857'); }
    });
  }

  // ---------- vehicles (drawn facing right, centred on the ground, length in tiles) ----------
  function carSprite(kind, len, color, variant, biome) {
    var key = 'veh.' + kind + '.' + color + '.' + variant;
    var W = len + 0.5;
    return sprite(key, W, 1.5, W / 2, 1.2, function (c) { drawCar(c, kind, len, color, variant); });
  }
  function drawCar(c, kind, len, color, variant) {
    var ink = '#26201c', h = len / 2;
    shadow(c, h + 0.08, 0.17, 0.3);
    var wheels = kind === 'hatch' ? [-h + 0.27, h - 0.27] : [-h + 0.3, h - 0.3];
    // body
    var bodyG = lin(c, 0, -0.62, 0, -0.1, [[0, shade(color, 0.28)], [0.5, color], [1, shade(color, -0.3)]]);
    rr(c, -h, -0.52, len, 0.4, 0.12); c.fillStyle = bodyG; c.fill(); c.lineWidth = 0.055; c.strokeStyle = ink; c.stroke();
    // cabin
    var rb = kind === 'wagon' ? -h + 0.06 : -h + 0.13, rf = h - 0.34;
    var top = -0.86;
    c.beginPath(); c.moveTo(rb, -0.5); c.lineTo(rb + 0.12, top + 0.06); c.quadraticCurveTo(rb + 0.15, top, rb + 0.25, top); c.lineTo(rf - 0.12, top); c.quadraticCurveTo(rf, top, rf + 0.06, top + 0.1); c.lineTo(rf + 0.3, -0.5); c.closePath();
    c.fillStyle = lin(c, 0, top, 0, -0.5, [[0, shade(color, 0.35)], [1, shade(color, -0.05)]]); c.fill(); c.lineWidth = 0.055; c.strokeStyle = ink; c.stroke();
    // window with driver
    var wx0 = rb + 0.2, wx1 = rf + 0.2;
    c.beginPath(); c.moveTo(wx0 - 0.02, -0.54); c.lineTo(wx0 + 0.07, top + 0.1); c.quadraticCurveTo(wx0 + 0.1, top + 0.06, wx0 + 0.18, top + 0.06); c.lineTo(wx1 - 0.14, top + 0.06); c.quadraticCurveTo(wx1 - 0.04, top + 0.06, wx1, top + 0.13); c.lineTo(wx1 + 0.12, -0.54); c.closePath();
    c.fillStyle = lin(c, 0, top, 0, -0.5, [[0, '#d8f1fb'], [1, '#7fb6cf']]); c.fill(); c.lineWidth = 0.03; c.strokeStyle = ink; c.stroke();
    var hx = wx1 - 0.18;
    ell(c, hx, -0.7, 0.07, 0.075, 0, ['#f1c9a0', '#c98f66', '#f4d7b8'][variant % 3]); // driver head
    c.beginPath(); c.arc(hx, -0.73, 0.075, Math.PI, 0); c.fillStyle = ['#3b2a22', '#d9573a', '#2f6f9f'][variant % 3]; c.fill();
    if (kind === 'wagon') limb(c, (wx0 + wx1) / 2 - 0.05, -0.54, (wx0 + wx1) / 2 - 0.02, top + 0.08, 0.035, color);
    // roof extras
    if (variant === 1) { rr(c, -h * 0.45, top - 0.14, len * 0.7, 0.1, 0.05); c.fillStyle = '#ff8a2a'; c.fill(); c.lineWidth = 0.035; c.strokeStyle = ink; c.stroke(); limb(c, -h * 0.2, top - 0.09, -h * 0.2, top, 0.03, ink); limb(c, h * 0.2, top - 0.09, h * 0.2, top, 0.03, ink); }
    if (variant === 2 && kind === 'wagon') { rr(c, -h * 0.5, top - 0.07, len * 0.8, 0.05, 0.02); c.fillStyle = '#3a3f46'; c.fill(); }
    // lights, bumper
    rr(c, h - 0.1, -0.44, 0.1, 0.1, 0.04); c.fillStyle = '#fff3b0'; c.fill(); c.lineWidth = 0.03; c.strokeStyle = ink; c.stroke();
    rr(c, -h, -0.44, 0.07, 0.1, 0.03); c.fillStyle = '#e03b3b'; c.fill();
    rr(c, -h + 0.02, -0.2, len - 0.04, 0.06, 0.03); c.fillStyle = 'rgba(0,0,0,.28)'; c.fill();
    limb(c, -h + 0.16, -0.34, h - 0.2, -0.34, 0.02, 'rgba(255,255,255,.35)');
    wheels.forEach(function (wx) { ell(c, wx, -0.14, 0.15, 0.15, 0, '#1d1b1a', ink, 0.03); ell(c, wx, -0.14, 0.07, 0.07, 0, '#b9bec6'); });
  }
  function plowSprite() {
    var len = 2.4, W = len + 0.7;
    return sprite('veh.plow', W, 1.9, W / 2 + 0.05, 1.55, function (c) {
      var ink = '#26201c', h = len / 2; shadow(c, h + 0.2, 0.2, 0.3);
      // box with salt spreader
      rr(c, -h, -0.9, 1.2, 0.62, 0.08); c.fillStyle = lin(c, 0, -0.9, 0, -0.28, [[0, '#ffc43a'], [1, '#d98a10']]); c.fill(); c.lineWidth = 0.06; c.strokeStyle = ink; c.stroke();
      for (var i = 0; i < 4; i++) limb(c, -h + 0.18 + i * 0.28, -0.84, -h + 0.18 + i * 0.28, -0.34, 0.03, 'rgba(120,60,0,.35)');
      poly(c, [-h + 0.1, -0.9, h * 0 - 0.2, -0.9, -0.3, -1.05, -h + 0.25, -1.05], '#d0d6dc', ink, 0.04);
      // cab
      c.beginPath(); c.moveTo(0.1, -0.28); c.lineTo(0.1, -1.18); c.quadraticCurveTo(0.1, -1.28, 0.2, -1.28); c.lineTo(0.62, -1.28); c.quadraticCurveTo(0.74, -1.26, 0.8, -1.12); c.lineTo(0.95, -0.7); c.lineTo(1.1, -0.66); c.lineTo(1.1, -0.28); c.closePath();
      c.fillStyle = lin(c, 0, -1.28, 0, -0.28, [[0, '#ffd45a'], [1, '#e19211']]); c.fill(); c.lineWidth = 0.06; c.strokeStyle = ink; c.stroke();
      c.beginPath(); c.moveTo(0.3, -0.72); c.lineTo(0.3, -1.12); c.quadraticCurveTo(0.3, -1.18, 0.38, -1.18); c.lineTo(0.62, -1.18); c.quadraticCurveTo(0.7, -1.16, 0.74, -1.06); c.lineTo(0.84, -0.78); c.lineTo(0.82, -0.72); c.closePath();
      c.fillStyle = lin(c, 0, -1.18, 0, -0.72, [[0, '#d8f1fb'], [1, '#7fb6cf']]); c.fill(); c.lineWidth = 0.035; c.strokeStyle = ink; c.stroke();
      ell(c, 0.5, -0.92, 0.09, 0.1, 0, '#f1c9a0'); c.beginPath(); c.arc(0.5, -0.95, 0.1, Math.PI, 0); c.fillStyle = '#d9573a'; c.fill();
      rr(c, 0.38, -1.4, 0.2, 0.1, 0.04); c.fillStyle = '#ffb21f'; c.fill(); c.lineWidth = 0.035; c.strokeStyle = ink; c.stroke(); // beacon base
      // blade
      c.beginPath(); c.moveTo(h + 0.05, -0.2); c.lineTo(h + 0.2, -0.95); c.quadraticCurveTo(h + 0.24, -1.0, h + 0.3, -0.94); c.lineTo(h + 0.38, -0.2); c.quadraticCurveTo(h + 0.2, -0.1, h + 0.05, -0.2); c.closePath();
      c.fillStyle = lin(c, h, 0, h + 0.4, 0, [[0, '#ffda5c'], [1, '#e8a017']]); c.fill(); c.lineWidth = 0.06; c.strokeStyle = ink; c.stroke();
      for (var j = 0; j < 4; j++) poly(c, [h + 0.07 + j * 0.0, -0.3 - j * 0.16, h + 0.31 + j * 0.01, -0.3 - j * 0.16, h + 0.3 + j * 0.01, -0.4 - j * 0.16, h + 0.08, -0.4 - j * 0.16], j % 2 ? '#26201c' : 'rgba(0,0,0,0)');
      limb(c, h - 0.1, -0.3, h + 0.08, -0.3, 0.07, '#4a4f58');
      rr(c, h - 0.04, -0.52, 0.1, 0.1, 0.03); c.fillStyle = '#fff3b0'; c.fill();
      [-0.72, -0.1, 0.78].forEach(function (wx) { ell(c, wx, -0.2, 0.22, 0.22, 0, '#1d1b1a', ink, 0.035); ell(c, wx, -0.2, 0.1, 0.1, 0, '#c4c9d0'); });
    });
  }
  function busSprite(color) {
    var len = 3.2, W = len + 0.5;
    return sprite('veh.bus.' + color, W, 1.7, W / 2, 1.4, function (c) {
      var ink = '#26201c', h = len / 2; shadow(c, h + 0.05, 0.19, 0.3);
      var base = color, trim = '#3f8a57';
      rr(c, -h, -1.12, len, 0.98, 0.2); c.fillStyle = lin(c, 0, -1.12, 0, -0.14, [[0, shade(base, 0.2)], [0.6, base], [1, shade(base, -0.22)]]); c.fill(); c.lineWidth = 0.06; c.strokeStyle = ink; c.stroke();
      c.save(); rr(c, -h, -1.12, len, 0.98, 0.2); c.clip(); rr(c, -h, -0.46, len, 0.14, 0); c.fillStyle = trim; c.fill(); c.fillStyle = '#e2603a'; c.fillRect(-h, -0.32, len, 0.06); c.restore();
      // windows with sightseers
      var n = 6, ww = (len - 0.9) / n;
      for (var i = 0; i < n; i++) {
        var x = -h + 0.12 + i * (ww + 0.02);
        rr(c, x, -1.0, ww, 0.42, 0.07); c.fillStyle = lin(c, 0, -1.0, 0, -0.58, [[0, '#e0f4fb'], [1, '#86bbd2']]); c.fill(); c.lineWidth = 0.03; c.strokeStyle = ink; c.stroke();
        var hx = x + ww / 2, skin = ['#f1c9a0', '#c98f66', '#f4d7b8', '#9a6a48'][i % 4];
        ell(c, hx, -0.74, 0.075, 0.08, 0, skin); c.beginPath(); c.arc(hx, -0.76, 0.08, Math.PI, 0); c.fillStyle = ['#d9573a', '#2f6f9f', '#f2b134', '#6a8f4e', '#7b5ea7', '#e8e2d0'][i % 6]; c.fill();
        if (i === 2) { rr(c, hx + 0.03, -0.74, 0.07, 0.05, 0.01); c.fillStyle = '#222'; c.fill(); }
      }
      // windscreen & door
      c.beginPath(); c.moveTo(h - 0.78, -1.0); c.lineTo(h - 0.1, -1.0); c.quadraticCurveTo(h - 0.02, -1.0, h - 0.02, -0.9); c.lineTo(h - 0.02, -0.58); c.lineTo(h - 0.78, -0.58); c.closePath();
      c.fillStyle = lin(c, 0, -1.0, 0, -0.58, [[0, '#e0f4fb'], [1, '#86bbd2']]); c.fill(); c.lineWidth = 0.03; c.strokeStyle = ink; c.stroke();
      ell(c, h - 0.25, -0.74, 0.07, 0.08, 0, '#f1c9a0'); c.beginPath(); c.arc(h - 0.25, -0.76, 0.08, Math.PI, 0); c.fillStyle = '#3b2a22'; c.fill();
      // sign
      // little maple-leaf emblems on the side (symmetric, so the bus reads the same either way round)
      for (var li = 0; li < 3; li++) { c.save(); c.translate(-0.55 + li * 0.55, -0.25); leafPath(c, 0.1); c.fillStyle = '#e8472a'; c.fill(); c.restore(); }
      rr(c, h - 0.12, -0.5, 0.12, 0.1, 0.03); c.fillStyle = '#fff3b0'; c.fill(); rr(c, -h, -0.5, 0.08, 0.1, 0.03); c.fillStyle = '#e03b3b'; c.fill();
      limb(c, -h + 0.1, -1.18, h - 0.15, -1.18, 0.05, '#555');
      [-h + 0.55, h - 0.62].forEach(function (wx) { ell(c, wx, -0.17, 0.18, 0.18, 0, '#1d1b1a', ink, 0.035); ell(c, wx, -0.17, 0.08, 0.08, 0, '#c4c9d0'); });
    });
  }
  var VEH_BEACON = { plow: { x: 0.48, y: -1.46 } };

  // ---------- river things ----------
  function logSprite(len, v, biome) {
    var lq = Math.round(len * 5) / 5, key = 'log.' + lq + '.' + v + '.' + (biome === 2 ? 1 : 0);
    return sprite(key, lq + 0.8, 1.1, (lq + 0.8) / 2, 0.7, function (c) {
      var h = lq / 2, ink = '#2c1d12', r = 0.27;
      var body = lin(c, 0, -r, 0, r, [[0, '#b98a58'], [0.45, '#8b5e36'], [1, '#5c3b21']]);
      rr(c, -h, -r, lq, 2 * r, 0.2); c.fillStyle = body; c.fill(); c.lineWidth = 0.06; c.strokeStyle = ink; c.stroke();
      for (var i = 0; i < 6; i++) { var y = -r + 0.08 + hash(i + v * 7) * 0.42, x0 = -h + 0.25 + hash(i * 3 + v) * (lq - 0.9); limb(c, x0, y, x0 + 0.2 + hash(i) * 0.3, y + 0.01, 0.025, 'rgba(40,20,8,.35)'); }
      ell(c, -h + 0.02, 0, 0.13, r - 0.01, 0, '#d9b17a', ink, 0.045);
      ell(c, -h + 0.02, 0, 0.07, 0.15, 0, null, 'rgba(90,55,25,.7)', 0.025); ell(c, -h + 0.02, 0, 0.025, 0.06, 0, '#8a5a30');
      ell(c, h - 0.02, 0, 0.12, r - 0.01, 0, '#c99d68', ink, 0.045);
      if (v === 1) { limb(c, -0.2, -r, -0.3, -r - 0.18, 0.07, '#6b4529'); limb(c, 0.5, -r, 0.62, -r - 0.14, 0.06, '#6b4529'); }
      if (v === 2 || biome === 2) { ell(c, 0.3, -r + 0.02, 0.32, 0.08, 0, '#6fae54'); ell(c, -0.6, -r + 0.03, 0.2, 0.06, 0, '#5c9b49'); }
      c.save(); rr(c, -h, -r, lq, 2 * r, 0.2); c.clip(); c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(-h, -r, lq, 0.07); c.restore();
    });
  }
  function floeSprite(len, seed, biome) {
    var lq = Math.round(len * 5) / 5, sd = Math.floor(seed * 4), key = 'floe.' + lq + '.' + sd + '.' + biome;
    return sprite(key, lq + 0.8, 1.2, (lq + 0.8) / 2, 0.75, function (c) {
      var rx = lq / 2, ry = 0.33, ink = '#1d4766', n = 9, pts = [], i;
      for (i = 0; i < n; i++) { var a = i / n * 6.2832, k = 0.86 + hash(i + sd * 13) * 0.2; pts.push([Math.cos(a) * rx * k, Math.sin(a) * ry * k]); }
      function path(oy) {
        c.beginPath();
        for (i = 0; i <= n; i++) { var p = pts[i % n], q = pts[(i + 1) % n], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2 + oy; if (i === 0) c.moveTo(mx, my); else c.quadraticCurveTo(p[0], p[1] + oy, mx, my); }
        c.closePath();
      }
      path(0.12); c.fillStyle = '#86b8d4'; c.fill(); c.lineWidth = 0.05; c.strokeStyle = ink; c.stroke();
      path(0); c.fillStyle = rad(c, -rx * 0.3, -ry * 0.4, 0.05, rx * 1.1, [[0, '#ffffff'], [0.6, '#e1f2fa'], [1, '#b9dbec']]); c.fill(); c.lineWidth = 0.05; c.strokeStyle = ink; c.stroke();
      limb(c, -rx * 0.4, -0.05, -rx * 0.1, 0.06, 0.025, 'rgba(110,160,190,.55)'); limb(c, rx * 0.15, -0.1, rx * 0.4, 0.02, 0.025, 'rgba(110,160,190,.55)'); limb(c, rx * 0.4, 0.02, rx * 0.5, 0.12, 0.02, 'rgba(110,160,190,.5)');
      ell(c, -rx * 0.35, -ry * 0.45, 0.22, 0.07, 0.1, 'rgba(255,255,255,.9)');
    });
  }

  // ---------- pickups, signs, rail bits ----------
  function leafPath(c, s) {
    var p = [0, -1, 0.14, -0.62, 0.38, -0.72, 0.3, -0.3, 0.7, -0.38, 0.55, -0.1, 0.9, 0.05, 0.5, 0.2, 0.55, 0.48, 0.12, 0.38, 0.06, 0.62, 0.0, 1.0, -0.06, 0.62, -0.12, 0.38, -0.55, 0.48, -0.5, 0.2, -0.9, 0.05, -0.55, -0.1, -0.7, -0.38, -0.3, -0.3, -0.38, -0.72, -0.14, -0.62];
    c.beginPath(); c.moveTo(p[0] * s, p[1] * s);
    for (var i = 2; i < p.length; i += 2) c.lineTo(p[i] * s, p[i + 1] * s);
    c.closePath();
  }
  function leafSprite(gold) {
    return sprite('leaf.' + (gold ? 'gold' : 'red'), 1, 1, 0.5, 0.95, function (c) {
      c.translate(0, -0.45);
      leafPath(c, 0.4);
      c.fillStyle = gold ? lin(c, 0, -0.4, 0, 0.4, [[0, '#fff2a0'], [0.5, '#ffc933'], [1, '#e8930c']]) : lin(c, 0, -0.4, 0, 0.4, [[0, '#ff9a3c'], [0.5, '#e8472a'], [1, '#b02a1c']]);
      c.fill(); c.lineWidth = 0.05; c.strokeStyle = gold ? '#7a4a05' : '#5c1a10'; c.stroke();
      limb(c, 0, -0.3, 0, 0.42, 0.025, 'rgba(255,255,255,.5)'); limb(c, 0, 0.1, 0.22, -0.08, 0.02, 'rgba(255,255,255,.4)'); limb(c, 0, 0.1, -0.22, -0.08, 0.02, 'rgba(255,255,255,.4)');
      limb(c, 0, 0.4, 0, 0.55, 0.045, gold ? '#7a4a05' : '#5c1a10');
    });
  }
  function signSprite(n) {
    return sprite('sign.' + n, 1.5, 1.6, 0.75, 1.5, function (c) {
      var ink = '#2c1d12'; shadow(c, 0.3, 0.1, 0.25);
      limb(c, 0, 0, 0, -0.9, 0.1, ink); limb(c, 0, 0, 0, -0.9, 0.055, '#8b5e36');
      rr(c, -0.55, -1.32, 1.1, 0.5, 0.08); c.fillStyle = lin(c, 0, -1.32, 0, -0.82, [[0, '#d9b17a'], [1, '#b0824f']]); c.fill(); c.lineWidth = 0.06; c.strokeStyle = ink; c.stroke();
      c.font = 'bold 0.34px "Fredoka", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#3a2412'; c.fillText(String(n), 0, -1.05);
    });
  }
  function flagSprite() {
    return sprite('flag', 1.6, 2.2, 0.5, 2.1, function (c) {
      var ink = '#2c1d12'; shadow(c, 0.25, 0.08, 0.25);
      limb(c, 0, 0, 0, -1.8, 0.1, ink); limb(c, 0, 0, 0, -1.8, 0.05, '#e9e2d0');
      c.beginPath(); c.moveTo(0.03, -1.8); c.quadraticCurveTo(0.5, -1.95, 1.0, -1.72); c.lineTo(0.8, -1.5); c.lineTo(1.0, -1.28); c.quadraticCurveTo(0.5, -1.45, 0.03, -1.3); c.closePath();
      c.fillStyle = lin(c, 0, -1.8, 1, -1.3, [[0, '#ff7a3c'], [1, '#d33a22']]); c.fill(); c.lineWidth = 0.06; c.strokeStyle = ink; c.stroke();
      ell(c, 0, -1.84, 0.08, 0.08, 0, '#ffd45a', ink, 0.04);
    });
  }
  function signalSprite() {
    return sprite('signal', 1.2, 2.3, 0.6, 2.2, function (c) {
      var ink = '#1f1c1a'; shadow(c, 0.3, 0.1, 0.25);
      poly(c, [-0.06, 0, -0.045, -1.7, 0.045, -1.7, 0.06, 0], lin(c, -0.06, 0, 0.06, 0, [[0, '#f4f4f4'], [1, '#b5b5b5']]), ink, 0.035);
      // crossbuck
      c.save(); c.translate(0, -1.9); c.rotate(0.7); rr(c, -0.4, -0.06, 0.8, 0.12, 0.02); c.fillStyle = '#f4f4f4'; c.fill(); c.lineWidth = 0.035; c.strokeStyle = ink; c.stroke(); c.restore();
      c.save(); c.translate(0, -1.9); c.rotate(-0.7); rr(c, -0.4, -0.06, 0.8, 0.12, 0.02); c.fillStyle = '#f4f4f4'; c.fill(); c.lineWidth = 0.035; c.strokeStyle = ink; c.stroke(); c.restore();
      rr(c, -0.3, -1.52, 0.6, 0.26, 0.08); c.fillStyle = '#1a1a1d'; c.fill(); c.lineWidth = 0.035; c.strokeStyle = ink; c.stroke();
    });
  }
  function trainSprite() {
    var L = 15;
    return sprite('train', L + 0.4, 2.0, (L + 0.4) / 2, 1.6, function (c) {
      var ink = '#1f1c1a', h = L / 2; shadow(c, h, 0.2, 0.3);
      function wheelsAt(x0, x1) { for (var x = x0; x <= x1; x += 0.55) { ell(c, x, -0.14, 0.14, 0.14, 0, '#25272b', ink, 0.03); ell(c, x, -0.14, 0.06, 0.06, 0, '#b9bec6'); } }
      // cars from the back (left) to the engine (right)
      var x0 = -h, cw = 3.5, i;
      for (i = 0; i < 3; i++) {
        var x = x0 + i * (cw + 0.12);
        rr(c, x, -1.12, cw, 0.9, 0.14); c.fillStyle = lin(c, 0, -1.12, 0, -0.22, [[0, '#f6ecd0'], [0.55, '#e7d7aa'], [1, '#bfa874']]); c.fill(); c.lineWidth = 0.06; c.strokeStyle = ink; c.stroke();
        c.save(); rr(c, x, -1.12, cw, 0.9, 0.14); c.clip(); c.fillStyle = '#2f7a52'; c.fillRect(x, -0.5, cw, 0.16); c.fillStyle = '#d2562a'; c.fillRect(x, -0.34, cw, 0.05); c.restore();
        for (var j = 0; j < 5; j++) { rr(c, x + 0.2 + j * 0.62, -0.98, 0.46, 0.34, 0.07); c.fillStyle = lin(c, 0, -0.98, 0, -0.64, [[0, '#e0f4fb'], [1, '#86bbd2']]); c.fill(); c.lineWidth = 0.03; c.strokeStyle = ink; c.stroke(); }
        wheelsAt(x + 0.45, x + cw - 0.45);
        rr(c, x - 0.02, -1.18, cw + 0.04, 0.08, 0.04); c.fillStyle = '#7d7466'; c.fill();
      }
      var ex = x0 + 3 * (cw + 0.12);
      var ew = L / 2 + h - ex;
      c.beginPath(); c.moveTo(ex, -0.2); c.lineTo(ex, -1.3); c.quadraticCurveTo(ex, -1.4, ex + 0.1, -1.4); c.lineTo(ex + ew * 0.5, -1.4); c.lineTo(ex + ew * 0.55, -1.0); c.lineTo(ex + ew - 0.5, -1.0); c.quadraticCurveTo(ex + ew - 0.05, -0.98, ex + ew, -0.7); c.lineTo(ex + ew, -0.2); c.closePath();
      c.fillStyle = lin(c, 0, -1.4, 0, -0.2, [[0, '#4f9d6e'], [0.6, '#2f7a52'], [1, '#1f5538']]); c.fill(); c.lineWidth = 0.06; c.strokeStyle = ink; c.stroke();
      c.fillStyle = '#f2c14e'; c.fillRect(ex + 0.05, -0.55, ew - 0.1, 0.07);
      rr(c, ex + 0.3, -1.26, ew * 0.38, 0.4, 0.07); c.fillStyle = lin(c, 0, -1.26, 0, -0.86, [[0, '#e0f4fb'], [1, '#86bbd2']]); c.fill(); c.lineWidth = 0.03; c.strokeStyle = ink; c.stroke();
      ell(c, ex + ew - 0.12, -0.78, 0.1, 0.1, 0, '#fff7b8', ink, 0.03);
      poly(c, [ex + ew, -0.2, ex + ew + 0.28, -0.1, ex + ew, -0.46], '#d9d9d9', ink, 0.04);
      rr(c, ex + ew * 0.62, -1.62, 0.34, 0.22, 0.05); c.fillStyle = '#2a2d31'; c.fill();
      wheelsAt(ex + 0.4, ex + ew - 0.4);
    });
  }

  // ---------- the critters (drawn live; tile units; origin at the feet; facing +x) ----------
  var CRITTERS = {
    moose:    { name: 'Moose',      cost: 0,   hopH: 0.62, blurb: 'Big, calm, unbothered.' },
    deer:     { name: 'White-tail', cost: 15,  hopH: 0.8,  blurb: 'Springs like a coil.' },
    woodchuck:{ name: 'Woodchuck',  cost: 45,  hopH: 0.5,  blurb: 'Would chuck, if asked.' },
    loon:     { name: 'Loon',       cost: 75,  hopH: 0.34, blurb: 'Waddles. Wails. Wins.' },
    bear:     { name: 'Black Bear', cost: 120, hopH: 0.44, blurb: 'Heavy landings. Thud.' },
    fox:      { name: 'Red Fox',    cost: 180, hopH: 0.7,  blurb: 'Pounce first, ask later.' }
  };
  var ORDER = ['moose', 'deer', 'woodchuck', 'loon', 'bear', 'fox'];

  // pose: t (seconds), hop (0..1 while hopping, else -1), sq (landing squash 0..1), look (-1..1 up/down head)
  function limbPair(c, hx, hy, kx, ky, fx, fy, w, col, hoof) {
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = w; c.strokeStyle = col;
    c.beginPath(); c.moveTo(hx, hy); c.lineTo(kx, ky); c.lineTo(fx, fy); c.stroke();
    if (hoof) ell(c, fx + 0.01, fy, w * 0.62, w * 0.45, 0, hoof);
  }
  function drawCritter(c, kind, pose) {
    var t = pose.t || 0, hp = pose.hop === undefined ? -1 : pose.hop, air = hp >= 0;
    var breathe = Math.sin(t * 2.4) * 0.012;
    var ink = '#2a1b12';
    c.save();
    c.lineJoin = 'round'; c.lineCap = 'round';
    var fn = CR[kind] || CR.moose;
    fn(c, t, hp, air, breathe, ink, pose);
    c.restore();
  }
  function legsAnim(hp, air, tuck) { // 0 = standing .. 1 = fully tucked
    if (!air) return 0;
    return Math.sin(Math.min(1, hp) * Math.PI) * tuck;
  }
  var CR = {};
  CR.moose = function (c, t, hp, air, br, ink) {
    var tk = legsAnim(hp, air, 1), body = '#6b4630', dark = '#3e2718', leg = '#8c6a4c';
    var bob = air ? 0 : Math.sin(t * 1.7) * 0.012;
    // far legs
    var ly = -0.0, kx = tk * 0.1;
    limbPair(c, -0.3, -0.5, -0.3 - 0.05 - kx, -0.3 + tk * 0.14, -0.28 - kx * 0.5, -0.02 - tk * 0.18, 0.1, shade(leg, -0.25), dark);
    limbPair(c, 0.26, -0.5, 0.28 + kx, -0.3 + tk * 0.14, 0.32 + kx * 1.6, -0.02 - tk * 0.22, 0.1, shade(leg, -0.25), dark);
    // tail
    ell(c, -0.52, -0.66, 0.06, 0.04, 0.4, dark);
    // body + hump
    ell(c, -0.04, -0.66 + br, 0.5, 0.27, -0.05, lin(c, 0, -0.95, 0, -0.38, [[0, shade(body, 0.12)], [1, shade(dark, 0.2)]]), ink, 0.05);
    ell(c, 0.12, -0.86 + br, 0.25, 0.16, -0.2, lin(c, 0, -1.02, 0, -0.7, [[0, shade(body, 0.2)], [1, body]]), ink, 0.05);
    ell(c, -0.1, -0.78, 0.22, 0.05, 0, 'rgba(255,230,190,.18)');
    // near legs
    limbPair(c, -0.2, -0.5, -0.2 + 0.0 - kx, -0.3 + tk * 0.14, -0.2 - kx * 0.4, -0.02 - tk * 0.2, 0.11, leg, dark);
    limbPair(c, 0.34, -0.5, 0.36 + kx, -0.3 + tk * 0.14, 0.4 + kx * 1.6, -0.02 - tk * 0.24, 0.11, leg, dark);
    // neck + head (nods in the idle, throws up in the hop)
    var nod = air ? -0.2 * Math.sin(hp * 3.14) : Math.sin(t * 1.3) * 0.05 + (Math.sin(t * 0.5) > 0.92 ? 0.15 : 0);
    c.save(); c.translate(0.42, -0.9 + br); c.rotate(nod);
    ell(c, 0.05, 0.04, 0.2, 0.15, 0.5, body, ink, 0.05);                              // neck
    ell(c, 0.32, 0.12, 0.31, 0.14, 0.45, lin(c, 0, -0.1, 0, 0.3, [[0, shade(body, 0.15)], [1, shade(dark, 0.1)]]), ink, 0.05); // long head
    ell(c, 0.55, 0.26, 0.13, 0.11, 0.3, '#2f2018', ink, 0.04);                        // big muzzle
    ell(c, 0.6, 0.23, 0.02, 0.025, 0, '#000');
    ell(c, 0.27, 0.34, 0.08, 0.16, 0.2, dark, ink, 0.035);                            // bell / dewlap
    ell(c, 0.4, 0.03, 0.035, 0.035, 0, '#fff', ink, 0.025); ell(c, 0.41, 0.035, 0.016, 0.016, 0, '#000');
    var flick = Math.sin(t * 0.8) > 0.93 ? 0.5 : 0;
    ell(c, 0.14, -0.1, 0.07, 0.13, -0.6 - flick, shade(body, 0.1), ink, 0.035);       // ear
    // palmate antlers
    var ant = '#e0c690', antD = '#b79a60';
    [[0.0, 0.7], [0.07, 0.9]].forEach(function (a, i) {
      c.save(); c.translate(0.2 + a[0], -0.08); c.rotate(-0.55 - i * 0.2 - (air ? 0.25 * Math.sin(hp * 3.14) : 0));
      c.beginPath(); c.moveTo(0, 0);
      c.quadraticCurveTo(0.05, -0.2, 0.0, -0.36);
      c.lineTo(-0.1, -0.5 * a[1]); c.lineTo(-0.05, -0.34 * a[1]); c.lineTo(-0.2, -0.46 * a[1]); c.lineTo(-0.1, -0.28 * a[1]); c.lineTo(-0.26, -0.3 * a[1]);
      c.quadraticCurveTo(-0.3, -0.12, -0.16, -0.04); c.quadraticCurveTo(-0.08, 0.02, 0, 0); c.closePath();
      c.fillStyle = i ? antD : ant; c.fill(); c.lineWidth = 0.04; c.strokeStyle = ink; c.stroke();
      c.restore();
    });
    c.restore();
  };

  CR.deer = function (c, t, hp, air, br, ink) {
    var body = '#c48a55', dark = '#8d5a33', white = '#fbf3e6';
    var ext = air ? Math.sin(hp * 3.14) : 0; // legs stretch fore and aft in flight
    var idleEar = Math.sin(t * 1.1) > 0.9 ? 0.4 : 0;
    // tail flag
    c.save(); c.translate(-0.48, -0.66); c.rotate(air ? -0.2 : Math.sin(t * 2) * 0.1 - 0.5); ell(c, -0.06, -0.06, 0.12, 0.07, -0.6, white, ink, 0.035); c.restore();
    limbPair(c, -0.28, -0.5, -0.33 - ext * 0.18, -0.28, -0.4 - ext * 0.28, -0.04 - ext * 0.16, 0.07, shade(body, -0.25), '#2a1b12');
    limbPair(c, 0.26, -0.5, 0.34 + ext * 0.18, -0.26, 0.44 + ext * 0.3, -0.06 - ext * 0.16, 0.07, shade(body, -0.25), '#2a1b12');
    ell(c, -0.02, -0.64 + br, 0.46, 0.22, -0.04, lin(c, 0, -0.86, 0, -0.42, [[0, shade(body, 0.2)], [0.7, body], [1, dark]]), ink, 0.05);
    ell(c, 0.0, -0.5 + br, 0.38, 0.09, 0, 'rgba(255,243,230,.85)');
    ell(c, -0.42, -0.66, 0.1, 0.12, 0, white);
    limbPair(c, -0.2, -0.5, -0.22 - ext * 0.2, -0.28, -0.28 - ext * 0.3, -0.04 - ext * 0.2, 0.08, body, '#2a1b12');
    limbPair(c, 0.34, -0.5, 0.4 + ext * 0.2, -0.28, 0.5 + ext * 0.32, -0.06 - ext * 0.2, 0.08, body, '#2a1b12');
    var nod = air ? -0.25 * ext : Math.sin(t * 1.1) * 0.04;
    c.save(); c.translate(0.36, -0.78 + br); c.rotate(nod);
    ell(c, 0.07, -0.07, 0.1, 0.24, 0.5, body, ink, 0.045);                              // neck
    ell(c, 0.26, -0.28, 0.2, 0.12, 0.35, lin(c, 0, -0.4, 0, -0.16, [[0, shade(body, 0.2)], [1, body]]), ink, 0.045); // head
    ell(c, 0.43, -0.22, 0.07, 0.06, 0.3, '#3b2a22'); ell(c, 0.47, -0.23, 0.02, 0.02, 0, '#000');
    ell(c, 0.28, -0.32, 0.034, 0.034, 0, '#fff', ink, 0.025); ell(c, 0.285, -0.32, 0.016, 0.016, 0, '#000');
    ell(c, 0.1, -0.4, 0.06, 0.15, -0.9 + idleEar, shade(body, 0.1), ink, 0.035); ell(c, 0.12, -0.38, 0.03, 0.09, -0.9 + idleEar, '#f2b9a0');
    ell(c, 0.18, -0.42, 0.06, 0.14, -0.2 + idleEar * 0.5, body, ink, 0.035);
    limb(c, 0.2, -0.42, 0.17, -0.7, 0.03, '#e8d8b0'); limb(c, 0.17, -0.7, 0.07, -0.88, 0.025, '#e8d8b0'); limb(c, 0.18, -0.58, 0.28, -0.74, 0.022, '#e8d8b0');
    c.restore();
  };

  CR.woodchuck = function (c, t, hp, air, br, ink) {
    var body = '#9a7650', dark = '#6a4d33', belly = '#d9bf93';
    var sit = !air ? Math.max(0, Math.sin(t * 0.55 + 1.2)) : 0; // stands up on and off
    var tuck = air ? Math.sin(hp * 3.14) : 0;
    c.save(); c.rotate(-sit * 0.5 + (air ? -0.15 * tuck : 0)); c.translate(sit * 0.08, 0);
    // tail
    ell(c, -0.5, -0.32, 0.17, 0.07, 0.4 + Math.sin(t * 3) * 0.1, dark, ink, 0.035);
    // hind foot, body
    ell(c, -0.12, -0.05, 0.16, 0.06, 0, dark, ink, 0.035);
    ell(c, 0.0, -0.34 + br, 0.42, 0.3, -0.05, lin(c, 0, -0.65, 0, -0.04, [[0, shade(body, 0.22)], [0.7, body], [1, dark]]), ink, 0.05);
    ell(c, 0.06, -0.22, 0.26, 0.16, 0, belly);
    // arms
    var arm = sit > 0.3 ? -0.14 : 0;
    limbPair(c, 0.22, -0.24, 0.3, -0.12 + arm, 0.38, -0.05 + arm * 1.5 - tuck * 0.1, 0.08, dark, null);
    // head
    c.save(); c.translate(0.36, -0.46 + br); c.rotate(air ? -0.15 : Math.sin(t * 7) * 0.04 * (sit > 0.3 ? 1 : 0));
    ell(c, 0.05, -0.06, 0.26, 0.22, 0, lin(c, 0, -0.3, 0, 0.14, [[0, shade(body, 0.2)], [1, body]]), ink, 0.05);
    ell(c, 0.21, 0.02, 0.15, 0.11, 0.1, belly, ink, 0.03);
    ell(c, 0.33, -0.02, 0.05, 0.04, 0, '#2a1b12');
    rr(c, 0.2, 0.06, 0.05, 0.09, 0.015); c.fillStyle = '#fffdf5'; c.fill(); c.lineWidth = 0.025; c.strokeStyle = ink; c.stroke();
    ell(c, 0.15, -0.12, 0.035, 0.04, 0, '#fff', ink, 0.025); ell(c, 0.16, -0.12, 0.018, 0.02, 0, '#000');
    ell(c, -0.1, -0.26, 0.07, 0.07, 0, dark, ink, 0.03);
    c.restore();
    c.restore();
  };

  CR.loon = function (c, t, hp, air, br, ink) {
    var rock = air ? Math.sin(hp * 6.28) * 0.28 : Math.sin(t * 1.4) * 0.02;
    c.save(); c.translate(0, 0); c.rotate(rock * 0.5);
    // feet (orange-black, far back)
    var step = air ? Math.sin(hp * 6.28) : 0;
    limb(c, -0.14, -0.22, -0.2 + step * 0.08, -0.02, 0.06, '#3a3a3a'); ell(c, -0.12 + step * 0.08, -0.01, 0.1, 0.035, 0, '#2c2c2c');
    limb(c, -0.02, -0.22, -0.04 - step * 0.08, -0.02, 0.06, '#4a4a4a'); ell(c, 0.0 - step * 0.08, -0.01, 0.1, 0.035, 0, '#2c2c2c');
    // body (boat-shaped)
    c.beginPath(); c.moveTo(-0.55, -0.4); c.quadraticCurveTo(-0.5, -0.2, -0.2, -0.17); c.lineTo(0.3, -0.17); c.quadraticCurveTo(0.52, -0.2, 0.5, -0.45); c.quadraticCurveTo(0.2, -0.62, -0.1, -0.64); c.quadraticCurveTo(-0.45, -0.62, -0.55, -0.4); c.closePath();
    c.fillStyle = lin(c, 0, -0.64, 0, -0.17, [[0, '#3d4249'], [1, '#14171a']]); c.fill(); c.lineWidth = 0.05; c.strokeStyle = ink; c.stroke();
    // white spots on the back
    for (var i = 0; i < 14; i++) { var sx = -0.42 + (i % 7) * 0.12 + (Math.floor(i / 7) ? 0.05 : 0), sy = -0.55 + Math.floor(i / 7) * 0.1; ell(c, sx, sy, 0.025, 0.02, 0, '#fff'); }
    // white chest
    c.beginPath(); c.moveTo(0.2, -0.17); c.quadraticCurveTo(0.5, -0.2, 0.5, -0.45); c.quadraticCurveTo(0.34, -0.4, 0.2, -0.17); c.closePath(); c.fillStyle = '#fbfbf8'; c.fill();
    ell(c, 0.18, -0.2, 0.3, 0.05, 0, '#f4f4f0');
    // neck and head, sweeping
    var dip = Math.sin(t * 0.9) > 0.55 ? 0.25 : 0, hx = 0.52, hy = -0.5;
    c.save(); c.translate(hx, hy); c.rotate(-0.15 + dip * 0.6 + (air ? -0.15 : 0));
    ell(c, 0.02, -0.18, 0.1, 0.24, 0.1, '#14171a', ink, 0.04);
    ell(c, 0.0, -0.1, 0.06, 0.12, 0.1, '#fff');
    for (var j = 0; j < 4; j++) limb(c, -0.07, -0.18 + j * 0.05, 0.07, -0.2 + j * 0.05, 0.015, '#14171a');
    ell(c, 0.07, -0.42, 0.12, 0.1, 0, '#14171a', ink, 0.04);
    poly(c, [0.15, -0.46, 0.38, -0.4, 0.15, -0.36], '#2a2d31', ink, 0.03);
    ell(c, 0.09, -0.45, 0.032, 0.032, 0, '#e02b2b'); ell(c, 0.092, -0.455, 0.012, 0.012, 0, '#000');
    c.restore();
    c.restore();
  };

  CR.bear = function (c, t, hp, air, br, ink) {
    var body = '#322c2a', dark = '#1d1917', muz = '#bf9a70';
    var tk = legsAnim(hp, air, 1);
    var sniff = Math.sin(t * 5) * 0.015;
    limbPair(c, -0.32, -0.45, -0.34, -0.25 + tk * 0.1, -0.34, -0.03 - tk * 0.12, 0.17, shade(body, -0.2), dark);
    limbPair(c, 0.28, -0.45, 0.32, -0.25 + tk * 0.1, 0.36, -0.03 - tk * 0.14, 0.17, shade(body, -0.2), dark);
    ell(c, -0.02, -0.55 + br, 0.5, 0.33, -0.05, lin(c, 0, -0.9, 0, -0.2, [[0, '#4a4240'], [1, dark]]), ink, 0.05);
    ell(c, 0.18, -0.74 + br, 0.28, 0.2, 0, 'rgba(255,255,255,.07)');
    limbPair(c, -0.18, -0.45, -0.2, -0.25 + tk * 0.1, -0.22, -0.03 - tk * 0.12, 0.19, body, dark);
    limbPair(c, 0.4, -0.45, 0.42, -0.25 + tk * 0.1, 0.46, -0.03 - tk * 0.14, 0.19, body, dark);
    var nod = air ? -0.12 : Math.sin(t * 1.2) * 0.05;
    c.save(); c.translate(0.46, -0.72 + br); c.rotate(nod);
    ell(c, -0.02, -0.14, 0.12, 0.1, 0, body, ink, 0.04); ell(c, -0.02, -0.14, 0.06, 0.05, 0, '#6b4a45');
    ell(c, 0.14, -0.14, 0.12, 0.1, 0, body, ink, 0.04); ell(c, 0.14, -0.14, 0.06, 0.05, 0, '#6b4a45');
    ell(c, 0.08, 0.0, 0.26, 0.23, 0, lin(c, 0, -0.25, 0, 0.2, [[0, '#4a4240'], [1, body]]), ink, 0.05);
    ell(c, 0.26, 0.07 + sniff, 0.15, 0.11, 0.1, muz, ink, 0.04);
    ell(c, 0.36, 0.03 + sniff, 0.06, 0.045, 0, '#0d0b0a');
    ell(c, 0.14, -0.05, 0.035, 0.035, 0, '#f4f0e8'); ell(c, 0.145, -0.05, 0.018, 0.018, 0, '#000');
    c.restore();
  };

  CR.fox = function (c, t, hp, air, br, ink) {
    var body = '#e2772d', dark = '#a94d17', white = '#fff8ee';
    var s = air ? Math.sin(hp * 3.14) : 0; // stretch
    var swish = air ? 0 : Math.sin(t * 2.2) * 0.35;
    // brush tail
    c.save(); c.translate(-0.4 - s * 0.05, -0.38); c.rotate(air ? 0.15 : -0.6 + swish);
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-0.35, -0.3, -0.62, -0.08); c.quadraticCurveTo(-0.45, 0.18, 0.0, 0.1); c.closePath();
    c.fillStyle = lin(c, 0, -0.2, 0, 0.15, [[0, shade(body, 0.2)], [1, dark]]); c.fill(); c.lineWidth = 0.05; c.strokeStyle = ink; c.stroke();
    c.beginPath(); c.moveTo(-0.45, -0.2); c.quadraticCurveTo(-0.62, -0.05, -0.5, 0.14); c.quadraticCurveTo(-0.42, 0.0, -0.45, -0.2); c.fillStyle = white; c.fill();
    c.restore();
    var ext = s;
    limbPair(c, -0.28, -0.4, -0.38 - ext * 0.2, -0.22, -0.46 - ext * 0.3, -0.04 - ext * 0.1, 0.07, '#2a1b12', null);
    limbPair(c, 0.24, -0.4, 0.32 + ext * 0.2, -0.22, 0.42 + ext * 0.3, -0.05 - ext * 0.1, 0.07, '#2a1b12', null);
    ell(c, -0.04, -0.46 + br, 0.44 + ext * 0.04, 0.2 - ext * 0.02, -0.05 - ext * 0.1, lin(c, 0, -0.7, 0, -0.26, [[0, shade(body, 0.22)], [1, dark]]), ink, 0.05);
    ell(c, 0.14, -0.4, 0.22, 0.1, 0, white);
    limbPair(c, -0.16, -0.4, -0.22 - ext * 0.2, -0.22, -0.3 - ext * 0.3, -0.04, 0.08, '#3a2518', null);
    limbPair(c, 0.34, -0.4, 0.4 + ext * 0.2, -0.22, 0.5 + ext * 0.3, -0.05, 0.08, '#3a2518', null);
    c.save(); c.translate(0.44, -0.6 + br); c.rotate(air ? -0.2 : Math.sin(t * 1.5) * 0.05);
    ell(c, 0.06, 0.0, 0.2, 0.17, 0, lin(c, 0, -0.2, 0, 0.18, [[0, shade(body, 0.2)], [1, body]]), ink, 0.05);
    poly(c, [0.2, -0.04, 0.46, 0.06, 0.18, 0.14], body, ink, 0.045);
    poly(c, [0.2, 0.05, 0.4, 0.07, 0.18, 0.14], white);
    ell(c, 0.46, 0.06, 0.035, 0.03, 0, '#000');
    var tw = Math.sin(t * 1.2) > 0.9 ? 0.25 : 0;
    poly(c, [-0.06, -0.12, -0.02 - tw * 0.2, -0.4, 0.1, -0.14], '#2a1b12', ink, 0.04); poly(c, [-0.01, -0.13, 0.0, -0.3, 0.07, -0.14], '#f4b3a0');
    poly(c, [0.08, -0.14, 0.16 + tw * 0.2, -0.4, 0.24, -0.1], body, ink, 0.04);
    ell(c, 0.18, -0.04, 0.03, 0.035, 0, '#fff', ink, 0.02); ell(c, 0.185, -0.04, 0.015, 0.02, 0, '#000');
    c.restore();
  };

  // body height used for the squished/frozen placeholders
  function drawFrozen(c, kind, t) { // an ice block with the critter inside
    c.save();
    drawCritter(c, kind, { t: t, hop: -1 });
    c.restore();
    c.save(); rr(c, -0.62, -1.15, 1.24, 1.2, 0.2);
    c.fillStyle = 'rgba(190,235,255,.55)'; c.fill(); c.lineWidth = 0.06; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke();
    limb(c, -0.4, -0.95, -0.2, -0.8, 0.04, 'rgba(255,255,255,.8)'); limb(c, 0.3, -0.3, 0.5, -0.5, 0.04, 'rgba(255,255,255,.7)');
    c.restore();
  }

  // ---------- public ----------
  window.Art = {
    U: U, PAL: PAL, ASSETS: ASSETS, loadAssets: loadAssets, CRITTERS: CRITTERS, ORDER: ORDER, VEH_BEACON: VEH_BEACON,
    shade: shade, rr: rr, ell: ell, lin: lin, rad: rad, hash: hash, limb: limb, poly: poly,
    tree: treeSprite, rock: rockSprite, car: carSprite, plow: plowSprite, bus: busSprite, log: logSprite, floe: floeSprite,
    leaf: leafSprite, sign: signSprite, flag: flagSprite, signal: signalSprite, train: trainSprite,
    critter: drawCritter, frozen: drawFrozen, leafPath: leafPath
  };
})();
