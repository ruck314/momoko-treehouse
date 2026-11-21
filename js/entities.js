/* entities.js – scenery painting and shared paint helpers (characters live in character.js).
 *
 * House style (see README): flat fill or one gradient per shape, then a
 * 2px PAL.ink outline. Curves via quadraticCurveTo / ellipse / rounded
 * rects. No 1px rectangles. That outline is what makes canvas read as a
 * storybook vector drawing rather than pixel art.
 */
(function () {
  'use strict';
  window.Game = window.Game || {};
  var PAL = Game.PAL;

  /* ---- Offscreen sprite memo (static scenery only) ----
     Painted at devicePixelRatio so cached scenery is as crisp as live
     drawing on HiDPI screens; drawSprite() scales it back to logical size. */
  var spriteCache = {};
  function getCachedSprite(key, w, h, drawFn) {
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    key += '@' + dpr;
    if (spriteCache[key]) return spriteCache[key];
    var cv = document.createElement('canvas');
    cv.lw = Math.max(1, Math.ceil(w));
    cv.lh = Math.max(1, Math.ceil(h));
    cv.width = Math.ceil(cv.lw * dpr);
    cv.height = Math.ceil(cv.lh * dpr);
    var g = cv.getContext('2d');
    g.scale(dpr, dpr);
    drawFn(g);
    spriteCache[key] = cv;
    return cv;
  }
  function drawSprite(c, spr, x, y) {
    c.drawImage(spr, x, y, spr.lw, spr.lh);
  }
  /* Called once the web font loads, so signs repaint in it. */
  function clearSpriteCache() { spriteCache = {}; }

  /* ---- Render effects ----
     Every optional lighting / post layer checks one of these flags, so a
     slow device (or a curious developer in the console) can switch them
     off one by one. engine.js lowers Game.FX.level on its own when frames
     run long: 0 = everything, 1 = no colour grade / sun shafts / soft
     foreground, 2 = no effects at all. */
  Game.FX = { level: 0, auto: true, glow: true, grade: true, vignette: true,
              shafts: true, motes: true, foreground: true, dapple: true };
  function fxOn(name) {
    var F = Game.FX;
    if (!F[name] || F.level >= 2) return false;
    if (F.level >= 1 && (name === 'grade' || name === 'shafts' || name === 'foreground')) return false;
    return true;
  }

  /* A sprite painted at a fixed low resolution whatever the screen's pixel
     ratio, then stretched when drawn. Bilinear upscaling blurs it for
     free, which is exactly what glows, light shafts, vignettes and
     out-of-focus foliage want -- no ctx.filter needed. */
  function getSoftSprite(key, w, h, res, drawFn) {
    key = 'soft:' + key;
    if (spriteCache[key]) return spriteCache[key];
    var cv = document.createElement('canvas');
    cv.lw = w; cv.lh = h;
    cv.width = Math.max(1, Math.ceil(w * res));
    cv.height = Math.max(1, Math.ceil(h * res));
    var g = cv.getContext('2d');
    g.scale(res, res);
    drawFn(g);
    spriteCache[key] = cv;
    return cv;
  }

  /* Every flag that changes what a baked layer looks like, as a cache key. */
  function fxSig() {
    var F = Game.FX, out = 'L' + F.level;
    for (var k in F) if (F[k] === false) out += k;
    return out;
  }

  /* A whole backdrop painted once and then blitted every frame: drawFn
     paints the rectangle (x, y, w, h) in the caller's own coordinates.
     This is how the expensive layers (gradients, glows, the grade and
     vignette) cost a single drawImage per frame. Each `slot` keeps only
     its latest bake, so a resize, a room change or an effect toggle
     replaces the old canvas instead of piling up memory. `res` is pixels
     per logical unit: 0.5 for soft content, 0 for full device sharpness
     (capped at 2x). */
  var bakeSlot = {};
  function getBaked(slot, variant, x, y, w, h, res, drawFn) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!res) res = dpr;
    var key = 'bake:' + slot + '|' + variant + '|' + x + ',' + y + ',' + w + ',' + h + '|' + res + '|' + fxSig();
    if (spriteCache[key]) return spriteCache[key];
    if (bakeSlot[slot]) delete spriteCache[bakeSlot[slot]];
    bakeSlot[slot] = key;
    var cv = document.createElement('canvas');
    cv.lw = w; cv.lh = h;
    cv.width = Math.max(1, Math.ceil(w * res));
    cv.height = Math.max(1, Math.ceil(h * res));
    var g = cv.getContext('2d');
    g.scale(res, res);
    g.translate(-x, -y);
    drawFn(g);
    spriteCache[key] = cv;
    return cv;
  }

  /* Additive bloom for a light source: a cached radial falloff in `rgb`
     ("255, 220, 140"), stamped at any size. */
  function glow(c, x, y, r, rgb, alpha) {
    if (!fxOn('glow')) return;
    var spr = getSoftSprite('glow' + rgb, 64, 64, 1, function (g) {
      var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(' + rgb + ', 1)');
      gr.addColorStop(0.25, 'rgba(' + rgb + ', 0.55)');
      gr.addColorStop(0.6, 'rgba(' + rgb + ', 0.16)');
      gr.addColorStop(1, 'rgba(' + rgb + ', 0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    });
    var ga = c.globalAlpha, op = c.globalCompositeOperation;
    c.globalAlpha = ga * (alpha === undefined ? 0.6 : alpha);
    c.globalCompositeOperation = 'lighter';
    c.drawImage(spr, x - r, y - r, r * 2, r * 2);
    c.globalAlpha = ga;
    c.globalCompositeOperation = op;
  }

  /* Final pass over a backdrop: a warm-to-cool soft-light grade so every
     screen sits in the same afternoon light, then a vignette that pulls
     the eye inward. A full-screen blend is far too slow to run every
     frame on a software canvas, so this is only ever called while baking
     a backdrop (see getBaked) -- at run time it is free. */
  var softLightOK = null;
  function postFX(c, x, y, w, h) {
    if (fxOn('grade')) {
      if (softLightOK === null) {
        var op0 = c.globalCompositeOperation;
        c.globalCompositeOperation = 'soft-light';
        softLightOK = c.globalCompositeOperation === 'soft-light';
        c.globalCompositeOperation = op0;
      }
      if (softLightOK) {
        var gs = getSoftSprite('grade', 64, 64, 1, function (g) {
          var gr = g.createLinearGradient(8, 0, 30, 64);
          gr.addColorStop(0, '#ffd9a0');
          gr.addColorStop(0.5, '#8a7f86');
          gr.addColorStop(1, '#2f3f78');
          g.fillStyle = gr;
          g.fillRect(0, 0, 64, 64);
        });
        var ga = c.globalAlpha;
        c.globalCompositeOperation = 'soft-light';
        c.globalAlpha = ga * 0.34;
        c.drawImage(gs, x, y, w, h);
        c.globalAlpha = ga;
        c.globalCompositeOperation = 'source-over';
      }
    }
    if (fxOn('vignette')) {
      var vs = getSoftSprite('vignette', 96, 60, 1, function (g) {
        g.translate(48, 30);
        g.scale(1, 60 / 96);
        var gr = g.createRadialGradient(0, 0, 26, 0, 0, 62);
        gr.addColorStop(0, 'rgba(24, 16, 44, 0)');
        gr.addColorStop(0.55, 'rgba(24, 16, 44, 0.07)');
        gr.addColorStop(1, 'rgba(24, 16, 44, 0.32)');
        g.fillStyle = gr;
        g.fillRect(-48, -48, 96, 96);
      });
      c.drawImage(vs, x, y, w, h);
    }
  }

  /* ---- Shape helpers ---- */

  /* Deterministic PRNG (LCG) so scattered scenery is identical every frame
     and every visit -- static art never calls Math.random(). */
  function seeded(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  /* Soft contact shadow: a radial fade squashed into an ellipse. */
  function softShadow(c, cx, cy, rx, ry, alpha) {
    c.save();
    c.translate(cx, cy);
    c.scale(1, ry / rx);
    var g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(22, 24, 58, ' + (alpha || 0.24) + ')');
    g.addColorStop(0.6, 'rgba(22, 24, 58, ' + (alpha || 0.24) * 0.55 + ')');
    g.addColorStop(1, 'rgba(22, 24, 58, 0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, rx, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  /* Outlines are PAL.ink by default. Painters that want a hue-tinted line
     (dark green round foliage, dark rose round a pink dress) either pass
     `col` or bracket a run of shapes with setInk(col) ... setInk(). */
  var INK = PAL.ink;
  function setInk(col) { INK = col || PAL.ink; }
  function ink(c, w, col) {
    c.strokeStyle = col || INK;
    c.lineWidth = w || 2;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.stroke();
  }

  function roundRect(c, x, y, w, h, r) {
    var rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  /* Auto-shading for props built from plain shapes (furniture, the shop,
     material icons). While it is on, every solid-colour shape drawn by
     the three helpers below also gets a light-to-shade wash across its
     own bounding box -- warm at the upper left, cool at the lower right --
     and its outline takes a deep tint of its fill. The wash re-fills the
     path that is already current, so it costs no clip. */
  var autoShade = false;
  function setAutoShade(on) { autoShade = !!on; }
  function formLight(c, x, y, w, h, fill) {
    if (typeof fill !== 'string' || fill.charAt(0) !== '#' || fill.length !== 7) return null;
    var g = c.createLinearGradient(x, y, x + w * 0.35, y + h);
    g.addColorStop(0, 'rgba(255, 246, 214, 0.36)');
    g.addColorStop(0.45, 'rgba(255, 246, 214, 0)');
    g.addColorStop(0.55, 'rgba(48, 30, 96, 0)');
    g.addColorStop(1, 'rgba(48, 30, 96, 0.3)');
    c.fillStyle = g;
    c.fill();
    return mix(inkOf(fill), PAL.ink, 0.45);
  }

  function fillRound(c, x, y, w, h, r, fill, outline) {
    roundRect(c, x, y, w, h, r);
    c.fillStyle = fill;
    c.fill();
    var ic = autoShade ? formLight(c, x, y, w, h, fill) : null;
    if (outline !== false) ink(c, 2, ic);
  }

  function fillEllipse(c, cx, cy, rx, ry, fill, outline) {
    rx = Math.abs(rx); ry = Math.abs(ry);
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    var ic = autoShade ? formLight(c, cx - rx, cy - ry, rx * 2, ry * 2, fill) : null;
    if (outline !== false) ink(c, 2, ic);
  }

  function fillPath(c, pts, fill, close, outline) {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (close !== false) c.closePath();
    c.fillStyle = fill;
    c.fill();
    var ic = null;
    if (autoShade) {
      var x0 = pts[0][0], x1 = x0, y0 = pts[0][1], y1 = y0;
      for (var k = 1; k < pts.length; k++) {
        if (pts[k][0] < x0) x0 = pts[k][0]; else if (pts[k][0] > x1) x1 = pts[k][0];
        if (pts[k][1] < y0) y0 = pts[k][1]; else if (pts[k][1] > y1) y1 = pts[k][1];
      }
      ic = formLight(c, x0, y0, x1 - x0, y1 - y0, fill);
    }
    if (outline !== false) ink(c, 2, ic);
  }

  /* Lighten / darken a hex colour by pct (-100..100). */
  function shade(hex, pct) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function adj(v) {
      var out = Math.round(v + (pct / 100) * (pct > 0 ? 255 - v : v));
      return Math.max(0, Math.min(255, out));
    }
    return '#' + ((1 << 24) + (adj(r) << 16) + (adj(g) << 8) + adj(b)).toString(16).slice(1);
  }

  /* Blend two hex colours; k = 0 gives a, 1 gives b. Used to push shadows
     toward a cool hue and highlights toward a warm one instead of just
     darkening or lightening the base colour. */
  var mixMemo = {};
  function mix(a, b, k) {
    var key = a + b + k;
    if (mixMemo[key]) return mixMemo[key];
    var x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    var r = Math.round(((x >> 16) & 255) * (1 - k) + ((y >> 16) & 255) * k);
    var g = Math.round(((x >> 8) & 255) * (1 - k) + ((y >> 8) & 255) * k);
    var bl = Math.round((x & 255) * (1 - k) + (y & 255) * k);
    return (mixMemo[key] = '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1));
  }
  var COOL = '#2a2466', WARM = '#fff0b8';
  /* Outline colour for a fill: the same hue, much deeper. */
  function inkOf(hex) { return mix(shade(hex, -52), '#3a1a30', 0.3); }
  /* Five-point star, filled with the current fillStyle. */
  function star(c, cx, cy, r) {
    c.beginPath();
    for (var i = 0; i < 10; i++) {
      var ang = (Math.PI / 5) * i - Math.PI / 2;
      var rad = (i % 2 === 0) ? r : r * 0.45;
      var px = cx + Math.cos(ang) * rad;
      var py = cy + Math.sin(ang) * rad;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
    c.fill();
  }

  /* ==================================================================
     Meadow scenery
     ================================================================== */

  /* ---- Backdrop: sky, sun, clouds and parallax ridges ----
     Everything here is a pure function of (camX, t), so the meadow looks
     the same every visit. Farther layers move less, sit higher and fade
     toward the sky colour (atmospheric perspective). */
  var VIEW_W = 800;
  /* The rectangle the sky painter fills. It is the 800x480 viewport
     everywhere except on touch devices, where the engine widens it to the
     whole canvas for the title, designer, intro and victory screens so the
     meadow fills the bezel instead of a dark frame. */
  var VIEW = { x: 0, y: 0, w: 800, h: 480 };
  function setView(x, y, w, h) { VIEW.x = x; VIEW.y = y; VIEW.w = w; VIEW.h = h; }
  var FLOWER_COLORS = ['#ff9ec4', '#ffd24a', '#fff4dc', '#b06aa8', '#8fd0e8'];
  /* Far to near. Each ridge is a vertical gradient from its sunlit crest
     (`top`) down into the haze pooled at its foot (`fill`), with a rim
     light along the crest; the trees on it are a shade darker with a lit
     side. Hue runs blue -> green and value light -> dark toward the
     viewer, which is what gives the meadow its depth. */
  var RIDGES = [
    { par: 0.05, base: 236, amp: 54, ph: 2.9, top: '#8fb9de', fill: '#bcd9ea', rim: '#cfe4f2', tree: null, treeS: 0, peak: true },
    { par: 0.12, base: 268, amp: 40, ph: 1.7, top: '#7fbfb0', fill: '#a9d6c3', rim: '#b9e2cf', tree: '#6aae9e', lit: '#9ad0bd', treeS: 0.55 },
    { par: 0.26, base: 306, amp: 30, ph: 4.1, top: '#52a662', fill: '#7cc274', rim: '#a0d888', tree: '#3d8f50', lit: '#6fba6a', treeS: 0.78 },
    { par: 0.45, base: 346, amp: 22, ph: 0.6, top: '#3f9438', fill: '#5fae48', rim: '#8ccc5e', tree: '#27723a', lit: '#55a648', treeS: 1 },
  ];
  function ridgeY(r, wx) {
    if (r.peak) {
      /* distant mountains: sharper, with a couple of proud summits */
      var m = 0.6 * Math.sin(wx * 0.0048 + r.ph) + 0.4 * Math.sin(wx * 0.0113 + r.ph * 1.9);
      return r.base - r.amp * (0.25 + 0.75 * Math.abs(m)) + 5 * Math.sin(wx * 0.045);
    }
    return r.base - r.amp * (0.55 * Math.sin(wx * 0.0062 + r.ph) +
                             0.3 * Math.sin(wx * 0.0151 + r.ph * 2.3) +
                             0.15 * Math.sin(wx * 0.037 + r.ph * 0.7));
  }

  /* Tree positions along each ridge, in that ridge's own scroll space. */
  var ridgeTrees = null;
  function buildRidgeTrees(worldW, margin) {
    ridgeTrees = [];
    for (var i = 0; i < RIDGES.length; i++) {
      var rnd = seeded(101 + i * 977);
      var list = [];
      var span = worldW * RIDGES[i].par + VIEW_W + margin;
      for (var x = -margin + rnd() * 80; x < span; x += 46 + rnd() * 150) {
        /* clumps: sometimes a second tree right beside the first */
        list.push({ x: x, s: 0.75 + rnd() * 0.5, pine: rnd() < 0.35 });
        if (rnd() < 0.3) list.push({ x: x + 14 + rnd() * 10, s: 0.6 + rnd() * 0.35, pine: rnd() < 0.5 });
      }
      ridgeTrees.push(list);
    }
  }

  function drawRidgeTree(c, x, y, s, pine, col, lit) {
    if (pine) {
      fillPath(c, [[x, y - 30 * s], [x + 9 * s, y - 2 * s], [x - 9 * s, y - 2 * s]], col, true, false);
      fillPath(c, [[x, y - 30 * s], [x - 1 * s, y - 2 * s], [x - 9 * s, y - 2 * s]], lit, true, false);
    } else {
      /* a little shade pooled on the slope, the trunk, then the crown as
         clustered masses: deep shade low on the far side, the base
         colour, and two sunlit clumps up on the near side */
      fillEllipse(c, x + 4 * s, y + 0.5, 9 * s, 2.2 * s, mix(col, '#0f3f4a', 0.35), false);
      c.fillStyle = mix(col, '#2a1c10', 0.35);
      c.fillRect(x - 1.2 * s, y - 12 * s, 2.4 * s, 12 * s);
      var deep = mix(col, '#0f3f4a', 0.3);
      fillEllipse(c, x + 1.5 * s, y - 15 * s, 9.5 * s, 9.5 * s, deep, false);
      fillEllipse(c, x + 5 * s, y - 11 * s, 5.5 * s, 5 * s, deep, false);
      fillEllipse(c, x - 0.8 * s, y - 17.5 * s, 8.4 * s, 9 * s, col, false);
      fillEllipse(c, x - 5 * s, y - 13 * s, 6 * s, 5.6 * s, col, false);
      fillEllipse(c, x - 3 * s, y - 21 * s, 5.2 * s, 4.6 * s, lit, false);
      fillEllipse(c, x - 6.5 * s, y - 15 * s, 3.2 * s, 2.8 * s, lit, false);
    }
  }

  /* Seven clouds over three depths: small, faint and slow far away. */
  var CLOUDS = (function () {
    var rnd = seeded(7);
    var out = [];
    var DEPTH = [
      { par: 0.05, drift: 0.04, s: 0.42, a: 0.6, y: 176 },
      { par: 0.12, drift: 0.09, s: 0.66, a: 0.78, y: 130 },
      { par: 0.22, drift: 0.16, s: 0.95, a: 0.92, y: 82 },
    ];
    for (var i = 0; i < 7; i++) {
      var d = DEPTH[i % 3];
      out.push({ par: d.par, drift: d.drift, s: d.s * (0.85 + rnd() * 0.3), a: d.a,
                 y: d.y + (rnd() - 0.5) * 34, off: rnd() * 1100 });
    }
    /* far ones first */
    out.sort(function (p, q) { return p.par - q.par; });
    return out;
  })();
  /* Extra clouds for the tall sky above the viewport on tablet menus,
     placed as a fraction of that band's height so they always fit it. */
  var HIGH_CLOUDS = [
    { f: 0.78, s: 1.15, a: 0.95, drift: 0.12, off: 120 },
    { f: 0.42, s: 0.8, a: 0.85, drift: 0.08, off: 640 },
    { f: 0.62, s: 0.62, a: 0.75, drift: 0.05, off: 980 },
    { f: 0.3, s: 1.0, a: 0.9, drift: 0.1, off: 1420 },
  ];

  /* One cloud, painted once: the puffs are filled together with a single
     top-to-bottom gradient (sunlit cream cap, cool lilac-blue belly), then
     each gets its own bright crown so the mass reads as rounded volumes. */
  var CLOUD_W = 150, CLOUD_H = 76;
  function drawSkyCloud(c, x, y, s, a) {
    /* One sprite per size, and drawn on whole device pixels, so every
       cloud is a plain unscaled copy (clouds drift far too slowly for
       the half-pixel snap to show). */
    var w = Math.ceil(CLOUD_W * s), h = Math.ceil(CLOUD_H * s);
    var spr = getCachedSprite('skyCloud' + s.toFixed(3), w, h, function (g) {
      g.scale(s, s);
      g.translate(CLOUD_W / 2, 44);
      var puffs = [[0, 12, 64, 15], [-36, 5, 30, 20], [36, 7, 27, 17], [0, -8, 40, 27], [-18, -14, 20, 15], [20, -6, 22, 16]];
      var body = g.createLinearGradient(0, -36, 0, 28);
      body.addColorStop(0, '#ffffff');
      body.addColorStop(0.5, '#f7fbff');
      body.addColorStop(0.8, '#cfe0f4');
      body.addColorStop(1, '#b3c8ea');
      g.fillStyle = body;
      g.beginPath();
      for (var i = 0; i < puffs.length; i++) {
        g.moveTo(puffs[i][0] + puffs[i][2], puffs[i][1]);
        g.ellipse(puffs[i][0], puffs[i][1], puffs[i][2], puffs[i][3], 0, 0, Math.PI * 2);
      }
      g.fill();
      /* warm sunlit crowns, upper left of each puff */
      for (var k = 1; k < puffs.length; k++) {
        var p = puffs[k];
        var hl = g.createRadialGradient(p[0] - p[2] * 0.3, p[1] - p[3] * 0.45, 0, p[0] - p[2] * 0.3, p[1] - p[3] * 0.45, p[2] * 0.8);
        hl.addColorStop(0, 'rgba(255, 252, 236, 0.95)');
        hl.addColorStop(1, 'rgba(255, 252, 236, 0)');
        g.fillStyle = hl;
        g.beginPath();
        g.ellipse(p[0], p[1], p[2], p[3], 0, 0, Math.PI * 2);
        g.fill();
      }
    });
    var ga = c.globalAlpha;
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    c.globalAlpha = ga * a;
    c.drawImage(spr, Math.round((x - CLOUD_W / 2 * s) * dpr) / dpr, Math.round((y - 44 * s) * dpr) / dpr, spr.lw, spr.lh);
    c.globalAlpha = ga;
  }

  /* The sun: a wide additive halo, slowly turning rays, then a disc that
     is hot white at the core and deep gold at the limb. */
  function drawSun(c, x, y, t) {
    drawSunHalo(c, x, y, t * 0.0016);
    drawSunDisc(c, x, y);
  }
  function drawSunHalo(c, x, y, rot) {
    glow(c, x, y, 150, '255, 232, 150', 0.5);
    var rays = getSoftSprite('sunRays', 220, 220, 1, function (g) {
      g.translate(110, 110);
      for (var i = 0; i < 12; i++) {
        var a = i * Math.PI / 6, len = i % 2 ? 78 : 104, hw = 0.085;
        var gr = g.createRadialGradient(0, 0, 30, 0, 0, len);
        gr.addColorStop(0, 'rgba(255, 240, 170, 0.5)');
        gr.addColorStop(1, 'rgba(255, 240, 170, 0)');
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(Math.cos(a - hw) * 30, Math.sin(a - hw) * 30);
        g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        g.lineTo(Math.cos(a + hw) * 30, Math.sin(a + hw) * 30);
        g.closePath();
        g.fill();
      }
    });
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.drawImage(rays, -110, -110, 220, 220);
    c.restore();
  }
  function drawSunDisc(c, x, y) {
    var disc = getCachedSprite('sunDisc', 68, 68, function (g) {
      var gr = g.createRadialGradient(28, 27, 2, 34, 34, 31);
      gr.addColorStop(0, '#fffbe0');
      gr.addColorStop(0.45, '#ffe168');
      gr.addColorStop(0.85, '#ffc93a');
      gr.addColorStop(1, '#f7ad2a');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(34, 34, 30, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255, 246, 200, 0.7)';
      g.lineWidth = 1.5;
      g.stroke();
    });
    drawSprite(c, disc, x - 34, y - 34);
  }

  var SKY_TOP = '#4fa9e3';
  function drawMeadowSky(c, camX, t, groundY, worldW, sunX) {
    var vx0 = VIEW.x, vx1 = VIEW.x + VIEW.w, Wv = VIEW.w;
    /* Sun with a soft halo. It sits between the build HUD (left) and the
       bag (right), not behind them; the title screen moves it aside. */
    var sx0 = sunX === undefined ? 470 : sunX;   /* null = no sun in this view */
    var vy = VIEW.y, vh = VIEW.h;
    /* Everything in the sky that never moves is one baked image: the
       gradient, the sun's halo and rays, the shafts of light fanning down
       from it, and the grade and vignette for this view. */
    /* It is all soft, so on a tablet menu (where it covers the whole
       screen) it is baked at half size; in play it is baked 1:1, which
       blits fastest. */
    var skyRes = Wv * (groundY - vy) > 400000 ? 0.5 : 0;
    var sky = getBaked('sky' + sx0 + '_' + groundY, '', vx0, vy, Wv, groundY - vy, skyRes, function (g) {
      var gr = g.createLinearGradient(0, 0, 0, groundY);
      gr.addColorStop(0, SKY_TOP);
      gr.addColorStop(0.42, '#8ccdf0');
      gr.addColorStop(0.72, '#c9e9ee');
      gr.addColorStop(1, '#fdf0c2');
      g.fillStyle = gr;
      g.fillRect(vx0, vy, Wv, groundY - vy);
      /* On tablets the sky runs on above the viewport: deepen it towards
         the top so that band reads as open sky, not a blank wall. */
      if (vy < 0) {
        var tg = g.createLinearGradient(0, vy, 0, 0);
        tg.addColorStop(0, '#2f86cf');
        tg.addColorStop(1, SKY_TOP);
        g.fillStyle = tg;
        g.fillRect(vx0, vy, Wv, -vy);
      }
      if (sx0 !== null) {
        drawSunHalo(g, sx0, 62, 0.26);
        drawSunShafts(g, sx0);
      }
      postFX(g, vx0, vy, Wv, vh);
    });
    c.drawImage(sky, vx0, vy, Wv, groundY - vy);
    if (sx0 !== null) drawSunDisc(c, sx0, 62);

    var wrap = Wv + 340;
    for (var i = 0; i < CLOUDS.length; i++) {
      var cl = CLOUDS[i];
      var cx = ((t * cl.drift - camX * cl.par + cl.off) % wrap + wrap) % wrap - 170 + vx0;
      drawSkyCloud(c, cx, cl.y, cl.s, cl.a);
    }
    if (VIEW.y < -60) {
      for (var h = 0; h < HIGH_CLOUDS.length; h++) {
        var hc = HIGH_CLOUDS[h];
        var hx = ((t * hc.drift + hc.off) % wrap + wrap) % wrap - 170 + vx0;
        drawSkyCloud(c, hx, VIEW.y * hc.f, hc.s, hc.a);
      }
      /* a little flock gliding across the top */
      var bx = ((t * 0.35 + 300) % wrap + wrap) % wrap - 170 + vx0;
      var by = VIEW.y * 0.55 + Math.sin(t / 70) * 6;
      c.save();
      c.strokeStyle = 'rgba(74, 51, 32, 0.55)';
      c.lineWidth = 1.8;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      var FLOCK = [[0, 0], [-22, 10], [-16, -12], [-40, 2]];
      for (var b = 0; b < FLOCK.length; b++) {
        var wing = 3 + Math.sin(t / 7 + b * 1.7) * 3;
        var fx = bx + FLOCK[b][0], fy = by + FLOCK[b][1];
        c.beginPath();
        c.moveTo(fx - 7, fy - wing);
        c.quadraticCurveTo(fx - 3, fy - wing * 0.4, fx, fy);
        c.quadraticCurveTo(fx + 3, fy - wing * 0.4, fx + 7, fy - wing);
        c.stroke();
      }
      c.restore();
    }

    /* The ridges are baked into long strips and scrolled. */
    var margin = Math.max(0, -vx0, vx1 - VIEW_W);
    if (!ridgeStrips || margin > ridgeMargin) buildRidgeStrips(worldW || 2600, margin);
    for (var r = 0; r < RIDGES.length; r++) {
      var st = ridgeStrips[r];
      var hgt = Math.min(st.lh, groundY - st.top);
      /* whole source pixels only: an unscaled copy is several times
         cheaper than a resampled one */
      c.drawImage(st, Math.round((vx0 + camX * RIDGES[r].par - st.x0) * st.res), 0, Wv * st.res, hgt * st.res,
                  vx0, st.top, Wv, hgt);
    }
  }

  /* One strip per ridge, covering every scroll position plus `margin` on
     each side for the bezels: the hill with its gradient and rim light,
     its trees, and (on the nearest one) the haze where the far fields
     meet the meadow. Far ridges are baked a little soft on purpose. */
  var ridgeStrips = null, ridgeMargin = -1;
  function buildRidgeStrips(worldW, margin) {
    ridgeMargin = Math.ceil(margin / 100) * 100 + 40;
    buildRidgeTrees(worldW, ridgeMargin);
    ridgeStrips = [];
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var bottom = 444;
    for (var r = 0; r < RIDGES.length; r++) {
      var R = RIDGES[r];
      var res = dpr;
      var x0 = -ridgeMargin, w = worldW * R.par + VIEW_W + 2 * ridgeMargin;
      var top = Math.floor(R.base - R.amp - 34 * R.treeS - 12 - (R.peak ? 14 : 0));
      var cv = document.createElement('canvas');
      cv.x0 = x0; cv.top = top; cv.res = res; cv.lh = bottom - top;   /* top is whole */
      cv.width = Math.ceil(w * res);
      cv.height = Math.ceil(cv.lh * res);
      var g = cv.getContext('2d');
      g.scale(res, res);
      g.translate(-x0, -top);
      var x;
      if (R.peak) {
        /* a paler, hazier range behind the mountains, for one more step
           of distance */
        g.beginPath();
        g.moveTo(x0, bottom);
        for (x = x0; x <= x0 + w; x += 8) g.lineTo(x, ridgeY(R, x * 0.83 + 410) - 16);
        g.lineTo(x0 + w, bottom);
        g.closePath();
        g.fillStyle = '#b4d0ea';
        g.fill();
      }
      var ridgePath = function () {
        g.beginPath();
        g.moveTo(x0, bottom);
        for (var px = x0; px <= x0 + w; px += 8) g.lineTo(px, ridgeY(R, px));
        g.lineTo(x0 + w, bottom);
        g.closePath();
      };
      ridgePath();
      var rg = g.createLinearGradient(0, R.base - R.amp, 0, 400);
      rg.addColorStop(0, R.top);
      rg.addColorStop(0.75, R.fill);
      g.fillStyle = rg;
      g.fill();
      if (R.peak) {
        /* snow on the summits: the crest line with a ragged lower edge */
        g.beginPath();
        var inSnow = false, run = [];
        for (x = x0; x <= x0 + w + 4; x += 4) {
          var yy = ridgeY(R, x);
          var cap = (R.base - R.amp * 0.6) - yy;
          if (cap > 0 && x <= x0 + w) {
            run.push([x, yy, Math.min(cap, 16) * 0.85 + 2 + 2.2 * Math.sin(x * 0.21) + 1.4 * Math.sin(x * 0.53)]);
            inSnow = true;
          } else if (inSnow) {
            g.moveTo(run[0][0], run[0][1]);
            for (var q = 1; q < run.length; q++) g.lineTo(run[q][0], run[q][1]);
            for (q = run.length - 1; q >= 0; q--) g.lineTo(run[q][0], run[q][1] + Math.max(0, run[q][2]));
            g.closePath();
            run = []; inSnow = false;
          }
        }
        g.fillStyle = 'rgba(246, 250, 255, 0.9)';
        g.fill();
      }
      /* Terrain light: slopes turned toward the sun (upper left) catch
         it warm, the far sides fall into cool shade, strongest near the
         crest and fading down the hillside into the haze. Nearer ridges
         get more contrast -- aerial perspective flattens the far ones.
         One pixel row holds the light per column; stretched down and
         faded, it shades the whole ridge in a single draw. */
      var depthK = [0.6, 0.55, 0.72, 0.85][r];
      var cols = Math.ceil(w / 2);
      var row = document.createElement('canvas');
      row.width = cols; row.height = 1;
      var rc = row.getContext('2d'), id = rc.createImageData(cols, 1);
      for (var ci = 0; ci < cols; ci++) {
        var cx2 = x0 + ci * 2;
        var sl = (ridgeY(R, cx2 + 7) - ridgeY(R, cx2 - 7)) / 14;
        var kk = Math.max(-1, Math.min(1, sl * (R.peak ? 1.6 : 3)));
        var o = ci * 4;
        if (kk > 0) {
          id.data[o] = R.peak ? 78 : 22; id.data[o + 1] = R.peak ? 76 : 62; id.data[o + 2] = R.peak ? 150 : 74;
          id.data[o + 3] = Math.round(255 * kk * depthK * 0.85);
        } else {
          id.data[o] = 255; id.data[o + 1] = 246; id.data[o + 2] = 204;
          id.data[o + 3] = Math.round(255 * -kk * depthK * 0.6);
        }
      }
      rc.putImageData(id, 0, 0);
      var dTop = R.base - R.amp - 8, dH = R.amp * 1.6 + 46;
      var lay = document.createElement('canvas');
      lay.width = Math.ceil(w * res); lay.height = Math.ceil(dH * res);
      var lg = lay.getContext('2d');
      lg.drawImage(row, 0, 0, lay.width, lay.height);
      lg.globalCompositeOperation = 'destination-in';
      var fade = lg.createLinearGradient(0, 0, 0, lay.height);
      fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
      fade.addColorStop(0.35, 'rgba(0, 0, 0, 0.75)');
      fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
      lg.fillStyle = fade;
      lg.fillRect(0, 0, lay.width, lay.height);
      g.save();
      ridgePath();
      g.clip();
      g.drawImage(lay, x0, dTop, w, dH);
      g.restore();
      /* soft rim light along the crest: a wide faint glow under a fine
         bright line, so it reads as light rather than an outline */
      g.beginPath();
      for (x = x0; x <= x0 + w; x += 8) {
        if (x === x0) g.moveTo(x, ridgeY(R, x) + 1.5); else g.lineTo(x, ridgeY(R, x) + 1.5);
      }
      g.strokeStyle = R.rim;
      g.globalAlpha = 0.3;
      g.lineWidth = 5;
      g.stroke();
      g.globalAlpha = 0.85;
      g.lineWidth = 1.4;
      g.stroke();
      g.globalAlpha = 1;
      if (R.tree) {
        var trees = ridgeTrees[r];
        for (var k = 0; k < trees.length; k++) {
          drawRidgeTree(g, trees[k].x, ridgeY(R, trees[k].x) + 3, R.treeS * trees[k].s, trees[k].pine, R.tree, R.lit);
        }
      }
      if (r === RIDGES.length - 1) {
        var hz = g.createLinearGradient(0, 330, 0, 400);
        hz.addColorStop(0, 'rgba(253, 244, 200, 0)');
        hz.addColorStop(1, 'rgba(253, 244, 200, 0.34)');
        g.fillStyle = hz;
        g.fillRect(x0, 330, w, bottom - 330);
      }
      ridgeStrips.push(cv);
    }
  }

  /* ---- Foreground: grass band, dirt path, tufts and little flowers ----
     The whole strip is static world-space art, so it is painted once into
     a world-wide sprite and just scrolled. The path runs from the shop
     door to the foot of the tree and fans out at both ends. */
  var GROUND_LIP = 12;   /* sprite starts this far above the ground line */
  function pathDepth(x, from, to, fans) {
    if (x < from || x > to) return 0;
    var edge = Math.min(1, (x - from) / 90, (to - x) / 90);
    var d = 13 + 2.5 * Math.sin(x * 0.021) + 1.5 * Math.sin(x * 0.057 + 1);
    for (var i = 0; i < fans.length; i++) {
      var k = (x - fans[i]) / 80;
      d += 9 * Math.exp(-k * k);
    }
    return d * (edge * edge * (3 - 2 * edge));
  }

  function drawMeadowGround(c, camX, groundY, H, M) {
    var bandH = H - groundY;
    var spr = getCachedSprite('meadowGround', M.width, bandH + GROUND_LIP, function (g) {
      var gy = GROUND_LIP;              /* the ground line inside the sprite */
      var gh = bandH;
      var rnd = seeded(2024);
      var from = M.shop.doorX - 70, to = M.tree.x + 40;
      var fans = [M.shop.doorX, M.tree.x - 118];

      paintGrassBase(g, 0, gy, M.width, gh, rnd);

      /* path: soil with a darker lower edge and a worn, lighter middle */
      var x, d;
      g.beginPath();
      g.moveTo(from, gy + 3);
      for (x = from; x <= to; x += 6) g.lineTo(x, gy + 3 + pathDepth(x, from, to, fans));
      g.lineTo(to, gy + 3);
      g.closePath();
      var pg = g.createLinearGradient(0, gy, 0, gy + 30);
      pg.addColorStop(0, '#c99c62');
      pg.addColorStop(0.3, '#e6c589');
      pg.addColorStop(1, '#d2a86c');
      g.fillStyle = pg;
      g.fill();
      g.save();
      g.clip();
      /* the grass bank shades the back of the path (soft, not a line) */
      var ao = g.createLinearGradient(0, gy + 3, 0, gy + 9);
      ao.addColorStop(0, 'rgba(70, 48, 20, 0.42)');
      ao.addColorStop(1, 'rgba(70, 48, 20, 0)');
      g.fillStyle = ao;
      g.fillRect(from, gy + 3, to - from, 6);
      /* the sunlit, worn crown of the path */
      g.fillStyle = 'rgba(255, 238, 196, 0.45)';
      for (x = from + 40; x < to - 40; x += 8) {
        d = pathDepth(x, from, to, fans);
        g.fillRect(x, gy + 3 + d * 0.32, 8, d * 0.22);
      }
      /* two faint wheel ruts, and packed-earth grain all over */
      g.strokeStyle = 'rgba(120, 78, 36, 0.16)';
      g.lineWidth = 1.2;
      for (var rut = 0; rut < 2; rut++) {
        g.beginPath();
        for (x = from; x <= to; x += 10) {
          d = pathDepth(x, from, to, fans);
          var ry = gy + 3 + d * (rut ? 0.74 : 0.5) + Math.sin(x * 0.013 + rut * 2) * 0.8;
          if (x === from) g.moveTo(x, ry); else g.lineTo(x, ry);
        }
        g.stroke();
      }
      for (var gr2 = 0; gr2 < (to - from) * 0.9; gr2++) {
        x = from + rnd() * (to - from);
        d = pathDepth(x, from, to, fans);
        if (d < 3) continue;
        var dk = rnd() < 0.55;
        g.fillStyle = dk ? 'rgba(128, 84, 40, 0.22)' : 'rgba(255, 244, 214, 0.32)';
        g.fillRect(x, gy + 4 + rnd() * (d - 1.5), 0.9 + rnd() * 1.4, 0.8 + rnd() * 0.6);
      }
      g.restore();
      /* front lip: a thin darker soil edge, then the grass below it in
         the lip's shadow */
      g.beginPath();
      for (x = from; x <= to; x += 6) {
        d = pathDepth(x, from, to, fans);
        if (x === from) g.moveTo(x, gy + 3 + d); else g.lineTo(x, gy + 3 + d);
      }
      g.strokeStyle = 'rgba(40, 80, 30, 0.28)';
      g.lineWidth = 4;
      g.save(); g.translate(0, 2.2); g.stroke(); g.restore();
      g.strokeStyle = '#ad7c45';
      g.lineWidth = 1.6;
      g.stroke();
      /* pebbles */
      for (var p = 0; p < 90; p++) {
        x = from + rnd() * (to - from);
        d = pathDepth(x, from, to, fans);
        if (d < 6) continue;
        var pr2 = 1.6 + rnd() * 1.6, py2 = gy + 5 + rnd() * (d - 4);
        fillEllipse(g, x + 0.6, py2 + 0.8, pr2, 1 + rnd() * 0.6, 'rgba(90, 58, 26, 0.3)', false);
        fillEllipse(g, x, py2, pr2, 1 + rnd(), rnd() < 0.5 ? '#a97d4a' : '#f6e2b6', false);
      }
      /* grass creeping over both edges of the path */
      g.lineCap = 'round';
      for (x = from + 6; x < to - 6; x += 3 + rnd() * 7) {
        d = pathDepth(x, from, to, fans);
        if (d < 4) continue;
        var front = rnd() < 0.55;
        var by = front ? gy + 3 + d + 1 : gy + 3.5;
        var bh = 2.5 + rnd() * 3.5;
        g.strokeStyle = front ? (rnd() < 0.5 ? 'rgba(52, 120, 46, 0.9)' : 'rgba(120, 190, 80, 0.9)') : 'rgba(64, 128, 48, 0.85)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x, by);
        g.quadraticCurveTo(x + 0.5, by - bh * 0.6, x + (rnd() - 0.3) * 3, by - bh);
        g.stroke();
      }

      /* grass tufts, bigger toward the viewer */
      g.lineCap = 'round';
      for (var i = 0; i < M.width / 9; i++) {
        x = rnd() * M.width;
        var y = gy + 8 + rnd() * (gh - 4);
        if (y < gy + 3 + pathDepth(x, from, to, fans) + 5) continue;
        var near = (y - gy) / gh;
        var hgt = 4 + near * 6 + rnd() * 3;
        g.strokeStyle = rnd() < 0.55 ? 'rgba(38, 98, 40, 0.85)' : 'rgba(176, 228, 104, 0.9)';
        g.lineWidth = 1.3 + near;
        for (var b = -1; b <= 1; b++) {
          g.beginPath();
          g.moveTo(x + b * 2, y);
          g.quadraticCurveTo(x + b * 2.5, y - hgt * 0.6, x + b * 4.5, y - hgt * (b === 0 ? 1.15 : 0.85));
          g.stroke();
        }
      }
      /* verge tufts along the back edge, wherever the path isn't */
      for (x = 4; x < M.width; x += 7 + rnd() * 16) {
        if (pathDepth(x, from, to, fans) > 0.5) continue;
        g.strokeStyle = 'rgba(52, 116, 44, 0.9)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(x, gy + 4); g.quadraticCurveTo(x + 1, gy, x + 3, gy - 3);
        g.moveTo(x + 3, gy + 4); g.quadraticCurveTo(x + 3, gy + 1, x + 1, gy - 1);
        g.stroke();
      }
      /* little flowers in the grass */
      for (var f = 0; f < M.width / 34; f++) {
        x = rnd() * M.width;
        var fy = gy + 18 + rnd() * (gh - 24);
        if (fy < gy + 3 + pathDepth(x, from, to, fans) + 8) continue;
        var col = FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)];
        var fr = 1.5 + (fy - gy) / gh * 1.3;
        fillEllipse(g, x + 1.5, fy + fr * 1.5, fr * 1.9, fr * 0.8, 'rgba(22, 60, 24, 0.3)', false);
        for (var q = 0; q < 5; q++) {
          var a = q * Math.PI * 2 / 5;
          fillEllipse(g, x + Math.cos(a) * fr, fy + Math.sin(a) * fr, fr * 0.8, fr * 0.8, col, false);
        }
        fillEllipse(g, x, fy, fr * 0.55, fr * 0.55, PAL.sun, false);
      }
    });
    drawSprite(c, spr, -camX, groundY - GROUND_LIP);
  }

  /* Meadow turf shared by the level strip and the menu backdrops: sunlit
     at the back, deep and cool at the viewer's feet, broken up with soft
     light and shade patches so it never reads as one flat green. */
  var GRASS_BACK = '#84ca4e', GRASS_MID = '#4c9a3c', GRASS_FRONT = '#286f36';
  function paintGrassBase(g, x0, gy, w, gh, rnd, detailOnly) {
    /* detailOnly leaves the base colour to the caller (the menus lay one
       gradient down the whole view and put this over it). */
    if (!detailOnly) {
      var gr = g.createLinearGradient(0, gy, 0, gy + gh);
      gr.addColorStop(0, GRASS_BACK);
      gr.addColorStop(0.45, GRASS_MID);
      gr.addColorStop(1, GRASS_FRONT);
      g.fillStyle = gr;
      g.fillRect(x0, gy, w, gh);
    }
    for (var i = 0; i < w / 26; i++) {
      var px = x0 + rnd() * w, py = gy + 10 + rnd() * (gh - 10);
      var prx = 30 + rnd() * 60, pry = 4 + rnd() * 7;
      g.save();
      g.translate(px, py);
      g.scale(1, pry / prx);
      var pr = g.createRadialGradient(0, 0, 0, 0, 0, prx);
      var lightPatch = rnd() < 0.5;
      pr.addColorStop(0, lightPatch ? 'rgba(206, 240, 120, 0.22)' : 'rgba(18, 70, 40, 0.2)');
      pr.addColorStop(1, lightPatch ? 'rgba(206, 240, 120, 0)' : 'rgba(18, 70, 40, 0)');
      g.fillStyle = pr;
      /* drawn three times so a patch crossing an end wraps round: the
         strip tiles across tablet bezels without a seam */
      for (var wr = -1; wr <= 1; wr++) {
        g.beginPath();
        g.arc(wr * w, 0, prx, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
    /* the back edge: a bright sunlit lip over a line of shade */
    g.fillStyle = 'rgba(40, 104, 44, 0.6)';
    g.fillRect(x0, gy, w, 3);
    g.fillStyle = 'rgba(214, 244, 130, 0.5)';
    g.fillRect(x0, gy + 3, w, 1.5);
  }

  /* Outline for foliage: a deep green instead of the brown ink, so leaves
     look lit rather than drawn round. */
  var LEAF_INK = '#24512a';

  /* Foreground knolls, shaded so they read as rounded. */
  function drawHill(c, d) {
    var pad = 4;
    var spr = getCachedSprite('hill' + d.w + 'x' + d.h, d.w + pad * 2, d.h / 2 + pad, function (g) {
      g.translate(d.w / 2 + pad, d.h / 2 + pad);
      var path = function () {
        g.beginPath();
        g.moveTo(-d.w / 2, 0);
        g.quadraticCurveTo(0, -d.h, d.w / 2, 0);
        g.closePath();
      };
      path();
      var gr = g.createLinearGradient(0, -d.h / 2, 0, 0);
      gr.addColorStop(0, '#6fbb48');
      gr.addColorStop(1, '#368538');
      g.fillStyle = gr;
      g.fill();
      g.save();
      path();
      g.clip();
      /* the sun-facing flank warms up, the far flank cools into shade */
      var lt = g.createRadialGradient(-d.w * 0.18, -d.h * 0.42, 0, -d.w * 0.18, -d.h * 0.42, d.w * 0.42);
      lt.addColorStop(0, 'rgba(230, 250, 160, 0.34)');
      lt.addColorStop(1, 'rgba(230, 250, 160, 0)');
      g.fillStyle = lt;
      g.fillRect(-d.w / 2, -d.h, d.w, d.h);
      var sh = g.createLinearGradient(d.w * 0.02, 0, d.w * 0.5, 0);
      sh.addColorStop(0, 'rgba(16, 64, 60, 0)');
      sh.addColorStop(1, 'rgba(16, 64, 60, 0.3)');
      g.fillStyle = sh;
      g.fillRect(0, -d.h, d.w / 2, d.h);
      /* haze pooled at its foot, where it meets the meadow */
      var hz = g.createLinearGradient(0, -d.h * 0.18, 0, 0);
      hz.addColorStop(0, 'rgba(240, 246, 200, 0)');
      hz.addColorStop(1, 'rgba(240, 246, 200, 0.22)');
      g.fillStyle = hz;
      g.fillRect(-d.w / 2, -d.h * 0.18, d.w, d.h * 0.18);
      g.restore();
      /* sunlit crest, soft */
      g.beginPath();
      for (var u = 0.14; u <= 0.6; u += 0.046) {
        var hx = -d.w / 2 + d.w * u, hy = -2 * u * (1 - u) * d.h + 3;
        if (u === 0.14) g.moveTo(hx, hy); else g.lineTo(hx, hy);
      }
      g.strokeStyle = 'rgba(206, 240, 130, 0.3)';
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.stroke();
      g.strokeStyle = 'rgba(214, 244, 140, 0.55)';
      g.lineWidth = 2;
      g.stroke();
    });
    drawSprite(c, spr, d.x - d.w / 2 - pad, d.y - d.h / 2 - pad);
  }

  /* One clump of foliage, lit from the upper left: banded cool belly,
     warm cap, a few sunlit leaf scallops along the top and dark ones in
     the shade, and a rim of light on the sun side. */
  var LEAF_LIT = [[-0.52, -0.2], [-0.12, -0.6], [0.3, -0.38], [-0.3, 0.1], [0.08, -0.12], [-0.62, 0.22]];
  var LEAF_DARK = [[0.3, 0.36], [-0.1, 0.52], [0.58, 0.12], [0.02, 0.26]];
  function leafClump(g, cx, cy, rx, ry, col) {
    fillEllipse(g, cx, cy, rx, ry, col, false);
    g.save();
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.clip();
    fillEllipse(g, cx + rx * 0.18, cy + ry * 0.52, rx * 1.1, ry * 0.7, mix(col, '#0f3f4a', 0.24), false);
    fillEllipse(g, cx + rx * 0.3, cy + ry * 0.86, rx * 1.05, ry * 0.56, mix(col, '#0f3f4a', 0.5), false);
    fillEllipse(g, cx - rx * 0.26, cy - ry * 0.4, rx * 0.62, ry * 0.44, mix(col, '#e6f27a', 0.22), false);
    fillEllipse(g, cx - rx * 0.34, cy - ry * 0.52, rx * 0.36, ry * 0.24, mix(col, '#f2f79a', 0.42), false);
    var lr = Math.max(2, rx * 0.11), i;
    g.fillStyle = mix(col, '#f2f79a', 0.5);
    for (i = 0; i < LEAF_LIT.length; i++) {
      g.beginPath(); g.arc(cx + LEAF_LIT[i][0] * rx, cy + LEAF_LIT[i][1] * ry, lr, Math.PI, Math.PI * 2); g.fill();
    }
    g.fillStyle = mix(col, '#0f3f4a', 0.62);
    for (i = 0; i < LEAF_DARK.length; i++) {
      g.beginPath(); g.arc(cx + LEAF_DARK[i][0] * rx, cy + LEAF_DARK[i][1] * ry, lr, 0, Math.PI); g.fill();
    }
    g.beginPath();
    g.ellipse(cx, cy, rx - 2, ry - 2, 0, Math.PI * 0.95, Math.PI * 1.6);
    g.strokeStyle = 'rgba(240, 250, 170, 0.5)';
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.stroke();
    g.restore();
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ink(g, 2, LEAF_INK);
  }

  function drawBgTree(c, d) {
    var s = d.scale;
    var key = 'bgTree' + s.toFixed(2);
    var w = 200 * s, h = 260 * s;
    var spr = getCachedSprite(key, w, h, function (g) {
      g.save();
      g.translate(w / 2, h);
      g.scale(s, s);
      softShadow(g, 8, -3, 62, 8, 0.3);
      /* trunk, lit from the upper left like everything else */
      fillPath(g, [[-11, 0], [-7, -90], [7, -90], [11, 0]], shade(PAL.bark, -8));
      g.save();
      g.globalAlpha = 0.35;
      fillPath(g, [[2, -4], [4, -88], [7, -90], [11, 0]], PAL.barkDark, true, false);
      g.restore();
      /* canopy: a dark heart seen between the clumps, then clumps from
         the shaded back to the sunlit crown, each one banded and leafy
         like the hero tree's, so it reads as clustered volume */
      fillEllipse(g, 2, -132, 60, 42, '#234f33', false);
      var clumps = [[-38, -112, 30, 24, PAL.leafDark], [40, -116, 28, 23, PAL.leafDark],
                    [-20, -140, 36, 30, PAL.leaf], [27, -143, 33, 28, PAL.leaf],
                    [2, -168, 34, 27, PAL.leafLight], [-46, -132, 19, 16, PAL.leafLight]];
      for (var i = 0; i < clumps.length; i++) {
        var k = clumps[i];
        leafClump(g, k[0], k[1], k[2], k[3], k[4]);
      }
      g.restore();
    });
    drawSprite(c, spr, d.x - w / 2, d.y - h);
  }

  function drawBush(c, d) {
    var spr = getCachedSprite('bush', 90, 60, function (g) {
      g.translate(45, 58);
      softShadow(g, 0, 0, 34, 6, 0.22);
      var clumps = [[-16, -12, 18, 15, PAL.leaf], [16, -12, 18, 15, PAL.leaf], [0, -20, 22, 19, PAL.leafLight]];
      for (var i = 0; i < clumps.length; i++) {
        var k = clumps[i];
        leafClump(g, k[0], k[1], k[2], k[3], k[4]);
      }
      /* a couple of berries so the bush isn't just green */
      fillEllipse(g, -22, -8, 2.4, 2.4, '#d9534f', false);
      fillEllipse(g, 20, -4, 2.4, 2.4, '#d9534f', false);
      fillEllipse(g, 6, -30, 2.2, 2.2, '#d9534f', false);
    });
    drawSprite(c, spr, d.x - 45, d.y - 58);
  }

  function drawStump(c, d) {
    var spr = getCachedSprite('stump', 72, 50, function (g) {
      g.translate(36, 46);
      softShadow(g, 0, 0, 26, 5, 0.22);
      /* root flare at the base, then the barrel */
      fillPath(g, [[-24, 0], [-17, -8], [-16, -26], [16, -26], [17, -8], [24, 0]], PAL.bark);
      g.save();
      g.beginPath();
      g.moveTo(-23, -1); g.lineTo(-16, -8); g.lineTo(-15, -25); g.lineTo(15, -25); g.lineTo(16, -8); g.lineTo(23, -1);
      g.closePath(); g.clip();
      /* bark grain + shaded right side */
      g.strokeStyle = PAL.barkDark; g.lineWidth = 1.6; g.globalAlpha = 0.45;
      for (var i = -2; i <= 2; i++) {
        g.beginPath(); g.moveTo(i * 6 + 1, -24); g.quadraticCurveTo(i * 6 + 3, -14, i * 6, -2); g.stroke();
      }
      g.globalAlpha = 0.28;
      fillPath(g, [[6, -26], [17, -26], [24, 0], [8, 0]], PAL.barkDark, true, false);
      g.globalAlpha = 0.18;
      fillPath(g, [[-16, -26], [-9, -26], [-9, 0], [-24, 0]], PAL.cream, true, false);
      g.restore();
      /* cut face with growth rings */
      fillEllipse(g, 0, -26, 17, 6.5, PAL.barkLight);
      fillEllipse(g, 0, -26, 11, 4, shade(PAL.barkLight, -12), false);
      fillEllipse(g, 0, -26, 6, 2.3, shade(PAL.barkLight, -22), false);
      fillEllipse(g, 0, -26, 1.8, 0.9, shade(PAL.barkLight, -36), false);
      /* a sprout from the top and a tuft at the foot */
      g.strokeStyle = PAL.grassDark; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(11, -29); g.quadraticCurveTo(14, -36, 19, -38); g.stroke();
      fillEllipse(g, 20, -39, 3.2, 2.2, PAL.leafLight, false);
      fillEllipse(g, -22, -1, 8, 3.5, PAL.grassDark, false);
    });
    drawSprite(c, spr, d.x - 36, d.y - 46);
  }

  function drawRock(c, d) {
    var spr = getCachedSprite('rock', 60, 40, function (g) {
      g.translate(30, 38);
      softShadow(g, 0, 0, 24, 4.5, 0.22);
      var pts = [[-22, 0], [-18, -14], [-6, -24], [8, -22], [20, -12], [23, 0]];
      fillPath(g, pts, '#a9a29a');
      g.save();
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath(); g.clip();
      /* lit facet top-left, deep shade bottom-right */
      fillPath(g, [[-16, -14], [-6, -22], [4, -20], [-4, -10]], '#cdc7bf', true, false);
      g.globalAlpha = 0.35;
      fillPath(g, [[2, -20], [20, -12], [23, 0], [-4, 0]], '#6e6760', true, false);
      g.globalAlpha = 1;
      /* a crack */
      g.strokeStyle = 'rgba(74,51,32,0.5)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(6, -16); g.lineTo(10, -8); g.lineTo(7, -3); g.stroke();
      /* granite grain, lichen and a sunlit rim along the upper-left edge */
      var rr = seeded(77);
      for (var sp = 0; sp < 60; sp++) {
        g.fillStyle = rr() < 0.5 ? 'rgba(70, 62, 58, 0.28)' : 'rgba(255, 250, 240, 0.35)';
        g.fillRect(-22 + rr() * 45, -24 + rr() * 24, 0.9 + rr(), 0.9);
      }
      fillEllipse(g, -9, -7, 3, 1.8, 'rgba(200, 196, 110, 0.55)', false);
      fillEllipse(g, -6, -5, 1.6, 1.1, 'rgba(200, 196, 110, 0.5)', false);
      g.beginPath();
      g.moveTo(-20, -2); g.lineTo(-16.5, -13.5); g.lineTo(-6, -22.5); g.lineTo(7, -20.8);
      g.strokeStyle = 'rgba(255, 250, 228, 0.6)';
      g.lineWidth = 1.6;
      g.stroke();
      /* contact shade where it sits in the grass */
      var gb = g.createLinearGradient(0, -6, 0, 0);
      gb.addColorStop(0, 'rgba(40, 50, 40, 0)');
      gb.addColorStop(1, 'rgba(40, 50, 40, 0.35)');
      g.fillStyle = gb;
      g.fillRect(-24, -6, 48, 6);
      g.restore();
      /* moss on the shady side and grass at the foot */
      fillEllipse(g, 14, -13, 6, 3.2, PAL.leaf, false);
      fillEllipse(g, 18, -10, 3.5, 2, PAL.leafLight, false);
      fillEllipse(g, -20, -1, 7, 3, PAL.grassDark, false);
      fillEllipse(g, 20, -1, 6, 2.6, PAL.grassDark, false);
    });
    drawSprite(c, spr, d.x - 30, d.y - 38);
  }

  /* A clump of flowers. The variant (from its x) picks the colour run and
     stem heights so no two clumps are the same stamp, and the whole clump
     leans with the breeze: a shear about its roots, so the cached sprite
     is reused as-is. */
  function drawFlowers(c, d, t) {
    var n = d.n || 4;
    var v = Math.floor(d.x / 37) % 5;
    var key = 'flowers' + n + '_' + v;
    var w = n * 18 + 10, h = 34;
    var spr = getCachedSprite(key, w, h, function (g) {
      var rnd = seeded(900 + v * 31 + n);
      for (var i = 0; i < n; i++) {
        var fx = 10 + i * 18 + (rnd() - 0.5) * 6;
        var stem = 11 + rnd() * 8;
        var col = FLOWER_COLORS[(i * 3 + v) % FLOWER_COLORS.length];
        var pr = 2.3 + rnd() * 0.8;
        g.strokeStyle = PAL.grassDark;
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(fx, h); g.quadraticCurveTo(fx + 1.5, h - stem * 0.5, fx, h - stem); g.stroke();
        /* a leaf on every other stem */
        if (i % 2 === 0) {
          fillEllipse(g, fx + 3.5, h - stem * 0.45, 3.2, 1.6, PAL.leaf, false);
        }
        for (var p = 0; p < 5; p++) {
          var a = (Math.PI * 2 / 5) * p;
          fillEllipse(g, fx + Math.cos(a) * (pr + 0.9), (h - stem - 3) + Math.sin(a) * (pr + 0.9), pr, pr, col, false);
        }
        fillEllipse(g, fx, h - stem - 3, 1.9, 1.9, PAL.sun, false);
      }
    });
    var sway = t === undefined ? 0 : Math.sin(t / 42 + d.x * 0.013) * 0.07;
    c.save();
    c.translate(d.x, d.y);
    c.transform(1, 0, sway, 1, 0, 0);
    drawSprite(c, spr, -w / 2, -h);
    c.restore();
  }

  /* A short run of picket fence, weathered cream with a rail. */
  function drawFence(c, d) {
    var n = d.n || 6;
    var w = n * 16 + 8, h = 44;
    var spr = getCachedSprite('fence' + n, w, h, function (g) {
      softShadow(g, w / 2, h - 2, w / 2, 4, 0.18);
      var wood = '#e7d6b4';
      /* rails first, so the pickets sit in front */
      fillRound(g, 2, h - 30, w - 4, 5, 2, shade(wood, -12));
      fillRound(g, 2, h - 16, w - 4, 5, 2, shade(wood, -12));
      for (var i = 0; i < n; i++) {
        var px = 6 + i * 16;
        fillPath(g, [[px, h - 2], [px, h - 36], [px + 5, h - 42], [px + 10, h - 36], [px + 10, h - 2]], wood);
        g.save();
        g.globalAlpha = 0.22;
        fillPath(g, [[px + 6, h - 37], [px + 10, h - 36], [px + 10, h - 2], [px + 6, h - 2]], '#2a1608', true, false);
        g.restore();
      }
      /* a little vine creeping up the end post */
      fillEllipse(g, 8, h - 20, 3.5, 2.6, PAL.leafLight, false);
      fillEllipse(g, 12, h - 28, 3, 2.3, PAL.leaf, false);
      fillEllipse(g, 9, h - 34, 2.4, 2, PAL.leafLight, false);
      fillEllipse(g, 13, h - 24, 1.8, 1.8, PAL.peach, false);
    });
    drawSprite(c, spr, d.x - w / 2, d.y - h + 2);
  }

  /* ---- Ambient life: butterflies, cloud shadows, birds ---- */

  /* One butterfly, flapping; (x, y) is its body, `k` its phase. */
  function drawButterfly(c, x, y, t, k, col) {
    var flap = Math.abs(Math.sin(t / 4 + k));
    c.save();
    c.translate(x, y);
    c.rotate(Math.cos(k) * 0.3);
    c.fillStyle = col;
    c.strokeStyle = PAL.ink;
    c.lineWidth = 1.2;
    for (var sd = -1; sd <= 1; sd += 2) {
      c.beginPath();
      c.ellipse(sd * 4.5 * flap, -2, 5 * flap + 0.6, 6, 0, 0, Math.PI * 2);
      c.fill(); c.stroke();
      c.beginPath();
      c.ellipse(sd * 3.5 * flap, 4, 3.5 * flap + 0.5, 4, 0, 0, Math.PI * 2);
      c.fill(); c.stroke();
    }
    fillRound(c, -1, -6, 2, 12, 1, PAL.ink, false);
    c.restore();
  }

  /* Butterflies looping lazily over the flowers along the whole meadow.
     Positions are a pure function of t, so nothing needs updating. */
  var MEADOW_BUTTERFLIES = [
    { x: 520, col: PAL.peach, sp: 150 }, { x: 905, col: PAL.sky, sp: 190 },
    { x: 1245, col: PAL.sun, sp: 170 }, { x: 1690, col: '#d9b8ff', sp: 160 },
    { x: 2255, col: PAL.peach, sp: 200 }, { x: 1420, col: '#ffffff', sp: 180 },
  ];
  function drawMeadowButterflies(c, camX, groundY, t) {
    for (var i = 0; i < MEADOW_BUTTERFLIES.length; i++) {
      var b = MEADOW_BUTTERFLIES[i];
      if (b.x < camX - 120 || b.x > camX + VIEW_W + 120) continue;
      var k = t / b.sp + i * 2.4;
      var x = b.x + Math.sin(k) * 46 + Math.sin(k * 3.1) * 8;
      var y = groundY - 42 + Math.sin(k * 2.3) * 18 + Math.cos(k * 0.7) * 10;
      drawButterfly(c, x, y, t, k, b.col);
    }
  }

  /* Big soft cloud shadows sliding over the grass, in step with the
     nearest cloud layer, so the meadow has weather instead of a flat
     green floor. Drawn in world space. */
  function drawCloudShadows(c, camX, groundY, H, t) {
    var wrap = VIEW_W + 700;
    for (var i = 0; i < 3; i++) {
      var sx = ((t * 0.16 + i * 530 + camX * 0.78) % wrap + wrap) % wrap - 350 + camX;
      var sy = groundY + 30 + i * 16;
      var rx = 170 + i * 30, ry = 30 + i * 5;
      c.save();
      c.translate(sx, sy);
      c.scale(1, ry / rx);
      var g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, 'rgba(30, 58, 18, 0.13)');
      g.addColorStop(0.55, 'rgba(30, 58, 18, 0.09)');
      g.addColorStop(1, 'rgba(30, 58, 18, 0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, rx, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }

  /* ---- Light and air ----
     Screen-space layers the engine draws over the finished meadow. */

  /* A few broad, soft shafts of sunlight slanting down across the sky
     from the sun's side. Painted tiny and stretched, so they have no
     edges; additive and screen-sized, so they only ever go into the
     baked sky. */
  function drawSunShafts(c, sunX) {
    if (!fxOn('shafts')) return;
    var spr = getSoftSprite('sunShafts', 800, 480, 0.06, function (g) {
      /* [x where it leaves the top, width, strength] -- all lean the same way */
      var beams = [[250, 70, 0.5], [372, 34, 0.32], [470, 96, 0.55], [600, 44, 0.36]];
      var gr = g.createLinearGradient(0, 30, 0, 430);
      gr.addColorStop(0, 'rgba(255, 246, 200, 0)');
      gr.addColorStop(0.25, 'rgba(255, 246, 200, 1)');
      gr.addColorStop(1, 'rgba(255, 246, 200, 0)');
      g.fillStyle = gr;
      for (var i = 0; i < beams.length; i++) {
        var bx = beams[i][0], bw = beams[i][1];
        g.globalAlpha = beams[i][2];
        g.beginPath();
        g.moveTo(bx, 30); g.lineTo(bx + bw, 30);
        g.lineTo(bx + bw * 1.7 - 190, 440); g.lineTo(bx - bw * 0.7 - 190, 440);
        g.closePath();
        g.fill();
      }
    });
    var ga = c.globalAlpha;
    c.globalAlpha = ga * 0.22;
    c.globalCompositeOperation = 'lighter';
    c.drawImage(spr, sunX - 400, 0, 800, 480);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = ga;
  }

  /* Pollen and dandelion fluff drifting on the breeze, catching the sun.
     Pure function of t; `par` slides them against the camera. */
  var MOTES = (function () {
    var rnd = seeded(555), out = [];
    for (var i = 0; i < 26; i++) {
      out.push({ x: rnd() * 900, y: 150 + rnd() * 300, r: 1 + rnd() * 1.8, vx: 0.12 + rnd() * 0.3,
                 ph: rnd() * 6.28, sw: 8 + rnd() * 16, par: 0.6 + rnd() * 0.7 });
    }
    return out;
  })();
  function drawMotes(c, camX, t, x0, w) {
    if (!fxOn('motes')) return;
    var wrap = w + 60, ga = c.globalAlpha;
    c.fillStyle = '#fffbe0';
    for (var i = 0; i < MOTES.length; i++) {
      var m = MOTES[i];
      var x = ((m.x + t * m.vx - camX * m.par) % wrap + wrap) % wrap - 30 + x0;
      var y = m.y + Math.sin(t / 90 + m.ph) * m.sw;
      var tw = 0.35 + 0.35 * Math.sin(t / 37 + m.ph * 3);
      c.globalAlpha = ga * tw;
      c.beginPath();
      c.arc(x, y, m.r, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = ga * tw * 0.3;
      c.beginPath();
      c.arc(x, y, m.r * 2.6, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = ga;
  }

  /* Out-of-focus grass and leaves between the camera and the scene. It
     scrolls faster than the world (parallax > 1), which sells the depth
     more than anything in the background does. Painted small and
     stretched, so it is soft without a blur filter. */
  var FG_W = 960, FG_H = 90;
  function drawForeground(c, camX, bottomY, x0, w) {
    if (!fxOn('foreground')) return;
    var spr = getSoftSprite('foreground', FG_W, FG_H, 0.3, function (g) {
      var rnd = seeded(4242);
      var sh = g.createLinearGradient(0, FG_H - 26, 0, FG_H);
      sh.addColorStop(0, 'rgba(14, 40, 44, 0)');
      sh.addColorStop(1, 'rgba(14, 40, 44, 0.5)');
      g.fillStyle = sh;
      g.fillRect(0, FG_H - 26, FG_W, 26);
      g.lineCap = 'round';
      for (var k = 0; k < 10; k++) {
        /* clumps wrap seamlessly: anything near an edge is drawn twice */
        var cx = rnd() * FG_W, n = 7 + Math.floor(rnd() * 6), big = 0.7 + rnd() * 0.9;
        for (var rep = -1; rep <= 1; rep++) {
          var r2 = seeded(900 + k * 17);
          for (var b = 0; b < n; b++) {
            var bx = cx + rep * FG_W + (r2() - 0.5) * 70;
            var hgt = (12 + r2() * 24) * big, lean = (r2() - 0.5) * 30;
            g.strokeStyle = r2() < 0.7 ? 'rgba(20, 74, 40, 0.8)' : 'rgba(64, 132, 52, 0.8)';
            g.lineWidth = 4 + r2() * 4;
            g.beginPath();
            g.moveTo(bx, FG_H + 6);
            g.quadraticCurveTo(bx + lean * 0.2, FG_H - hgt * 0.6, bx + lean, FG_H - hgt);
            g.stroke();
          }
        }
      }
    });
    var off = ((camX * 1.45) % FG_W + FG_W) % FG_W;
    for (var x = x0 - off; x < x0 + w; x += FG_W) {
      c.drawImage(spr, x, bottomY - FG_H + 8, FG_W, FG_H);
    }
  }

  /* The lens over the playfield. The sky's own bake carries the grade and
     vignette for the open sky, but the ridges, grass and props are drawn
     over it live, so they get this: corners and the near foreground
     falling off into a cool shade, which deepens the darks and pulls the
     eye to the middle where Momoko walks. Masked to the lower part of the
     frame so the sky corners are not darkened twice. One stretched blit. */
  function drawWorldVignette(c, x0, y0, w, h) {
    if (!fxOn('vignette')) return;
    var spr = getSoftSprite('worldVignette', 96, 60, 1, function (g) {
      g.save();
      g.translate(48, 26);
      g.scale(1, 0.72);
      var gr = g.createRadialGradient(0, 0, 22, 0, 0, 64);
      gr.addColorStop(0, 'rgba(18, 30, 44, 0)');
      gr.addColorStop(0.55, 'rgba(18, 30, 44, 0.1)');
      gr.addColorStop(1, 'rgba(18, 30, 44, 0.42)');
      g.fillStyle = gr;
      g.fillRect(-48, -60, 96, 120);
      g.restore();
      g.globalCompositeOperation = 'destination-in';
      var m = g.createLinearGradient(0, 0, 0, 60);
      m.addColorStop(0, 'rgba(0, 0, 0, 0)');
      m.addColorStop(0.42, 'rgba(0, 0, 0, 0.15)');
      m.addColorStop(1, 'rgba(0, 0, 0, 1)');
      g.fillStyle = m;
      g.fillRect(0, 0, 96, 60);
    });
    c.drawImage(spr, x0, y0, w, h);
  }

  /* The big tree's shade on the grass: a broad soft pool thrown to the
     right (the sun is upper left), pierced by coins of dappled light.
     World-space, drawn under the tree itself. */
  function drawTreeShade(c, x, groundY) {
    if (!fxOn('dapple')) return;
    var w = 460, h = 84;
    var spr = getSoftSprite('treeShade', w, h, 0.5, function (g) {
      g.save();
      g.translate(w / 2, 30);
      g.scale(1, 0.15);
      var gr = g.createRadialGradient(0, 0, 40, 0, 0, w / 2);
      gr.addColorStop(0, 'rgba(8, 44, 50, 0.62)');
      gr.addColorStop(0.7, 'rgba(8, 44, 50, 0.46)');
      gr.addColorStop(1, 'rgba(10, 52, 46, 0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, w / 2, 0, Math.PI * 2); g.fill();
      g.restore();
      var rnd = seeded(808);
      g.globalCompositeOperation = 'destination-out';
      for (var i = 0; i < 26; i++) {
        var a = rnd() * 6.28, rr = Math.sqrt(rnd()) * 170;
        g.beginPath();
        g.ellipse(w / 2 + Math.cos(a) * rr, 30 + Math.sin(a) * rr * 0.13, 7 + rnd() * 13, 2 + rnd() * 2.6, 0, 0, Math.PI * 2);
        g.fillStyle = 'rgba(0,0,0,' + (0.45 + rnd() * 0.4) + ')';
        g.fill();
      }
    });
    c.drawImage(spr, x - w / 2 + 34, groundY - 22, w, h);
  }

  /* A pair of birds gliding across the sky, screen-space, slow. */
  function drawSkyBirds(c, t) {
    var wrap = VIEW.w + 300;
    var bx = ((t * 0.3 + 160) % wrap + wrap) % wrap - 150 + VIEW.x;
    var by = 112 + Math.sin(t / 60) * 8;
    c.save();
    c.strokeStyle = 'rgba(74, 51, 32, 0.5)';
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    for (var b = 0; b < 2; b++) {
      var wing = 2.5 + Math.sin(t / 8 + b * 1.7) * 2.5;
      var fx = bx - b * 22, fy = by + b * 9;
      c.beginPath();
      c.moveTo(fx - 6, fy - wing);
      c.quadraticCurveTo(fx - 2.5, fy - wing * 0.4, fx, fy);
      c.quadraticCurveTo(fx + 2.5, fy - wing * 0.4, fx + 6, fy - wing);
      c.stroke();
    }
    c.restore();
  }

  function drawMushroom(c, d) {
    var spr = getCachedSprite('mushroom', 40, 32, function (g) {
      g.translate(20, 30);
      softShadow(g, 2, 0, 14, 3, 0.2);
      fillRound(g, -4, -12, 8, 12, 3, PAL.cream);
      /* domed cap, shaded on the right, with a lit rim */
      g.beginPath();
      g.moveTo(-13, -11);
      g.quadraticCurveTo(-12, -22, 0, -23);
      g.quadraticCurveTo(12, -22, 13, -11);
      g.closePath();
      g.fillStyle = '#d9534f';
      g.fill();
      g.save();
      g.clip();
      g.globalAlpha = 0.22;
      fillPath(g, [[2, -24], [14, -24], [14, -10], [4, -10]], '#2a1608', true, false);
      g.globalAlpha = 0.3;
      fillEllipse(g, -5, -19, 5, 2.2, '#ffffff', false);
      g.restore();
      g.beginPath();
      g.moveTo(-13, -11);
      g.quadraticCurveTo(-12, -22, 0, -23);
      g.quadraticCurveTo(12, -22, 13, -11);
      g.closePath();
      ink(g, 2);
      fillEllipse(g, -5, -15, 2.4, 1.8, PAL.cream, false);
      fillEllipse(g, 4, -17, 2, 1.6, PAL.cream, false);
      fillEllipse(g, 8, -13, 1.4, 1.2, PAL.cream, false);
      /* a baby one leaning on it */
      fillRound(g, 11, -6, 5, 6, 2, PAL.cream);
      fillEllipse(g, 13.5, -7, 6, 3.5, '#d9534f');
      fillEllipse(g, 12, -8, 1.3, 1, PAL.cream, false);
    });
    drawSprite(c, spr, d.x - 20, d.y - 30);
  }

  /* Shrink a label until it fits `maxW`, so a Japanese string (wider glyphs)
     never overflows a sign painted for English. */
  function fitText(c, text, maxW, basePx) {
    var px = basePx;
    c.font = 'bold ' + px + 'px "M PLUS Rounded 1c", sans-serif';
    while (px > 7 && c.measureText(text).width > maxW) {
      px -= 1;
      c.font = 'bold ' + px + 'px "M PLUS Rounded 1c", sans-serif';
    }
  }

  function drawSignpost(c, d) {
    /* Cache key includes the language: the sign has words on it. */
    var lang = (window.Game && Game.i18n) ? Game.i18n.getLang() : 'en';
    var spr = getCachedSprite('signpost_' + lang, 76, 76, function (g) {
      g.translate(38, 74);
      fillRound(g, -3, -56, 6, 56, 2, PAL.bark);
      fillRound(g, -30, -56, 60, 22, 4, PAL.barkLight);
      g.fillStyle = PAL.ink;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      var shopWord = (window.Game && Game.i18n) ? Game.i18n.t('signShop') : 'SHOP';
      fitText(g, shopWord, 42, 12);
      g.fillText(shopWord, 8, -45);
      /* arrow pointing back down the path -- the shop is to the left */
      fillPath(g, [[-14, -50], [-24, -45], [-14, -40]], PAL.ink, true, false);
    });
    drawSprite(c, spr, d.x - 38, d.y - 74);
  }

  function drawMeadowDecor(c, d, t) {
    switch (d.type) {
      case 'hill': drawHill(c, d); break;
      case 'bgTree': drawBgTree(c, d); break;
      case 'bush': drawBush(c, d); break;
      case 'stump': drawStump(c, d); break;
      case 'rock': drawRock(c, d); break;
      case 'flowers': drawFlowers(c, d, t); break;
      case 'mushroom': drawMushroom(c, d); break;
      case 'signpost': drawSignpost(c, d); break;
      case 'fence': drawFence(c, d); break;
    }
  }

  /* ---- The shop building ---- */
  /* The building itself never changes, so it is painted once (per
     language: the sign has words on it); only the chimney smoke and the
     awning move, and they are drawn live over it. */
  function drawShop(c, x, groundY, t) {
    var lang = (window.Game && Game.i18n) ? Game.i18n.getLang() : 'en';
    var spr = getCachedSprite('shopBody_' + lang + fxSig(), 380, 262, function (g) {
      setAutoShade(true);
      drawShopBody(g, 190, 252, 0, 1);
      setAutoShade(false);
      /* warm light spilling from the window */
      glow(g, 190 - 89, 252 - 82, 62, '255, 220, 140', 0.4);
    });
    drawSprite(c, spr, x - 190, groundY - 252);
    setAutoShade(true);
    drawShopBody(c, x, groundY, t, 2);
    setAutoShade(false);
  }
  /* part 1 = the static building, 2 = the moving bits. */
  function drawShopBody(c, x, groundY, t, part) {
    var w = 300, h = 210;
    var left = x - w / 2;
    var top = groundY - h;

    if (part === 2) {
      c.save();
      c.globalAlpha = 0.5;
      var puff = Math.sin(t / 50) * 2;
      fillEllipse(c, x + 80 + puff, top - 14, 6, 5, PAL.cream, false);
      fillEllipse(c, x + 86 - puff, top - 24, 4.5, 4, PAL.cream, false);
      c.restore();
      /* awning */
      var sway = Math.sin(t / 40) * 1.5;
      for (var i = 0; i < 5; i++) {
        var ax = left + 12 + i * 56;
        fillPath(c, [[ax, top + 92], [ax + 56, top + 92], [ax + 46 + sway, top + 112], [ax + 10 + sway, top + 112]],
          i % 2 === 0 ? '#c05a48' : PAL.cream);
      }
      return;
    }

    /* body */
    fillRound(c, left, top + 46, w, h - 46, 8, '#e8cfa8');
    /* plank lines */
    c.strokeStyle = shade('#e8cfa8', -18);
    c.lineWidth = 1.5;
    for (var py = top + 60; py < groundY - 6; py += 14) {
      c.beginPath(); c.moveTo(left + 5, py); c.lineTo(left + w - 5, py); c.stroke();
    }
    roundRect(c, left, top + 46, w, h - 46, 8);
    ink(c, 2);

    /* eave shadow on the wall, so the roof sits on the building */
    c.save();
    c.globalAlpha = 0.16;
    fillPath(c, [[left - 4, top + 50], [left + w + 4, top + 50], [left + w + 2, top + 64], [left - 2, top + 64]], PAL.ink, true, false);
    c.restore();
    /* roof, sunlit on the left slope and in shade on the right */
    var roofPts = [[left - 16, top + 50], [x, top - 6], [left + w + 16, top + 50]];
    fillPath(c, roofPts, '#8a6340');
    c.save();
    c.beginPath(); c.moveTo(roofPts[0][0], roofPts[0][1]); c.lineTo(roofPts[1][0], roofPts[1][1]); c.lineTo(roofPts[2][0], roofPts[2][1]); c.closePath(); c.clip();
    c.globalAlpha = 0.22;
    fillPath(c, [[x, top - 6], [left + w + 16, top + 50], [x, top + 50]], PAL.ink, true, false);
    c.globalAlpha = 0.14;
    fillPath(c, [[left - 16, top + 50], [x, top - 6], [x, top + 50]], PAL.cream, true, false);
    /* shingle courses */
    c.globalAlpha = 0.35;
    c.strokeStyle = PAL.ink;
    c.lineWidth = 1.2;
    for (var r = 1; r <= 3; r++) {
      var ry = top + 50 - r * 13;
      var half = (w / 2 + 16) * (1 - (r * 13) / 56);
      c.beginPath(); c.moveTo(x - half, ry); c.lineTo(x + half, ry); c.stroke();
    }
    c.restore();
    /* chimney (its lazy puff of smoke is drawn live) */
    fillRound(c, x + 70, top + 2, 18, 30, 2, '#c05a48');
    fillRound(c, x + 67, top - 2, 24, 7, 2, shade('#c05a48', -18));

    /* sign board */
    fillRound(c, x - 96, top + 56, 192, 30, 6, '#c05a48');
    c.fillStyle = PAL.cream;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var signName = (window.Game && Game.i18n) ? Game.i18n.t('shopSignName') : 'ACORN & PLANK';
    fitText(c, signName, 180, 15);
    c.fillText(signName, x, top + 72);

    /* window: warm interior, a shelf of goods, a sill underneath */
    fillRound(c, left + 24, top + 100, 74, 56, 5, '#f3dfae');
    c.save();
    c.beginPath(); roundRect(c, left + 25, top + 101, 72, 54, 4); c.clip();
    var wg = c.createLinearGradient(0, top + 100, 0, top + 156);
    wg.addColorStop(0, 'rgba(255,244,220,0.9)');
    wg.addColorStop(1, 'rgba(201,168,106,0.6)');
    c.fillStyle = wg;
    c.fillRect(left + 24, top + 100, 74, 56);
    /* shelf with a lantern, a rope coil and stacked planks */
    fillRound(c, left + 26, top + 134, 70, 4, 1.5, PAL.bark, false);
    fillRound(c, left + 30, top + 138, 26, 5, 2, PAL.barkLight, false);
    fillRound(c, left + 32, top + 143, 26, 5, 2, PAL.bark, false);
    fillRound(c, left + 68, top + 118, 10, 14, 3, PAL.sun, false);
    c.strokeStyle = '#c9a86a'; c.lineWidth = 3;
    c.beginPath(); c.arc(left + 44, top + 123, 6, 0, Math.PI * 2); c.stroke();
    /* glass glint */
    c.globalAlpha = 0.5;
    c.strokeStyle = '#ffffff'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(left + 30, top + 120); c.lineTo(left + 44, top + 104); c.stroke();
    c.restore();
    c.strokeStyle = PAL.ink;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(left + 61, top + 100); c.lineTo(left + 61, top + 156);
    c.moveTo(left + 24, top + 128); c.lineTo(left + 98, top + 128);
    c.stroke();
    roundRect(c, left + 24, top + 100, 74, 56, 5); ink(c, 2);
    fillRound(c, left + 18, top + 156, 86, 7, 3, PAL.barkLight);

    /* door */
    var doorW = 62, doorH = 96;
    var dx = x + 58 - doorW / 2;
    var dy = groundY - doorH;
    fillRound(c, dx, dy, doorW, doorH, 6, '#a9773f');
    fillRound(c, dx + 7, dy + 8, doorW - 14, 34, 4, '#c69a5e');
    fillRound(c, dx + 7, dy + 50, doorW - 14, 34, 4, shade('#a9773f', -8));
    fillEllipse(c, dx + doorW - 13, dy + doorH / 2, 3.4, 3.4, PAL.sun);
    /* doormat */
    fillRound(c, dx - 6, groundY - 5, doorW + 12, 7, 3, '#c05a48');


    /* barrel of planks out front */
    fillRound(c, left - 6, groundY - 46, 40, 46, 6, PAL.bark);
    fillRound(c, left - 6, groundY - 40, 40, 6, 3, PAL.barkLight, false);
    for (var b = 0; b < 4; b++) {
      fillRound(c, left + 2 + b * 7, groundY - 66, 5, 26, 2, PAL.barkLight);
    }
  }

  /* ==================================================================
     Material icons (shop tiles, bag pips, carry overlay)
     Drawn centred on (cx, cy), fitting roughly a `size` box.
     ================================================================== */
  function drawMaterialIcon(c, type, cx, cy, size) {
    var was = autoShade;
    setAutoShade(true);
    drawMaterialIconBody(c, type, cx, cy, size);
    setAutoShade(was);
  }
  function drawMaterialIconBody(c, type, cx, cy, size) {
    var s = size / 40;
    c.save();
    c.translate(cx, cy);
    c.scale(s, s);
    switch (type) {
      case 'plank':
        fillRound(c, -18, -6, 36, 12, 3, PAL.barkLight);
        c.strokeStyle = shade(PAL.barkLight, -22);
        c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(-14, -1); c.lineTo(14, -1); c.stroke();
        break;
      case 'beam':
        fillRound(c, -19, -9, 38, 18, 3, PAL.bark);
        fillRound(c, -19, -9, 38, 6, 2, PAL.barkLight, false);
        break;
      case 'rope':
        c.strokeStyle = '#c9a86a';
        c.lineWidth = 5;
        c.lineCap = 'round';
        c.beginPath();
        c.arc(0, 0, 12, 0, Math.PI * 2);
        c.stroke();
        c.strokeStyle = shade('#c9a86a', -28);
        c.lineWidth = 1.4;
        for (var i = 0; i < 8; i++) {
          var a = (Math.PI * 2 / 8) * i;
          c.beginPath();
          c.moveTo(Math.cos(a) * 9, Math.sin(a) * 9);
          c.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
          c.stroke();
        }
        break;
      case 'nail':
        for (var n = -1; n <= 1; n++) {
          fillPath(c, [[n * 10 - 3, -12], [n * 10 + 3, -12], [n * 10 + 1.4, 12], [n * 10 - 1.4, 12]], '#b8bcc4');
          fillEllipse(c, n * 10, -12, 5.5, 2.6, '#d6dae0');
        }
        break;
      case 'shingle':
        fillPath(c, [[-16, 8], [-16, -6], [0, -12], [16, -6], [16, 8]], '#8a6340');
        c.strokeStyle = shade('#8a6340', -26);
        c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(-16, 1); c.lineTo(16, 1); c.stroke();
        c.beginPath(); c.moveTo(-6, 1); c.lineTo(-6, 8); c.stroke();
        c.beginPath(); c.moveTo(6, 1); c.lineTo(6, 8); c.stroke();
        break;
      case 'door':
        fillRound(c, -11, -17, 22, 34, 4, '#a9773f');
        fillRound(c, -6, -12, 12, 12, 3, '#c69a5e');
        fillEllipse(c, 6, 2, 2.4, 2.4, PAL.sun);
        break;
      case 'window':
        fillRound(c, -15, -13, 30, 26, 3, PAL.cream);
        fillRound(c, -11, -9, 22, 18, 2, PAL.sky, false);
        c.strokeStyle = PAL.ink;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(0, -9); c.lineTo(0, 9);
        c.moveTo(-11, 0); c.lineTo(11, 0);
        c.stroke();
        break;
      case 'glass':
        c.save();
        c.globalAlpha = 0.75;
        fillPath(c, [[-13, -13], [13, -13], [13, 13], [-13, 13]], PAL.sky);
        c.restore();
        c.save();
        c.globalAlpha = 0.7;
        c.strokeStyle = '#ffffff';
        c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(-8, 8); c.lineTo(6, -8); c.stroke();
        c.beginPath(); c.moveTo(0, 9); c.lineTo(10, -3); c.stroke();
        c.restore();
        break;
      case 'lantern':
        fillRound(c, -8, -10, 16, 18, 4, PAL.sun);
        fillRound(c, -10, -14, 20, 5, 2, PAL.bark);
        fillRound(c, -10, 7, 20, 5, 2, PAL.bark);
        c.strokeStyle = PAL.ink;
        c.lineWidth = 1.6;
        c.beginPath(); c.arc(0, -16, 5, Math.PI, 0); c.stroke();
        break;
      case 'flowerBox':
        fillRound(c, -16, 0, 32, 13, 3, PAL.bark);
        for (var fb = -1; fb <= 1; fb++) {
          fillEllipse(c, fb * 9, -6, 5.5, 5, fb === 0 ? PAL.peach : PAL.sun);
          fillEllipse(c, fb * 9, -6, 2, 2, PAL.cream, false);
        }
        break;
      case 'sign':
        fillRound(c, -16, -11, 32, 20, 4, PAL.barkLight);
        fillRound(c, -2, 8, 4, 9, 2, PAL.bark);
        c.strokeStyle = PAL.ink;
        c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(-10, -4); c.lineTo(10, -4); c.stroke();
        c.beginPath(); c.moveTo(-10, 2); c.lineTo(5, 2); c.stroke();
        break;
      case 'bunting':
        c.strokeStyle = PAL.ink;
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(-18, -8);
        c.quadraticCurveTo(0, 0, 18, -8);
        c.stroke();
        for (var bi = 0; bi < 4; bi++) {
          var bx = -13 + bi * 9;
          var by = -8 + Math.sin((bi + 0.5) / 4 * Math.PI) * 5;
          fillPath(c, [[bx - 4, by], [bx + 4, by], [bx, by + 11]],
            [PAL.peach, PAL.sun, PAL.leafLight, PAL.sky][bi], true, false);
        }
        break;
      case 'windChime':
        c.strokeStyle = PAL.ink;
        c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(0, -16); c.lineTo(0, -10); c.stroke();
        fillEllipse(c, 0, -8, 12, 5, '#c9a86a');
        for (var wc = -1; wc <= 1; wc++) {
          c.beginPath(); c.moveTo(wc * 8, -5); c.lineTo(wc * 8, 4); c.stroke();
          fillRound(c, wc * 8 - 2, 4, 4, 9, 2, '#d6dae0');
        }
        break;
      default:
        fillRound(c, -13, -13, 26, 26, 4, PAL.creamDark);
        break;
    }
    c.restore();
  }

  /* ==================================================================
     Particles
     ================================================================== */
  function Particle(x, y, vx, vy, life, color, size) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.color = color; this.size = size || 3;
  }
  Particle.prototype.update = function () {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.12;
    this.life--;
  };
  Particle.prototype.draw = function (c) {
    var a = Math.max(0, this.life / this.maxLife);
    c.save();
    c.globalAlpha = a;
    c.fillStyle = this.color;
    c.beginPath();
    c.arc(this.x, this.y, this.size * a, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };

  function spawnBurst(list, x, y, n, colors, spread) {
    var sp = spread || 3;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var v = Math.random() * sp + 0.6;
      list.push(new Particle(
        x, y,
        Math.cos(a) * v,
        Math.sin(a) * v - 1.2,
        30 + Math.random() * 25,
        colors[Math.floor(Math.random() * colors.length)],
        2 + Math.random() * 2.5
      ));
    }
  }

  window.Game.entities = {
    setView: setView,
    getCachedSprite: getCachedSprite,
    clearSpriteCache: clearSpriteCache,
    ink: ink,
    roundRect: roundRect,
    fillRound: fillRound,
    fillEllipse: fillEllipse,
    fillPath: fillPath,
    shade: shade,
    star: star,
    seeded: seeded,
    softShadow: softShadow,
    setInk: setInk,
    setAutoShade: setAutoShade,
    mix: mix,
    inkOf: inkOf,
    COOL: COOL,
    WARM: WARM,
    LEAF_INK: LEAF_INK,
    fxOn: fxOn,
    glow: glow,
    postFX: postFX,
    getSoftSprite: getSoftSprite,
    getBaked: getBaked,
    fxSig: fxSig,
    paintGrassBase: paintGrassBase,
    drawSun: drawSun,
    drawSkyCloud: drawSkyCloud,
    drawMotes: drawMotes,
    drawForeground: drawForeground,
    drawWorldVignette: drawWorldVignette,
    drawTreeShade: drawTreeShade,
    drawMeadowSky: drawMeadowSky,
    drawMeadowGround: drawMeadowGround,
    drawMeadowDecor: drawMeadowDecor,
    drawMeadowButterflies: drawMeadowButterflies,
    drawCloudShadows: drawCloudShadows,
    drawSkyBirds: drawSkyBirds,
    drawButterfly: drawButterfly,
    drawShop: drawShop,
    drawMaterialIcon: drawMaterialIcon,
    fitText: fitText,
    Particle: Particle,
    spawnBurst: spawnBurst,
  };
})();
