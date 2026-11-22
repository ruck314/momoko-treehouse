/* character.js – Momoko and her friends, painted as cel-shaded chibi
   characters, plus the motion rig that animates them.

   Drawn with the feet at (0, 0) in local space, about 57 units tall at
   scale 1, a three-quarter view turned toward local +x (the way she
   faces); facing left is a mirror. Every part is filled in its deep
   shade, then its own outline nudged toward the key light lays the mid
   band and the lit body over it, so each form gets a hard two-step
   terminator. Shadows on cloth and hair cool toward plum, skin shadows
   stay warm, a sliver of sky light runs down the shadow edges, and every
   outline takes a deep tone of the colour it surrounds.

   Performance: each rigid part (head, eyes, fringe, hat, each arm and
   leg segment, each shoe, bodice, skirt, every hanging lock) is painted
   once per outfit, facing and size into a small canvas and assembled
   with transforms each frame. Hanging parts (twin tails, braids, long
   hair, ribbons, cape, bunny ears) are drawn as a chain of slices of
   their bitmap, each slice rotated a little more than the one above,
   so a spring can bend them.

   Motion: a Rig (one per walker) integrates, in seconds, the walk phase
   (stride-locked, contact / passing / up), hip bob, lean, squash, a
   turn tween, idle breathing, blinks, glances and fidgets, and the
   spring-damper secondary motion on hair, skirt, cape and charms driven
   by her velocity and acceleration. Menus without a rig get a stateless
   idle or walk from the clock. */
(function () {
  'use strict';
  var Game = window.Game;
  var E = Game.entities, PAL = Game.PAL;
  var TAU = Math.PI * 2;

  /* ==================================================================
     Colour
     ================================================================== */
  function rgbOf(hex) {
    if (hex.length === 4) hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    var n = parseInt(hex.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hexOf(r, g, b) {
    var cl = function (v) { return Math.max(0, Math.min(255, Math.round(v))); };
    return '#' + ((1 << 24) + (cl(r) << 16) + (cl(g) << 8) + cl(b)).toString(16).slice(1);
  }
  var MIXM = {};
  function mix(a, b, k) {
    var key = a + b + k;
    var v = MIXM[key];
    if (v) return v;
    var x = rgbOf(a), y = rgbOf(b);
    return (MIXM[key] = hexOf(x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k));
  }
  function scl(a, k) {
    var x = rgbOf(a);
    return hexOf(x[0] * k, x[1] * k, x[2] * k);
  }
  function rgba(hex, a) {
    var x = rgbOf(hex);
    return 'rgba(' + x[0] + ', ' + x[1] + ', ' + x[2] + ', ' + a + ')';
  }
  function lum(a) {
    var x = rgbOf(a);
    return (x[0] * 0.3 + x[1] * 0.59 + x[2] * 0.11) / 255;
  }
  /* A deep line in the fill's own hue, pulled toward the house plum. */
  var HOUSE = [58, 26, 48];
  function inkOf(fill) {
    var x = rgbOf(fill);
    var r = x[0] / 255, g = x[1] / 255, b = x[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, d = max - min;
    var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    var out;
    if (s < 0.12) {
      out = hexOf(HOUSE[0] * 0.9 + x[0] * 0.1, HOUSE[1] * 0.9 + x[1] * 0.1, HOUSE[2] * 0.9 + x[2] * 0.1);
    } else {
      var h;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      var l2 = Math.min(0.26, l * 0.48), s2 = Math.min(1, s * 0.75 + 0.2);
      var cc = (1 - Math.abs(2 * l2 - 1)) * s2, xx = cc * (1 - Math.abs((h / 60) % 2 - 1)), m = l2 - cc / 2;
      var rgb = h < 60 ? [cc, xx, 0] : h < 120 ? [xx, cc, 0] : h < 180 ? [0, cc, xx] : h < 240 ? [0, xx, cc] : h < 300 ? [xx, 0, cc] : [cc, 0, xx];
      out = hexOf((rgb[0] + m) * 255 * 0.7 + HOUSE[0] * 0.3, (rgb[1] + m) * 255 * 0.7 + HOUSE[1] * 0.3, (rgb[2] + m) * 255 * 0.7 + HOUSE[2] * 0.3);
    }
    if (lum(out) > lum(fill) * 0.72) out = scl(fill, 0.5);
    return out;
  }
  /* Tones of one base: d1 / d2 the shadow bands, hi the sheen, ink. */
  var TONE = {};
  function tone(col, kind, warm) {
    var key = col + kind + (warm ? 'w' : '');
    var v = TONE[key];
    if (v) return v;
    if (kind === 'd1') v = warm ? scl(mix(col, '#e8607a', 0.16), 0.95) : scl(mix(col, '#5a3ca8', 0.16), 0.88);
    else if (kind === 'd2') v = warm ? scl(mix(col, '#b8405a', 0.3), 0.85) : scl(mix(col, '#2c2078', 0.32), 0.72);
    else if (kind === 'hi') v = mix(col, '#fff8e4', lum(col) < 0.3 ? 0.36 : 0.46);
    else if (kind === 'ink') v = warm ? mix(scl(col, 0.42), '#7a2a1e', 0.35) : inkOf(col);
    TONE[key] = v;
    return v;
  }

  /* ==================================================================
     Shading primitives
     ================================================================== */
  /* +1 when local +x is screen right. The sun stays at the upper left of
     the screen, so every band and rim flips with it. */
  var LIT = 1;

  function cel(c, path, col, o) {
    o = o || {};
    var s = o.s === undefined ? 1.4 : o.s;
    var lx = -LIT * 0.5, ly = -1;
    path();
    c.fillStyle = tone(col, 'd2', o.warm);
    c.fill();
    c.save();
    path();
    c.clip();
    c.translate(lx * s * 0.5, ly * s * 0.5);
    path();
    c.fillStyle = tone(col, 'd1', o.warm);
    c.fill();
    c.translate(lx * s * 0.5, ly * s * 0.5);
    path();
    c.fillStyle = col;
    c.fill();
    c.restore();
    if (o.x0 !== undefined) rim(c, path, o.x0, o.y0, o.x1, o.y1, o.rim === undefined ? 0.6 : o.rim, o.warm);
    if (o.ink !== 0) {
      path();
      c.strokeStyle = o.inkCol || tone(col, 'ink', o.warm);
      c.lineWidth = o.ink || 0.6;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.stroke();
    }
  }
  /* Sky light along the lower shadow-side edge and a warm sun edge on the
     upper lit side: inner strokes of the shape faded in by gradient. */
  function rim(c, path, x0, y0, x1, y1, a, warm) {
    if (!a) return;
    var sx0 = LIT > 0 ? x0 : x1, sx1 = LIT > 0 ? x1 : x0;
    c.save();
    path();
    c.clip();
    var g = c.createLinearGradient(sx0, y0, sx1, y1);
    g.addColorStop(0, 'rgba(198, 232, 255, 0)');
    g.addColorStop(0.55, 'rgba(198, 232, 255, 0)');
    g.addColorStop(1, 'rgba(206, 236, 255, ' + (a * (warm ? 0.7 : 0.9)) + ')');
    c.strokeStyle = g;
    c.lineWidth = 1.4;
    path();
    c.stroke();
    var w = c.createLinearGradient(sx0, y0, sx1, y1);
    w.addColorStop(0, 'rgba(255, 246, 214, ' + (a * 0.75) + ')');
    w.addColorStop(0.4, 'rgba(255, 246, 214, 0)');
    c.strokeStyle = w;
    c.lineWidth = 1;
    path();
    c.stroke();
    c.restore();
  }
  function stroke(c, col, w) {
    c.strokeStyle = col;
    c.lineWidth = w;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.stroke();
  }
  function ell(c, x, y, rx, ry, rot) {
    c.beginPath();
    c.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot || 0, 0, TAU);
  }
  function dot(c, x, y, rx, ry, col, rot) {
    ell(c, x, y, rx, ry, rot);
    c.fillStyle = col;
    c.fill();
  }
  /* A tapered capsule from (x1, y1, r1) to (x2, y2, r2). */
  function capsule(c, x1, y1, r1, x2, y2, r2) {
    var a = Math.atan2(y2 - y1, x2 - x1);
    c.beginPath();
    c.arc(x1, y1, r1, a + Math.PI / 2, a - Math.PI / 2);
    c.arc(x2, y2, r2, a - Math.PI / 2, a + Math.PI / 2);
    c.closePath();
  }
  function starPath(c, cx, cy, r, inner) {
    c.beginPath();
    for (var i = 0; i < 10; i++) {
      var ang = -Math.PI / 2 + i * Math.PI / 5;
      var rr = i % 2 === 0 ? r : r * (inner || 0.45);
      if (i === 0) c.moveTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
      else c.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
    }
    c.closePath();
  }
  function heartPath(c, x, y, r) {
    c.beginPath();
    c.moveTo(x, y + r * 1.1);
    c.bezierCurveTo(x - r * 1.6, y + r * 0.05, x - r * 1.05, y - r * 1.15, x, y - r * 0.35);
    c.bezierCurveTo(x + r * 1.05, y - r * 1.15, x + r * 1.6, y + r * 0.05, x, y + r * 1.1);
    c.closePath();
  }
  function gem(c, x, y, r, col) {
    ell(c, x, y, r, r);
    var g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, mix(col, '#ffffff', 0.3));
    g.addColorStop(1, scl(col, 0.72));
    c.fillStyle = g;
    c.fill();
    stroke(c, tone(col, 'ink'), 0.3);
  }
  function glint(c, x, y, rx, ry, a, rot) {
    c.save();
    c.globalAlpha = a === undefined ? 0.85 : a;
    dot(c, x, y, rx, ry, '#ffffff', rot);
    c.restore();
  }
  /* Polished metal: the cel bands, then a hot specular streak and a dark
     core across the shape from the sun side, and a warm bounce at the
     far edge. (x0, y0)-(x1, y1) is the shape's box. */
  function metal(c, path, col, x0, y0, x1, y1, o) {
    o = o || {};
    cel(c, path, col, { s: o.s === undefined ? 0.8 : o.s, ink: 0 });
    c.save();
    path();
    c.clip();
    var g = c.createLinearGradient(LIT > 0 ? x0 : x1, y0, LIT > 0 ? x1 : x0, y1);
    g.addColorStop(0, 'rgba(255, 255, 255, 0)');
    g.addColorStop(0.16, 'rgba(255, 255, 255, 0.9)');
    g.addColorStop(0.3, 'rgba(255, 255, 255, 0)');
    g.addColorStop(0.46, rgba(tone(col, 'd2', true), 0));
    g.addColorStop(0.62, rgba(tone(col, 'd2', true), 0.7));
    g.addColorStop(0.8, rgba(tone(col, 'd2', true), 0));
    g.addColorStop(1, 'rgba(255, 236, 170, 0.5)');
    c.fillStyle = g;
    c.fillRect(Math.min(x0, x1) - 1, Math.min(y0, y1) - 1, Math.abs(x1 - x0) + 2, Math.abs(y1 - y0) + 2);
    c.restore();
    path();
    stroke(c, o.inkCol || tone(col, 'ink', true), o.ink || 0.5);
  }
  /* A cut stone: the girdle, a brighter table, facet lines and a hot spot. */
  function jewel(c, x, y, r, col, n) {
    n = n || 6;
    var poly = function (k) {
      c.beginPath();
      for (var i = 0; i < n; i++) {
        var a = -Math.PI / 2 + i * TAU / n;
        if (i) c.lineTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
        else c.moveTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
      }
      c.closePath();
    };
    cel(c, function () { poly(1); }, col, { s: r * 0.55, ink: 0 });
    poly(0.52);
    c.fillStyle = tone(col, 'hi');
    c.fill();
    c.beginPath();
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + i * TAU / n;
      c.moveTo(x + Math.cos(a) * r * 0.52, y + Math.sin(a) * r * 0.52);
      c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    stroke(c, rgba(tone(col, 'ink'), 0.55), r * 0.12);
    poly(1);
    stroke(c, tone(col, 'ink'), Math.max(0.3, r * 0.2));
    glint(c, x - LIT * r * 0.2, y - r * 0.2, r * 0.3, r * 0.2, 0.95, -0.5);
  }
  /* A soft ball with a broken, scalloped edge: pom-poms, fur, curls. */
  function fluffPath(c, x, y, r, n, depth) {
    c.beginPath();
    for (var i = 0; i < n; i++) {
      var a0 = i * TAU / n, a1 = (i + 1) * TAU / n, am = (a0 + a1) / 2, k = 1 + depth;
      if (!i) c.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
      c.quadraticCurveTo(x + Math.cos(am) * r * k, y + Math.sin(am) * r * k, x + Math.cos(a1) * r, y + Math.sin(a1) * r);
    }
    c.closePath();
  }
  /* The current path as a row of stitches. */
  function stitch(c, col, w) {
    c.setLineDash([w * 2.2, w * 1.8]);
    stroke(c, col, w);
    c.setLineDash([]);
  }
  /* A five-petalled blossom with a seeded centre. */
  function blossom(c, x, y, r, col, rot) {
    for (var p = 0; p < 5; p++) {
      var a = p * TAU / 5 - Math.PI / 2 + (rot || 0);
      (function (px, py, a) {
        cel(c, function () { ell(c, px, py, r * 0.62, r * 0.5, a); }, col, { s: r * 0.3, ink: Math.max(0.25, r * 0.16) });
      })(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, a);
    }
    dot(c, x, y, r * 0.4, r * 0.4, PAL.sun);
    stroke(c, '#b07a18', Math.max(0.2, r * 0.12));
    glint(c, x - r * 0.12, y - r * 0.14, r * 0.14, r * 0.1, 0.9);
  }
  function softSprite(key, fn) { return E.getSoftSprite(key, 32, 32, 2, fn); }
  function blushSprite() {
    return softSprite('chBlush', function (g) {
      var gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255, 110, 140, 0.8)');
      gr.addColorStop(0.55, 'rgba(255, 120, 150, 0.32)');
      gr.addColorStop(1, 'rgba(255, 130, 160, 0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 32, 32);
    });
  }
  /* The contact shadow: the same falloff as E.softShadow, baked once. */
  function shadowSprite() {
    return softSprite('chShadow', function (g) {
      var gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(22, 24, 58, 0.42)');
      gr.addColorStop(0.6, 'rgba(22, 24, 58, 0.231)');
      gr.addColorStop(1, 'rgba(22, 24, 58, 0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 32, 32);
    });
  }
  function puffSprite() {
    return softSprite('chPuff', function (g) {
      var gr = g.createRadialGradient(13, 13, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255, 250, 238, 0.95)');
      gr.addColorStop(0.5, 'rgba(244, 234, 214, 0.6)');
      gr.addColorStop(1, 'rgba(232, 220, 196, 0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 32, 32);
    });
  }

  /* ==================================================================
     Geometry
     ================================================================== */
  var HIP_Y = -12.2, NECK_Y = -27.6, SH_Y = -25.4, SH_X = 6.9;
  var THIGH = 5.4, SHIN = 5.2, ANKLE_H = 1.7, HIP_X = 2.6;
  var UPPER = 6.2, FORE = 5.0;
  var HY = -41;          /* cranium centre */
  /* Features turned toward +x: the near eye (-x) full size, the far eye
     foreshortened toward the cheek edge, nose and mouth leading. A turn
     passes through a front view (F 0, even eyes) while it mirrors. */
  var F3 = 2.2, F = F3;
  var WAIST_Y = -19.6;

  var DEF = { skin: '#ffddbb', hair: '#e06088', outfitColor: '#ff9ec4', shoeColor: '#c05a48',
              hairStyle: 'twinTails', outfit: 'frillyDress', shoes: 'maryJane', hat: 'none',
              accessory: 'none', charm: 'none', back: 'none', eyes: '#7c3e22' };
  function norm(cu) {
    var o = {};
    for (var k in DEF) o[k] = (cu && cu[k]) || DEF[k];
    return o;
  }
  function custKey(cu) {
    return cu.skin + cu.hair + cu.outfitColor + cu.shoeColor + cu.hairStyle + cu.outfit + cu.shoes +
      cu.hat + cu.accessory + cu.charm + cu.back + cu.eyes;
  }
  function isDress(o) { return o === 'frillyDress' || o === 'sailorDress' || o === 'starDress'; }

  /* ==================================================================
     Face
     ================================================================== */
  function facePath(c) {
    c.beginPath();
    c.moveTo(-13.2, HY);
    c.ellipse(0, HY, 13.2, 12.6, 0, Math.PI, TAU);
    c.bezierCurveTo(13.5, HY + 4.8, 12, HY + 9.4, 6.8, HY + 11.8);
    c.quadraticCurveTo(2.8, HY + 13.6, 0.9, HY + 13.6);
    c.quadraticCurveTo(-1.6, HY + 13.6, -5.8, HY + 11.8);
    c.bezierCurveTo(-11.4, HY + 9.4, -13.5, HY + 4.8, -13.2, HY);
    c.closePath();
  }

  var EYE_Y = HY + 5.2;
  var EYES3 = [{ x: -4.4 + F3, rx: 3.2, side: -1 }, { x: 5.0 + F3, rx: 2.5, side: 1 }];
  var EYESF = [{ x: -5.0, rx: 2.95, side: -1 }, { x: 5.0, rx: 2.95, side: 1 }];
  var EYES = EYES3;
  function setView(front) { F = front ? 0 : F3; EYES = front ? EYESF : EYES3; }
  /* Iris tones for an eye colour: dark at the top, the colour, a glow
     below, its rim, the ring of light under the pupil and the flecks. */
  var IRISM = { '#7c3e22': ['#3a1810', '#7c3e22', '#e8a258', '#2a100c', 'rgba(255, 214, 150, 0.8)', '#ffe2b0'] };
  function irisOf(col) {
    var v = IRISM[col];
    if (!v) {
      v = IRISM[col] = [scl(mix(col, '#1a0a3a', 0.3), 0.5), col, mix(col, '#fff8dc', 0.55), scl(col, 0.34),
                        rgba(mix(col, '#ffffff', 0.72), 0.85), mix(col, '#ffffff', 0.78)];
    }
    return v;
  }

  function eye(c, x, y, rx, side, state, IRIS) {
    var ry = 3.9;
    var lashCol = '#2c1418';
    if (state === 'c') {
      c.beginPath();
      c.moveTo(x - rx - 0.3, y + 0.5);
      c.quadraticCurveTo(x, y + 2.4, x + rx + 0.3, y + 0.5);
      stroke(c, lashCol, 0.9);
      c.beginPath();
      c.moveTo(x + side * (rx + 0.1), y + 0.6);
      c.lineTo(x + side * (rx + 1.3), y - 0.2);
      stroke(c, lashCol, 0.6);
      return;
    }
    var lid = state === 'h' ? 0.55 : 0;      /* how far the upper lid has dropped */
    var lx = state === 'f' ? 0.75 : state === 'b' ? -0.75 : 0;
    var ly = state === 'u' ? -0.8 : 0;
    var lidY = y - ry + lid * ry * 1.4;
    c.save();
    ell(c, x, y, rx, ry);
    c.clip();
    if (lid) { c.beginPath(); c.rect(x - rx - 1, lidY, rx * 2 + 2, ry * 3); c.clip(); }
    /* sclera, cool under the lid */
    var sg = c.createLinearGradient(0, y - ry, 0, y + ry);
    sg.addColorStop(0, '#c8c4e4');
    sg.addColorStop(0.35, '#ffffff');
    sg.addColorStop(1, '#fff8f4');
    c.fillStyle = sg;
    c.fillRect(x - rx - 1, y - ry - 1, rx * 2 + 2, ry * 2 + 2);
    /* iris: dark at the top glowing to amber below */
    var ix = x + lx, iy = y + 0.35 + ly, irx = rx * 0.84, iry = ry * 0.86;
    var g = c.createLinearGradient(0, iy - iry, 0, iy + iry);
    g.addColorStop(0, IRIS[0]);
    g.addColorStop(0.45, IRIS[1]);
    g.addColorStop(1, IRIS[2]);
    ell(c, ix, iy, irx, iry);
    c.fillStyle = g;
    c.fill();
    stroke(c, IRIS[3], 0.35);
    /* pupil and the glow ring under it */
    dot(c, ix, iy + 0.25, irx * 0.42, iry * 0.46, '#1a0806');
    c.beginPath();
    c.ellipse(ix, iy + 0.5, irx * 0.7, iry * 0.68, 0, 0.35, Math.PI - 0.35);
    stroke(c, IRIS[4], 0.45);
    /* iris fleck lines */
    c.globalAlpha = 0.35;
    c.beginPath();
    for (var k = 0; k < 5; k++) {
      var a = Math.PI * (0.15 + k * 0.17);
      c.moveTo(ix + Math.cos(a) * irx * 0.5, iy + Math.sin(a) * iry * 0.5);
      c.lineTo(ix + Math.cos(a) * irx * 0.85, iy + Math.sin(a) * iry * 0.85);
    }
    stroke(c, IRIS[5], 0.25);
    c.globalAlpha = 1;
    /* the upper lid's shadow across the top of the eye */
    c.fillStyle = 'rgba(60, 30, 70, 0.32)';
    ell(c, x, lidY - ry * 0.25, rx * 1.3, ry * 0.62);
    c.fill();
    /* catchlights: a big one on the sun side, a small bounce, a fleck */
    var cs = -LIT;
    glint(c, ix + cs * irx * 0.4, iy - iry * 0.42, 1.15, 1.4, 1, cs * 0.3);
    glint(c, ix - cs * irx * 0.42, iy + iry * 0.48, 0.55, 0.5, 0.9);
    glint(c, ix + cs * irx * 0.05, iy + iry * 0.1, 0.3, 0.3, 0.7);
    c.restore();
    /* upper lash: heavy, thinning to the inner corner, outer flick */
    var o = side, ty = lidY;
    c.beginPath();
    c.moveTo(x - o * rx * 0.98, ty + ry * 0.55 - lid * 0.8);
    c.quadraticCurveTo(x - o * rx * 0.2, ty - 0.55, x + o * rx * 1.02, ty + ry * 0.36);
    c.lineTo(x + o * (rx + 1.25), ty - 0.15);
    c.lineTo(x + o * (rx + 0.85), ty + ry * 0.62);
    c.quadraticCurveTo(x - o * rx * 0.1, ty + 0.5, x - o * rx * 0.98, ty + ry * 0.55 - lid * 0.8);
    c.closePath();
    c.fillStyle = lashCol;
    c.fill();
    /* two lash tips at the outer corner */
    c.beginPath();
    c.moveTo(x + o * rx * 0.75, ty + 0.4);
    c.lineTo(x + o * (rx + 0.7), ty - 1.1);
    stroke(c, lashCol, 0.4);
    /* lid crease above */
    if (!lid) {
      c.beginPath();
      c.moveTo(x - o * rx * 0.2, y - ry - 1.05);
      c.quadraticCurveTo(x + o * rx * 0.55, y - ry - 1.35, x + o * (rx + 0.3), y - ry * 0.7);
      stroke(c, 'rgba(120, 50, 50, 0.4)', 0.3);
    }
    /* lower lash hint at the outer corner */
    c.beginPath();
    c.moveTo(x + o * rx * 0.25, y + ry * 0.98);
    c.quadraticCurveTo(x + o * rx * 0.8, y + ry * 0.86, x + o * rx * 1.02, y + ry * 0.45);
    stroke(c, 'rgba(70, 24, 30, 0.6)', 0.35);
  }

  function drawEyes(c, cu, state) {
    var iris = irisOf(cu.eyes);
    for (var i = 0; i < 2; i++) eye(c, EYES[i].x, EYE_Y, EYES[i].rx, EYES[i].side, state, iris);
    /* brows: soft, peeking under the fringe */
    c.globalAlpha = 0.7;
    for (var j = 0; j < 2; j++) {
      var ex = EYES[j].x, o = EYES[j].side;
      c.beginPath();
      c.moveTo(ex - o * 1.8, EYE_Y - 5.6);
      c.quadraticCurveTo(ex + o * 0.4, EYE_Y - 6.6, ex + o * 2.6, EYE_Y - 5.9);
      stroke(c, tone(cu.hair, 'ink'), 0.55);
    }
    c.globalAlpha = 1;
  }

  function drawHeadBase(c, cu, mouth) {
    var skin = cu.skin;
    cel(c, function () { facePath(c); }, skin, { warm: true, s: 2.4, ink: 0.85, x0: -13, x1: 13, y0: HY - 12, y1: HY + 13.6, rim: 0.7 });
    c.save();
    facePath(c);
    c.clip();
    /* clean light high on the cheek, on the sun side */
    var hx = -LIT * 5.5;
    var hg = c.createRadialGradient(hx, HY + 2, 0.5, hx, HY + 2, 9);
    hg.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
    hg.addColorStop(1, 'rgba(255, 255, 255, 0)');
    c.fillStyle = hg;
    c.fillRect(-14, HY - 13, 28, 28);
    /* the fringe and side locks cast a hard shadow on the forehead */
    c.translate(LIT * 0.5, 1.5);
    c.fillStyle = tone(skin, 'd1', true);
    fringeShadowShapes(c, cu);
    c.restore();
    /* blush with a few hatch strokes */
    var bl = blushSprite();
    c.drawImage(bl, -10.4 + F, EYE_Y + 2.6, F ? 7.6 : 7.2, 3.8);
    c.drawImage(bl, 4.6 + F, EYE_Y + 2.6, F ? 5.6 : 7.2, 3.8);
    c.beginPath();
    for (var h = 0; h < 3; h++) {
      c.moveTo(-8.4 + F + h * 0.9, EYE_Y + 5.3); c.lineTo(-7.8 + F + h * 0.9, EYE_Y + 4.1);
      c.moveTo(6.6 + F + h * 0.9, EYE_Y + 5.3); c.lineTo(7.2 + F + h * 0.9, EYE_Y + 4.1);
    }
    stroke(c, 'rgba(232, 80, 110, 0.5)', 0.3);
    /* nose: a warm fleck with a touch of light */
    var nx = F * 1.7 + 0.3, ny = HY + 8.4;
    c.beginPath();
    c.moveTo(nx - 0.2, ny - 0.5);
    c.quadraticCurveTo(nx + 0.6, ny + 0.1, nx + 0.1, ny + 0.5);
    stroke(c, tone(skin, 'd2', true), 0.45);
    glint(c, nx - 0.6, ny - 0.4, 0.35, 0.25, 0.7);
    /* mouth */
    var mx = F * 1.5, my = HY + 10.7;
    if (mouth) {
      c.beginPath();
      c.moveTo(mx - 1.9, my - 0.4);
      c.quadraticCurveTo(mx, my + 0.1, mx + 1.9, my - 0.4);
      c.quadraticCurveTo(mx + 1.5, my + 2.3, mx, my + 2.3);
      c.quadraticCurveTo(mx - 1.5, my + 2.3, mx - 1.9, my - 0.4);
      c.closePath();
      c.fillStyle = '#8a2a3a';
      c.fill();
      c.save();
      c.clip();
      dot(c, mx + 0.2, my + 2.2, 1.3, 0.9, '#ff8a9c');
      c.fillStyle = '#ffffff';
      c.fillRect(mx - 1.6, my - 0.6, 3.2, 0.6);
      c.restore();
      c.beginPath();
      c.moveTo(mx - 1.9, my - 0.4);
      c.quadraticCurveTo(mx, my + 0.1, mx + 1.9, my - 0.4);
      stroke(c, '#5a1a24', 0.4);
    } else {
      c.beginPath();
      c.moveTo(mx - 1.7, my);
      c.quadraticCurveTo(mx, my + 1.25, mx + 1.7, my);
      c.quadraticCurveTo(mx, my + 0.55, mx - 1.7, my);
      c.closePath();
      c.fillStyle = '#9a3446';
      c.fill();
      c.beginPath();
      c.moveTo(mx - 1.8, my - 0.1);
      c.quadraticCurveTo(mx, my + 1.3, mx + 1.8, my - 0.1);
      stroke(c, '#5a1a24', 0.42);
      c.beginPath();
      c.moveTo(mx + 1.6, my - 0.3); c.lineTo(mx + 2.1, my - 0.6);
      stroke(c, '#5a1a24', 0.32);
    }
  }

  /* ==================================================================
     Hair
     ================================================================== */
  var STYLE = {
    twinTails:  { bangs: 'swept', side: 7.4,  back: 'short' },
    longBraids: { bangs: 'swept', side: 6.6,  back: 'short' },
    buns:       { bangs: 'swept', side: 6.2,  back: 'short' },
    bob:        { bangs: 'blunt', side: 12.6, back: 'bob', sideW: 1.5 },
    ponytail:   { bangs: 'swept', side: 6.8,  back: 'pony' },
    longHair:   { bangs: 'part',  side: 14.6, back: 'short' },
    sideTail:   { bangs: 'swept', side: 7.4,  back: 'short' },
    pixie:      { bangs: 'pixie', side: 3.6,  back: 'pixie' },
    lowTails:   { bangs: 'swept', side: 6.4,  back: 'short' },
    puffs:      { bangs: 'blunt', side: 5.2,  back: 'short' },
    topKnot:    { bangs: 'part',  side: 8.6,  back: 'pony' },
    wavy:       { bangs: 'swept', side: 11.6, back: 'short', sideW: 1.3 },
    bunTails:   { bangs: 'swept', side: 6.8,  back: 'short' },
  };
  function styleOf(cu) { return STYLE[cu.hairStyle] || STYLE.twinTails; }

  /* Fringe locks: [tipX, tipY, width, sweep]. Each is a curved teardrop
     from the crown to its tip; together they make the clumped fringe. */
  var BANGS = {
    swept: [[-11.6, HY + 4.2, 6.2, -1], [-7.4, HY + 1.6, 7.4, -0.6], [-2.4, HY + 0.6, 7.6, 0.2],
            [3.0, HY + 1.0, 7.4, 0.8], [8.2, HY + 2.2, 7, 1.2], [12.2, HY + 5.4, 5.4, 1],
            [-4.8, HY - 2.4, 4.4, -0.3], [0.6, HY - 2.0, 4.6, 0.6], [5.8, HY - 1.8, 4.2, 1]],
    blunt: [[-11.8, HY + 5, 6.6, -0.4], [-7.6, HY + 2.2, 7.2, -0.2], [-2.6, HY + 1.6, 7.4, 0],
            [2.8, HY + 1.6, 7.4, 0.2], [8.0, HY + 2.4, 7.2, 0.4], [12.0, HY + 5.4, 6, 0.4],
            [-5.2, HY + 0.6, 4.6, 0], [0.2, HY + 0.8, 4.6, 0.1], [5.4, HY + 0.8, 4.6, 0.2]],
    part:  [[-11.8, HY + 6.2, 6.6, -1.3], [-7.6, HY + 1.4, 7.6, -1.4], [-3.0, HY - 0.6, 6.6, -1.2],
            [3.4, HY - 0.2, 6.4, 1.2], [8.2, HY + 1.6, 7.6, 1.4], [12.2, HY + 6.4, 6, 1.3],
            [-5.6, HY - 2.8, 4.4, -1], [5.4, HY - 2.6, 4.4, 1]],
    pixie: [[-11.4, HY + 1.6, 6.4, -1.4], [-7.0, HY - 0.6, 7, -1.2], [-2.2, HY - 1.6, 7.2, -0.6],
            [3.2, HY - 1.2, 7.2, 0.8], [8.4, HY + 0.2, 6.6, 1.6], [12.0, HY + 2.6, 5.4, 1.8],
            [0.4, HY - 4.2, 4.8, 1.2], [-4.6, HY - 4.4, 4.4, -0.6]],
  };
  var CROWN_Y = HY - 12.4;
  function lockPath(c, L) {
    var tx = L[0], ty = L[1], w = L[2], sw = L[3];
    var rx = tx * 0.38, ry = CROWN_Y;
    var my = (ry + ty) / 2;
    /* clockwise, like the cap, so the union fills without holes */
    c.moveTo(rx + w * 0.28, ry);
    c.bezierCurveTo(rx + w * 0.62, my - 1.5, tx + w * 0.42 - sw * 1.6, ty - 3.4, tx, ty);
    c.bezierCurveTo(tx - w * 0.5 - sw * 1.2, ty - 4.2, rx - w * 0.62, my - 1, rx - w * 0.28, ry);
    c.closePath();
  }
  function capPath(c, wide) {
    var R = 14.5 + (wide || 0);
    c.moveTo(-R + 0.2, HY + 1);
    c.ellipse(0, HY - 1.2, R, 13.9, 0, Math.PI * 0.98, Math.PI * 2.02);
    c.quadraticCurveTo(R - 0.4, HY + 4, R - 1.4, HY + 5.5);
    c.quadraticCurveTo(10.5, HY - 2, 0, HY - 6);
    c.quadraticCurveTo(-10.5, HY - 2, -R + 1.4, HY + 5.5);
    c.closePath();
  }
  /* Face-framing lock: from the temple down past the cheek, tip curling in. */
  function sideLockPath(c, side, len, wide) {
    var w = wide || 1;
    var x = function (v) { return side * v; };
    var ty = HY + 2 + len;
    c.moveTo(x(10.6), HY - 4.5);
    c.bezierCurveTo(x(14.8 + w), HY - 1, x(14.4 + w * 0.8), ty - len * 0.45, x(12.3 + w * 0.4), ty);
    c.quadraticCurveTo(x(11.6 + w * 0.3), ty - 1.3, x(10.8 + w * 0.2), ty - 2.6);
    c.quadraticCurveTo(x(10.3 + w * 0.5), ty - 1, x(9.6), ty - 1.6);
    c.bezierCurveTo(x(10.8), ty - len * 0.5, x(10.2), HY + 1, x(8.6), HY - 3.6);
    c.closePath();
  }
  function fringeShadowShapes(c, cu) {
    var st = styleOf(cu), B = BANGS[st.bangs];
    c.beginPath();
    capPath(c, st.bangs === 'blunt' ? 0.4 : 0);
    for (var i = 0; i < B.length; i++) lockPath(c, B[i]);
    c.fill();
    if (st.side) {
      c.beginPath(); sideLockPath(c, -1, st.side, st.sideW); c.fill();
      c.beginPath(); sideLockPath(c, 1, st.side, st.sideW); c.fill();
    }
  }
  function frontHairUnion(c, cu) {
    var st = styleOf(cu), B = BANGS[st.bangs];
    return function () {
      c.beginPath();
      capPath(c, st.bangs === 'blunt' ? 0.4 : 0);
      for (var i = 0; i < B.length; i++) lockPath(c, B[i]);
    };
  }

  function hairCol(cu) { return cu.hair; }

  /* The back of the head: everything behind the face that doesn't hang. */
  function drawHairBack(c, cu) {
    var col = tone(hairCol(cu), 'd1'), st = styleOf(cu), back = st.back;
    var path;
    if (back === 'bob') {
      path = function () {
        c.beginPath();
        c.moveTo(-14.8, HY);
        c.ellipse(0, HY - 1.2, 15, 14.2, 0, Math.PI, TAU);
        c.bezierCurveTo(16.6, HY + 4, 17, HY + 10, 15, HY + 13.6);
        c.quadraticCurveTo(12.4, HY + 14.8, 10.6, HY + 12.6);
        c.lineTo(-10.6, HY + 12.6);
        c.quadraticCurveTo(-12.4, HY + 14.8, -15, HY + 13.6);
        c.bezierCurveTo(-17, HY + 10, -16.6, HY + 4, -14.8, HY);
        c.closePath();
      };
    } else if (back === 'pixie') {
      path = function () {
        c.beginPath();
        c.moveTo(-14.4, HY + 1);
        c.ellipse(0, HY - 1.2, 14.6, 13.8, 0, Math.PI, TAU);
        c.quadraticCurveTo(15, HY + 5, 13.2, HY + 7.4);
        c.lineTo(-13.2, HY + 7.4);
        c.quadraticCurveTo(-15, HY + 5, -14.4, HY + 1);
        c.closePath();
      };
    } else {
      var lo = back === 'pony' ? 7.6 : 10.6;
      path = function () {
        c.beginPath();
        c.moveTo(-14.7, HY);
        c.ellipse(0, HY - 1.2, 14.9, 14.2, 0, Math.PI, TAU);
        c.bezierCurveTo(15.5, HY + 4, 15.3, HY + lo - 2, 14.3, HY + lo);
        c.quadraticCurveTo(13.2, HY + lo - 1.4, 12, HY + lo - 0.6);
        c.lineTo(-12, HY + lo - 0.6);
        c.quadraticCurveTo(-13.2, HY + lo - 1.4, -14.3, HY + lo);
        c.bezierCurveTo(-15.3, HY + lo - 2, -15.5, HY + 4, -14.7, HY);
        c.closePath();
      };
    }
    cel(c, path, col, { s: 2, ink: 0.8, inkCol: tone(hairCol(cu), 'ink'), x0: -15, x1: 15, y0: HY - 14, y1: HY + 14, rim: 0.5 });
    if (cu.hairStyle === 'buns' || cu.hairStyle === 'bunTails') {
      bun(c, cu, -10.4, HY - 10.6);
      bun(c, cu, 10.4, HY - 10.6);
    } else if (cu.hairStyle === 'puffs') {
      puff(c, cu, -15.6, HY - 4.6);
      puff(c, cu, 15.6, HY - 4.6);
    } else if (cu.hairStyle === 'topKnot') {
      bun(c, cu, 0, HY - 16.8, 1.15);
    }
  }
  function bun(c, cu, x, y, k) {
    var col = hairCol(cu);
    k = k || 1;
    cel(c, function () { ell(c, x, y, 6.2 * k, 5.9 * k); }, col, { s: 2, ink: 0.8, x0: x - 6 * k, x1: x + 6 * k, y0: y - 6 * k, y1: y + 6 * k });
    var ink = tone(col, 'ink');
    c.beginPath(); c.arc(x + 0.4, y + 0.4, 3.6 * k, Math.PI * 0.8, Math.PI * 2.1); stroke(c, ink, 0.45);
    c.beginPath(); c.arc(x - 0.2, y + 0.6, 1.8 * k, Math.PI * 1.1, Math.PI * 2.3); stroke(c, ink, 0.4);
    c.beginPath(); c.arc(x - LIT * 0.4, y + 0.2, 4.6 * k, Math.PI * 1.15, Math.PI * 1.6);
    stroke(c, tone(col, 'hi'), 1.1);
    glint(c, x - LIT * 2.2 * k, y - 3 * k, 0.8, 0.45, 0.9);
  }
  /* A big round puff of curls beside the head. */
  function puff(c, cu, x, y) {
    var col = hairCol(cu), side = x < 0 ? -1 : 1;
    cel(c, function () { fluffPath(c, x, y, 7.4, 9, 0.3); }, col,
      { s: 2.4, ink: 0.8, x0: x - 9.5, x1: x + 9.5, y0: y - 9.5, y1: y + 9.5, rim: 0.7 });
    c.save();
    fluffPath(c, x, y, 7.4, 9, 0.3);
    c.clip();
    /* the ball turns away from the sun underneath */
    c.globalAlpha = 0.55;
    c.beginPath();
    c.ellipse(x, y, 11, 11, 0, 0, TAU);
    c.ellipse(x - LIT * 2.2, y - 3.2, 8.2, 8.2, 0, 0, TAU, true);
    c.fillStyle = tone(col, 'd2');
    c.fill();
    c.globalAlpha = 1;
    /* curls: little hooks spiralling round the ball */
    c.beginPath();
    for (var i = 0; i < 7; i++) {
      var a = i * 0.9 + 0.5, r = i === 6 ? 0.6 : 5.2 - (i % 2) * 1.5;
      var px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      c.moveTo(px + 1.5, py);
      c.arc(px, py, 1.5, 0, Math.PI * 1.25);
    }
    stroke(c, tone(col, 'd2'), 0.42);
    c.beginPath();
    c.arc(x - LIT * 0.6, y + 0.4, 6, Math.PI * 1.12, Math.PI * 1.58);
    c.globalAlpha = 0.9;
    stroke(c, tone(col, 'hi'), 1.5);
    c.restore();
    glint(c, x - LIT * 3.4, y - 4.4, 1, 0.5, 0.9, -0.5 * LIT);
    scrunchie(c, x - side * 6.6, y - 0.6, cu.outfitColor);
  }

  function drawHairFront(c, cu) {
    var col = hairCol(cu), st = styleOf(cu), B = BANGS[st.bangs];
    var ink = tone(col, 'ink');
    var wide = st.bangs === 'blunt' ? 0.4 : 0;
    /* side locks first: the fringe overlaps their roots */
    if (st.side) {
      for (var s = -1; s <= 1; s += 2) {
        (function (side) {
          var p = function () { c.beginPath(); sideLockPath(c, side, st.side, st.sideW); };
          cel(c, p, col, { s: 1.6, ink: 0.65, inkCol: ink, x0: side * 9, x1: side * 15, y0: HY - 4, y1: HY + 2 + st.side, rim: 0.6 });
          c.beginPath();
          c.moveTo(side * 11.2, HY - 2);
          c.quadraticCurveTo(side * 12.8, HY + st.side * 0.5, side * 11.8, HY + st.side - 0.5);
          stroke(c, tone(col, 'd2'), 0.35);
          c.beginPath();
          c.moveTo(side * 12.6, HY - 1.5);
          c.quadraticCurveTo(side * 13.6, HY + 1.5, side * 13.2, HY + st.side * 0.4);
          c.globalAlpha = 0.8;
          stroke(c, tone(col, 'hi'), 0.6);
          c.globalAlpha = 1;
        })(s);
      }
    }
    /* cap and fringe locks as one silhouette: ink it at double width
       first so the fill leaves only the outer half of the line, then
       shade it once so the crown reads as one clean dome and the bands
       step down each clump's far side */
    var U0 = frontHairUnion(c, cu);
    U0();
    c.strokeStyle = ink;
    c.lineWidth = 1.6;
    c.lineJoin = 'round';
    c.stroke();
    cel(c, U0, col, { s: 2.4, ink: 0 });
    /* a little shade on one flank of each lock, and its parting line,
       both fading out toward the crown */
    for (var i = 0; i < B.length; i++) {
      (function (L) {
        var tx = L[0], ty = L[1], w = L[2], sw = L[3];
        var fade = c.createLinearGradient(0, ty - 9, 0, ty);
        fade.addColorStop(0, 'rgba(0,0,0,0)');
        fade.addColorStop(1, ink);
        c.save();
        U0();
        c.clip();
        c.beginPath();
        c.moveTo(tx, ty);
        c.bezierCurveTo(tx + w * 0.42 - sw * 1.6, ty - 3.4, tx * 0.38 + w * 0.62, (CROWN_Y + ty) / 2 - 1.5, tx * 0.38 + w * 0.3, CROWN_Y + 3);
        c.quadraticCurveTo(tx * 0.6 + w * 0.1, (CROWN_Y + ty) / 2, tx, ty);
        c.closePath();
        var sh = c.createLinearGradient(0, ty - 8, 0, ty);
        sh.addColorStop(0, 'rgba(0,0,0,0)');
        sh.addColorStop(1, tone(col, 'd1'));
        c.fillStyle = sh;
        c.globalAlpha = 0.75;
        c.fill();
        c.globalAlpha = 1;
        c.restore();
        c.beginPath();
        c.moveTo(tx, ty);
        c.bezierCurveTo(tx + w * 0.42 - sw * 1.6, ty - 3.4, tx * 0.38 + w * 0.62, (CROWN_Y + ty) / 2 - 1.5, tx * 0.38 + w * 0.3, CROWN_Y + 3);
        c.strokeStyle = fade;
        c.lineWidth = 0.55;
        c.stroke();
      })(B[i]);
    }
    /* outline of the whole crown */
    c.beginPath();
    c.ellipse(0, HY - 1.2, 14.5 + wide, 13.9, 0, Math.PI * 1.0, Math.PI * 2.0);
    stroke(c, ink, 0.85);
    /* angel ring: a toothed band of sheen round the crown */
    var U = frontHairUnion(c, cu);
    c.save();
    U();
    c.clip();
    c.fillStyle = tone(col, 'hi');
    c.globalAlpha = 0.95;
    var cx = -LIT * 0.8, cy = HY - 0.6, rr = 10.8;
    var a0 = Math.PI * 1.13, a1 = Math.PI * 1.87;
    c.beginPath();
    c.arc(cx, cy, rr, a0, a1);
    var n = 14;
    for (var k = n; k >= 0; k--) {
      var a = a0 + (a1 - a0) * (k / n);
      var dip = k % 2 === 0 ? 1.9 : 0.7;
      c.lineTo(cx + Math.cos(a) * (rr - dip), cy + Math.sin(a) * (rr - dip) * 0.95);
    }
    c.closePath();
    c.fill();
    c.globalAlpha = 1;
    var ga = a0 + (a1 - a0) * (LIT > 0 ? 0.28 : 0.72);
    glint(c, cx + Math.cos(ga) * (rr - 1), cy + Math.sin(ga) * (rr - 1), 1.5, 0.6, 0.95, ga + Math.PI / 2);
    glint(c, cx + Math.cos(ga + 0.5) * (rr - 1.3), cy + Math.sin(ga + 0.5) * (rr - 1.3), 0.6, 0.35, 0.8);
    /* sky rim down the shadow side */
    var sx = LIT * 15;
    var rg = c.createLinearGradient(sx, 0, sx - LIT * 6, 0);
    rg.addColorStop(0, 'rgba(200, 232, 255, 0.3)');
    rg.addColorStop(1, 'rgba(200, 232, 255, 0)');
    c.fillStyle = rg;
    c.fillRect(-16, HY - 16, 32, 24);
    c.restore();
    /* ties and bows that sit on the hair */
    if (cu.hairStyle === 'twinTails') {
      scrunchie(c, -13.4, HY - 6.2, PAL.peach);
      scrunchie(c, 13.4, HY - 6.2, PAL.peach);
    } else if (cu.hairStyle === 'sideTail') {
      bow(c, 13.2, HY - 6.4, cu.outfitColor, 0.9);
    } else if (cu.hairStyle === 'topKnot') {
      bow(c, 0.4, HY - 13.4, cu.outfitColor, 0.78);
    }
    drawCharm(c, cu);
    if (cu.accessory === 'ribbon') {
      bow(c, 6.2, HY - 12.4, PAL.peach, 1.25);
      /* polka dots on the loops */
      var RD = [[-3.4, -1.4], [-2.2, 1.3], [-4.4, 0.6], [3.4, -1.4], [2.2, 1.3], [4.4, 0.6]];
      for (var rd = 0; rd < RD.length; rd++) dot(c, 6.2 + RD[rd][0], HY - 12.4 + RD[rd][1], 0.42, 0.42, '#fff8ee');
    }
  }
  function scrunchie(c, x, y, col) {
    cel(c, function () { ell(c, x, y, 2.3, 2.7); }, col, { s: 0.9, ink: 0.5 });
    c.beginPath();
    c.moveTo(x - 1.4, y - 1.2); c.lineTo(x + 1.2, y - 0.6);
    c.moveTo(x - 1.4, y + 0.8); c.lineTo(x + 1.3, y + 1.2);
    stroke(c, tone(col, 'd2'), 0.3);
    glint(c, x - LIT * 0.8, y - 1.3, 0.6, 0.4, 0.85);
  }
  function bow(c, x, y, col, k) {
    k = k || 1;
    var loop = function (dir) {
      return function () {
        c.beginPath();
        c.moveTo(x, y);
        c.bezierCurveTo(x + dir * 1.4 * k, y - 3.4 * k, x + dir * 4.6 * k, y - 3 * k, x + dir * 4.2 * k, y);
        c.bezierCurveTo(x + dir * 4.6 * k, y + 3 * k, x + dir * 1.4 * k, y + 3.2 * k, x, y);
        c.closePath();
      };
    };
    cel(c, loop(-1), col, { s: 1, ink: 0.5 });
    cel(c, loop(1), col, { s: 1, ink: 0.5 });
    c.beginPath();
    c.moveTo(x - 1.6 * k, y - 0.9 * k); c.quadraticCurveTo(x - 2.6 * k, y, x - 1.6 * k, y + 0.9 * k);
    c.moveTo(x + 1.6 * k, y - 0.9 * k); c.quadraticCurveTo(x + 2.6 * k, y, x + 1.6 * k, y + 0.9 * k);
    stroke(c, tone(col, 'd2'), 0.3);
    cel(c, function () { ell(c, x, y, 1.2 * k, 1.4 * k); }, tone(col, 'd1'), { s: 0.5, ink: 0.4, inkCol: tone(col, 'ink') });
    glint(c, x - LIT * 2.6 * k, y - 1.2 * k, 0.8 * k, 0.4 * k, 0.8, -0.4 * LIT);
  }

  /* ---- Hanging hair, ribbons and the cape: chain pieces ----
     Each returns { k (cache key), x, y (pivot, head frame unless body),
     a (rest angle), bx, by, bw, bh (bitmap box in the pivot frame),
     n (slices), m (how much the sway moves it), out (+1 / -1), draw }. */
  function tailShape(c, o, len, wid) {
    return function () {
      c.beginPath();
      c.moveTo(-o * 1.8, -1.8);
      c.bezierCurveTo(o * wid * 1.25, -3.8, o * wid * 1.35, len * 0.42, o * wid * 0.8, len * 0.76);
      c.quadraticCurveTo(o * wid * 0.62, len * 0.94, o * wid * 0.22, len * 1.02);
      c.quadraticCurveTo(o * wid * 0.42, len * 0.86, o * wid * 0.2, len * 0.76);
      c.quadraticCurveTo(o * wid * 0.05, len * 0.9, -o * wid * 0.22, len * 0.93);
      c.quadraticCurveTo(o * wid * 0.08, len * 0.62, -o * wid * 0.3, len * 0.28);
      c.quadraticCurveTo(-o * 2.6, len * 0.1, -o * 1.8, -1.8);
      c.closePath();
    };
  }
  function tailUnder(c, o, len, wid) {
    return function () {
      c.beginPath();
      c.moveTo(-o * 0.6, 2);
      c.quadraticCurveTo(-o * wid * 0.6, len * 0.4, -o * wid * 0.1, len * 0.86);
      c.quadraticCurveTo(o * wid * 0.25, len * 0.6, o * wid * 0.3, len * 0.3);
      c.closePath();
    };
  }
  function drawTail(c, col, o, len, wid) {
    var ink = tone(col, 'ink');
    cel(c, tailUnder(c, o, len, wid), tone(col, 'd1'), { s: 1, ink: 0.6, inkCol: ink });
    var p = tailShape(c, o, len, wid);
    var x0 = o > 0 ? -wid * 0.3 : wid * 1.3, x1 = o > 0 ? wid * 1.3 : -wid * 0.3;
    cel(c, p, col, { s: 2, ink: 0.75, inkCol: ink, x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: 0, y1: len, rim: 0.7 });
    c.save();
    p();
    c.clip();
    c.beginPath();
    c.moveTo(o * 0.6, 1.5); c.bezierCurveTo(o * wid * 0.9, len * 0.2, o * wid * 0.95, len * 0.5, o * wid * 0.5, len * 0.8);
    c.moveTo(-o * 0.6, 3); c.bezierCurveTo(o * wid * 0.3, len * 0.3, o * wid * 0.4, len * 0.6, o * wid * 0.1, len * 0.88);
    stroke(c, tone(col, 'd2'), 0.38);
    c.beginPath();
    c.moveTo(o * wid * 0.25 - LIT * 0.5, 0.5);
    c.bezierCurveTo(o * wid * 0.95, len * 0.12, o * wid * 1.05, len * 0.3, o * wid * 0.85, len * 0.44);
    c.globalAlpha = 0.85;
    stroke(c, tone(col, 'hi'), 1.2);
    c.globalAlpha = 1;
    glint(c, o * wid * 0.82, len * 0.17, 0.9, 0.4, 0.9, o * 0.9);
    c.restore();
  }
  function braidChain(c, col, tie) {
    for (var b = 0; b < 6; b++) {
      var by = 1.6 + b * 4.1, r = 3.3 - b * 0.15, ox = (b % 2 ? 0.7 : -0.7);
      (function (bx, by, r, rot) {
        cel(c, function () { ell(c, bx, by, r, r * 0.95 + 0.4, rot); }, col,
          { s: 1.3, ink: 0.6, x0: bx - r, x1: bx + r, y0: by - r, y1: by + r, rim: 0.5 });
        c.beginPath();
        c.moveTo(bx - r * 0.5, by - r * 0.4);
        c.quadraticCurveTo(bx, by - r * 0.85, bx + r * 0.5, by - r * 0.4);
        stroke(c, tone(col, 'hi'), 0.55);
      })(ox, by, r, ox * 0.4);
    }
    var ty = 26.4;
    cel(c, function () {
      c.beginPath();
      c.moveTo(-1.8, ty);
      c.quadraticCurveTo(-2.6, ty + 3.4, -0.4, ty + 4.6);
      c.quadraticCurveTo(0.3, ty + 2.8, 1.8, ty + 4);
      c.quadraticCurveTo(2.2, ty + 1.8, 1.8, ty);
      c.closePath();
    }, col, { s: 0.8, ink: 0.55 });
    scrunchie(c, 0, ty - 0.4, tie);
  }
  function longCurtain(c, col) {
    var p = function () {
      c.beginPath();
      c.moveTo(-14.4, -2);
      c.bezierCurveTo(-17, 8, -17.2, 18, -15.6, 27);
      c.quadraticCurveTo(-13.4, 30.4, -11.4, 28.2);
      c.quadraticCurveTo(-9.6, 31.4, -6.6, 29.2);
      c.quadraticCurveTo(-3.4, 31.6, 0, 29.4);
      c.quadraticCurveTo(3.4, 31.6, 6.6, 29.2);
      c.quadraticCurveTo(9.6, 31.4, 11.4, 28.2);
      c.quadraticCurveTo(13.4, 30.4, 15.6, 27);
      c.bezierCurveTo(17.2, 18, 17, 8, 14.4, -2);
      c.closePath();
    };
    cel(c, p, tone(col, 'd1'), { s: 2, ink: 0.8, inkCol: tone(col, 'ink'), x0: -17, x1: 17, y0: 0, y1: 30, rim: 0.6 });
    c.save();
    p();
    c.clip();
    c.beginPath();
    for (var i = -3; i <= 3; i++) {
      c.moveTo(i * 3.6, 2);
      c.quadraticCurveTo(i * 4.4, 16, i * 4.2 + 0.4, 28);
    }
    stroke(c, tone(col, 'd2'), 0.4);
    c.beginPath();
    c.moveTo(-LIT * 12, 4); c.quadraticCurveTo(-LIT * 14.6, 12, -LIT * 13.6, 20);
    c.globalAlpha = 0.7;
    stroke(c, tone(col, 'hi'), 1.2);
    c.restore();
  }
  /* Long waves: a wide cloud of hair with a scalloped edge that ends in
     fat curls at the waist. */
  function wavyCurtain(c, col) {
    var n = 4, y0 = -2, y1 = 21, i;
    var W0 = function (k) { return 15.2 + k * 1.25; };
    var p = function () {
      c.beginPath();
      c.moveTo(-14.4, y0);
      for (i = 0; i < n; i++) {
        c.quadraticCurveTo(-W0(i) - 3.6, y0 + (y1 - y0) * (i + 0.5) / n, -W0(i) - 1.2, y0 + (y1 - y0) * (i + 1) / n);
      }
      var bx = [-W0(n - 1) - 1.2, -12.2, -4.1, 4.1, 12.2, W0(n - 1) + 1.2];
      for (i = 0; i < 5; i++) c.quadraticCurveTo((bx[i] + bx[i + 1]) / 2, y1 + 6.6, bx[i + 1], y1 + (i === 4 ? 0 : 0.8));
      for (i = n - 1; i >= 0; i--) {
        c.quadraticCurveTo(W0(i) + 3.6, y0 + (y1 - y0) * (i + 0.5) / n, i ? W0(i - 1) + 1.2 : 14.4, y0 + (y1 - y0) * i / n);
      }
      c.closePath();
    };
    cel(c, p, tone(col, 'd1'), { s: 2.2, ink: 0.8, inkCol: tone(col, 'ink'), x0: -21, x1: 21, y0: 0, y1: 27, rim: 0.7 });
    c.save();
    p();
    c.clip();
    /* strands that snake down, and the curl inside each lobe */
    c.beginPath();
    for (i = -2; i <= 2; i++) {
      c.moveTo(i * 4.4, 1);
      c.bezierCurveTo(i * 4.4 - 2.4, 7, i * 5.2 + 2.6, 13, i * 5.6, 20);
    }
    for (i = 0; i < 5; i++) {
      var lx = -16.3 + i * 8.15;
      c.moveTo(lx + 2.6, y1 + 0.4);
      c.arc(lx, y1 + 0.6, 2.6, 0, Math.PI * 1.2);
    }
    stroke(c, tone(col, 'd2'), 0.42);
    c.beginPath();
    c.moveTo(-LIT * 13.4, 3);
    c.bezierCurveTo(-LIT * 17.6, 8, -LIT * 15.4, 13, -LIT * 18.6, 19);
    c.globalAlpha = 0.75;
    stroke(c, tone(col, 'hi'), 1.3);
    c.restore();
    for (i = 0; i < 5; i++) glint(c, -16.3 + i * 8.15 - LIT * 1.2, y1 + 1.8, 0.9, 0.4, 0.5, -0.4 * LIT);
  }
  function ribbonTail(c, col, len) {
    var p = function () {
      c.beginPath();
      c.moveTo(-1.4, 0);
      c.bezierCurveTo(-2.2, len * 0.4, 0.4, len * 0.7, -0.6, len);
      c.lineTo(1.0, len - 1.6);
      c.lineTo(2.2, len + 0.2);
      c.bezierCurveTo(2.6, len * 0.7, 0.4, len * 0.4, 1.4, 0);
      c.closePath();
    };
    cel(c, p, col, { s: 0.8, ink: 0.5 });
  }

  function hangingHair(cu) {
    var col = hairCol(cu), out = [];
    switch (cu.hairStyle) {
      case 'twinTails':
        out.push({ k: 'tl0', x: -13.2, y: HY - 6, a: 0.2, bx: -16, by: -6, bw: 22, bh: 36, n: 3, m: 1, out: -1,
                   draw: function (g) { drawTail(g, col, -1, 26, 6.8); } });
        out.push({ k: 'tl1', x: 13.2, y: HY - 6, a: -0.2, bx: -6, by: -6, bw: 22, bh: 36, n: 3, m: 1, out: 1,
                   draw: function (g) { drawTail(g, col, 1, 26, 6.8); } });
        break;
      case 'ponytail':
        out.push({ k: 'tl0', x: -10.4, y: HY - 9.6, a: 0.62, bx: -17, by: -6, bw: 24, bh: 40, n: 4, m: 1.15, out: -1,
                   draw: function (g) { drawTail(g, col, -1, 29, 7.6); scrunchie(g, 0, -0.6, cu.outfitColor); } });
        break;
      case 'sideTail':
        out.push({ k: 'tl0', x: 13.4, y: HY - 6.2, a: -0.3, bx: -6, by: -6, bw: 22, bh: 36, n: 3, m: 1, out: 1,
                   draw: function (g) { drawTail(g, col, 1, 25, 7.2); } });
        break;
      case 'longBraids':
        out.push({ k: 'tl0', x: -11.6, y: HY + 5.4, a: 0.06, bx: -6, by: -4, bw: 12, bh: 36, n: 3, m: 0.55, out: -1,
                   draw: function (g) { braidChain(g, col, PAL.peach); } });
        out.push({ k: 'tl1', x: 11.6, y: HY + 5.4, a: -0.06, bx: -6, by: -4, bw: 12, bh: 36, n: 3, m: 0.55, out: 1,
                   draw: function (g) { braidChain(g, col, PAL.peach); } });
        break;
      case 'longHair':
        out.push({ k: 'tlc', x: 0, y: HY - 2, a: 0, bx: -18, by: -3, bw: 36, bh: 36, n: 3, m: 0.35, out: 0,
                   draw: function (g) { longCurtain(g, col); } });
        break;
      case 'wavy':
        out.push({ k: 'tlc', x: 0, y: HY - 2, a: 0, bx: -23.5, by: -3, bw: 47, bh: 31, n: 3, m: 0.4, out: 0,
                   draw: function (g) { wavyCurtain(g, col); } });
        break;
      case 'bunTails':
        out.push({ k: 'tl0', x: -14.2, y: HY - 9.4, a: 0.2, bx: -11, by: -5, bw: 15, bh: 38, n: 4, m: 1.1, out: -1,
                   draw: function (g) { drawTail(g, col, -1, 31, 4.4); } });
        out.push({ k: 'tl1', x: 14.2, y: HY - 9.4, a: -0.2, bx: -4, by: -5, bw: 15, bh: 38, n: 4, m: 1.1, out: 1,
                   draw: function (g) { drawTail(g, col, 1, 31, 4.4); } });
        break;
      case 'lowTails':
        out.push({ k: 'tl0', x: -12.4, y: HY + 6.6, a: 0.14, bx: -12, by: -5, bw: 17, bh: 29, n: 3, m: 0.8, out: -1,
                   draw: function (g) { drawTail(g, col, -1, 21, 5.8); bow(g, -0.6, -0.2, cu.outfitColor, 0.66); } });
        out.push({ k: 'tl1', x: 12.4, y: HY + 6.6, a: -0.14, bx: -5, by: -5, bw: 17, bh: 29, n: 3, m: 0.8, out: 1,
                   draw: function (g) { drawTail(g, col, 1, 21, 5.8); bow(g, 0.6, -0.2, cu.outfitColor, 0.66); } });
        break;
    }
    if (cu.accessory === 'ribbon') {
      out.push({ k: 'rb0', x: 8.6, y: HY - 11.6, a: -0.18, bx: -3, by: -1, bw: 6.5, bh: 17, n: 3, m: 1.3, out: 1,
                 draw: function (g) { ribbonTail(g, PAL.peach, 14); } });
      out.push({ k: 'rb1', x: 9.8, y: HY - 11.2, a: -0.42, bx: -3, by: -1, bw: 6.5, bh: 15, n: 3, m: 1.4, out: 1,
                 draw: function (g) { ribbonTail(g, tone(PAL.peach, 'd1'), 12); } });
    }
    return out;
  }

  /* ==================================================================
     Charms (glasses, clips) and hats
     ================================================================== */
  function drawCharm(c, cu) {
    switch (cu.charm) {
      case 'heartClip':
        cel(c, function () { heartPath(c, 9.6, HY - 4.6, 2.4); }, '#ff4a6e', { s: 0.8, ink: 0.5 });
        glint(c, 8.8, HY - 5.6, 0.7, 0.45, 0.9, -0.5);
        break;
      case 'starClip':
        cel(c, function () { starPath(c, 9.8, HY - 4.8, 3.1, 0.48); }, '#ffd24a', { s: 0.8, ink: 0.5 });
        glint(c, 9.2, HY - 5.6, 0.7, 0.45, 0.9);
        break;
      case 'flowerClip':
        for (var p = 0; p < 5; p++) {
          var a = p * TAU / 5 - Math.PI / 2;
          (function (px, py) {
            cel(c, function () { ell(c, px, py, 1.65, 1.65); }, '#fff2f6', { s: 0.6, ink: 0.4, inkCol: '#b85a7a' });
          })(10 + Math.cos(a) * 1.7, HY - 5 + Math.sin(a) * 1.7);
        }
        dot(c, 10, HY - 5, 1.1, 1.1, PAL.sun);
        stroke(c, '#b07a18', 0.3);
        break;
      case 'butterflyClip':
        c.save();
        c.translate(9.9, HY - 4.9);
        c.rotate(0.38);
        for (var bs = -1; bs <= 1; bs += 2) {
          (function (sd) {
            cel(c, function () { ell(c, sd * 1.5, 1.4, 1.5, 1.25, sd * 0.5); }, '#c89af0', { s: 0.5, ink: 0.4 });
            cel(c, function () { ell(c, sd * 2.1, -0.9, 2.3, 1.8, -sd * 0.5); }, '#7cc8ff', { s: 0.7, ink: 0.4 });
            dot(c, sd * 2.6, -1.1, 0.6, 0.6, '#fffbe8');
          })(bs);
        }
        cel(c, function () { capsule(c, 0, -1.7, 0.55, 0, 1.9, 0.4); }, '#5a3a8a', { s: 0.3, ink: 0.3 });
        c.beginPath();
        c.moveTo(-0.2, -2); c.quadraticCurveTo(-1, -3.4, -1.7, -3.5);
        c.moveTo(0.2, -2); c.quadraticCurveTo(1, -3.4, 1.7, -3.5);
        stroke(c, '#5a3a8a', 0.3);
        c.restore();
        break;
    }
  }
  /* Charms worn on the face itself, under the fringe. */
  function drawFacePaint(c, cu) {
    var nx = -5.6 + F, fx = 7.2 + F, cy = EYE_Y + 4.5, k = F ? 0.8 : 1;
    var skin = cu.skin, i;
    c.save();
    facePath(c);
    c.clip();
    switch (cu.charm) {
      case 'freckles':
        var FR = [[-1.9, -0.5], [-0.4, 0.2], [1.2, -0.5], [-1.1, 0.9], [0.5, 1]];
        var fcol = mix(tone(skin, 'd2', true), '#7a3a1e', 0.6);
        for (i = 0; i < FR.length; i++) {
          dot(c, nx + 0.6 + FR[i][0] * 1.15, cy - 0.4 + FR[i][1], 0.42, 0.38, fcol);
          if (i < 4) dot(c, fx - 0.4 + FR[i][0] * k, cy - 0.4 + FR[i][1], 0.42 * k, 0.38, fcol);
        }
        dot(c, F * 1.7 - 1.3, HY + 7, 0.36, 0.34, fcol);
        dot(c, F * 1.7 + 0.3, HY + 6.6, 0.36, 0.34, fcol);
        dot(c, F * 1.7 + 1.8, HY + 7, 0.36, 0.34, fcol);
        break;
      case 'whiskers':
        var wk = '#4a2030';
        c.beginPath();
        for (i = -1; i <= 1; i++) {
          c.moveTo(nx + 1.6, cy + i * 0.8);
          c.quadraticCurveTo(nx - 0.8, cy + i * 1.2 - 0.2, nx - 3.4, cy + i * 1.9);
          c.moveTo(fx - 1.4 * k, cy + i * 0.8);
          c.quadraticCurveTo(fx + 0.6 * k, cy + i * 1.2 - 0.2, fx + 2.6 * k, cy + i * 1.9);
        }
        stroke(c, wk, 0.42);
        /* a pink button nose over her own */
        var bx = F * 1.7 + 0.3, by = HY + 8.2;
        cel(c, function () {
          c.beginPath();
          c.moveTo(bx - 1.3, by - 0.7);
          c.quadraticCurveTo(bx, by - 1.1, bx + 1.3, by - 0.7);
          c.quadraticCurveTo(bx + 0.9, by + 0.8, bx, by + 0.9);
          c.quadraticCurveTo(bx - 0.9, by + 0.8, bx - 1.3, by - 0.7);
          c.closePath();
        }, '#ff7a9c', { s: 0.4, ink: 0.35, inkCol: wk });
        glint(c, bx - 0.4, by - 0.5, 0.35, 0.2, 0.9);
        break;
      case 'rainbow':
        var RB = ['#f0485a', '#ffb43a', '#ffe24a', '#58c06a', '#4a9af0'];
        c.save();
        c.lineCap = 'butt';
        for (i = 0; i < RB.length; i++) {
          c.beginPath();
          c.arc(nx + 0.4, cy + 1.9, 2.9 - i * 0.44, Math.PI * 1.04, Math.PI * 1.96);
          c.strokeStyle = RB[i];
          c.lineWidth = 0.5;
          c.stroke();
        }
        c.restore();
        dot(c, nx - 2.2, cy + 2, 0.9, 0.65, '#ffffff');
        dot(c, nx + 3, cy + 2, 0.9, 0.65, '#ffffff');
        cel(c, function () { starPath(c, fx, cy + 0.6, 1.7 * k, 0.5); }, '#ffd83a', { s: 0.4, ink: 0.35, inkCol: '#a8701a' });
        break;
      case 'heartCheek':
        cel(c, function () { heartPath(c, nx + 0.6, cy + 0.9, 1.75); }, '#ff4a6e', { s: 0.5, ink: 0.4 });
        glint(c, nx, cy + 0.3, 0.45, 0.3, 0.9, -0.5);
        cel(c, function () { heartPath(c, fx + 0.4 * k, cy + 1.2, 1.05 * k); }, '#ff8ab0', { s: 0.3, ink: 0.3, inkCol: '#a03058' });
        break;
      case 'bandaid':
        c.save();
        c.translate(F * 1.6 + 0.3, HY + 6.9);
        c.rotate(-0.14);
        cel(c, function () { E.roundRect(c, -3.5, -1.15, 7, 2.3, 1.1); }, '#ff9ec4', { s: 0.5, ink: 0.4, inkCol: '#a03a68' });
        c.fillStyle = '#fff4f8';
        c.fillRect(-1.25, -0.95, 2.5, 1.9);
        c.beginPath();
        c.moveTo(-1.25, -1.1); c.lineTo(-1.25, 1.1); c.moveTo(1.25, -1.1); c.lineTo(1.25, 1.1);
        stroke(c, '#d86a98', 0.22);
        dot(c, -2.4, -0.3, 0.2, 0.2, '#d86a98');
        dot(c, -2.4, 0.45, 0.2, 0.2, '#d86a98');
        dot(c, 2.4, -0.3, 0.2, 0.2, '#d86a98');
        dot(c, 2.4, 0.45, 0.2, 0.2, '#d86a98');
        c.restore();
        break;
    }
    c.restore();
  }
  function drawGlasses(c, cu) {
    if (cu.charm === 'glasses') {
      var fr = '#7a3e34';
      for (var i = 0; i < 2; i++) {
        var e = EYES[i];
        ell(c, e.x, EYE_Y + 0.2, e.rx + 1.3, 4.3);
        c.fillStyle = 'rgba(210, 236, 255, 0.16)';
        c.fill();
        stroke(c, fr, 0.65);
        /* lens glare */
        c.save();
        ell(c, e.x, EYE_Y + 0.2, e.rx + 1.1, 4.1);
        c.clip();
        c.beginPath();
        c.moveTo(e.x - 3, EYE_Y + 3); c.lineTo(e.x + 1, EYE_Y - 4.5); c.lineTo(e.x + 2.4, EYE_Y - 4.5); c.lineTo(e.x - 1.6, EYE_Y + 3);
        c.fillStyle = 'rgba(255, 255, 255, 0.4)';
        c.fill();
        c.restore();
      }
      c.beginPath();
      c.moveTo(EYES[0].x + EYES[0].rx + 1.2, EYE_Y - 0.6);
      c.quadraticCurveTo(F + 0.5, EYE_Y - 1.8, EYES[1].x - EYES[1].rx - 1.2, EYE_Y - 0.6);
      c.moveTo(EYES[1].x + EYES[1].rx + 1.3, EYE_Y - 0.6); c.lineTo(12.9, EYE_Y - 1.4);
      c.moveTo(EYES[0].x - EYES[0].rx - 1.3, EYE_Y - 0.6); c.lineTo(-12.6, EYE_Y - 1.4);
      stroke(c, fr, 0.6);
    } else if (cu.charm === 'sunnies' || cu.charm === 'starShades') {
      var star = cu.charm === 'starShades';
      var rimCol = star ? '#a85a12' : '#7a1840';
      for (var j = 0; j < 2; j++) {
        var ee = EYES[j];
        (function (x) {
          var p = star ? function () { starPath(c, x, EYE_Y + 0.3, 5.3, 0.56); } : function () { heartPath(c, x, EYE_Y + 0.4, 3.9); };
          p();
          var g = c.createLinearGradient(0, EYE_Y - 4, 0, EYE_Y + 4.5);
          g.addColorStop(0, star ? 'rgba(255, 150, 30, 0.86)' : 'rgba(214, 40, 110, 0.82)');
          g.addColorStop(1, star ? 'rgba(255, 226, 90, 0.6)' : 'rgba(255, 150, 190, 0.55)');
          c.fillStyle = g;
          c.fill();
          stroke(c, rimCol, 0.7);
          c.save(); p(); c.clip();
          c.beginPath();
          c.moveTo(x - 3.4, EYE_Y + 1.4); c.lineTo(x - 0.4, EYE_Y - 3.6); c.lineTo(x + 1.0, EYE_Y - 3.6); c.lineTo(x - 2, EYE_Y + 1.4);
          c.fillStyle = 'rgba(255, 255, 255, 0.55)';
          c.fill();
          c.restore();
        })(ee.x);
      }
      c.beginPath();
      c.moveTo(EYES[0].x + 3.2, EYE_Y - 1.6); c.quadraticCurveTo(F + 0.5, EYE_Y - 2.6, EYES[1].x - 3.2, EYE_Y - 1.6);
      c.moveTo(EYES[1].x + 3.8, EYE_Y - 1.4); c.lineTo(12.9, EYE_Y - 2);
      stroke(c, rimCol, 0.7);
    }
  }

  var STRAW = '#ecc86a', WITCH = '#5f4ab0';
  /* The rigid part of the hat. Bunny ears and the witch hat's cone are
     chain pieces drawn before it. */
  function drawHat(c, cu) {
    var oc = cu.outfitColor;
    switch (cu.hat) {
      case 'strawHat':
        /* shade under the brim across the crown and brow */
        c.save();
        c.globalAlpha = 0.28;
        dot(c, LIT * 0.8, HY - 7.6, 15.5, 4.2, '#3a2060');
        c.restore();
        cel(c, function () { ell(c, 0, HY - 10.4, 21, 5.8, -0.04); }, STRAW, { s: 1.6, ink: 0.7, x0: -21, x1: 21, y0: HY - 16, y1: HY - 5 });
        c.save();
        ell(c, 0, HY - 10.4, 21, 5.8, -0.04);
        c.clip();
        c.beginPath();
        for (var r = 0; r < 3; r++) c.ellipse(0, HY - 10.4, 17.5 - r * 0.0 - r * 2.4, 4.7 - r * 0.6, -0.04, 0, TAU);
        stroke(c, tone(STRAW, 'd1'), 0.35);
        c.restore();
        var dome = function () {
          c.beginPath();
          c.moveTo(-11.4, HY - 11);
          c.bezierCurveTo(-11.8, HY - 20.5, -6, HY - 22.6, 0, HY - 22.6);
          c.bezierCurveTo(6, HY - 22.6, 11.8, HY - 20.5, 11.4, HY - 11);
          c.quadraticCurveTo(0, HY - 8.6, -11.4, HY - 11);
          c.closePath();
        };
        cel(c, dome, '#f2d684', { s: 2, ink: 0.7, x0: -11.5, x1: 11.5, y0: HY - 23, y1: HY - 9 });
        var band = function () {
          c.beginPath();
          c.moveTo(-11.5, HY - 14.2);
          c.quadraticCurveTo(0, HY - 11.8, 11.5, HY - 14.2);
          c.lineTo(11.4, HY - 11);
          c.quadraticCurveTo(0, HY - 8.6, -11.4, HY - 11);
          c.closePath();
        };
        /* the weave */
        c.save();
        dome();
        c.clip();
        c.globalAlpha = 0.5;
        c.beginPath();
        for (var wv = -24; wv <= 14; wv += 2.4) {
          c.moveTo(wv, HY - 9); c.lineTo(wv + 10, HY - 23);
          c.moveTo(-wv, HY - 9); c.lineTo(-wv - 10, HY - 23);
        }
        stroke(c, tone('#f2d684', 'd2'), 0.25);
        c.restore();
        cel(c, band, '#d2483e', { s: 0.8, ink: 0.55 });
        c.beginPath();
        c.moveTo(-11.2, HY - 13.2); c.quadraticCurveTo(0, HY - 10.8, 11.2, HY - 13.2);
        stroke(c, tone('#d2483e', 'hi'), 0.35);
        bow(c, -10.2, HY - 12.4, '#d2483e', 0.7);
        blossom(c, 6.6, HY - 12.6, 2.3, '#fffaf2', 0.3);
        c.beginPath();
        c.moveTo(-6, HY - 20.6); c.quadraticCurveTo(-1, HY - 22, 4, HY - 21);
        stroke(c, tone('#f2d684', 'hi'), 0.8);
        break;
      case 'beret':
        cel(c, function () { ell(c, -1.6, HY - 13.6, 15, 6.6, -0.14); }, oc, { s: 2, ink: 0.7, x0: -17, x1: 14, y0: HY - 20, y1: HY - 7 });
        c.beginPath();
        c.ellipse(-1.2, HY - 11.8, 13.4, 4.2, -0.14, 0.15, Math.PI - 0.15);
        stroke(c, tone(oc, 'd2'), 0.5);
        /* the band it gathers into, and the soft folds running to it */
        c.save();
        ell(c, -1.6, HY - 13.6, 15, 6.6, -0.14);
        c.clip();
        c.beginPath();
        c.ellipse(-1, HY - 9.4, 12.6, 3.2, -0.14, 0, TAU);
        c.fillStyle = tone(oc, 'd2');
        c.fill();
        c.beginPath();
        for (var bf = -3; bf <= 3; bf++) { c.moveTo(1.4 + bf * 0.5, HY - 19); c.quadraticCurveTo(bf * 3.4, HY - 16, bf * 4.4 - 1, HY - 11.6); }
        c.globalAlpha = 0.6;
        stroke(c, tone(oc, 'd1'), 0.4);
        c.restore();
        cel(c, function () { capsule(c, 1.4, HY - 19.6, 0.9, 2.2, HY - 21.8, 0.7); }, tone(oc, 'd1'), { s: 0.4, ink: 0.4 });
        glint(c, -7 * LIT, HY - 17.4, 3, 0.9, 0.5, -0.2);
        metal(c, function () { starPath(c, 7.4, HY - 13.6, 2.1, 0.5); }, '#ffcf3a', 5.3, HY - 15.7, 9.5, HY - 11.5, { ink: 0.4 });
        break;
      case 'flowerCrown':
        /* the vine, leaves tucked between the blooms */
        c.beginPath();
        c.ellipse(0, HY - 9.2, 13.6, 3.6, 0, Math.PI * 1.02, Math.PI * 1.98);
        stroke(c, '#2c5a26', 1.7);
        c.beginPath();
        c.ellipse(0, HY - 9.2, 13.6, 3.6, 0, Math.PI * 1.02, Math.PI * 1.98);
        stroke(c, '#5aa23c', 0.9);
        for (var lf = -3; lf <= 3; lf++) {
          if (!lf) continue;
          (function (lx, ly, rot) {
            cel(c, function () { ell(c, lx, ly, 2.7, 1.2, rot); }, '#7bc45a', { s: 0.5, ink: 0.4 });
            c.beginPath();
            c.moveTo(lx - Math.cos(rot) * 2, ly - Math.sin(rot) * 2); c.lineTo(lx + Math.cos(rot) * 2, ly + Math.sin(rot) * 2);
            stroke(c, '#3f7a30', 0.25);
          })(lf * 4.1 + (lf > 0 ? -1 : 1) * 0.9, HY - 11.2 + Math.abs(lf) * 1.15, lf * 0.5 + (lf % 2 ? 0.6 : -0.6));
        }
        var FC = ['#ffb0cc', '#fff4dc', '#ff8fb6', '#ffe08a', '#ffb0cc'];
        for (var i = -2; i <= 2; i++) {
          blossom(c, i * 6.1, HY - 12 + Math.abs(i) * 1.7, i % 2 === 0 ? 3 : 2.5, FC[i + 2], i * 0.4);
        }
        /* buds */
        dot(c, -9.2, HY - 12.2, 0.9, 0.9, '#ff6a94');
        stroke(c, '#a03058', 0.3);
        dot(c, 9.4, HY - 12, 0.9, 0.9, '#ffd24a');
        stroke(c, '#b07a18', 0.3);
        break;
      case 'cap':
        var capDome = function () {
          c.beginPath();
          c.moveTo(-13.4, HY - 6.8);
          c.bezierCurveTo(-14, HY - 18, -6, HY - 20.6, 0, HY - 20.6);
          c.bezierCurveTo(7, HY - 20.6, 14.4, HY - 17, 13.8, HY - 7);
          c.quadraticCurveTo(0, HY - 5, -13.4, HY - 6.8);
          c.closePath();
        };
        cel(c, capDome, oc, { s: 2.2, ink: 0.75, x0: -14, x1: 14, y0: HY - 21, y1: HY - 6 });
        c.beginPath();
        c.moveTo(0, HY - 20.4); c.quadraticCurveTo(-2.4, HY - 12, -1.6, HY - 6);
        c.moveTo(0, HY - 20.4); c.quadraticCurveTo(7.4, HY - 13, 8.6, HY - 6.4);
        stroke(c, tone(oc, 'd2'), 0.4);
        var bill = function () {
          c.beginPath();
          c.moveTo(4, HY - 7.6);
          c.quadraticCurveTo(16, HY - 9.6, 21.4, HY - 6.6);
          c.quadraticCurveTo(20.4, HY - 4.4, 14, HY - 4.6);
          c.quadraticCurveTo(8, HY - 4.8, 3.4, HY - 5.6);
          c.closePath();
        };
        cel(c, bill, tone(oc, 'd1'), { s: 1, ink: 0.65, inkCol: tone(oc, 'ink') });
        c.beginPath();
        c.moveTo(5.6, HY - 6.6); c.quadraticCurveTo(14, HY - 7.8, 19.6, HY - 6);
        stitch(c, tone(oc, 'hi'), 0.22);
        c.beginPath();
        c.moveTo(-13, HY - 8.2); c.quadraticCurveTo(0, HY - 6.4, 13.4, HY - 8.4);
        stitch(c, tone(oc, 'hi'), 0.22);
        dot(c, 0, HY - 20.6, 1.4, 0.8, tone(oc, 'd1'));
        stroke(c, tone(oc, 'ink'), 0.4);
        cel(c, function () { starPath(c, -4, HY - 13, 2.4); }, '#fff4dc', { s: 0.5, ink: 0.4, inkCol: tone(oc, 'ink') });
        c.beginPath();
        c.moveTo(-8 * LIT, HY - 17.6); c.quadraticCurveTo(-4 * LIT, HY - 19.6, 0, HY - 19.8);
        c.globalAlpha = 0.8;
        stroke(c, tone(oc, 'hi'), 0.9);
        c.globalAlpha = 1;
        break;
      case 'bunnyEars':
        c.beginPath();
        c.ellipse(0, HY - 1.2, 14.6, 13.8, 0, Math.PI * 1.12, Math.PI * 1.88);
        stroke(c, '#7a3a5a', 1.9);
        c.beginPath();
        c.ellipse(0, HY - 1.2, 14.6, 13.8, 0, Math.PI * 1.12, Math.PI * 1.88);
        stroke(c, '#ffd0e0', 1.1);
        bow(c, -9.6, HY - 11.8, '#ff7aa8', 0.8);
        break;
      case 'crown':
        c.save();
        c.translate(1.4, HY - 13.6);
        c.rotate(0.1);
        /* velvet inside the points */
        cel(c, function () {
          c.beginPath(); c.moveTo(-8, 0); c.quadraticCurveTo(-7, -7.4, 0, -7.6); c.quadraticCurveTo(7, -7.4, 8, 0); c.closePath();
        }, '#b8304a', { s: 1.4, ink: 0.5 });
        var crownP = function () {
          c.beginPath();
          c.moveTo(-9, 2);
          c.lineTo(-10.2, -6.6); c.lineTo(-7.1, -2.8);
          c.lineTo(-5, -8.4); c.lineTo(-2.5, -3);
          c.lineTo(0, -10.2); c.lineTo(2.5, -3);
          c.lineTo(5, -8.4); c.lineTo(7.1, -2.8);
          c.lineTo(10.2, -6.6); c.lineTo(9, 2);
          c.quadraticCurveTo(0, 4.6, -9, 2);
          c.closePath();
        };
        metal(c, crownP, '#ffcf3a', -10.5, -10.5, 10.5, 4.6, { ink: 0.65, inkCol: '#8a5a12' });
        /* the band's two rolled edges */
        c.beginPath();
        c.moveTo(-9.2, -0.6); c.quadraticCurveTo(0, 1.8, 9.2, -0.6);
        stroke(c, '#a8741a', 0.4);
        c.beginPath();
        c.moveTo(-9.3, -1.1); c.quadraticCurveTo(0, 1.3, 9.3, -1.1);
        stroke(c, '#fff3b8', 0.3);
        var TIPS = [[-10.2, -6.6], [-5, -8.4], [0, -10.2], [5, -8.4], [10.2, -6.6]];
        for (var tp = 0; tp < 5; tp++) {
          dot(c, TIPS[tp][0], TIPS[tp][1] - 0.5, 1.15, 1.15, '#ffe27a');
          stroke(c, '#8a5a12', 0.4);
          glint(c, TIPS[tp][0] - LIT * 0.35, TIPS[tp][1] - 0.9, 0.4, 0.3, 0.95);
        }
        jewel(c, 0, 1.5, 1.9, '#e8384e', 6);
        jewel(c, -5.4, 0.8, 1.3, '#3a8ae8', 4);
        jewel(c, 5.4, 0.8, 1.3, '#3ab868', 4);
        dot(c, -2.8, 1.9, 0.45, 0.45, '#fffaf0');
        dot(c, 2.8, 1.9, 0.45, 0.45, '#fffaf0');
        c.restore();
        break;
      case 'beanie':
        var bdome = function () {
          c.beginPath();
          c.moveTo(-14.7, HY - 8.6);
          c.bezierCurveTo(-15.6, HY - 17.6, -8, HY - 22, 0, HY - 22);
          c.bezierCurveTo(8, HY - 22, 15.6, HY - 17.6, 14.7, HY - 8.6);
          c.quadraticCurveTo(0, HY - 6, -14.7, HY - 8.6);
          c.closePath();
        };
        cel(c, bdome, oc, { s: 2.2, ink: 0.75, x0: -15, x1: 15, y0: HY - 22, y1: HY - 7, rim: 0.6 });
        c.save();
        bdome();
        c.clip();
        c.beginPath();
        for (var kx = -12; kx <= 12; kx += 3) { c.moveTo(kx * 1.1, HY - 8); c.quadraticCurveTo(kx * 0.92, HY - 16, kx * 0.3, HY - 22); }
        stroke(c, tone(oc, 'd1'), 0.45);
        /* a snowflake-jumper zigzag round the middle */
        c.beginPath();
        for (var zz = -16; zz < 16; zz += 3.2) {
          var zy = HY - 15.4 + (zz / 16) * (zz / 16) * 2.4;
          c.moveTo(zz, zy + 1.7); c.lineTo(zz + 1.6, zy); c.lineTo(zz + 3.2, zy + 1.7 + ((zz + 3.2) / 16) * ((zz + 3.2) / 16) * 0.4);
        }
        stroke(c, mix(oc, '#ffffff', 0.75), 0.55);
        c.beginPath();
        c.moveTo(-8 * LIT, HY - 18.6); c.quadraticCurveTo(-4 * LIT, HY - 21, 0.5, HY - 21.2);
        c.globalAlpha = 0.7;
        stroke(c, tone(oc, 'hi'), 0.9);
        c.restore();
        var cuffCol = mix(oc, '#ffffff', 0.4);
        var cuffP = function () {
          c.beginPath();
          c.moveTo(-15.4, HY - 11);
          c.quadraticCurveTo(0, HY - 8, 15.4, HY - 11);
          c.quadraticCurveTo(16, HY - 8.6, 15.2, HY - 6.4);
          c.quadraticCurveTo(0, HY - 3.2, -15.2, HY - 6.4);
          c.quadraticCurveTo(-16, HY - 8.6, -15.4, HY - 11);
          c.closePath();
        };
        cel(c, cuffP, cuffCol, { s: 1.3, ink: 0.7, inkCol: tone(oc, 'ink'), x0: -15.5, x1: 15.5, y0: HY - 11, y1: HY - 3.5, rim: 0.6 });
        c.save();
        cuffP();
        c.clip();
        c.beginPath();
        for (var cr = -14; cr <= 14; cr += 2) { c.moveTo(cr, HY - 11.5); c.lineTo(cr * 0.99, HY - 3); }
        stroke(c, tone(cuffCol, 'd1'), 0.35);
        c.restore();
        cel(c, function () { fluffPath(c, 0.8, HY - 23.8, 3.5, 9, 0.36); }, '#fff6ec', { s: 1.3, ink: 0.55, inkCol: tone(oc, 'ink') });
        c.beginPath();
        c.moveTo(-0.8, HY - 24.6); c.lineTo(0.2, HY - 23.4);
        c.moveTo(1.6, HY - 25.4); c.lineTo(2, HY - 24);
        c.moveTo(1.4, HY - 22.6); c.lineTo(2.6, HY - 22.2);
        stroke(c, tone('#fff6ec', 'd2'), 0.3);
        break;
      case 'catEars':
        var hc = cu.hair;
        c.beginPath();
        c.ellipse(0, HY - 1.2, 14.6, 13.8, 0, Math.PI * 1.14, Math.PI * 1.86);
        stroke(c, tone(hc, 'ink'), 1.9);
        c.beginPath();
        c.ellipse(0, HY - 1.2, 14.6, 13.8, 0, Math.PI * 1.14, Math.PI * 1.86);
        stroke(c, tone(hc, 'd1'), 1.1);
        for (var es = -1; es <= 1; es += 2) {
          (function (sd) {
            var earP = function () {
              c.beginPath();
              c.moveTo(sd * 3.4, HY - 14.6);
              c.quadraticCurveTo(sd * 7.4, HY - 19.6, sd * 11.6, HY - 23.6);
              c.quadraticCurveTo(sd * 14.2, HY - 16.6, sd * 13, HY - 9.4);
              c.quadraticCurveTo(sd * 8, HY - 13.2, sd * 3.4, HY - 14.6);
              c.closePath();
            };
            cel(c, earP, hc, { s: 1.8, ink: 0.75, x0: Math.min(sd * 3, sd * 14), x1: Math.max(sd * 3, sd * 14), y0: HY - 24, y1: HY - 9, rim: 0.7 });
            cel(c, function () {
              c.beginPath();
              c.moveTo(sd * 6.6, HY - 15);
              c.quadraticCurveTo(sd * 8.8, HY - 18, sd * 11, HY - 20.8);
              c.quadraticCurveTo(sd * 12.4, HY - 16.4, sd * 11.6, HY - 12);
              c.quadraticCurveTo(sd * 9, HY - 13.8, sd * 6.6, HY - 15);
              c.closePath();
            }, '#ffb4cc', { s: 0.9, ink: 0 });
            /* a tuft of pale fur at the root */
            c.beginPath();
            c.moveTo(sd * 6.8, HY - 14.4);
            c.lineTo(sd * 7.8, HY - 16.6); c.lineTo(sd * 8.6, HY - 14.6);
            c.lineTo(sd * 9.8, HY - 16.2); c.lineTo(sd * 10.6, HY - 13.2);
            c.quadraticCurveTo(sd * 8.8, HY - 13.6, sd * 6.8, HY - 14.4);
            c.fillStyle = '#fff4f8';
            c.fill();
            glint(c, sd * 10.6 - LIT * 0.8, HY - 20.6, 0.7, 0.35, 0.7, sd * 0.9);
          })(es);
        }
        break;
      case 'acorn':
        var ac = '#c08a4c';
        var rimY = function (x) { return HY - 8 + (1 - (x / 15) * (x / 15)) * 2.4; };
        var acP = function () {
          c.beginPath();
          c.moveTo(-15, rimY(-15));
          c.bezierCurveTo(-15.8, HY - 17, -8.6, HY - 20.8, 0, HY - 20.8);
          c.bezierCurveTo(8.6, HY - 20.8, 15.8, HY - 17, 15, rimY(15));
          for (var ai = 0; ai < 6; ai++) {
            var xa = 15 - ai * 5, xb = 15 - (ai + 1) * 5;
            c.quadraticCurveTo((xa + xb) / 2, rimY((xa + xb) / 2) + 2.1, xb, rimY(xb));
          }
          c.closePath();
        };
        cel(c, acP, ac, { s: 2.4, ink: 0.75, x0: -15.5, x1: 15.5, y0: HY - 21, y1: HY - 5, rim: 0.7 });
        c.save();
        acP();
        c.clip();
        /* the cap's criss-cross scales, and the rolled rim they end in */
        c.beginPath();
        for (var sr = -30; sr <= 30; sr += 3.4) {
          c.moveTo(sr, HY - 4); c.quadraticCurveTo(sr + 5, HY - 13, sr + 13, HY - 22);
          c.moveTo(-sr, HY - 4); c.quadraticCurveTo(-sr - 5, HY - 13, -sr - 13, HY - 22);
        }
        stroke(c, tone(ac, 'd2', true), 0.38);
        c.beginPath();
        c.moveTo(-15, rimY(-15) - 1.6);
        c.quadraticCurveTo(0, HY - 4.6, 15, rimY(15) - 1.6);
        c.lineTo(15, HY - 3); c.lineTo(-15, HY - 3);
        c.closePath();
        c.fillStyle = tone(ac, 'd1', true);
        c.fill();
        c.beginPath();
        c.moveTo(-15, rimY(-15) - 1.6);
        c.quadraticCurveTo(0, HY - 4.6, 15, rimY(15) - 1.6);
        stroke(c, tone(ac, 'ink', true), 0.4);
        c.beginPath();
        c.moveTo(-9 * LIT, HY - 16.4); c.quadraticCurveTo(-5 * LIT, HY - 19.4, 0, HY - 19.8);
        c.globalAlpha = 0.6;
        stroke(c, tone(ac, 'hi'), 1.1);
        c.restore();
        cel(c, function () { capsule(c, 0.2, HY - 20.2, 1.25, 2.2, HY - 24.8, 0.95); }, '#7a5230', { s: 0.6, ink: 0.5 });
        c.save();
        c.translate(2.4, HY - 24.4);
        c.rotate(-0.5);
        cel(c, function () {
          c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(3, -3, 6.6, -0.4); c.quadraticCurveTo(3.2, 2.2, 0, 0); c.closePath();
        }, '#7bc45a', { s: 0.7, ink: 0.45 });
        c.beginPath(); c.moveTo(0.6, 0); c.quadraticCurveTo(3.2, -0.6, 6, -0.4);
        stroke(c, '#3f7a30', 0.3);
        c.restore();
        break;
      case 'mushroom':
        var mr = '#e8483e', gill = '#fff0d6';
        c.save();
        c.globalAlpha = 0.26;
        dot(c, LIT * 0.8, HY - 6.8, 15, 3.6, '#3a2060');
        c.restore();
        /* the pale underside showing under the rim */
        cel(c, function () { ell(c, 0, HY - 9.8, 19.4, 4.4, -0.03); }, gill, { s: 1, ink: 0.7, inkCol: '#8a5a3a' });
        c.save();
        ell(c, 0, HY - 9.8, 19.4, 4.4, -0.03);
        c.clip();
        c.beginPath();
        for (var gl = -9; gl <= 9; gl++) { c.moveTo(gl * 1.1, HY - 10.6); c.lineTo(gl * 2.3, HY - 4.8); }
        stroke(c, tone(gill, 'd2', true), 0.3);
        c.restore();
        var capM = function () {
          c.beginPath();
          c.moveTo(-19.6, HY - 10.4);
          c.bezierCurveTo(-20.2, HY - 20.4, -10.4, HY - 26, 0, HY - 26);
          c.bezierCurveTo(10.4, HY - 26, 20.2, HY - 20.4, 19.6, HY - 10.4);
          c.quadraticCurveTo(0, HY - 6.8, -19.6, HY - 10.4);
          c.closePath();
        };
        cel(c, capM, mr, { s: 2.8, ink: 0.8, x0: -20, x1: 20, y0: HY - 26, y1: HY - 8, rim: 0.7 });
        c.save();
        capM();
        c.clip();
        var SPOTS = [[-9.4, HY - 19.6, 3.5, 2.7, -0.3], [1.4, HY - 22.4, 3.1, 2.1, 0], [10.4, HY - 17.6, 3.7, 2.8, 0.35],
                     [-15.4, HY - 12.8, 2.6, 2.1, -0.5], [-3, HY - 13.6, 3.6, 2.5, -0.1], [15.6, HY - 11.6, 2.5, 1.9, 0.5], [6.4, HY - 11.2, 2.1, 1.4, 0.2]];
        for (var ms = 0; ms < SPOTS.length; ms++) {
          var S0 = SPOTS[ms];
          dot(c, S0[0] + LIT * 0.35, S0[1] + 0.4, S0[2], S0[3], tone('#fff6e8', 'd2'), S0[4]);
          dot(c, S0[0], S0[1], S0[2], S0[3], '#fff6e8', S0[4]);
        }
        c.beginPath();
        c.moveTo(-12 * LIT, HY - 18); c.quadraticCurveTo(-8 * LIT, HY - 23.6, -1 * LIT, HY - 24.8);
        c.globalAlpha = 0.5;
        stroke(c, '#ffffff', 1.3);
        c.restore();
        break;
      case 'partyHat':
        c.save();
        c.translate(2.6, HY - 12.6);
        c.rotate(0.16);
        var cone = function () {
          c.beginPath();
          c.moveTo(-6.6, 0);
          c.quadraticCurveTo(-3, -9, 0, -17.4);
          c.quadraticCurveTo(3, -9, 6.6, 0);
          c.quadraticCurveTo(0, 2.6, -6.6, 0);
          c.closePath();
        };
        cel(c, cone, '#ff7aa8', { s: 1.8, ink: 0.7, x0: -6.6, x1: 6.6, y0: -17, y1: 2, rim: 0.6 });
        c.save();
        cone();
        c.clip();
        /* slanted stripes and a few confetti dots */
        var PS = ['#ffd83a', '#7cc8ff', '#ffd83a', '#7cc8ff'];
        for (var ph = 0; ph < 4; ph++) {
          c.beginPath();
          c.moveTo(-9, -1.5 - ph * 4.4); c.lineTo(9, -5.5 - ph * 4.4); c.lineTo(9, -7.3 - ph * 4.4); c.lineTo(-9, -3.3 - ph * 4.4);
          c.closePath();
          c.fillStyle = PS[ph];
          c.fill();
        }
        c.beginPath();
        c.moveTo(-LIT * 2.6, -1); c.quadraticCurveTo(-LIT * 1.6, -8, -LIT * 0.4, -14);
        c.globalAlpha = 0.6;
        stroke(c, '#ffffff', 0.9);
        c.restore();
        cone();
        stroke(c, tone('#ff7aa8', 'ink'), 0.7);
        /* a frill round the brim and a pom-pom on the tip */
        for (var pf = -3; pf <= 3; pf++) {
          dot(c, pf * 2.1, 0.5 + (1 - (pf / 3) * (pf / 3)) * 1.2, 1.25, 1.1, '#fff6ec');
          stroke(c, '#a03a68', 0.3);
        }
        cel(c, function () { fluffPath(c, 0, -18.4, 2.5, 8, 0.36); }, '#fff6ec', { s: 0.9, ink: 0.5, inkCol: '#a03a68' });
        c.restore();
        break;
      case 'bigBow':
        c.save();
        c.translate(0, HY - 15.4);
        c.scale(2.7, 2.7);
        bow(c, 0, 0, oc, 1);
        /* a lighter stripe along each loop */
        c.beginPath();
        c.moveTo(-0.9, -0.2); c.quadraticCurveTo(-2.6, -1.7, -3.8, -0.4);
        c.moveTo(0.9, -0.2); c.quadraticCurveTo(2.6, -1.7, 3.8, -0.4);
        c.globalAlpha = 0.75;
        stroke(c, mix(oc, '#ffffff', 0.65), 0.34);
        c.restore();
        break;
      case 'witchHat':
        /* front half of the brim; the back half is drawn behind the cone */
        var brim = function () { ell(c, 0, HY - 10.6, 19.6, 5, -0.05); };
        c.save();
        c.beginPath(); c.rect(-22, HY - 10.8, 44, 8); c.clip();
        cel(c, brim, WITCH, { s: 1.4, ink: 0.7, x0: -20, x1: 20, y0: HY - 15, y1: HY - 5 });
        c.restore();
        var wband = function () {
          c.beginPath();
          c.moveTo(-9.6, HY - 15.2);
          c.quadraticCurveTo(0, HY - 13.2, 9.6, HY - 15.2);
          c.lineTo(10.2, HY - 11.4);
          c.quadraticCurveTo(0, HY - 9.4, -10.2, HY - 11.4);
          c.closePath();
        };
        cel(c, wband, '#ff9ec4', { s: 0.8, ink: 0.55 });
        /* a square gold buckle on the band */
        metal(c, function () {
          c.beginPath();
          c.rect(0, HY - 14.9, 5, 4.6);
          c.rect(1.2, HY - 13.8, 2.6, 2.4);
        }, '#ffcf3a', 0, HY - 15, 5, HY - 10, { ink: 0.4, inkCol: '#8a5a12' });
        break;
    }
  }
  /* Chain parts of hats, in the head frame. */
  function hatChains(cu) {
    var out = [];
    if (cu.hat === 'bunnyEars') {
      var ear = function (g) {
        var p = function () {
          g.beginPath();
          g.moveTo(-2.6, 0.6);
          g.bezierCurveTo(-4.6, -6, -3.6, -12.6, 0, -13.6);
          g.bezierCurveTo(3.6, -12.6, 4.6, -6, 2.6, 0.6);
          g.closePath();
        };
        cel(g, p, '#fff4f8', { s: 1.2, ink: 0.6, inkCol: '#7a3a5a', x0: -4, x1: 4, y0: -14, y1: 0 });
        cel(g, function () {
          g.beginPath();
          g.moveTo(-1.2, -0.6);
          g.bezierCurveTo(-2.4, -5, -1.8, -10.6, 0, -11.4);
          g.bezierCurveTo(1.8, -10.6, 2.4, -5, 1.2, -0.6);
          g.closePath();
        }, '#ffb0c8', { s: 0.6, ink: 0 });
      };
      out.push({ k: 'be0', x: -5.4, y: HY - 13, a: -0.22, bx: -5, by: -15, bw: 10, bh: 17, n: 3, m: -0.8, out: -1, up: true, draw: ear });
      out.push({ k: 'be1', x: 5.6, y: HY - 13, a: 0.26, bx: -5, by: -15, bw: 10, bh: 17, n: 3, m: -1, out: 1, up: true, draw: ear });
    } else if (cu.hat === 'witchHat') {
      out.push({ k: 'wc', x: 0, y: HY - 12.8, a: -0.06, bx: -11, by: -24, bw: 24, bh: 26, n: 3, m: -0.7, out: 0, up: true,
        draw: function (g) {
          var p = function () {
            g.beginPath();
            g.moveTo(-9.8, 0.4);
            g.bezierCurveTo(-7, -8, -4, -15, -1.4, -19);
            g.quadraticCurveTo(2.4, -22.6, 8.4, -20.4);
            g.quadraticCurveTo(3.8, -19.2, 2.6, -15.6);
            g.bezierCurveTo(4.4, -10, 7.6, -4, 9.8, 0.4);
            g.quadraticCurveTo(0, 2.2, -9.8, 0.4);
            g.closePath();
          };
          cel(g, p, WITCH, { s: 2, ink: 0.7, x0: -10, x1: 10, y0: -22, y1: 1 });
          g.beginPath();
          g.moveTo(-5 * LIT, -4); g.quadraticCurveTo(-3.6 * LIT, -11, -1.4 * LIT, -16);
          g.globalAlpha = 0.6;
          stroke(g, tone(WITCH, 'hi'), 0.9);
          g.globalAlpha = 1;
          /* a crescent moon and two stars sewn on */
          g.save();
          p();
          g.clip();
          g.beginPath();
          g.arc(1.2, -9, 2.3, 0, TAU);
          g.arc(2.3, -9.7, 1.9, 0, TAU, true);
          g.fillStyle = '#ffe27a';
          g.fill('evenodd');
          starPath(g, -3.6, -4.6, 1.3, 0.45);
          g.fill();
          starPath(g, 5.2, -3, 1, 0.45);
          g.fill();
          g.restore();
        } });
    }
    return out;
  }

  /* ==================================================================
     Body: outfit, sleeves, legs, shoes, accessories
     ================================================================== */
  function legColor(cu) {
    if (cu.outfit === 'hoodie') return '#4a4068';
    if (cu.outfit === 'tutu') return '#fde6ee';
    return cu.skin;
  }
  function isSkinLeg(cu) { return cu.outfit !== 'hoodie' && cu.outfit !== 'tutu'; }

  function drawThigh(c, cu, back) {
    var col = legColor(cu);
    if (back) col = tone(col, 'd1', isSkinLeg(cu));
    cel(c, function () { capsule(c, 0, 0, 2.45, 0, THIGH, 2.0); }, col,
      { warm: isSkinLeg(cu), s: 1.2, ink: 0.6, x0: -2.4, x1: 2.4, y0: 0, y1: THIGH, rim: 0.5 });
  }
  function drawShin(c, cu, back) {
    var col = legColor(cu), warm = isSkinLeg(cu);
    if (back) col = tone(col, 'd1', warm);
    var p = function () { capsule(c, 0, 0, 2.0, 0, SHIN, 1.45); };
    cel(c, p, col, { warm: warm, s: 1.1, ink: 0.6, x0: -2, x1: 2, y0: 0, y1: SHIN, rim: 0.5 });
    /* knee: a soft crease and a warm highlight */
    c.beginPath();
    c.moveTo(-1, 0.9); c.quadraticCurveTo(0.2, 1.5, 1.3, 0.9);
    stroke(c, tone(col, 'd2', warm), 0.3);
    var sh = cu.shoes;
    c.save();
    p();
    c.clip();
    if (sh === 'maryJane' || sh === 'sneaker' || sh === 'geta' || sh === 'bunny') {
      var sock = back ? '#e8e4f0' : '#ffffff';
      c.fillStyle = tone(sock, 'd1');
      c.fillRect(-3, SHIN - 2.2, 6, 4);
      c.fillStyle = sock;
      c.fillRect(-3 - LIT * 0.5, SHIN - 2.4, 6, 4);
      c.restore();
      c.beginPath();
      if (sh === 'maryJane') {
        for (var i = 0; i < 3; i++) c.arc(-1.5 + i * 1.5, SHIN - 2.3, 0.8, Math.PI, 0);
        stroke(c, tone(cu.outfitColor, 'ink'), 0.3);
      } else if (sh === 'sneaker') {
        c.moveTo(-1.7, SHIN - 2.3); c.lineTo(1.7, SHIN - 2.3);
        c.moveTo(-1.6, SHIN - 1.5); c.lineTo(1.6, SHIN - 1.5);
        stroke(c, '#7aa0d8', 0.3);
      } else if (sh === 'bunny') {
        c.moveTo(-1.7, SHIN - 2.3); c.lineTo(1.7, SHIN - 2.3);
        stroke(c, '#ff9ec4', 0.5);
      } else {
        c.moveTo(-1.7, SHIN - 2.4); c.lineTo(1.7, SHIN - 2.4);
        stroke(c, '#c8c0d8', 0.3);
      }
    } else if (sh === 'boots' || sh === 'skates' || sh === 'hiTops') {
      var bc = sh === 'skates' ? '#fffaf4' : cu.shoeColor, top = sh === 'hiTops' ? SHIN - 3 : 1.2;
      if (back) bc = tone(bc, 'd1');
      c.fillStyle = tone(bc, 'd2');
      c.fillRect(-3, top, 6, 7);
      c.fillStyle = bc;
      c.fillRect(-3 - LIT * 0.7, top + 0.2, 6, 7);
      c.restore();
      var cuff = sh === 'skates' ? (back ? tone(cu.shoeColor, 'd1') : cu.shoeColor) : mix(bc, '#fff4dc', 0.55);
      cel(c, function () { c.beginPath(); c.ellipse(0, top + 0.3, 2.4, 0.95, 0, 0, TAU); }, cuff, { s: 0.4, ink: 0.4, inkCol: tone(bc, 'ink') });
      if (sh === 'boots') {
        c.beginPath();
        c.moveTo(-LIT * 1.1, 2.6); c.lineTo(-LIT * 1.1, SHIN - 0.6);
        c.globalAlpha = 0.6;
        stroke(c, tone(bc, 'hi'), 0.5);
        c.globalAlpha = 1;
      } else {
        /* laces up the front */
        c.beginPath();
        for (var lz = top + 1.4; lz < SHIN + 0.4; lz += 1.1) { c.moveTo(0.2, lz); c.lineTo(1.9, lz - 0.5); }
        stroke(c, sh === 'skates' ? cu.shoeColor : '#ffffff', 0.35);
      }
    } else if (sh === 'balletFlats') {
      c.restore();
      /* ribbons crossed up the ankle */
      c.beginPath();
      c.moveTo(-1.6, SHIN + 0.6); c.lineTo(1.5, SHIN - 1.6);
      c.moveTo(1.6, SHIN + 0.6); c.lineTo(-1.5, SHIN - 1.6);
      c.moveTo(-1.5, SHIN - 1.6); c.lineTo(1.5, SHIN - 2.4);
      stroke(c, back ? tone(cu.shoeColor, 'd1') : cu.shoeColor, 0.45);
    } else {
      c.restore();
    }
  }
  /* Shoe in the ankle frame: ankle at (0, 0), sole at y = ANKLE_H, toe +x. */
  function drawShoe(c, cu, back) {
    var col = back ? tone(cu.shoeColor, 'd1') : cu.shoeColor, sh = cu.shoes;
    var skin = back ? tone(cu.skin, 'd1', true) : cu.skin;
    var y = ANKLE_H;
    var foot = function (h, toe, base) {
      var y = base || ANKLE_H;
      return function () {
        c.beginPath();
        c.moveTo(-2.6, y);
        c.quadraticCurveTo(-3.1, y - h, -0.8, y - h - 0.3);
        c.quadraticCurveTo(toe - 1.4, y - h * 0.9, toe, y - 0.9);
        c.quadraticCurveTo(toe + 0.3, y, toe - 0.6, y + 0.15);
        c.lineTo(-1.8, y + 0.15);
        c.quadraticCurveTo(-2.7, y + 0.1, -2.6, y);
        c.closePath();
      };
    };
    var p;
    switch (sh) {
      case 'sneaker':
        p = foot(3.4, 5.2);
        cel(c, p, col, { s: 0.9, ink: 0.55, x0: -3, x1: 5.4, y0: y - 3.6, y1: y });
        c.save(); p(); c.clip();
        c.fillStyle = '#ffffff';
        c.fillRect(-4, y - 0.9, 10, 1.3);
        c.fillStyle = '#c8d0e8';
        c.fillRect(-4, y - 0.1, 10, 0.4);
        dot(c, 4.1, y - 1.7, 1.6, 1.2, '#ffffff');
        c.restore();
        c.beginPath();
        c.moveTo(-0.2, y - 3.1); c.lineTo(1.2, y - 2.3);
        c.moveTo(0.9, y - 3.3); c.lineTo(2.3, y - 2.4);
        stroke(c, '#ffffff', 0.45);
        glint(c, 0.4, y - 3.2, 1, 0.3, 0.6);
        break;
      case 'boots':
        p = foot(3.2, 4.8);
        cel(c, p, col, { s: 0.9, ink: 0.55, x0: -3, x1: 5, y0: y - 3.4, y1: y });
        c.save(); p(); c.clip();
        c.fillStyle = tone(col, 'd2');
        c.fillRect(-4, y - 0.6, 10, 1);
        c.restore();
        glint(c, 2.6, y - 2.4, 1.1, 0.35, 0.6, 0.3);
        break;
      case 'sandals':
        p = foot(2.4, 4.6);
        cel(c, p, skin, { warm: true, s: 0.7, ink: 0.5 });
        /* toes */
        c.beginPath();
        c.moveTo(3.2, y - 1.6); c.lineTo(3.4, y - 0.6);
        c.moveTo(2.2, y - 1.9); c.lineTo(2.4, y - 0.7);
        stroke(c, tone(skin, 'd2', true), 0.25);
        cel(c, function () { c.beginPath(); c.rect(-2.8, y - 0.2, 7.8, 0.9); }, col, { s: 0.3, ink: 0.4 });
        cel(c, function () { capsule(c, -0.6, y - 2.6, 0.6, 3.6, y - 1.2, 0.55); }, col, { s: 0.3, ink: 0.4 });
        cel(c, function () { capsule(c, -2.2, y - 2.4, 0.5, -1.9, y, 0.5); }, col, { s: 0.3, ink: 0.4 });
        blossom(c, 1.6, y - 2, 0.95, '#fff6f0', 0.3);
        break;
      case 'balletFlats':
        p = foot(2.6, 5);
        cel(c, p, col, { s: 0.8, ink: 0.55, x0: -3, x1: 5, y0: y - 3, y1: y });
        /* the low cut shows the top of the foot */
        c.save(); p(); c.clip();
        dot(c, -0.2, y - 2.9, 2.2, 1.1, skin);
        c.restore();
        bow(c, 2.4, y - 1.9, back ? tone('#ffffff', 'd1') : '#fff4f8', 0.32);
        glint(c, 3.8, y - 1.2, 0.8, 0.3, 0.7, 0.3);
        break;
      case 'hiTops':
        p = foot(3.5, 5.2);
        cel(c, p, col, { s: 0.9, ink: 0.55, x0: -3, x1: 5.4, y0: y - 3.6, y1: y });
        c.save(); p(); c.clip();
        /* rubber toe cap and sole */
        dot(c, 4.4, y - 1.3, 1.9, 1.7, '#ffffff');
        c.fillStyle = '#ffffff';
        c.fillRect(-4, y - 0.8, 10, 1.3);
        c.fillStyle = '#e8485a';
        c.fillRect(-4, y - 0.45, 10, 0.3);
        c.restore();
        c.beginPath();
        c.moveTo(2.6, y - 2.4); c.quadraticCurveTo(3.4, y - 1.2, 2.9, y - 0.8);
        stroke(c, tone(col, 'ink'), 0.3);
        dot(c, -0.9, y - 2.2, 1.05, 1.05, '#ffffff');
        stroke(c, tone(col, 'ink'), 0.25);
        starPath(c, -0.9, y - 2.2, 0.75, 0.45);
        c.fillStyle = col;
        c.fill();
        c.beginPath();
        c.moveTo(0.9, y - 3.2); c.lineTo(2.2, y - 2.5);
        stroke(c, '#ffffff', 0.4);
        break;
      case 'geta':
        var wood = back ? tone('#c08a52', 'd1', true) : '#c08a52', tabi = back ? '#e8e4f0' : '#ffffff';
        p = foot(2.5, 4.6, y - 1.5);
        cel(c, p, tabi, { s: 0.7, ink: 0.5, inkCol: '#8a84a8' });
        /* the split toe */
        c.beginPath();
        c.moveTo(3.3, y - 3.2); c.lineTo(3.7, y - 2.2);
        stroke(c, '#a8a4c0', 0.3);
        /* the thong */
        c.beginPath();
        c.moveTo(-1.2, y - 3.6); c.quadraticCurveTo(1.6, y - 3.9, 3.5, y - 2.5);
        stroke(c, tone(col, 'ink'), 1.1);
        c.beginPath();
        c.moveTo(-1.2, y - 3.6); c.quadraticCurveTo(1.6, y - 3.9, 3.5, y - 2.5);
        stroke(c, col, 0.6);
        /* the board and its two teeth */
        cel(c, function () { c.beginPath(); c.rect(-1.9, y - 0.9, 1.5, 1.05); c.rect(2, y - 0.9, 1.5, 1.05); }, tone(wood, 'd1', true), { warm: true, s: 0.2, ink: 0.4 });
        cel(c, function () { E.roundRect(c, -3.1, y - 1.6, 8.6, 0.95, 0.4); }, wood, { warm: true, s: 0.3, ink: 0.4 });
        break;
      case 'skates':
        var white = back ? tone('#fffaf4', 'd1') : '#fffaf4';
        p = foot(3.2, 4.7, y - 1.5);
        cel(c, p, white, { s: 0.8, ink: 0.5, inkCol: '#8a7a9a', x0: -3, x1: 5, y0: y - 4.7, y1: y - 1.5 });
        c.beginPath();
        c.moveTo(0.8, y - 4.4); c.lineTo(2.2, y - 3.7);
        c.moveTo(1.6, y - 4); c.lineTo(3, y - 3.2);
        stroke(c, col, 0.4);
        /* plate, wheels and the toe stop */
        cel(c, function () { c.beginPath(); c.rect(-2.7, y - 1.6, 7.4, 0.55); }, '#c8ccd8', { s: 0.2, ink: 0.3, inkCol: '#5a5a78' });
        for (var wh = 0; wh < 2; wh++) {
          var wx = wh ? 3 : -1.4;
          cel(c, function () { ell(c, wx, y - 0.5, 1.05, 1.05); }, col, { s: 0.4, ink: 0.45 });
          dot(c, wx, y - 0.5, 0.36, 0.36, '#fff4dc');
        }
        dot(c, 5, y - 1.2, 0.6, 0.6, col);
        stroke(c, tone(col, 'ink'), 0.3);
        glint(c, 3.4, y - 2.9, 0.9, 0.3, 0.7, 0.35);
        break;
      case 'bunny':
        var fur = mix(col, '#ffffff', 0.74), fink = tone(col, 'ink');
        /* ears standing up over the toe */
        for (var be = 0; be < 2; be++) {
          (function (dx, rot) {
            c.save();
            c.translate(3 + dx, y - 2.5);
            c.rotate(rot);
            cel(c, function () { c.beginPath(); c.ellipse(0, -1.8, 0.8, 2, 0, 0, TAU); }, fur, { s: 0.5, ink: 0.4, inkCol: fink });
            dot(c, 0, -1.7, 0.32, 1.2, '#ff9ec4');
            c.restore();
          })(be ? 1.2 : 0, be ? 0.42 : -0.12);
        }
        p = foot(3.2, 5.3);
        cel(c, p, fur, { s: 0.9, ink: 0.55, inkCol: fink, x0: -3, x1: 5.4, y0: y - 3.4, y1: y });
        cel(c, function () { fluffPath(c, -2.7, y - 1.6, 0.85, 6, 0.4); }, '#ffffff', { s: 0.3, ink: 0.35, inkCol: fink });
        dot(c, 3.5, y - 2, 0.36, 0.42, '#3a2030');
        glint(c, 3.4, y - 2.15, 0.13, 0.13, 1);
        dot(c, 5, y - 1.45, 0.4, 0.3, '#ff7a9c');
        c.beginPath();
        c.moveTo(4.9, y - 1.1); c.quadraticCurveTo(4.3, y - 0.6, 3.8, y - 0.9);
        stroke(c, '#3a2030', 0.22);
        c.globalAlpha = 0.6;
        dot(c, 2.9, y - 1.2, 0.6, 0.38, '#ff9ec4');
        c.globalAlpha = 1;
        break;
      default: /* maryJane */
        p = foot(2.9, 4.8);
        cel(c, p, col, { s: 0.9, ink: 0.55, x0: -3, x1: 5, y0: y - 3.2, y1: y });
        c.beginPath();
        c.moveTo(-1.6, y - 3); c.quadraticCurveTo(0.4, y - 2.2, 2, y - 3.2);
        stroke(c, tone(col, 'ink'), 0.7);
        gem(c, 1.9, y - 3.1, 0.55, '#ffe680');
        glint(c, 3.2, y - 1.7, 1.1, 0.35, 0.8, 0.35);
        break;
    }
  }

  /* Sleeve and upper arm, hanging +y from the shoulder. */
  function sleeveOf(cu) {
    switch (cu.outfit) {
      case 'sweater': case 'hoodie': case 'raincoat': return 'long';
      case 'yukata': return 'wide';
      case 'tutu': return 'none';
      case 'tee': return 'short';
      case 'fairy': return 'cap';
      default: return 'puff';
    }
  }
  function drawUpperArm(c, cu, back) {
    var skin = back ? tone(cu.skin, 'd1', true) : cu.skin;
    var sc = cu.outfit === 'overalls' || cu.outfit === 'pinafore' ? '#fff4dc' : cu.outfitColor;
    if (back) sc = tone(sc, 'd1');
    var kind = sleeveOf(cu);
    if (kind !== 'long') cel(c, function () { capsule(c, 0, 0, 2.15, 0, UPPER, 1.8); }, skin, { warm: true, s: 1, ink: 0.55, x0: -2.2, x1: 2.2, y0: 0, y1: UPPER, rim: 0.5 });
    if (kind === 'puff') {
      var pp = function () {
        c.beginPath();
        c.moveTo(-3.4, 0.4);
        c.bezierCurveTo(-4.4, -3, 4.4, -3, 3.4, 0.4);
        c.quadraticCurveTo(4.2, 3, 2.6, 4.1);
        c.quadraticCurveTo(0, 4.9, -2.6, 4.1);
        c.quadraticCurveTo(-4.2, 3, -3.4, 0.4);
        c.closePath();
      };
      cel(c, pp, sc, { s: 1.2, ink: 0.6, x0: -4, x1: 4, y0: -2.6, y1: 4.6, rim: 0.6 });
      c.beginPath();
      c.moveTo(-1.6, -1.2); c.quadraticCurveTo(-1.8, 1.8, -1.2, 3.8);
      c.moveTo(1.2, -1.2); c.quadraticCurveTo(1.4, 1.8, 1.0, 3.9);
      stroke(c, tone(sc, 'd1'), 0.35);
      var cuff = cu.outfit === 'sailorDress' ? '#ffffff' : mix(sc, '#ffffff', 0.55);
      cel(c, function () { c.beginPath(); c.ellipse(0, 4.1, 2.9, 0.9, 0, 0, TAU); }, cuff, { s: 0.4, ink: 0.45, inkCol: tone(sc, 'ink') });
      glint(c, -LIT * 1.6, -0.9, 1, 0.5, 0.6, -0.4);
    } else if (kind === 'long') {
      cel(c, function () { capsule(c, 0, 0, 2.9, 0, UPPER + 0.6, 2.4); }, sc, { s: 1.2, ink: 0.6, x0: -2.9, x1: 2.9, y0: -2, y1: UPPER, rim: 0.6 });
      c.beginPath();
      c.moveTo(-0.6, 2); c.quadraticCurveTo(0.8, 3.4, 1.6, 2.8);
      stroke(c, tone(sc, 'd1'), 0.35);
    } else if (kind === 'wide') {
      var wp = function () {
        c.beginPath();
        c.moveTo(-3, -1);
        c.quadraticCurveTo(-3.6, 5, -3.6, 9.4);
        c.quadraticCurveTo(-1.6, 11.6, 1.6, 10.6);
        c.quadraticCurveTo(3.8, 6, 3.2, -1);
        c.quadraticCurveTo(0, -2.8, -3, -1);
        c.closePath();
      };
      cel(c, wp, sc, { s: 1.4, ink: 0.6, x0: -3.6, x1: 3.6, y0: -2, y1: 11, rim: 0.6 });
      c.save(); wp(); c.clip();
      yukataPattern(c, sc, -4, -2, 8, 14);
      c.restore();
    } else if (kind === 'short') {
      var sp2 = function () { capsule(c, 0, -0.3, 3.1, 0, 3, 2.8); };
      cel(c, sp2, sc, { s: 1.1, ink: 0.6, x0: -3.1, x1: 3.1, y0: -3, y1: 5.6, rim: 0.6 });
      c.save();
      sp2();
      c.clip();
      c.fillStyle = '#ffffff';
      c.fillRect(-4, 4.3, 8, 0.9);
      c.restore();
    } else if (kind === 'cap') {
      /* a petal over the shoulder */
      var pet = mix(sc, '#ffffff', 0.3);
      cel(c, function () {
        c.beginPath();
        c.moveTo(-3.3, -0.8);
        c.quadraticCurveTo(0, -3.6, 3.3, -0.8);
        c.quadraticCurveTo(2.8, 2.6, 0, 4.6);
        c.quadraticCurveTo(-2.8, 2.6, -3.3, -0.8);
        c.closePath();
      }, pet, { s: 0.9, ink: 0.55, inkCol: tone(sc, 'ink'), x0: -3.3, x1: 3.3, y0: -3, y1: 4.6, rim: 0.5 });
      c.beginPath();
      c.moveTo(0, -2.4); c.lineTo(0, 3.8);
      stroke(c, tone(sc, 'd1'), 0.3);
    } else {
      /* tutu: a satin strap on the shoulder */
      cel(c, function () { c.beginPath(); c.ellipse(0, -0.4, 2.4, 1.2, 0, 0, TAU); }, sc, { s: 0.4, ink: 0.45 });
    }
  }
  function drawForearm(c, cu, back) {
    var skin = back ? tone(cu.skin, 'd1', true) : cu.skin;
    var kind = sleeveOf(cu);
    var sc = back ? tone(cu.outfitColor, 'd1') : cu.outfitColor;
    cel(c, function () { capsule(c, 0, 0, 1.75, 0, FORE, 1.35); }, skin, { warm: true, s: 0.9, ink: 0.55, x0: -1.8, x1: 1.8, y0: 0, y1: FORE, rim: 0.5 });
    if (kind === 'long') {
      cel(c, function () { capsule(c, 0, -0.6, 2.4, 0, FORE - 0.8, 2.0); }, sc, { s: 1, ink: 0.6, x0: -2.4, x1: 2.4, y0: 0, y1: FORE, rim: 0.6 });
      cel(c, function () { c.beginPath(); c.rect(-2.2, FORE - 1.6, 4.4, 1.6); }, cu.outfit === 'sweater' ? tone(sc, 'd1') : mix(sc, '#ffffff', 0.25), { s: 0.4, ink: 0.45, inkCol: tone(sc, 'ink') });
      if (cu.outfit === 'raincoat') {
        /* a strap and button on the cuff, and the shine of the slicker */
        gem(c, 0.9, FORE - 0.8, 0.5, PAL.sun);
        glint(c, -LIT * 1, 1.4, 0.35, 1.5, 0.55);
      } else {
        c.beginPath();
        c.moveTo(-1.4, FORE - 1.6); c.lineTo(-1.4, FORE); c.moveTo(0, FORE - 1.6); c.lineTo(0, FORE); c.moveTo(1.4, FORE - 1.6); c.lineTo(1.4, FORE);
        stroke(c, tone(sc, 'd2'), 0.25);
      }
    }
    /* mitten hand: palm, a thumb toward the front, a finger crease */
    var hy = FORE + 1.6;
    cel(c, function () { c.beginPath(); c.ellipse(0.1, hy, 1.95, 2.25, 0, 0, TAU); }, skin, { warm: true, s: 0.7, ink: 0.55 });
    cel(c, function () { c.beginPath(); c.ellipse(1.7, hy - 0.7, 0.85, 1.25, -0.5, 0, TAU); }, skin, { warm: true, s: 0.4, ink: 0.5 });
    c.beginPath();
    c.moveTo(-1, hy + 0.9); c.quadraticCurveTo(0, hy + 1.4, 1, hy + 1);
    stroke(c, tone(skin, 'd2', true), 0.3);
    glint(c, -LIT * 0.7, hy - 1, 0.6, 0.4, 0.5);
  }

  function yukataPattern(c, col, x, y, w, h) {
    c.fillStyle = mix(col, '#ffffff', 0.55);
    for (var yy = y; yy < y + h; yy += 3.6) {
      for (var xx = x + ((yy / 3.6) % 2 ? 1.8 : 0); xx < x + w; xx += 3.6) {
        c.beginPath();
        for (var k = 0; k < 5; k++) {
          var a = k * TAU / 5;
          c.moveTo(xx, yy);
          c.ellipse(xx + Math.cos(a) * 0.55, yy + Math.sin(a) * 0.55, 0.5, 0.5, 0, 0, TAU);
        }
        c.fill();
      }
    }
  }

  function bodicePath(c) {
    c.beginPath();
    c.moveTo(-5.4, -27.6);
    c.quadraticCurveTo(0, -26.4, 5.4, -27.6);
    c.quadraticCurveTo(7.8, -27, 7.5, -24.4);
    c.quadraticCurveTo(6.6, -21.4, 6, WAIST_Y);
    c.quadraticCurveTo(0, WAIST_Y + 0.8, -6, WAIST_Y);
    c.quadraticCurveTo(-6.6, -21.4, -7.5, -24.4);
    c.quadraticCurveTo(-7.8, -27, -5.4, -27.6);
    c.closePath();
  }
  function neck(c, cu) {
    var sk = cu.skin;
    c.beginPath();
    c.moveTo(-2.2, -30); c.lineTo(2.2, -30); c.lineTo(2.4, -26.6); c.quadraticCurveTo(0, -25.8, -2.4, -26.6); c.closePath();
    c.fillStyle = tone(sk, 'd1', true);
    c.fill();
    stroke(c, tone(sk, 'ink', true), 0.5);
    c.fillStyle = tone(sk, 'd2', true);
    c.fillRect(-2.2, -30, 4.4, 1.8);
  }
  var BODY_O = { s: 1.6, ink: 0.7, x0: -8, x1: 8, y0: -28, y1: WAIST_Y, rim: 0.7 };

  function drawBodice(c, cu) {
    var col = cu.outfitColor, o = cu.outfit;
    neck(c, cu);
    var light = mix(col, '#ffffff', 0.55);
    switch (o) {
      case 'overalls':
      case 'pinafore':
        cel(c, function () { bodicePath(c); }, '#fff4dc', BODY_O);
        cel(c, function () {
          c.beginPath();
          c.moveTo(-3, -27.2); c.lineTo(0, -24.8); c.lineTo(3, -27.2); c.lineTo(1.6, -27.6); c.lineTo(0, -26.2); c.lineTo(-1.6, -27.6); c.closePath();
        }, '#fff4dc', { s: 0.4, ink: 0.45, inkCol: tone(col, 'ink') });
        var bib = function () {
          c.beginPath();
          c.moveTo(-4.2, -24); c.lineTo(4.2, -24); c.lineTo(5, WAIST_Y - 0.4); c.lineTo(-5, WAIST_Y - 0.4); c.closePath();
        };
        cel(c, bib, col, { s: 1.2, ink: 0.65, x0: -5, x1: 5, y0: -24, y1: WAIST_Y });
        cel(c, function () { capsule(c, -4.6, -27.6, 0.9, -3.8, -23.6, 0.9); }, col, { s: 0.4, ink: 0.5 });
        cel(c, function () { capsule(c, 4.6, -27.6, 0.9, 3.8, -23.6, 0.9); }, col, { s: 0.4, ink: 0.5 });
        gem(c, -3.6, -23.4, 0.75, PAL.sun);
        gem(c, 3.6, -23.4, 0.75, PAL.sun);
        cel(c, function () { c.beginPath(); c.rect(-2.2, -22.8, 4.4, 2.6); }, tone(col, 'd1'), { s: 0.4, ink: 0.45, inkCol: tone(col, 'ink') });
        c.beginPath(); c.moveTo(-1.6, -22.4); c.lineTo(1.6, -22.4); c.setLineDash([0.5, 0.5]);
        stroke(c, tone(col, 'hi'), 0.25); c.setLineDash([]);
        break;
      case 'sweater':
      case 'hoodie':
        cel(c, function () { bodicePath(c); }, col, BODY_O);
        if (o === 'sweater') {
          c.save(); bodicePath(c); c.clip();
          c.beginPath();
          for (var x = -6; x <= 6; x += 2.4) { c.moveTo(x, -26); c.quadraticCurveTo(x * 1.1, -23, x * 1.05, WAIST_Y); }
          stroke(c, tone(col, 'd1'), 0.4);
          c.restore();
          cel(c, function () {
            c.beginPath();
            c.moveTo(-4.4, -27.8); c.quadraticCurveTo(0, -29.6, 4.4, -27.8); c.lineTo(4, -25.8); c.quadraticCurveTo(0, -24.8, -4, -25.8); c.closePath();
          }, tone(col, 'd1'), { s: 0.6, ink: 0.55, inkCol: tone(col, 'ink') });
          c.beginPath();
          for (var r = -3; r <= 3; r += 1.2) { c.moveTo(r, -28.2); c.lineTo(r * 0.95, -25.6); }
          stroke(c, tone(col, 'd2'), 0.25);
        } else {
          /* hood collar and drawstrings */
          cel(c, function () {
            c.beginPath();
            c.moveTo(-6, -27.8); c.quadraticCurveTo(0, -24.2, 6, -27.8); c.lineTo(5, -25.4); c.quadraticCurveTo(0, -22.6, -5, -25.4); c.closePath();
          }, tone(col, 'd1'), { s: 0.6, ink: 0.55, inkCol: tone(col, 'ink') });
          c.beginPath();
          c.moveTo(-1.6, -24.6); c.quadraticCurveTo(-1.8, -22.6, -1.4, -21.4);
          c.moveTo(1.6, -24.6); c.quadraticCurveTo(1.9, -22.6, 1.8, -21.2);
          stroke(c, '#fff4dc', 0.5);
          dot(c, -1.4, -21.2, 0.45, 0.6, '#c8c0b0');
          dot(c, 1.8, -21, 0.45, 0.6, '#c8c0b0');
        }
        break;
      case 'yukata':
        cel(c, function () { bodicePath(c); }, col, BODY_O);
        c.save(); bodicePath(c); c.clip();
        yukataPattern(c, col, -8, -28, 16, 9);
        c.restore();
        /* crossed collar, left over right, white under-collar */
        cel(c, function () {
          c.beginPath(); c.moveTo(-3.6, -27.8); c.lineTo(1.6, -21.4); c.lineTo(3, -21.6); c.lineTo(-1.8, -27.9); c.closePath();
        }, '#fffaf0', { s: 0.4, ink: 0.4, inkCol: tone(col, 'ink') });
        cel(c, function () {
          c.beginPath(); c.moveTo(3.6, -27.8); c.lineTo(-2.4, -20.2); c.lineTo(-0.4, -20.2); c.lineTo(5.4, -27.4); c.closePath();
        }, tone(col, 'd1'), { s: 0.4, ink: 0.45, inkCol: tone(col, 'ink') });
        break;
      case 'princess':
        cel(c, function () { bodicePath(c); }, col, BODY_O);
        /* a pale stomacher laced with gold, a jewelled neckline */
        var stom = function () {
          c.beginPath();
          c.moveTo(-2.8, -27); c.lineTo(2.8, -27); c.lineTo(1.5, WAIST_Y); c.lineTo(-1.5, WAIST_Y); c.closePath();
        };
        cel(c, stom, mix(col, '#ffffff', 0.72), { s: 0.6, ink: 0.4, inkCol: tone(col, 'ink') });
        c.beginPath();
        for (var lc = 0; lc < 3; lc++) {
          var ly0 = -25.6 + lc * 1.9;
          c.moveTo(-1.9, ly0); c.lineTo(1.7, ly0 + 1.5);
          c.moveTo(1.9, ly0); c.lineTo(-1.7, ly0 + 1.5);
        }
        stroke(c, '#d8a020', 0.32);
        c.beginPath();
        c.moveTo(-5.6, -27.4); c.quadraticCurveTo(0, -25.6, 5.6, -27.4);
        stroke(c, '#8a5a12', 1.1);
        c.beginPath();
        c.moveTo(-5.6, -27.4); c.quadraticCurveTo(0, -25.6, 5.6, -27.4);
        stroke(c, '#ffd24a', 0.6);
        jewel(c, 0, -26.2, 1.25, '#4aa0f0', 6);
        break;
      case 'raincoat':
        cel(c, function () { bodicePath(c); }, col, BODY_O);
        c.beginPath();
        c.moveTo(0.4, -26); c.lineTo(0.6, WAIST_Y + 0.4);
        stroke(c, tone(col, 'ink'), 0.4);
        /* collar flaps and a pair of toggles */
        for (var rc = -1; rc <= 1; rc += 2) {
          (function (side) {
            cel(c, function () {
              c.beginPath();
              c.moveTo(side * 0.3, -27);
              c.lineTo(side * 5.2, -28);
              c.quadraticCurveTo(side * 6.4, -25.6, side * 3.4, -23.8);
              c.closePath();
            }, mix(col, '#ffffff', 0.3), { s: 0.6, ink: 0.5, inkCol: tone(col, 'ink') });
          })(rc);
        }
        cel(c, function () { capsule(c, -1, -22.2, 0.6, 2, -22.2, 0.6); }, '#a8743c', { warm: true, s: 0.3, ink: 0.35 });
        c.beginPath();
        c.moveTo(-6, -24.6); c.quadraticCurveTo(-6.6, -22, -5.4, WAIST_Y - 0.4);
        c.globalAlpha = 0.6;
        stroke(c, '#ffffff', 0.7);
        c.globalAlpha = 1;
        break;
      case 'tee':
        cel(c, function () { bodicePath(c); }, col, BODY_O);
        /* ringer collar and a rainbow on the chest */
        c.beginPath();
        c.moveTo(-3.6, -27.9); c.quadraticCurveTo(0, -25.6, 3.6, -27.9);
        stroke(c, tone(col, 'ink'), 1.5);
        c.beginPath();
        c.moveTo(-3.6, -27.9); c.quadraticCurveTo(0, -25.6, 3.6, -27.9);
        stroke(c, '#ffffff', 0.9);
        var TR = ['#f0485a', '#ffd83a', '#4a9af0'];
        c.save();
        c.lineCap = 'butt';
        for (var tr = 0; tr < 3; tr++) {
          c.beginPath();
          c.arc(0, -21, 3.3 - tr * 0.75, Math.PI * 1.06, Math.PI * 1.94);
          c.strokeStyle = TR[tr];
          c.lineWidth = 0.78;
          c.stroke();
        }
        c.restore();
        dot(c, -3, -20.9, 1.1, 0.8, '#ffffff');
        dot(c, 3, -20.9, 1.1, 0.8, '#ffffff');
        break;
      case 'fairy':
        cel(c, function () {
          c.beginPath(); c.moveTo(-5.4, -27.6); c.quadraticCurveTo(0, -26.4, 5.4, -27.6); c.quadraticCurveTo(7.6, -27, 7.2, -24.6); c.lineTo(-7.2, -24.6); c.quadraticCurveTo(-7.6, -27, -5.4, -27.6); c.closePath();
        }, cu.skin, { warm: true, s: 0.8, ink: 0.55 });
        /* two leaves crossed into a bodice */
        var fleo = function () {
          c.beginPath();
          c.moveTo(-6.4, -25.6);
          c.quadraticCurveTo(-3, -27.4, 0, -24.4);
          c.quadraticCurveTo(3, -27.4, 6.4, -25.6);
          c.quadraticCurveTo(6.6, -22.4, 6, WAIST_Y);
          c.quadraticCurveTo(0, WAIST_Y + 0.8, -6, WAIST_Y);
          c.quadraticCurveTo(-6.6, -22.4, -6.4, -25.6);
          c.closePath();
        };
        cel(c, fleo, col, BODY_O);
        c.beginPath();
        c.moveTo(-5.6, -25.4); c.quadraticCurveTo(-1, -23, 3.4, WAIST_Y);
        c.moveTo(5.6, -25.4); c.quadraticCurveTo(1, -23, -3.4, WAIST_Y);
        stroke(c, tone(col, 'd2'), 0.4);
        c.beginPath();
        c.moveTo(-5.9, -25.2); c.quadraticCurveTo(-3, -26.8, -0.4, -24.3);
        c.moveTo(5.9, -25.2); c.quadraticCurveTo(3, -26.8, 0.4, -24.3);
        stroke(c, mix(col, '#ffffff', 0.6), 0.5);
        blossom(c, 0, -23.6, 1.5, '#fff6f0', 0.2);
        break;
      case 'tutu':
        var leo = function () {
          c.beginPath();
          c.moveTo(-6.2, -25.4);
          c.quadraticCurveTo(-3.2, -26.8, 0, -25.2);
          c.quadraticCurveTo(3.2, -26.8, 6.2, -25.4);
          c.quadraticCurveTo(6.4, -22.4, 6, WAIST_Y);
          c.quadraticCurveTo(0, WAIST_Y + 0.8, -6, WAIST_Y);
          c.quadraticCurveTo(-6.4, -22.4, -6.2, -25.4);
          c.closePath();
        };
        /* bare shoulders above the leotard */
        cel(c, function () {
          c.beginPath(); c.moveTo(-5.4, -27.6); c.quadraticCurveTo(0, -26.4, 5.4, -27.6); c.quadraticCurveTo(7.6, -27, 7.2, -24.6); c.lineTo(-7.2, -24.6); c.quadraticCurveTo(-7.6, -27, -5.4, -27.6); c.closePath();
        }, cu.skin, { warm: true, s: 0.8, ink: 0.55 });
        cel(c, leo, col, BODY_O);
        c.beginPath(); c.moveTo(-4.6, -26); c.lineTo(-4.4, -27.8); c.moveTo(4.6, -26); c.lineTo(4.4, -27.8);
        stroke(c, col, 0.8);
        for (var sp = 0; sp < 5; sp++) glint(c, -3 + sp * 1.5, -23 + (sp % 2) * 1.4, 0.3, 0.3, 0.9);
        break;
      default:
        cel(c, function () { bodicePath(c); }, col, BODY_O);
        if (o === 'frillyDress') {
          for (var s = -1; s <= 1; s += 2) {
            (function (side) {
              cel(c, function () {
                c.beginPath();
                c.moveTo(0, -27);
                c.quadraticCurveTo(side * 3, -28.4, side * 5.6, -27.3);
                c.quadraticCurveTo(side * 5.4, -24.6, side * 2.6, -24.4);
                c.quadraticCurveTo(side * 0.6, -24.8, 0, -27);
                c.closePath();
              }, '#fffaf2', { s: 0.6, ink: 0.45, inkCol: tone(col, 'ink') });
            })(s);
          }
          cel(c, function () { heartPath(c, 0, -23.2, 1.1); }, '#ff4a70', { s: 0.4, ink: 0.4 });
          glint(c, -0.4, -23.6, 0.35, 0.25, 0.9);
          /* waist sash */
          cel(c, function () { c.beginPath(); c.rect(-6.1, WAIST_Y - 1.6, 12.2, 1.9); }, light, { s: 0.5, ink: 0.45, inkCol: tone(col, 'ink') });
        } else if (o === 'sailorDress') {
          cel(c, function () {
            c.beginPath();
            c.moveTo(-6.6, -27.4); c.lineTo(0, -21.4); c.lineTo(6.6, -27.4); c.lineTo(4, -27.8); c.lineTo(0, -24.4); c.lineTo(-4, -27.8); c.closePath();
          }, '#ffffff', { s: 0.5, ink: 0.45, inkCol: tone(col, 'ink') });
          c.beginPath();
          c.moveTo(-5.6, -26.9); c.lineTo(0, -22.2); c.lineTo(5.6, -26.9);
          stroke(c, tone(col, 'd1'), 0.45);
          bow(c, 0, -22.4, '#d84a48', 0.55);
        } else {
          /* star dress: gold band and a star brooch */
          cel(c, function () { c.beginPath(); c.rect(-6.1, WAIST_Y - 1.5, 12.2, 1.7); }, '#ffd24a', { s: 0.5, ink: 0.45, inkCol: '#a0701a' });
          cel(c, function () { starPath(c, 0, -24.4, 2.2); }, '#fff2a0', { s: 0.6, ink: 0.4, inkCol: '#a0701a' });
        }
    }
    /* the head's shadow across the collar */
    c.save();
    bodicePath(c);
    c.clip();
    c.globalAlpha = 0.28;
    dot(c, LIT * 1.2, -27.6, 6.5, 2.2, '#3a1a60');
    c.restore();
    bodyAccessory(c, cu);
  }

  /* Accessories worn on the bodice (the hanging bits are chains). */
  var LEI = ['#ff8fb6', '#ffd24a', '#fff6f0', '#ff9a5a', '#c89af0'];
  function strap(c, x1, y1, x2, y2, col) {
    cel(c, function () { capsule(c, x1, y1, 1, x2, y2, 0.9); }, col, { s: 0.4, ink: 0.5 });
    c.beginPath();
    c.moveTo(x1, y1 + 0.6); c.lineTo(x2, y2 - 0.6);
    stitch(c, tone(col, 'hi'), 0.2);
  }
  function bodyAccessory(c, cu) {
    var i;
    switch (cu.accessory) {
      case 'scarf':
        var sc = '#d8504a';
        var wrap = function () {
          c.beginPath();
          c.moveTo(-6.8, -29); c.quadraticCurveTo(0, -27, 6.8, -29);
          c.quadraticCurveTo(8.4, -26.8, 6.6, -24.4); c.quadraticCurveTo(0, -22, -6.6, -24.4);
          c.quadraticCurveTo(-8.4, -26.8, -6.8, -29); c.closePath();
        };
        cel(c, wrap, sc, { s: 1.2, ink: 0.65, x0: -8, x1: 8, y0: -29, y1: -22, rim: 0.6 });
        c.save();
        wrap();
        c.clip();
        c.beginPath();
        c.moveTo(-8, -27); c.quadraticCurveTo(0, -24.8, 8, -27);
        stroke(c, '#fff0d8', 0.9);
        /* the knit */
        c.globalAlpha = 0.4;
        c.beginPath();
        for (i = -7; i <= 7; i++) { c.moveTo(i * 1.1, -29.4); c.lineTo(i * 1.12 + 0.4, -22); }
        stroke(c, tone(sc, 'd2'), 0.25);
        c.restore();
        cel(c, function () { ell(c, 3.6, -24.8, 2.2, 1.9, 0.3); }, tone(sc, 'd1'), { s: 0.6, ink: 0.55, inkCol: tone(sc, 'ink') });
        break;
      case 'backpack':
        strap(c, -4.8, -27.8, -5.6, -21, '#3f7a30');
        strap(c, 4.8, -27.8, 5.6, -21, '#3f7a30');
        break;
      case 'necklace':
        /* a string of pearls down to the pendant */
        for (i = 0; i <= 8; i++) {
          var u = i / 8, px = -3.8 + 7.6 * u + (0.5 - Math.abs(u - 0.5)) * 0.8, py = -27.8 + 2 * u * (1 - u) * 7.4;
          dot(c, px, py, 0.55, 0.55, '#fff6e4');
          stroke(c, '#b08a4a', 0.22);
        }
        break;
      case 'cape':
        /* the cape's shoulders drape over the sleeves' tops */
        for (var cs = -1; cs <= 1; cs += 2) {
          (function (side) {
            cel(c, function () {
              c.beginPath();
              c.moveTo(side * 3.2, -28.4);
              c.quadraticCurveTo(side * 8.8, -29, side * 9.4, -24);
              c.quadraticCurveTo(side * 6.6, -25, side * 4.4, -26.2);
              c.closePath();
            }, '#c8384a', { s: 0.6, ink: 0.5 });
            c.beginPath();
            c.moveTo(side * 4.6, -26.5); c.quadraticCurveTo(side * 6.8, -25.4, side * 9.2, -24.5);
            stroke(c, '#ffd24a', 0.4);
          })(cs);
        }
        c.beginPath(); c.moveTo(-4.4, -27); c.quadraticCurveTo(0, -25.4, 4.4, -27);
        stroke(c, '#8a5a12', 0.8);
        c.beginPath(); c.moveTo(-4.4, -27); c.quadraticCurveTo(0, -25.4, 4.4, -27);
        stroke(c, '#ffd24a', 0.4);
        metal(c, function () { starPath(c, 0, -26.1, 2.1, 0.5); }, '#ffcf3a', -2.1, -28.2, 2.1, -24, { ink: 0.4, inkCol: '#8a5a12' });
        break;
      case 'satchel':
        strap(c, 6.4, -27.6, -6.2, -17, '#8a5a34');
        break;
      case 'bowtie':
        c.save();
        c.translate(0, -26.3);
        c.scale(1.12, 1.12);
        bow(c, 0, 0, '#e8485a', 1);
        var BD = [[-2.5, -0.9], [-3.3, 0.9], [-1.7, 0.9], [2.5, -0.9], [3.3, 0.9], [1.7, 0.9]];
        for (i = 0; i < BD.length; i++) dot(c, BD[i][0], BD[i][1], 0.32, 0.32, '#fff8ee');
        c.restore();
        break;
      case 'bandana':
        var bnd = '#3f8ae8';
        var tri = function () {
          c.beginPath();
          c.moveTo(-6.6, -28.8); c.quadraticCurveTo(0, -27, 6.6, -28.8);
          c.quadraticCurveTo(5.4, -24.6, 0.9, -20.4);
          c.quadraticCurveTo(-4.6, -24.4, -6.6, -28.8);
          c.closePath();
        };
        cel(c, tri, bnd, { s: 1.1, ink: 0.6, x0: -6.6, x1: 6.6, y0: -29, y1: -20.4, rim: 0.6 });
        c.save();
        tri();
        c.clip();
        for (i = 0; i < 9; i++) dot(c, -4.6 + (i % 3) * 3.6 + (Math.floor(i / 3) % 2) * 1.6, -26.6 + Math.floor(i / 3) * 2.3, 0.5, 0.5, '#fff8ee');
        c.beginPath();
        c.moveTo(-6, -28); c.quadraticCurveTo(0, -26, 6, -28);
        stroke(c, tone(bnd, 'd2'), 0.5);
        c.restore();
        break;
      case 'lei':
        c.beginPath();
        c.moveTo(-6, -28.6); c.quadraticCurveTo(0, -17.6, 6, -28.6);
        stroke(c, '#3f7a30', 0.8);
        /* the ends first, so the blooms at the front overlap them */
        var order = [0, 8, 1, 7, 2, 6, 3, 5, 4];
        for (i = 0; i < 9; i++) {
          var lu = order[i] / 8;
          blossom(c, -6 + 12 * lu, -28.6 + 2 * lu * (1 - lu) * 11, 1.85, LEI[order[i] % 5], order[i] * 0.7);
        }
        break;
      case 'camera':
        c.beginPath();
        c.moveTo(-4, -27.8); c.lineTo(0.2, -22.4);
        c.moveTo(4.2, -27.8); c.lineTo(0.8, -22.4);
        stroke(c, '#3a2a48', 0.9);
        c.beginPath();
        c.moveTo(-4, -27.8); c.lineTo(0.2, -22.4);
        c.moveTo(4.2, -27.8); c.lineTo(0.8, -22.4);
        stroke(c, '#ff9ec4', 0.45);
        break;
    }
    if (cu.back === 'bearPack') {
      strap(c, -4.8, -27.8, -5.6, -21, '#a06a3a');
      strap(c, 4.8, -27.8, 5.6, -21, '#a06a3a');
    } else if (cu.back === 'leafCape') {
      /* two leaves over the shoulders, pinned with an acorn */
      for (var ls = -1; ls <= 1; ls += 2) {
        (function (side) {
          cel(c, function () {
            c.beginPath();
            c.moveTo(side * 1.4, -27);
            c.quadraticCurveTo(side * 6, -30.4, side * 9.6, -25.2);
            c.quadraticCurveTo(side * 5.6, -24.2, side * 1.4, -27);
            c.closePath();
          }, '#6bb84a', { s: 0.7, ink: 0.5 });
          c.beginPath();
          c.moveTo(side * 2, -27); c.quadraticCurveTo(side * 5.6, -27.4, side * 9, -25.4);
          stroke(c, '#3f7a30', 0.3);
        })(ls);
      }
      cel(c, function () { ell(c, 0, -25.6, 1.3, 1.6); }, '#d8a45a', { s: 0.5, ink: 0.4 });
      cel(c, function () { c.beginPath(); c.ellipse(0, -26.5, 1.6, 1, 0, Math.PI, TAU); c.closePath(); }, '#8a5a34', { s: 0.3, ink: 0.4 });
    }
  }
  /* The camera that hangs from its strap, drawn round its top centre. */
  function cameraArt(g) {
    var col = '#3aa8b8';
    cel(g, function () { E.roundRect(g, -2.9, -0.5, 2.6, 1.6, 0.5); }, '#eef2f6', { s: 0.4, ink: 0.4, inkCol: '#3a2a48' });
    cel(g, function () { capsule(g, 2, 0.1, 0.5, 2.8, 0.1, 0.5); }, '#e8485a', { s: 0.2, ink: 0.3 });
    var body = function () { E.roundRect(g, -4.3, 0.6, 8.6, 5.7, 1.3); };
    cel(g, body, col, { s: 1.1, ink: 0.6, x0: -4.3, x1: 4.3, y0: 0.6, y1: 6.3, rim: 0.6 });
    g.save();
    body();
    g.clip();
    g.fillStyle = '#fff4dc';
    g.fillRect(-5, 1.5, 10, 1.1);
    g.restore();
    /* lens: a dark barrel, the glass and its reflection */
    cel(g, function () { ell(g, 0.5, 3.7, 2.4, 2.4); }, '#4a4a66', { s: 0.6, ink: 0.5, inkCol: '#2a2238' });
    var gl = g.createRadialGradient(0.5 - LIT * 0.5, 3.1, 0.2, 0.5, 3.7, 1.7);
    gl.addColorStop(0, '#bfe8ff');
    gl.addColorStop(0.5, '#4a7ad8');
    gl.addColorStop(1, '#1a1a4a');
    ell(g, 0.5, 3.7, 1.65, 1.65);
    g.fillStyle = gl;
    g.fill();
    glint(g, 0.5 - LIT * 0.6, 3, 0.5, 0.32, 0.95, -0.5);
    dot(g, -3, 2.05, 0.5, 0.4, '#ffe27a');
    stroke(g, '#8a5a12', 0.2);
  }
  /* The star wand she holds, in the forearm's frame (fist at 0.1, FORE + 1.6). */
  function wandArt(g) {
    var hx = 0.3, hy = FORE + 2.6, tx = -4.4, ty = -3.6;
    cel(g, function () { capsule(g, hx, hy, 0.6, tx, ty, 0.5); }, '#fff2f8', { s: 0.4, ink: 0.45, inkCol: '#a04a78' });
    g.beginPath();
    for (var i = 0; i < 5; i++) {
      var u = 0.16 + i * 0.16, x = hx + (tx - hx) * u, y = hy + (ty - hy) * u;
      g.moveTo(x - 0.55, y - 0.1); g.lineTo(x + 0.5, y + 0.45);
    }
    stroke(g, '#ff7aa8', 0.38);
    /* streamers under the star */
    cel(g, function () {
      g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(tx - 3.4, ty + 2, tx - 3, ty + 5.4); g.lineTo(tx - 1.8, ty + 4.4); g.quadraticCurveTo(tx - 2, ty + 2.2, tx + 0.4, ty + 0.8); g.closePath();
    }, '#8fd0ff', { s: 0.4, ink: 0.35 });
    cel(g, function () {
      g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(tx + 2.6, ty + 1.6, tx + 2.4, ty + 4.4); g.lineTo(tx + 1.3, ty + 3.6); g.quadraticCurveTo(tx + 1.2, ty + 2, tx - 0.4, ty + 0.8); g.closePath();
    }, '#ff9ec4', { s: 0.4, ink: 0.35 });
    var sx = tx - 0.8, sy = ty - 2.6;
    metal(g, function () { starPath(g, sx, sy, 4.3, 0.5); }, '#ffd83a', sx - 4.3, sy - 4.3, sx + 4.3, sy + 4.3, { ink: 0.6, inkCol: '#a8701a' });
    starPath(g, sx, sy + 0.1, 2, 0.5);
    g.fillStyle = 'rgba(255, 250, 214, 0.8)';
    g.fill();
    /* twinkles */
    var TW = [[sx - 4.6, sy - 3.6, 1.1], [sx + 4.8, sy - 1.4, 0.8], [sx + 2.6, sy - 5, 0.6]];
    for (var t = 0; t < TW.length; t++) {
      g.beginPath();
      g.moveTo(TW[t][0], TW[t][1] - TW[t][2]);
      g.quadraticCurveTo(TW[t][0], TW[t][1], TW[t][0] + TW[t][2], TW[t][1]);
      g.quadraticCurveTo(TW[t][0], TW[t][1], TW[t][0], TW[t][1] + TW[t][2]);
      g.quadraticCurveTo(TW[t][0], TW[t][1], TW[t][0] - TW[t][2], TW[t][1]);
      g.quadraticCurveTo(TW[t][0], TW[t][1], TW[t][0], TW[t][1] - TW[t][2]);
      g.fillStyle = '#ffffff';
      g.fill();
    }
  }
  /* A small bear, drawn hanging by one paw from (0, 0). */
  function bearArt(g, col, lite) {
    var o = function (x, y, rx, ry, rot, cc, s) {
      cel(g, function () { ell(g, x, y, rx, ry, rot); }, cc || col, { warm: true, s: s || 0.7, ink: 0.45, inkCol: tone(col, 'ink', true) });
    };
    cel(g, function () { capsule(g, 0.1, 0.4, 0.95, 0.9, 4.4, 1.05); }, col, { warm: true, s: 0.5, ink: 0.45 });
    o(-0.5, 9.5, 1.25, 1.55, 0.25);
    o(2.5, 9.5, 1.25, 1.55, -0.25);
    dot(g, -0.6, 10, 0.6, 0.7, lite);
    dot(g, 2.6, 10, 0.6, 0.7, lite);
    o(1, 7, 2.6, 2.9, 0, col, 1);
    dot(g, 1.1, 7.4, 1.5, 1.8, lite);
    o(3.5, 6.2, 0.95, 1.5, -0.6);
    o(-1.3, 1.9, 1.15, 1.15, 0);
    o(3.1, 1.6, 1.15, 1.15, 0);
    dot(g, -1.3, 2, 0.55, 0.55, lite);
    dot(g, 3.1, 1.7, 0.55, 0.55, lite);
    o(0.9, 3.5, 2.8, 2.45, 0, col, 1);
    dot(g, 1.1, 4.2, 1.35, 1.05, lite);
    dot(g, 1.1, 3.75, 0.5, 0.36, '#3a2028');
    g.beginPath();
    g.moveTo(1.1, 4.1); g.lineTo(1.1, 4.5);
    g.moveTo(0.5, 4.6); g.quadraticCurveTo(1.1, 5.1, 1.7, 4.6);
    stroke(g, '#3a2028', 0.25);
    dot(g, -0.2, 3, 0.38, 0.45, '#2a1820');
    dot(g, 2.2, 2.9, 0.38, 0.45, '#2a1820');
    glint(g, -0.3, 2.85, 0.14, 0.14, 1);
    glint(g, 2.1, 2.75, 0.14, 0.14, 1);
    bow(g, 1, 5.55, '#e8485a', 0.36);
  }
  function satchelArt(g) {
    var col = '#b07a48';
    cel(g, function () {
      g.beginPath(); g.moveTo(-4.6, 0); g.lineTo(4.6, 0); g.quadraticCurveTo(5.4, 6.8, 3.6, 7.6); g.lineTo(-3.6, 7.6); g.quadraticCurveTo(-5.4, 6.8, -4.6, 0); g.closePath();
    }, col, { warm: true, s: 1.1, ink: 0.6, x0: -5, x1: 5, y0: 0, y1: 7.6, rim: 0.6 });
    var flap = function () {
      g.beginPath(); g.moveTo(-4.8, -0.3); g.lineTo(4.8, -0.3); g.lineTo(4.3, 3.4); g.quadraticCurveTo(0, 5.2, -4.3, 3.4); g.closePath();
    };
    cel(g, flap, tone(col, 'd1', true), { warm: true, s: 0.6, ink: 0.5, inkCol: tone(col, 'ink', true) });
    g.beginPath();
    g.moveTo(-3.8, 0.6); g.lineTo(-3.5, 3); g.quadraticCurveTo(0, 4.4, 3.5, 3); g.lineTo(3.8, 0.6);
    stitch(g, '#f2d6a8', 0.22);
    metal(g, function () { E.roundRect(g, -1.1, 3.1, 2.2, 2.2, 0.4); }, '#ffcf3a', -1.1, 3.1, 1.1, 5.3, { ink: 0.35, inkCol: '#8a5a12' });
    dot(g, 0, 4.2, 0.4, 0.4, '#8a5a12');
  }
  function backpackArt(c) {
    var bc = '#4e8f3c';
    /* the grab handle */
    c.beginPath();
    c.arc(-10.6, -28.2, 1.7, Math.PI, TAU);
    stroke(c, tone(bc, 'ink'), 1.3);
    c.beginPath();
    c.arc(-10.6, -28.2, 1.7, Math.PI, TAU);
    stroke(c, tone(bc, 'd1'), 0.6);
    var bag = function () {
      c.beginPath();
      c.moveTo(-6.4, -28); c.quadraticCurveTo(-16.6, -29.4, -17, -22);
      c.lineTo(-16.6, -15.4); c.quadraticCurveTo(-11.4, -12.6, -6, -14.6); c.closePath();
    };
    cel(c, bag, bc, { s: 1.8, ink: 0.7, x0: -17, x1: -6, y0: -29, y1: -13, rim: 0.7 });
    /* the lid and its strap and buckle */
    cel(c, function () {
      c.beginPath();
      c.moveTo(-6.4, -28); c.quadraticCurveTo(-16.6, -29.4, -17, -23.2);
      c.quadraticCurveTo(-12, -20.4, -6.6, -22.4); c.closePath();
    }, mix(bc, '#fff4dc', 0.28), { s: 0.9, ink: 0.55, inkCol: tone(bc, 'ink') });
    c.beginPath();
    c.moveTo(-16.2, -23.4); c.quadraticCurveTo(-12, -21.2, -7.2, -22.8);
    stitch(c, '#fff4dc', 0.22);
    cel(c, function () { c.beginPath(); c.rect(-14.2, -24.4, 1.7, 5.4); }, '#8a5a34', { s: 0.3, ink: 0.4 });
    metal(c, function () { c.beginPath(); c.rect(-14.6, -20.6, 2.5, 2); }, '#ffcf3a', -14.6, -20.6, -12.1, -18.6, { ink: 0.35, inkCol: '#8a5a12' });
    /* front pocket */
    cel(c, function () {
      c.beginPath(); c.moveTo(-16.4, -18.4); c.quadraticCurveTo(-14.6, -13.8, -10.6, -14.2); c.lineTo(-11, -18); c.closePath();
    }, tone(bc, 'd1'), { s: 0.5, ink: 0.5, inkCol: tone(bc, 'ink') });
    c.beginPath();
    c.moveTo(-15.8, -17.6); c.lineTo(-11.4, -17.3);
    stitch(c, tone(bc, 'hi'), 0.2);
  }

  /* The skirt (or shorts, or hems) hanging from the waist. */
  function skirtPath(c, hemY, top, hem, wave) {
    return function () {
      c.beginPath();
      c.moveTo(-top, WAIST_Y - 0.4);
      c.lineTo(top, WAIST_Y - 0.4);
      c.bezierCurveTo(top + 2, WAIST_Y + 3, hem - 1, hemY - 4, hem, hemY);
      var n = 5;
      for (var i = 0; i < n; i++) {
        var x0 = hem - (2 * hem) * (i / n), x1 = hem - (2 * hem) * ((i + 1) / n);
        c.quadraticCurveTo((x0 + x1) / 2, hemY + wave + Math.sin((i + 0.5) / n * Math.PI) * 1.2, x1, hemY + Math.sin((i + 1) / n * Math.PI) * 1.2);
      }
      c.bezierCurveTo(-hem + 1, hemY - 4, -top - 2, WAIST_Y + 3, -top, WAIST_Y - 0.4);
      c.closePath();
    };
  }
  function folds(c, path, col, hemY, top, hem) {
    c.save();
    path();
    c.clip();
    c.fillStyle = tone(col, 'd1');
    var F2 = [-0.62, -0.18, 0.3, 0.72];
    c.beginPath();
    for (var i = 0; i < F2.length; i++) {
      var fx = F2[i];
      c.moveTo(fx * top, WAIST_Y + 1);
      c.lineTo(fx * hem - 1.2, hemY + 2);
      c.lineTo(fx * hem + 0.6, hemY + 2);
      c.closePath();
    }
    c.fill();
    c.fillStyle = tone(col, 'hi');
    c.globalAlpha = 0.55;
    c.beginPath();
    for (var j = 0; j < F2.length - 1; j++) {
      var hx = (F2[j] + F2[j + 1]) / 2 - LIT * 0.06;
      c.moveTo(hx * top, WAIST_Y + 1.5);
      c.lineTo(hx * hem - 0.5, hemY);
      c.lineTo(hx * hem + 0.5, hemY);
      c.closePath();
    }
    c.fill();
    c.restore();
  }
  function drawSkirt(c, cu) {
    var col = cu.outfitColor, o = cu.outfit, p;
    var light = mix(col, '#ffffff', 0.6);
    switch (o) {
      case 'overalls':
        p = function () {
          c.beginPath();
          c.moveTo(-6, WAIST_Y - 0.6); c.lineTo(6, WAIST_Y - 0.6);
          c.quadraticCurveTo(7.4, -15, 7.6, -11.4);
          c.lineTo(1, -11); c.lineTo(0, -13.2); c.lineTo(-1, -11);
          c.lineTo(-7.6, -11.4);
          c.quadraticCurveTo(-7.4, -15, -6, WAIST_Y - 0.6);
          c.closePath();
        };
        cel(c, p, col, { s: 1.4, ink: 0.7, x0: -8, x1: 8, y0: WAIST_Y, y1: -11, rim: 0.6 });
        cel(c, function () { c.beginPath(); c.rect(-7.6, -12.6, 6.6, 1.5); }, tone(col, 'd1'), { s: 0.3, ink: 0.4, inkCol: tone(col, 'ink') });
        cel(c, function () { c.beginPath(); c.rect(1, -12.6, 6.6, 1.5); }, tone(col, 'd1'), { s: 0.3, ink: 0.4, inkCol: tone(col, 'ink') });
        c.beginPath(); c.moveTo(-4.4, -18); c.quadraticCurveTo(-3, -16.4, -3.6, -14.6); c.moveTo(4.4, -18); c.quadraticCurveTo(3, -16.4, 3.6, -14.6);
        stroke(c, tone(col, 'd2'), 0.35);
        break;
      case 'sweater':
        p = skirtPath(c, -12.4, 6, 7.4, 0.2);
        cel(c, p, col, { s: 1.4, ink: 0.7, x0: -8, x1: 8, y0: WAIST_Y, y1: -12, rim: 0.6 });
        c.save(); p(); c.clip();
        c.beginPath();
        for (var x = -7; x <= 7; x += 2.4) { c.moveTo(x * 0.85, WAIST_Y); c.lineTo(x, -11); }
        stroke(c, tone(col, 'd1'), 0.4);
        c.fillStyle = tone(col, 'd1');
        c.fillRect(-9, -14.2, 18, 3);
        c.restore();
        break;
      case 'hoodie':
        p = skirtPath(c, -14, 6, 6.8, 0);
        cel(c, p, col, { s: 1.4, ink: 0.7, x0: -8, x1: 8, y0: WAIST_Y, y1: -13, rim: 0.6 });
        c.save(); p(); c.clip();
        c.fillStyle = tone(col, 'd1');
        c.fillRect(-9, -15.4, 18, 3);
        c.restore();
        cel(c, function () {
          c.beginPath(); c.moveTo(-4, -19); c.lineTo(4, -19); c.lineTo(5, -15.6); c.lineTo(-5, -15.6); c.closePath();
        }, tone(col, 'd1'), { s: 0.4, ink: 0.5, inkCol: tone(col, 'ink') });
        break;
      case 'yukata':
        p = function () {
          c.beginPath();
          c.moveTo(-6.2, WAIST_Y - 0.4); c.lineTo(6.2, WAIST_Y - 0.4);
          c.quadraticCurveTo(8, -12, 7.6, -3.6);
          c.quadraticCurveTo(0, -2.6, -7.6, -3.6);
          c.quadraticCurveTo(-8, -12, -6.2, WAIST_Y - 0.4);
          c.closePath();
        };
        cel(c, p, col, { s: 1.6, ink: 0.7, x0: -8, x1: 8, y0: WAIST_Y, y1: -3, rim: 0.6 });
        c.save(); p(); c.clip();
        yukataPattern(c, col, -9, WAIST_Y, 18, 18);
        c.restore();
        c.beginPath(); c.moveTo(-2.4, WAIST_Y); c.quadraticCurveTo(1, -11, 3.6, -3.2);
        stroke(c, tone(col, 'ink'), 0.5);
        /* obi */
        var obi = '#e8504a';
        cel(c, function () { c.beginPath(); c.rect(-6.6, WAIST_Y - 2.2, 13.2, 3.8); }, obi, { s: 0.6, ink: 0.55, x0: -6.6, x1: 6.6, y0: WAIST_Y - 2, y1: WAIST_Y + 1.6 });
        c.beginPath(); c.moveTo(-6.6, WAIST_Y - 0.3); c.lineTo(6.6, WAIST_Y - 0.3);
        stroke(c, '#ffd24a', 0.45);
        break;
      case 'pinafore':
        p = skirtPath(c, -10.4, 5.9, 12.2, 0.6);
        cel(c, p, col, { s: 1.8, ink: 0.7, x0: -12.2, x1: 12.2, y0: WAIST_Y, y1: -10.4, rim: 0.7 });
        folds(c, p, col, -10.4, 5.9, 12.2);
        c.save();
        p();
        c.clip();
        c.beginPath();
        c.moveTo(-14, -12.2); c.quadraticCurveTo(0, -10.4, 14, -12.2);
        stitch(c, tone(col, 'hi'), 0.24);
        c.restore();
        /* a patch pocket with a heart, and the waistband */
        cel(c, function () {
          c.beginPath(); c.moveTo(2.2, -17.4); c.lineTo(7, -17.2); c.lineTo(7.6, -13.4); c.quadraticCurveTo(5, -12.6, 2.6, -13.4); c.closePath();
        }, tone(col, 'd1'), { s: 0.4, ink: 0.45, inkCol: tone(col, 'ink') });
        cel(c, function () { heartPath(c, 4.9, -15.3, 0.95); }, '#fff4dc', { s: 0.3, ink: 0.3, inkCol: tone(col, 'ink') });
        cel(c, function () { c.beginPath(); c.rect(-6.1, WAIST_Y - 1.2, 12.2, 1.7); }, tone(col, 'd1'), { s: 0.4, ink: 0.45, inkCol: tone(col, 'ink') });
        break;
      case 'princess':
        var gh = -3.4;
        var gown = function () {
          c.beginPath();
          c.moveTo(-6, WAIST_Y - 0.4);
          c.lineTo(6, WAIST_Y - 0.4);
          c.bezierCurveTo(10.6, WAIST_Y + 2, 13.6, gh - 6, 14.4, gh);
          for (var gi = 0; gi < 6; gi++) {
            var ga = 14.4 - 28.8 * (gi / 6), gb = 14.4 - 28.8 * ((gi + 1) / 6);
            c.quadraticCurveTo((ga + gb) / 2, gh + 1.5, gb, gh);
          }
          c.bezierCurveTo(-13.6, gh - 6, -10.6, WAIST_Y + 2, -6, WAIST_Y - 0.4);
          c.closePath();
        };
        cel(c, gown, col, { s: 2, ink: 0.7, x0: -14.4, x1: 14.4, y0: WAIST_Y, y1: gh, rim: 0.7 });
        folds(c, gown, col, gh, 5.9, 14);
        c.save();
        gown();
        c.clip();
        /* the pale front panel the overskirt parts to show */
        c.beginPath();
        c.moveTo(0, WAIST_Y + 0.4);
        c.quadraticCurveTo(-3.6, -11, -6.4, gh + 2);
        c.lineTo(6.4, gh + 2);
        c.quadraticCurveTo(3.6, -11, 0, WAIST_Y + 0.4);
        c.closePath();
        c.fillStyle = mix(col, '#ffffff', 0.72);
        c.fill();
        c.beginPath();
        c.moveTo(0, WAIST_Y + 0.4); c.quadraticCurveTo(-3.6, -11, -6.4, gh + 2);
        c.moveTo(0, WAIST_Y + 0.4); c.quadraticCurveTo(3.6, -11, 6.4, gh + 2);
        stroke(c, '#8a5a12', 1.1);
        c.beginPath();
        c.moveTo(0, WAIST_Y + 0.4); c.quadraticCurveTo(-3.6, -11, -6.4, gh + 2);
        c.moveTo(0, WAIST_Y + 0.4); c.quadraticCurveTo(3.6, -11, 6.4, gh + 2);
        stroke(c, '#ffd24a', 0.6);
        /* a gold band and a white ruffle at the hem */
        c.beginPath();
        c.moveTo(-15, gh - 2.6); c.quadraticCurveTo(0, gh - 0.8, 15, gh - 2.6);
        stroke(c, '#ffd24a', 0.7);
        c.fillStyle = '#fffaf2';
        c.beginPath();
        c.moveTo(-15, gh - 1.4); c.quadraticCurveTo(0, gh + 0.4, 15, gh - 1.4);
        c.lineTo(15, gh + 3); c.lineTo(-15, gh + 3);
        c.closePath();
        c.fill();
        c.restore();
        for (var gs = 0; gs < 7; gs++) glint(c, -11 + gs * 3.7, -13.4 + (gs % 3) * 2.6, 0.32, 0.32, 0.95);
        /* gold girdle dipping to a point */
        cel(c, function () {
          c.beginPath();
          c.moveTo(-6.2, WAIST_Y - 1.4); c.lineTo(6.2, WAIST_Y - 1.4); c.lineTo(6.2, WAIST_Y - 0.2);
          c.lineTo(0, WAIST_Y + 2); c.lineTo(-6.2, WAIST_Y - 0.2);
          c.closePath();
        }, '#ffd24a', { s: 0.5, ink: 0.45, inkCol: '#8a5a12' });
        break;
      case 'raincoat':
        p = skirtPath(c, -11.4, 6.2, 9.8, 0.1);
        cel(c, p, col, { s: 1.6, ink: 0.7, x0: -10, x1: 10, y0: WAIST_Y, y1: -11, rim: 0.7 });
        c.save();
        p();
        c.clip();
        c.beginPath();
        c.moveTo(0.6, WAIST_Y); c.lineTo(0.9, -10);
        stroke(c, tone(col, 'ink'), 0.4);
        c.beginPath();
        c.moveTo(-11, -12.6); c.quadraticCurveTo(0, -11.2, 11, -12.6);
        stitch(c, tone(col, 'hi'), 0.22);
        c.beginPath();
        c.moveTo(-7.4, WAIST_Y + 1.4); c.quadraticCurveTo(-9.2, -15, -9.6, -12.2);
        c.globalAlpha = 0.6;
        stroke(c, '#ffffff', 0.7);
        c.restore();
        for (var rp = -1; rp <= 1; rp += 2) {
          (function (side) {
            cel(c, function () {
              c.beginPath(); c.moveTo(side * 2.4, -17); c.lineTo(side * 6.6, -17.2); c.lineTo(side * 7, -13.4); c.quadraticCurveTo(side * 4.6, -12.6, side * 2.4, -13.4); c.closePath();
            }, tone(col, 'd1'), { s: 0.4, ink: 0.45, inkCol: tone(col, 'ink') });
          })(rp);
        }
        cel(c, function () { capsule(c, -1, -18.2, 0.6, 2, -18.2, 0.6); }, '#a8743c', { warm: true, s: 0.3, ink: 0.35 });
        break;
      case 'tee':
        var dn = '#5a7fb0';
        p = function () {
          c.beginPath();
          c.moveTo(-6, WAIST_Y + 1); c.lineTo(6, WAIST_Y + 1);
          c.quadraticCurveTo(7.6, -15, 7.8, -11.2);
          c.lineTo(1, -10.8); c.lineTo(0, -13); c.lineTo(-1, -10.8);
          c.lineTo(-7.8, -11.2);
          c.quadraticCurveTo(-7.6, -15, -6, WAIST_Y + 1);
          c.closePath();
        };
        cel(c, p, dn, { s: 1.4, ink: 0.7, x0: -8, x1: 8, y0: WAIST_Y, y1: -11, rim: 0.6 });
        cel(c, function () { c.beginPath(); c.rect(-7.8, -12.6, 6.8, 1.6); }, mix(dn, '#ffffff', 0.5), { s: 0.3, ink: 0.4, inkCol: tone(dn, 'ink') });
        cel(c, function () { c.beginPath(); c.rect(1, -12.6, 6.8, 1.6); }, mix(dn, '#ffffff', 0.5), { s: 0.3, ink: 0.4, inkCol: tone(dn, 'ink') });
        c.beginPath();
        c.moveTo(-5.6, -16.6); c.quadraticCurveTo(-4.4, -15, -2.4, -15.2);
        c.moveTo(5.6, -16.6); c.quadraticCurveTo(4.4, -15, 2.4, -15.2);
        stitch(c, '#f2d6a8', 0.22);
        /* the tee's hem over the waistband */
        cel(c, function () {
          c.beginPath();
          c.moveTo(-6.3, WAIST_Y - 0.6); c.lineTo(6.3, WAIST_Y - 0.6);
          c.quadraticCurveTo(6.9, -18.4, 6.7, -17.4);
          c.quadraticCurveTo(0, -16.4, -6.7, -17.4);
          c.quadraticCurveTo(-6.9, -18.4, -6.3, WAIST_Y - 0.6);
          c.closePath();
        }, col, { s: 0.9, ink: 0.6, x0: -7, x1: 7, y0: WAIST_Y, y1: -17, rim: 0.5 });
        break;
      case 'fairy':
        /* two rows of petals, the back row darker and longer */
        var PT = [[-5, 0.95, 10.6, 1], [5, -0.95, 10.6, 1], [-2.6, 0.45, 11.8, 1], [2.6, -0.45, 11.8, 1], [0, 0, 12.2, 1],
                  [-4.2, 0.72, 8.8, 0], [4.2, -0.72, 8.8, 0], [-1.5, 0.24, 9.8, 0], [1.5, -0.24, 9.8, 0]];
        for (var pi = 0; pi < PT.length; pi++) {
          (function (L) {
            var pc = L[3] ? tone(col, 'd1') : col;
            c.save();
            c.translate(L[0], WAIST_Y - 0.4);
            c.rotate(L[1]);
            var pp = function () { c.beginPath(); leafPath(c, L[2], 3.9); };
            cel(c, pp, pc, { s: 1.3, ink: 0.6, inkCol: tone(col, 'ink'), x0: -3.9, x1: 3.9, y0: 0, y1: L[2], rim: 0.5 });
            c.save();
            pp();
            c.clip();
            /* tips fading to cream */
            var tg = c.createLinearGradient(0, L[2] * 0.5, 0, L[2]);
            tg.addColorStop(0, 'rgba(255, 250, 232, 0)');
            tg.addColorStop(1, 'rgba(255, 250, 232, 0.8)');
            c.fillStyle = tg;
            c.fillRect(-4, 0, 8, L[2]);
            c.beginPath();
            c.moveTo(0, 1); c.lineTo(0, L[2] - 1.4);
            stroke(c, tone(col, 'd2'), 0.3);
            c.restore();
            c.restore();
          })(PT[pi]);
        }
        /* a vine belt with a bloom on the hip */
        c.beginPath();
        c.moveTo(-6.2, WAIST_Y - 0.4); c.quadraticCurveTo(0, WAIST_Y + 0.6, 6.2, WAIST_Y - 0.4);
        stroke(c, '#2c5a26', 1.5);
        c.beginPath();
        c.moveTo(-6.2, WAIST_Y - 0.4); c.quadraticCurveTo(0, WAIST_Y + 0.6, 6.2, WAIST_Y - 0.4);
        stroke(c, '#6bb84a', 0.8);
        blossom(c, -3.6, WAIST_Y, 1.5, '#fff6f0', 0.4);
        break;
      case 'tutu':
        for (var layer = 0; layer < 3; layer++) {
          var hy = -13.6 + layer * 0.9, hw = 14.8 - layer * 1.6;
          (function (hy, hw, layer) {
            var lp = function () {
              c.beginPath();
              c.moveTo(-6, WAIST_Y - 0.4);
              c.lineTo(6, WAIST_Y - 0.4);
              c.quadraticCurveTo(hw, WAIST_Y + 1, hw, hy);
              for (var i = 0; i < 8; i++) {
                var x0 = hw - (2 * hw) * (i / 8), x1 = hw - (2 * hw) * ((i + 1) / 8);
                c.quadraticCurveTo((x0 + x1) / 2, hy + 1.9, x1, hy);
              }
              c.quadraticCurveTo(-hw, WAIST_Y + 1, -6, WAIST_Y - 0.4);
              c.closePath();
            };
            c.globalAlpha = layer === 2 ? 1 : 0.86;
            cel(c, lp, mix(col, '#ffffff', 0.45 - layer * 0.12), { s: 1, ink: 0.5, inkCol: tone(col, 'ink'), x0: -hw, x1: hw, y0: WAIST_Y, y1: hy, rim: 0.5 });
            c.globalAlpha = 1;
          })(hy, hw, layer);
        }
        c.save();
        c.globalAlpha = 0.9;
        for (var sp = 0; sp < 6; sp++) glint(c, -9 + sp * 3.6, -15.2 + (sp % 2) * 1.6, 0.35, 0.35, 0.95);
        c.restore();
        cel(c, function () { c.beginPath(); c.rect(-6.1, WAIST_Y - 1, 12.2, 1.6); }, col, { s: 0.4, ink: 0.45 });
        break;
      default:
        var hemY = -10.2, top = 5.9, hem = 12.6;
        if (o === 'frillyDress') {
          /* white petticoat peeking under the hem */
          var pt = skirtPath(c, hemY + 1.3, top, hem + 0.4, 1.4);
          cel(c, pt, '#fffaf2', { s: 0.6, ink: 0.5, inkCol: tone(col, 'ink') });
          c.save(); pt(); c.clip();
          c.beginPath();
          for (var k = -12; k <= 12; k += 2.2) { c.moveTo(k, hemY - 0.6); c.arc(k + 1.1, hemY + 1.2, 1.1, Math.PI, 0, true); }
          stroke(c, tone('#fffaf2', 'd1'), 0.3);
          c.restore();
        }
        p = skirtPath(c, hemY, top, hem, 0.6);
        cel(c, p, col, { s: 1.8, ink: 0.7, x0: -hem, x1: hem, y0: WAIST_Y, y1: hemY, rim: 0.7 });
        folds(c, p, col, hemY, top, hem);
        if (o === 'sailorDress') {
          c.save(); p(); c.clip();
          c.fillStyle = '#ffffff';
          c.beginPath(); c.moveTo(-14, hemY - 2.3); c.quadraticCurveTo(0, hemY - 0.6, 14, hemY - 2.3);
          c.lineTo(14, hemY - 1.3); c.quadraticCurveTo(0, hemY + 0.4, -14, hemY - 1.3); c.closePath(); c.fill();
          c.restore();
        } else if (o === 'starDress') {
          var st = [[-7.6, -13.2, 1.3], [-3, -11.8, 1.1], [2.2, -14.6, 1.2], [6.8, -12, 1.3], [-0.8, -16.4, 0.9]];
          for (var si = 0; si < st.length; si++) {
            (function (s) {
              cel(c, function () { starPath(c, s[0], s[1], s[2]); }, '#ffd24a', { s: 0.3, ink: 0.35, inkCol: '#a0701a' });
            })(st[si]);
          }
          c.save(); p(); c.clip();
          c.beginPath(); c.moveTo(-14, hemY - 0.9); c.quadraticCurveTo(0, hemY + 0.9, 14, hemY - 0.9);
          stroke(c, '#ffe9a0', 0.6);
          c.restore();
        } else {
          c.save(); p(); c.clip();
          c.globalAlpha = 0.6;
          c.beginPath(); c.moveTo(-14, hemY - 1.6); c.quadraticCurveTo(0, hemY, 14, hemY - 1.6);
          stroke(c, light, 0.6);
          c.restore();
        }
    }
  }

  /* Pieces worn behind the body. */
  function drawBack(c, cu) {
    if (cu.outfit === 'hoodie' || cu.outfit === 'raincoat') {
      cel(c, function () {
        c.beginPath();
        c.moveTo(-8, -26);
        c.bezierCurveTo(-11.4, -31, -11, -36.4, -7, -37);
        c.lineTo(7, -37);
        c.bezierCurveTo(11, -36.4, 11.4, -31, 8, -26);
        c.closePath();
      }, tone(cu.outfitColor, 'd1'), { s: 1, ink: 0.6, inkCol: tone(cu.outfitColor, 'ink') });
    }
    if (cu.outfit === 'yukata') {
      bow(c, -7.2, WAIST_Y - 1, '#e8504a', 1.1);
    }
    if (cu.accessory === 'backpack') backpackArt(c);
  }
  /* Chain pieces hanging from the body (body frame). */
  function leafPath(g, len, w) {
    g.moveTo(0, 0);
    g.bezierCurveTo(-w, len * 0.28, -w * 0.9, len * 0.74, 0, len);
    g.bezierCurveTo(w * 0.9, len * 0.74, w, len * 0.28, 0, 0);
    g.closePath();
  }
  function bodyChains(cu) {
    var out = [];
    if (cu.accessory === 'cape') {
      out.push({ k: 'cp', x: 0, y: -27.4, a: 0, bx: -17, by: -2, bw: 34, bh: 22, n: 4, m: 0.6, out: 0, back: true,
        draw: function (g) {
          var col = '#c8384a';
          var p = function () {
            g.beginPath();
            g.moveTo(-5.6, 0);
            g.quadraticCurveTo(0, 1.2, 5.6, 0);
            g.bezierCurveTo(10, 4, 14.6, 12, 16, 17.6);
            g.quadraticCurveTo(11.4, 19.6, 7.6, 18);
            g.quadraticCurveTo(3.6, 19.6, 0, 18.2);
            g.quadraticCurveTo(-3.6, 19.6, -7.6, 18);
            g.quadraticCurveTo(-11.4, 19.6, -16, 17.6);
            g.bezierCurveTo(-14.6, 12, -10, 4, -5.6, 0);
            g.closePath();
          };
          cel(g, p, col, { s: 2.2, ink: 0.7, x0: -16, x1: 16, y0: 0, y1: 19, rim: 0.6 });
          g.save(); p(); g.clip();
          g.beginPath();
          g.moveTo(-3, 2); g.quadraticCurveTo(-5.6, 10, -7, 18);
          g.moveTo(3, 2); g.quadraticCurveTo(5.4, 10, 7, 18);
          stroke(g, tone(col, 'd2'), 0.5);
          /* gold braid along the hem and a scatter of stars */
          g.beginPath();
          g.moveTo(-16, 16.2); g.quadraticCurveTo(-11.4, 18.2, -7.6, 16.6); g.quadraticCurveTo(-3.6, 18.2, 0, 16.8);
          g.quadraticCurveTo(3.6, 18.2, 7.6, 16.6); g.quadraticCurveTo(11.4, 18.2, 16, 16.2);
          stroke(g, '#ffd24a', 0.9);
          g.fillStyle = '#ffe27a';
          var ST = [[-9.4, 12, 1.3], [-3.4, 8.4, 1], [4.2, 12.6, 1.4], [10.4, 10, 1], [0.6, 4.6, 0.8]];
          for (var i = 0; i < ST.length; i++) { starPath(g, ST[i][0], ST[i][1], ST[i][2], 0.45); g.fill(); }
          g.restore();
        } });
    }
    if (cu.back === 'leafCape') {
      out.push({ k: 'lc', x: 0, y: -27.4, a: 0, bx: -17, by: -2, bw: 34, bh: 24, n: 4, m: 0.6, out: 0, back: true,
        draw: function (g) {
          /* big leaves fanned out, the outer ones underneath */
          var LV = [[-5.2, 0.4, 19, 0.56, '#3f8a34'], [5.2, 0.4, 19, -0.56, '#3f8a34'],
                    [-2.8, 0.2, 21, 0.26, '#5aa83e'], [2.8, 0.2, 21, -0.26, '#5aa83e'], [0, 0, 21.6, 0, '#7cc452']];
          for (var i = 0; i < LV.length; i++) {
            (function (L) {
              g.save();
              g.translate(L[0], L[1]);
              g.rotate(L[3]);
              var p = function () { g.beginPath(); leafPath(g, L[2], 6.4); };
              cel(g, p, L[4], { s: 1.6, ink: 0.65, x0: -6.4, x1: 6.4, y0: 0, y1: L[2], rim: 0.6 });
              g.save();
              p();
              g.clip();
              g.beginPath();
              g.moveTo(0, 0.6); g.lineTo(0, L[2] - 0.6);
              for (var v = 1; v < 5; v++) {
                var vy = L[2] * v / 5.4;
                g.moveTo(0, vy); g.lineTo(-4.4, vy + 2.6);
                g.moveTo(0, vy); g.lineTo(4.4, vy + 2.6);
              }
              stroke(g, tone(L[4], 'd2'), 0.35);
              g.beginPath();
              g.moveTo(-LIT * 2.4, 3); g.quadraticCurveTo(-LIT * 4, L[2] * 0.4, -LIT * 2.6, L[2] * 0.7);
              g.globalAlpha = 0.6;
              stroke(g, tone(L[4], 'hi'), 0.8);
              g.restore();
              g.restore();
            })(LV[i]);
          }
        } });
    }
    if (cu.accessory === 'scarf') {
      out.push({ k: 'sf', x: 3.4, y: -25, a: -0.08, bx: -3.4, by: -1, bw: 7, bh: 14, n: 3, m: 1.1, out: 1,
        draw: function (g) {
          var col = '#c24842';
          var p = function () {
            g.beginPath(); g.moveTo(-2.4, 0); g.lineTo(2.6, 0); g.lineTo(3.1, 10.6); g.lineTo(-2.5, 10.8); g.closePath();
          };
          cel(g, p, col, { s: 0.9, ink: 0.55, x0: -2.5, x1: 3.1, y0: 0, y1: 11, rim: 0.5 });
          g.save();
          p();
          g.clip();
          g.fillStyle = '#fff0d8';
          g.fillRect(-3, 3, 7, 1.1);
          g.fillRect(-3, 6.2, 7, 1.1);
          g.globalAlpha = 0.4;
          g.beginPath();
          for (var k = -2; k <= 3; k++) { g.moveTo(k, 0); g.lineTo(k * 1.1, 11); }
          stroke(g, tone(col, 'd2'), 0.22);
          g.restore();
          /* fringe */
          g.beginPath();
          for (var i = 0; i < 5; i++) { g.moveTo(-2 + i * 1.2, 10.7); g.lineTo(-2.2 + i * 1.25, 12.4); }
          stroke(g, tone(col, 'ink'), 0.7);
          g.beginPath();
          for (i = 0; i < 5; i++) { g.moveTo(-2 + i * 1.2, 10.7); g.lineTo(-2.2 + i * 1.25, 12.3); }
          stroke(g, '#fff0d8', 0.35);
        } });
    }
    return out;
  }

  /* ==================================================================
     Things worn on her back (the new Back tab)
     ================================================================== */
  /* One side of a pair of wings, hinged at (0, 0) and spreading toward +x. */
  function butterflyWing(g) {
    var A = '#ff8ac0', B = '#b98af0', edge = '#6a2a7a';
    var up = function () {
      g.beginPath();
      g.moveTo(0, 0.4);
      g.bezierCurveTo(2.5, -9, 10, -16.6, 17.2, -14.2);
      g.bezierCurveTo(21.2, -12.6, 19.6, -3.4, 13.6, 0.6);
      g.quadraticCurveTo(6.5, 3.4, 0, 0.4);
      g.closePath();
    };
    var lo = function () {
      g.beginPath();
      g.moveTo(0, 1.2);
      g.bezierCurveTo(5, 1.6, 12.6, 3.6, 13, 9.4);
      g.bezierCurveTo(13.2, 14.4, 7.4, 15.4, 4.4, 11.4);
      g.quadraticCurveTo(1.6, 7, 0, 1.2);
      g.closePath();
    };
    cel(g, lo, B, { s: 1.6, ink: 0, x0: 0, x1: 13, y0: 1, y1: 15, rim: 0.5 });
    g.save();
    lo();
    g.clip();
    lo();
    stroke(g, rgba(edge, 0.8), 2.4);
    dot(g, 8.4, 9.4, 1.7, 1.7, '#ffe27a');
    dot(g, 5.2, 5.2, 0.8, 0.8, '#fff8e8');
    g.restore();
    lo();
    stroke(g, edge, 0.7);
    cel(g, up, A, { s: 2, ink: 0, x0: 0, x1: 20, y0: -16, y1: 3, rim: 0.5 });
    g.save();
    up();
    g.clip();
    /* warm glow from the root, a dark band round the edge, veins, eye spots */
    var gr = g.createRadialGradient(1, 0, 0.5, 1, 0, 13.5);
    gr.addColorStop(0, 'rgba(255, 238, 150, 0.95)');
    gr.addColorStop(1, 'rgba(255, 238, 150, 0)');
    g.fillStyle = gr;
    g.fillRect(-1, -17, 23, 21);
    up();
    stroke(g, rgba(edge, 0.8), 2.8);
    g.beginPath();
    g.moveTo(0.6, 0); g.quadraticCurveTo(7, -7, 15, -12);
    g.moveTo(0.6, 0.2); g.quadraticCurveTo(9, -3.4, 17.4, -7.2);
    g.moveTo(0.8, 0.4); g.quadraticCurveTo(8, -0.6, 14, -1.2);
    stroke(g, rgba(edge, 0.55), 0.35);
    dot(g, 14, -9.4, 1.6, 1.6, '#fff8e8');
    dot(g, 16.4, -5, 0.9, 0.9, '#fff8e8');
    dot(g, 10.6, -4.2, 1, 1, '#8fd0ff');
    g.restore();
    up();
    stroke(g, edge, 0.7);
    glint(g, 6, -8.6, 1.6, 0.5, 0.6, -0.9);
  }
  function fairyWing(g) {
    var ink = '#3a8ab0';
    var up = function () {
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(3, -10, 12, -19.6, 19.4, -17.6);
      g.bezierCurveTo(22.6, -14.6, 15, -4.6, 0, 1);
      g.closePath();
    };
    var lo = function () {
      g.beginPath();
      g.moveTo(0, 1);
      g.bezierCurveTo(8, 0.4, 16.6, 4.6, 17.4, 9.8);
      g.bezierCurveTo(14.6, 12.6, 5.6, 9, 0, 2.2);
      g.closePath();
    };
    var one = function (p, x1, y1) {
      g.save();
      g.globalAlpha = 0.84;
      var gr = g.createLinearGradient(0, 0, x1, y1);
      gr.addColorStop(0, '#fffbe0');
      gr.addColorStop(0.45, '#c8f4ee');
      gr.addColorStop(1, '#8fd8ff');
      p();
      g.fillStyle = gr;
      g.fill();
      g.restore();
      g.save();
      p();
      g.clip();
      /* a cool shade along the lower edge, light veins fanning from the root */
      p();
      stroke(g, 'rgba(90, 150, 220, 0.4)', 2.2);
      g.beginPath();
      for (var v = 0; v < 4; v++) {
        g.moveTo(0.6, 0.4);
        g.quadraticCurveTo(x1 * 0.5, y1 * (0.3 + v * 0.14), x1 * (0.98 - v * 0.1), y1 * (0.9 - v * 0.24));
      }
      stroke(g, 'rgba(255, 255, 255, 0.95)', 0.4);
      g.restore();
      p();
      stroke(g, ink, 0.6);
    };
    one(lo, 16, 9);
    one(up, 18, -16);
    glint(g, 12.4, -13.4, 0.9, 0.5, 0.95, -0.7);
    glint(g, 6.4, -6, 0.6, 0.35, 0.9, -0.7);
    glint(g, 11.6, 6.6, 0.6, 0.35, 0.9, 0.5);
  }
  function angelWing(g) {
    var col = '#fbf8ff', ink = '#8a84c8';
    var outer = function () {
      g.beginPath();
      g.moveTo(0, 1.4);
      g.bezierCurveTo(0.6, -8, 7, -16.4, 14.8, -16.2);
      g.quadraticCurveTo(20.2, -15.6, 18.8, -10.4);
      g.quadraticCurveTo(20.6, -6.4, 16.6, -4.4);
      g.quadraticCurveTo(18, 0, 13.6, 0.8);
      g.quadraticCurveTo(14, 4.8, 9.8, 4.6);
      g.quadraticCurveTo(9.4, 8, 5.6, 6.8);
      g.quadraticCurveTo(3.6, 8.6, 0, 4.2);
      g.closePath();
    };
    cel(g, outer, col, { s: 2.2, ink: 0.7, inkCol: ink, x0: 0, x1: 20, y0: -16, y1: 8, rim: 0.4 });
    g.save();
    outer();
    g.clip();
    /* the bone of the wing along the top, then three rows of feathers */
    g.beginPath();
    g.moveTo(-1, 1.4);
    g.bezierCurveTo(0.6, -8, 7, -16.4, 14.8, -16.2);
    g.quadraticCurveTo(19, -16, 19, -12.6);
    g.bezierCurveTo(13, -14.4, 6.4, -9, 3.6, 0);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.beginPath();
    var ROW = [[3.8, -1, 16.6, -9.6, 5], [3.2, 1.6, 14.4, -3.4, 5], [2.4, 3.6, 10.6, 2.4, 4]];
    for (var r = 0; r < ROW.length; r++) {
      var R = ROW[r];
      for (var f = 0; f < R[4]; f++) {
        var u0 = f / R[4], u1 = (f + 1) / R[4];
        var x0 = R[0] + (R[2] - R[0]) * u0, y0 = R[1] + (R[3] - R[1]) * u0;
        var x1 = R[0] + (R[2] - R[0]) * u1, y1 = R[1] + (R[3] - R[1]) * u1;
        g.moveTo(x0, y0);
        g.quadraticCurveTo((x0 + x1) / 2 + 1.2, (y0 + y1) / 2 + 2.6, x1, y1);
      }
    }
    stroke(g, rgba(ink, 0.75), 0.4);
    g.restore();
    glint(g, 6.4, -11, 2, 0.6, 0.9, -0.9);
  }
  /* A bear-shaped backpack peeking over her shoulder (body frame). */
  function bearPackArt(g) {
    var col = '#c8915a', lite = '#f4dcb0';
    var o = function (x, y, rx, ry, rot, cc, s) {
      cel(g, function () { ell(g, x, y, rx, ry, rot); }, cc || col, { warm: true, s: s || 0.9, ink: 0.55, inkCol: tone(col, 'ink', true) });
    };
    o(-16.2, -21.4, 1.6, 2.1, 0.5);
    o(-14.8, -15.6, 2.1, 1.7, -0.3);
    dot(g, -15.2, -15.3, 1, 0.8, lite);
    o(-11.4, -20.2, 5.4, 6.2, 0.1, col, 1.6);
    dot(g, -13.2, -19.4, 2.4, 3.2, lite);
    /* a zip across the tummy */
    g.beginPath();
    g.moveTo(-15.4, -20.6); g.quadraticCurveTo(-13.2, -19.4, -11.2, -20.2);
    stitch(g, '#8a5a34', 0.25);
    o(-15.4, -31.6, 1.9, 1.9, 0);
    o(-8.6, -32.4, 1.9, 1.9, 0);
    dot(g, -15.4, -31.4, 0.95, 0.95, lite);
    dot(g, -8.6, -32.2, 0.95, 0.95, lite);
    o(-12, -28.6, 4.9, 4.2, 0, col, 1.5);
    dot(g, -12.9, -27.5, 2.1, 1.6, lite);
    dot(g, -13.1, -28.1, 0.75, 0.52, '#3a2028');
    g.beginPath();
    g.moveTo(-13.1, -27.6); g.lineTo(-13.1, -27);
    g.moveTo(-14, -26.9); g.quadraticCurveTo(-13.1, -26.2, -12.2, -26.9);
    stroke(g, '#3a2028', 0.3);
    dot(g, -14.8, -29.4, 0.55, 0.65, '#2a1820');
    dot(g, -10.9, -29.7, 0.55, 0.65, '#2a1820');
    glint(g, -14.95, -29.6, 0.2, 0.2, 1);
    glint(g, -11.05, -29.9, 0.2, 0.2, 1);
    g.globalAlpha = 0.5;
    dot(g, -15.8, -27.6, 0.9, 0.55, '#ff8a9c');
    dot(g, -9.6, -27.9, 0.9, 0.55, '#ff8a9c');
    g.globalAlpha = 1;
  }
  /* A fox's brush, root at (0, 0), sweeping out behind her and up. */
  function foxTailArt(g) {
    var col = '#f08a3a';
    var p = function () {
      g.beginPath();
      g.moveTo(0.6, 0.6);
      g.bezierCurveTo(-6, 4.4, -15.4, 1.6, -16.6, -6.8);
      g.bezierCurveTo(-17.2, -11.6, -15, -15.6, -12.4, -17.4);
      g.bezierCurveTo(-12.8, -12.4, -9, -7.6, -5, -5.2);
      g.bezierCurveTo(-2.8, -3.8, -0.6, -2.8, 0.4, -2.4);
      g.closePath();
    };
    cel(g, p, col, { warm: true, s: 2, ink: 0.7, x0: -17, x1: 1, y0: -17, y1: 4, rim: 0.6 });
    g.save();
    p();
    g.clip();
    /* the cream tip, its edge a row of fur points */
    g.beginPath();
    g.moveTo(-19, -9.4);
    g.lineTo(-16.4, -8.6); g.lineTo(-15.6, -10.2); g.lineTo(-14, -9.2); g.lineTo(-13.2, -11); g.lineTo(-11.6, -10.2); g.lineTo(-10.6, -12);
    g.lineTo(-9, -19); g.lineTo(-19, -19);
    g.closePath();
    g.fillStyle = tone('#fff6e8', 'd1', true);
    g.fill();
    g.translate(-LIT * 0.5, -0.8);
    g.fillStyle = '#fff6e8';
    g.fill();
    g.translate(LIT * 0.5, 0.8);
    /* fur strokes along the sweep */
    g.beginPath();
    g.moveTo(-2, 0.4); g.quadraticCurveTo(-8, 1.6, -12.6, -2.4);
    g.moveTo(-3.4, -2.2); g.quadraticCurveTo(-8.6, -2.2, -12.2, -6);
    g.moveTo(-7.6, 1.4); g.quadraticCurveTo(-12.4, 0.2, -14.6, -4.4);
    stroke(g, tone(col, 'd2', true), 0.4);
    g.beginPath();
    g.moveTo(-3, 1.6); g.quadraticCurveTo(-10.4, 3, -14.6, -1.6);
    g.globalAlpha = 0.7;
    stroke(g, tone(col, 'hi'), 1);
    g.restore();
  }
  var WING_Y = -27, WING_K = 1.42;
  var WINGS = { butterfly: butterflyWing, fairy: fairyWing, angel: angelWing };
  /* front false: the layer behind her side tails (wings); true: the one
     over them (the bear, the fox tail). */
  function drawBackItem(c, cu, ck, res, P, front) {
    var b = cu.back;
    if (!front && WINGS[b]) {
      /* a slow fold and spread at rest, a flutter on the move */
      var flap = 1 - (0.1 + 0.1 * Math.sin(P.t * 2.4)) * (1 - P.amp) - (0.2 + 0.2 * Math.sin(P.t * 17)) * P.amp;
      for (var s = 1; s >= -1; s -= 2) {
        c.save();
        c.translate(s * 1.4, WING_Y - P.bounce * 0.2);
        c.rotate(s * (P.sway * 0.18 - 0.04));
        c.scale(s * flap * WING_K, WING_K);
        piece(c, ck + (s > 0 ? 'wr' : 'wl'), -1.5, -20.5, 25, 37, res, function (g) {
          /* the far wing is lit from the other side: paint it mirrored */
          if (s < 0) LIT = -LIT;
          WINGS[b](g);
          if (s < 0) LIT = -LIT;
        });
        c.restore();
      }
    } else if (front && b === 'bearPack') {
      c.save();
      c.translate(0, -P.bounce * 0.25);
      piece(c, ck + 'bp', -18.5, -35, 14.5, 22, res, bearPackArt);
      c.restore();
    } else if (front && b === 'foxTail') {
      c.save();
      c.translate(-3.6, -13.4);
      c.rotate(-P.sway * 0.5 + Math.sin(P.t * 2.6) * 0.06 * (1 - P.amp));
      piece(c, ck + 'ft', -18.5, -18.5, 20.5, 24, res, foxTailArt);
      c.restore();
    }
  }

  /* ==================================================================
     Part cache and chains
     ================================================================== */
  var partCache = {}, partCount = 0;
  function getPiece(key, bx, by, bw, bh, res, fn) {
    var cv = partCache[key];
    if (!cv) {
      if (partCount > 700) { partCache = {}; partCount = 0; }
      cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil(bw * res));
      cv.height = Math.max(1, Math.ceil(bh * res));
      var g = cv.getContext('2d');
      g.scale(cv.width / bw, cv.height / bh);
      g.translate(-bx, -by);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      fn(g);
      partCache[key] = cv;
      partCount++;
    }
    return cv;
  }
  function piece(c, key, bx, by, bw, bh, res, fn) {
    if (!res) { fn(c); return; }
    c.drawImage(getPiece(key, bx, by, bw, bh, res, fn), bx, by, bw, bh);
  }
  /* A bitmap hanging from its pivot, drawn as n slices; angs[0] is the
     rotation at the pivot, angs[i] the extra bend at joint i. up: the
     piece points up (-y) from its pivot instead of hanging. */
  function drawChain(c, key, res, ch, angs) {
    var bx = ch.bx, by = ch.by, bw = ch.bw, bh = ch.bh, n = angs.length - 1;
    var dir = ch.up ? -1 : 1;
    var L = ch.up ? -by : by + bh;
    /* painted live (big previews), the chain is still sliced from a
       bitmap: redrawing the whole shape per slice would double every
       translucent highlight where the slices overlap */
    if (!res) {
      var m = c.getTransform();
      res = Math.min(16, Math.ceil(Math.sqrt(m.a * m.a + m.b * m.b) * 2) / 2);
      key += '@' + res;
    }
    var cv = getPiece(key, bx, by, bw, bh, res, ch.draw);
    var ky = cv ? cv.height / bh : 0;
    var seg = L / n;
    c.save();
    c.translate(ch.x, ch.y);
    c.rotate(angs[0]);
    for (var i = 0; i < n; i++) {
      var a = i === 0 ? -99 : -0.5, b = i === n - 1 ? 99 : seg + 0.5;
      var jy = dir * i * seg;
      var lo = dir > 0 ? jy + a : jy - b, hi = dir > 0 ? jy + b : jy - a;
      var Y0 = Math.max(by, lo), Y1 = Math.min(by + bh, hi);
      if (Y1 > Y0) {
        c.drawImage(cv, 0, (Y0 - by) * ky, cv.width, (Y1 - Y0) * ky, bx, Y0 - jy, bw, Y1 - Y0);
      }
      c.translate(0, dir * seg);
      c.rotate(angs[i + 1]);
    }
    c.restore();
  }
  /* Bend for a chain: root angle plus increments that curve it, the tip
     lagging (sway2) behind the root (sway). */
  function chainAngles(ch, P, extra) {
    /* a positive angle swings a hanging tip toward -x (behind her) */
    var n = ch.n, m = ch.m;
    var root = ch.a - (P.sway * 0.6 - (extra || 0)) * m - P.bounce * 0.06 * (ch.out || 0);
    var out = [root];
    var bendTotal = -(P.sway * 0.4 + (P.sway2 - P.sway) * 1.5) * m;
    var wsum = 0, i;
    for (i = 1; i <= n; i++) wsum += 0.5 + i / n;
    for (i = 1; i <= n; i++) out.push(bendTotal * (0.5 + i / n) / wsum);
    return out;
  }

  /* ==================================================================
     Pose
     ================================================================== */
  function basePose() {
    return { face: 1, turnSx: 1, sq: 0, lift: 0, bobY: 0, hipX: 0, lean: 0, phase: 0, amp: 0, stance: 0.5,
             breath: 0, eyes: 'o', mouth: 0, sway: 0, sway2: 0, skirt: 0, cape: 0, charm: 0,
             bounce: 0, carry: 0, tilt: 0, t: 0, fidget: 0, run: 0, front: false,
             hang: 0, legSw: 0, air: false, sprint: 0 };
  }
  /* Menus without a rig: an idle or a walk from the clock. */
  function stillPose(frame, facing, blink, lift, tm, x) {
    var P = basePose();
    var t = tm === undefined ? performance.now() / 1000 + (x || 0) * 0.013 : tm / 60;
    P.t = t;
    P.face = facing < 0 ? -1 : 1;
    P.lift = lift || 0;
    if (frame > 0) {
      P.phase = (t * 2.1) % 1;
      P.amp = 1;
      P.bobY = 0.85 * Math.cos(TAU * 2 * (P.phase - 0.06));
      P.lean = 0.07;
      P.sway = -0.3 + Math.sin(t * TAU * 4.2) * 0.04;
      P.sway2 = P.sway - 0.04 + Math.sin(t * TAU * 4.2 - 1) * 0.05;
      P.skirt = -0.06;
      P.cape = -0.5;
      P.mouth = 1;
      P.eyes = 'f';
    } else {
      P.breath = Math.sin(t * TAU / 3.2);
      P.sway = Math.sin(t * 1.3) * 0.04;
      P.sway2 = Math.sin(t * 1.3 - 0.6) * 0.05;
      P.skirt = Math.sin(t * 1.1) * 0.012;
      P.tilt = Math.sin(t * 0.9) * 0.025;
      P.hipX = Math.sin(t * TAU / 5.3) * 0.35;
    }
    if (blink) P.eyes = 'c';
    return P;
  }

  /* ==================================================================
     The figure
     ================================================================== */
  /* Two-bone leg: returns hip, knee, ankle with the knee forward (+x). */
  function legIK(hx, hy, ax, ay) {
    var dx = ax - hx, dy = ay - hy;
    var d = Math.sqrt(dx * dx + dy * dy), max = THIGH + SHIN - 0.02;
    if (d > max) { dx *= max / d; dy *= max / d; ax = hx + dx; ay = hy + dy; d = max; }
    var a0 = Math.atan2(dy, dx);
    var cosA = (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d);
    var al = Math.acos(Math.max(-1, Math.min(1, cosA)));
    var ta = a0 - al;
    var kx = hx + Math.cos(ta) * THIGH, ky = hy + Math.sin(ta) * THIGH;
    return { ta: ta, kx: kx, ky: ky, sa: Math.atan2(ay - ky, ax - kx), ax: ax, ay: ay };
  }
  /* Foot target for a leg at phase p (0 contact, foot forward). The foot
     is planted for the first P.stance of the cycle: half at a walk, down
     to a fifth at her full-speed jog, where both feet are off the ground
     between steps and the swing foot kicks up higher behind her. */
  var STRIDE = 5.0;      /* half the planted foot's sweep, local units */
  function footAt(P, p, base) {
    p = ((p % 1) + 1) % 1;
    var sp = P.sprint || 0;
    var S = STRIDE * P.amp * (1 + 0.12 * sp), H = (2.5 + 2.0 * P.run + 1.2 * sp) * P.amp, B = P.stance || 0.5;
    var x, y = 0, pitch = 0;
    if (p < B) {
      x = S * (1 - 2 * p / B);
      if (p > B * 0.64) pitch = (p - B * 0.64) / (B * 0.36) * 0.4 * P.amp;
      else if (p < B * 0.16) pitch = -(B * 0.16 - p) / (B * 0.16) * 0.25 * P.amp;
    } else {
      var u = (p - B) / (1 - B);
      var e = u * u * (3 - 2 * u);
      x = -S + 2 * S * e;
      y = -H * Math.sin(Math.PI * Math.pow(u, 1 - 0.25 * P.run));
      pitch = (u < 0.5 ? 0.4 * (1 - u * 2) : -0.3 * (u * 2 - 1)) * P.amp;
    }
    return { x: base + x, y: y, pitch: pitch };
  }

  var pieceRes = 0;
  /* Shoes and hats that need a bigger bitmap than the rest. */
  var TALL_SHOE = { hiTops: 1, geta: 1, skates: 1, bunny: 1 };
  var TALL_HAT = { crown: 1, beanie: 1, acorn: 1, mushroom: 1, partyHat: 1, bigBow: 1 };
  function drawFigure(c, x, y, cu, sc, P, live) {
    cu = norm(cu);
    var f = P.face;
    LIT = f;
    c.save();
    c.translate(x, y);
    c.scale(sc, sc);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    /* contact shadow, planted; shrinks as she leaves the ground */
    if ((!live || live === 'shadow') && !P.air) {
      var shs = shadowSprite(), rx1 = 15.5 - P.lift * 0.3, rx2 = 9.5 - P.lift * 0.35;
      c.globalAlpha = 0.3 / 0.42;
      c.drawImage(shs, 1.4 * f - rx1, 0.8 - 3.9, rx1 * 2, 7.8);
      c.globalAlpha = Math.max(0.12, 0.42 - P.lift * 0.03) / 0.42;
      c.drawImage(shs, 0.6 * f - rx2, 0.4 - 2.1, rx2 * 2, 4.2);
      c.globalAlpha = 1;
    }
    c.scale(f * P.turnSx, 1);
    c.scale(1 + P.sq * 0.6, 1 - P.sq);
    c.translate(0, -P.lift);

    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var res = live ? 0 : Math.ceil(sc * dpr * 4) / 4 + 0.25;
    if (res > 7) res = 0;
    pieceRes = res;
    var ck = custKey(cu) + (f < 0 ? 'L' : 'R') + res;

    /* ---- skeleton for this frame ---- */
    var hipX = P.hipX, hipY = HIP_Y + P.bobY;
    var tuck = Math.min(4, P.lift * 0.45);
    /* leg 0 is the near one (-x: she is turned toward +x), phase + 0.5 */
    var phases = [P.phase + 0.5, P.phase];
    var hang = P.hang || 0;
    var legs = [];
    for (var li = 0; li < 2; li++) {
      var side = li === 0 ? -1 : 1;
      var ft = footAt(P, phases[li], side * (HIP_X - 0.2));
      var fx = ft.x + tuck * 0.3, fy = ft.y - ANKLE_H - tuck, pitch = ft.pitch - tuck * 0.06;
      if (hang) {
        /* hanging from the handle: legs dangle from the hip, knees soft,
           toes down, kicking a little out of step with each other */
        var la = P.legSw + 0.12 * Math.sin(P.t * 6.2 + li * Math.PI) * hang;
        var hx = hipX + side * HIP_X + Math.sin(la) * (THIGH + SHIN - 0.9);
        var hy = hipY + Math.cos(la) * (THIGH + SHIN - 0.9);
        fx += (hx - fx) * hang; fy += (hy - fy) * hang; pitch += (0.6 - pitch) * hang;
      }
      legs.push(legIK(hipX + side * HIP_X, hipY, fx, fy));
      legs[li].pitch = pitch;
    }
    var breath = P.breath;
    var carry = P.carry;
    /* arms swing opposite the legs (a same-side foot forward puts that
       arm back), a beat behind them; at a jog the elbows bend and the
       swing grows */
    var arms = [];
    for (var ai = 0; ai < 2; ai++) {
      var s = ai === 0 ? -1 : 1;
      var rest = -s * 0.13 + breath * 0.012 * -s;
      var swing = Math.cos(TAU * (phases[ai] - 0.04)) * P.amp * (0.5 + 0.22 * P.run) * (1 + 0.3 * (P.sprint || 0));
      var ua = rest + swing;
      var fa = -0.22 - (0.3 * P.run + 0.3 * (P.sprint || 0)) * P.amp - Math.max(0, -swing) * 0.45;
      if (P.fidget) { ua += s * 0.1 * P.fidget; fa -= 0.4 * P.fidget; }
      /* cheering: hands up beside her head, elbows out */
      var cua = s > 0 ? -2.35 : 2.35, cfa = s > 0 ? -0.5 : 0.5;
      ua = ua + (cua - ua) * carry * 0.9;
      fa = fa + (cfa - fa) * carry;
      /* hanging: both arms stretched straight up to the handle, shoulders
         shrugged, fists out beside her head */
      if (hang) {
        ua += ((s > 0 ? -2.59 : 2.59) - ua) * hang;
        fa += (0 - fa) * hang;
      }
      arms.push({ ua: ua, fa: fa, k: 1 + 0.25 * hang, up: 2 * hang });
    }

    /* ---- upper body transform helpers ---- */
    function body(cx) {
      cx.translate(hipX, P.bobY);
      cx.translate(0, HIP_Y);
      cx.rotate(P.lean);
      cx.translate(0, -HIP_Y);
    }
    function head(cx) {
      cx.translate(0, NECK_Y - breath * 0.3 + P.bounce * 0.15);
      cx.rotate(P.tilt - P.lean * 0.45);
      cx.translate(0, -NECK_Y);
    }
    var hairChains = hangingHair(cu);
    var bChains = bodyChains(cu);

    /* 1. cape behind everything */
    for (var bc = 0; bc < bChains.length; bc++) {
      var chb = bChains[bc];
      if (!chb.back) continue;
      c.save(); body(c);
      drawChain(c, ck + chb.k, res, chb, capeAngles(chb, P));
      c.restore();
    }
    /* 2. things behind: hood, obi bow, backpack, back hair, hanging locks */
    c.save();
    body(c);
    if (cu.outfit === 'hoodie' || cu.outfit === 'raincoat' || cu.outfit === 'yukata' || cu.accessory === 'backpack') {
      c.save();
      c.translate(0, cu.accessory === 'backpack' ? -P.bounce * 0.25 : 0);
      piece(c, ck + 'bk', -16, -40, 32, 30, res, function (g) { drawBack(g, cu); });
      c.restore();
    }
    c.save();
    head(c);
    c.translate(P.front ? 0 : -1, 0);
    /* puffs and a top knot stick out past the usual box */
    var hbw = cu.hairStyle === 'puffs' ? 26.5 : 18.5, hbt = cu.hairStyle === 'topKnot' ? 27.5 : 18;
    piece(c, ck + 'hb', -hbw, HY - hbt, hbw * 2, hbt + 15, res, function (g) { drawHairBack(g, cu); });
    c.translate(P.front ? 0 : 1, 0);
    /* the hair down her back, then wings over it, then the tails and
       ribbons that hang at her sides, then a bag or a tail over those */
    var hc, chh;
    for (hc = 0; hc < hairChains.length; hc++) {
      chh = hairChains[hc];
      if (!chh.out) drawChain(c, ck + chh.k, res, chh, chainAngles(chh, P));
    }
    c.restore();
    drawBackItem(c, cu, ck, res, P, false);
    c.save();
    head(c);
    for (hc = 0; hc < hairChains.length; hc++) {
      chh = hairChains[hc];
      if (chh.out) drawChain(c, ck + chh.k, res, chh, chainAngles(chh, P));
    }
    c.restore();
    drawBackItem(c, cu, ck, res, P, true);
    /* 3. far arm (+x), behind the torso */
    drawArm(c, cu, ck, res, 1, arms[1], 0);
    c.restore();

    /* 4. legs, far one (+x) first */
    for (var lg = 1; lg >= 0; lg--) {
      var L = legs[lg], back = lg === 1, tag = back ? 'b' : 'f';
      c.save();
      c.translate(L.ax, L.ay);
      c.rotate(L.pitch);
      if (TALL_SHOE[cu.shoes]) piece(c, ck + 'sh' + tag, -4.5, -5.8, 11.5, 8.6, res, function (g) { drawShoe(g, cu, back); });
      else piece(c, ck + 'sh' + tag, -4, -3, 10.5, 5.6, res, function (g) { drawShoe(g, cu, back); });
      c.restore();
      c.save();
      c.translate(L.kx, L.ky);
      c.rotate(L.sa - Math.PI / 2);
      piece(c, ck + 'sn' + tag, -3.2, -2.4, 6.4, SHIN + 4.2, res, function (g) { drawShin(g, cu, back); });
      c.restore();
      c.save();
      c.translate(hipX + (back ? -HIP_X : HIP_X), hipY);
      c.rotate(L.ta - Math.PI / 2);
      piece(c, ck + 'th' + tag, -3, -3, 6, THIGH + 5.5, res, function (g) { drawThigh(g, cu, back); });
      c.restore();
    }

    /* 5. skirt, bodice, front hanging bits */
    c.save();
    body(c);
    c.save();
    var sk = P.skirt;
    c.translate(0, WAIST_Y);
    c.transform(1, 0, sk, 1, 0, 0);
    c.scale(1 + Math.abs(P.bounce) * 0.01, 1);
    c.translate(0, -WAIST_Y);
    piece(c, ck + 'sk', -17, WAIST_Y - 3, 34, 22, res, function (g) { drawSkirt(g, cu); });
    c.restore();
    c.save();
    c.translate(0, WAIST_Y);
    c.scale(1, 1 + breath * 0.012);
    c.translate(0, -WAIST_Y);
    piece(c, ck + 'bd', -10, -31, 20, 15, res, function (g) { drawBodice(g, cu); });
    for (var fc = 0; fc < bChains.length; fc++) {
      var chf = bChains[fc];
      if (chf.back) continue;
      drawChain(c, ck + chf.k, res, chf, chainAngles(chf, P));
    }
    pendants(c, cu, P);
    c.restore();

    /* 6. head */
    c.save();
    head(c);
    /* face, eyes, glasses and fringe: one piece per expression */
    setView(P.front);
    piece(c, ck + 'hh' + P.mouth + P.eyes + (P.front ? 'F' : ''), -18, HY - 20, 36, 37, res, function (g) {
      drawHeadBase(g, cu, P.mouth);
      drawEyes(g, cu, P.eyes);
      drawFacePaint(g, cu);
      drawGlasses(g, cu);
      drawHairFront(g, cu);
    });
    setView(false);
    var hatY = -P.bounce * 0.3;
    if (cu.hat !== 'none') {
      c.save();
      c.translate(0, hatY);
      var hch = hatChains(cu);
      if (cu.hat === 'witchHat') {
        piece(c, ck + 'htb', -21, HY - 17, 42, 8, res, function (g) {
          g.save(); g.beginPath(); g.rect(-22, HY - 17, 44, 6.4); g.clip();
          g.translate(0, 0); drawHatBrimBack(g); g.restore();
        });
      }
      for (var hk = 0; hk < hch.length; hk++) {
        drawChain(c, ck + hch[hk].k, res, hch[hk], chainAngles(hch[hk], P, P.bounce * 0.04));
      }
      if (TALL_HAT[cu.hat]) piece(c, ck + 'ht', -24, HY - 34, 48, 36, res, function (g) { drawHat(g, cu); });
      else piece(c, ck + 'ht', -23, HY - 25, 46, 27, res, function (g) { drawHat(g, cu); });
      c.restore();
    }
    c.restore();

    /* 7. near arm (-x) */
    drawArm(c, cu, ck, res, 0, arms[0], P.charm);
    c.restore();

    c.restore();
    LIT = 1;
  }
  function drawHatBrimBack(g) {
    cel(g, function () { ell(g, 0, HY - 10.6, 19.6, 5, -0.05); }, WITCH, { s: 1.4, ink: 0.7 });
  }
  function capeAngles(ch, P) {
    var flutter = Math.sin(P.t * 10.5) * 0.05 * P.amp;
    var k = -P.cape;
    return [k * 0.35, k * 0.12 + flutter, k * 0.14 - flutter * 0.6, k * 0.14 + flutter, k * 0.1];
  }
  function drawArm(c, cu, ck, res, i, A, swing) {
    var s = i === 0 ? -1 : 1, back = i === 1, tag = back ? 'b' : 'f';
    c.save();
    c.translate(s * SH_X, SH_Y - A.up);
    c.rotate(A.ua);
    c.scale(1, A.k);
    piece(c, ck + 'au' + tag, -4.6, -3.4, 9.2, 15.6, res, function (g) { drawUpperArm(g, cu, back); });
    c.translate(0, UPPER);
    c.rotate(A.fa);
    /* what the near hand holds goes under it, so the fist closes over it */
    if (!back && cu.accessory === 'wand') {
      piece(c, ck + 'hw', -11.2, -12.4, 15.4, 21.6, res, wandArt);
    } else if (!back && cu.accessory === 'teddy') {
      c.save();
      c.translate(0.1, FORE + 2);
      c.rotate(0.2 - A.ua - A.fa - swing * 0.9);
      piece(c, ck + 'hb2', -2.6, -0.8, 8, 12.6, res, function (g) { bearArt(g, '#c8915a', '#f4dcb0'); });
      c.restore();
    }
    piece(c, ck + 'af' + tag, -3, -2.8, 6.4, FORE + 7, res, function (g) { drawForearm(g, cu, back); });
    c.restore();
  }
  /* Small swinging charms: the necklace's pendant, the satchel, the camera. */
  function pendants(c, cu, P) {
    var key = custKey(cu) + (LIT < 0 ? 'L' : 'R') + pieceRes;
    if (cu.accessory === 'necklace') {
      c.save();
      c.translate(0.6, -24.2);
      c.rotate(-P.charm);
      piece(c, key + 'nk', -2.6, -0.6, 5.2, 5, pieceRes, function (g) {
        metal(g, function () { heartPath(g, 0, 1.9, 1.95); }, '#ffcf3a', -2.4, -0.4, 2.4, 4.2, { ink: 0.35, inkCol: '#8a5a12' });
        cel(g, function () { heartPath(g, 0, 1.95, 1.4); }, '#ff4a7e', { s: 0.5, ink: 0.25, inkCol: '#8a1840' });
        glint(g, -0.5, 1.3, 0.42, 0.28, 0.95, -0.5);
      });
      c.restore();
    } else if (cu.accessory === 'satchel') {
      c.save();
      c.translate(-6.4, -17);
      c.rotate(-P.charm * 0.7);
      piece(c, key + 'sat', -5.6, -1, 11.2, 9.4, pieceRes, satchelArt);
      c.restore();
    } else if (cu.accessory === 'camera') {
      c.save();
      c.translate(0.5, -22.6);
      c.rotate(-P.charm * 0.6);
      piece(c, key + 'cam', -5, -1.2, 10, 8.2, pieceRes, cameraArt);
      c.restore();
    }
  }

  /* ==================================================================
     Rig: time-based motion and secondary animation
     ================================================================== */
  function Spring(k, d) { this.p = 0; this.v = 0; this.k = k; this.d = d; }
  Spring.prototype.step = function (target, force, dt) {
    var a = this.k * (target - this.p) - this.d * this.v + (force || 0);
    this.v += a * dt;
    this.p += this.v * dt;
  };
  var RUN = 192;   /* px/s of a full-speed walk (3.2 px per 60 Hz tick) */

  function Rig() {
    this.t = Math.random() * 20;
    this.spd = 0;
    this.moving = false;
    this.idle = 0;
    this.phase = 0;
    this.amp = 0;
    this.face = 1;
    this.drawFace = 1;
    this.turnT = 1;
    this.hair = new Spring(55, 6.5);
    this.hair2 = new Spring(80, 7);
    this.skirt = new Spring(110, 9);
    this.cape = new Spring(38, 5);
    this.lean = new Spring(85, 10);
    this.sq = new Spring(230, 13);
    this.bounce = new Spring(200, 13);
    this.charm = new Spring(120, 3.5);
    this.carry = new Spring(140, 24);
    this.land = new Spring(160, 14);      /* knee dip that soaks up a landing */
    this.cheerArm = new Spring(90, 13);
    this.legSw = new Spring(40, 4);       /* dangling legs on the zipline */
    this.hang = 0;                        /* 0 on her feet .. 1 hanging from the handle */
    this.hanging = false;
    this.prevPhase = 0;
    this.prevBob = 0;
    this.alpha = 1;                       /* draw between the last two ticks */
    this.stance = 0.5;
    this.scale = 1.3;                     /* draw scale, so feet can match the ground */
    this.settle = -1;
    this.hop = null;
    this.hopT = 0;
    this.hopsLeft = 0;
    this.hopLift = 0;
    this.crouch = 0;
    this.blinkT = 1 + Math.random() * 3;
    this.blinkAge = 9;
    this.lookT = 3 + Math.random() * 4;
    this.look = 'o';
    this.lookAge = 0;
    this.lookDur = 0;
    this.fidgetT = 6 + Math.random() * 5;
    this.fidgetAge = 9;
    this.puffs = [];
    this.wantCarry = false;
    this.turbo = 0;                       /* set by Player.drive each tick */
    this.tb = 0;                          /* eased turbo, for the look */
    this.sprint = 0;                      /* eased: 0 at a walk .. 1 at twice it */
  }
  Rig.prototype.puff = function (x, y, dir, n) {
    for (var i = 0; i < n; i++) {
      this.puffs.push({ x: x + (Math.random() - 0.5) * 8 - dir * 4, y: y - Math.random() * 2,
                        vx: -dir * (14 + Math.random() * 16) + (Math.random() - 0.5) * 10,
                        age: 0, life: 0.45 + Math.random() * 0.2, r: 3 + Math.random() * 2 });
    }
  };
  /* Hops: a steady bounce (title, party) or a couple of cheers (a part of
     the house going up). Each hop is a crouch, a push-off, a parabola and
     a landing the squash spring and a knee dip absorb. */
  Rig.prototype.setHop = function (period, height, phase) {
    this.hop = { period: period, height: height };
    this.hopT = (phase || 0) * period;
    this.hopsLeft = -1;
  };
  Rig.prototype.cheer = function (n) {
    this.hop = { period: 0.78, height: 7 };
    this.hopT = 0;
    this.hopsLeft = n;
  };
  /* One small hop with the arms left alone (landing off the zipline). */
  Rig.prototype.hopOnce = function (height) {
    this.hop = { period: 0.5, height: height, quiet: true };
    this.hopT = 0;
    this.hopsLeft = 1;
  };
  Rig.prototype.flip = function () {
    var S = [this.hair, this.hair2, this.skirt, this.cape, this.charm];
    for (var i = 0; i < S.length; i++) { S[i].p = -S[i].p; S[i].v = -S[i].v; }
  };
  /* dt seconds; speed in px/s; facing +1 / -1. */
  Rig.prototype.update = function (dt, x, y, speed, facing, carry) {
    this.t += dt;
    this.prevPhase = this.phase;
    this.prevBob = this.bobY || 0;
    var target = Math.min(speed, 300);
    var prev = this.spd;
    this.spd += (target - this.spd) * Math.min(1, dt * 16);
    var sN = this.spd / RUN, acc = (this.spd - prev) / dt / RUN;
    this.hang += ((this.hanging ? 1 : 0) - this.hang) * Math.min(1, dt * 14);
    /* on the zipline the speed is wind in her hair, not steps */
    var moving = target > 5 && !this.hanging;
    if (moving && !this.moving) {
      this.sq.v -= 2.4;
      if (this.idle > 0.3) this.puff(x, y, facing, 2);
    } else if (!moving && this.moving && !this.hanging) {
      this.sq.v += 1.8;
      this.puff(x, y, -facing, 2);
    }
    this.moving = moving;
    this.idle = moving ? 0 : this.idle + dt;
    this.tb += ((moving ? this.turbo : 0) - this.tb) * Math.min(1, dt * 8);   /* not pushing on a wall */
    this.turbo = 0;
    /* turning: the eyes go first, the head swings through a front view
       while the figure mirrors, then settles into the new three-quarter */
    if (facing !== this.face) {
      this.face = facing;
      this.turnT = 0;
      this.sq.v += 0.8;
      if (moving) this.puff(x, y, -facing, 1);
    }
    if (this.turnT < 1) {
      this.turnT = Math.min(1, this.turnT + dt / 0.22);
      if (this.turnT >= 0.5 && this.drawFace !== this.face) { this.drawFace = this.face; this.flip(); }
    }
    /* walk: the phase follows the distance covered, so a planted foot
       keeps pace with the ground. Cadence tops out at 3 strides a second;
       past that the planted part of the stride shrinks instead (a jog,
       both feet off the ground between steps). Only the drawn stride
       eases in and out, never the foot's speed over the ground. Faster
       than a walk (turbo) she sprints: a longer stride and more time in
       the air, with the cadence held near 3.3 strides a second. */
    var v = moving ? speed : 0;
    var wantAmp = moving ? Math.min(1, 0.55 + sN * 1.8) : 0;
    this.amp += (wantAmp - this.amp) * Math.min(1, dt * (moving ? 14 : 7));
    var over = Math.max(0, Math.min(1, (v - 1.25 * RUN) / (0.75 * RUN)));
    this.sprint += (over - this.sprint) * Math.min(1, dt * 6);
    var sp = this.sprint;
    var reach = 2 * STRIDE * Math.max(0.3, this.amp) * (1 + 0.12 * sp) * this.scale;   /* planted sweep, px */
    var freq = Math.min(3 + 0.3 * sp, v / (2 * reach));
    var wantStance = v > 0 ? Math.max(0.18 - 0.055 * sp, Math.min(0.5, reach * freq / v)) : 0.5;
    this.stance += (wantStance - this.stance) * Math.min(1, dt * 12);
    if (moving) {
      this.settle = -1;
      this.phase = (this.phase + Math.min(4.5 - 1.2 * sp, v * this.stance / reach) * dt) % 1;
      /* turbo: a little dust kicked up behind each footfall */
      if (this.tb > 0.3 && Math.floor(this.phase * 2) !== Math.floor(this.prevPhase * 2)) this.puff(x, y, facing, 1);
    } else if (this.amp > 0.02) {
      /* stopping: finish the step to the next passing pose (feet
         together, one raised) and let it come down there */
      if (this.settle < 0) this.settle = this.phase < 0.25 ? 0.25 : this.phase < 0.75 ? 0.75 : 1.25;
      var ph = this.phase < this.settle - 0.5 ? this.phase + 1 : this.phase;
      ph = Math.min(this.settle, ph + 1.8 * dt);
      this.phase = ph % 1;
    }
    /* body bob: a walk vaults over the planted leg (low at each contact);
       a jog sinks into each short stance and floats between steps */
    var B = this.stance, run = Math.max(0, Math.min(1, (0.5 - B) / 0.3));
    this.run = run;
    var walkBob = 1.05 * (0.5 + 0.5 * Math.cos(TAU * 2 * (this.phase - 0.06)));
    var jogBob = 1.1 + 0.7 * Math.cos(TAU * 2 * (this.phase - B / 2 - 0.02));
    var bobY = this.amp * (walkBob + (jogBob - walkBob) * run);
    /* hop */
    var hopLift = 0, crouch = 0;
    if (this.hop) {
      var T = this.hop.period, HH = this.hop.height, A = 0.2 + 0.035 * HH, C = 0.16;
      this.hopT += dt;
      if (this.hopT >= T) {
        this.hopT -= T;
        if (this.hopsLeft > 0 && --this.hopsLeft === 0) this.hop = null;
      }
      var tau = this.hopT;
      if (this.hop && tau < C) {
        var cu = tau / C;
        crouch = cu < 0.7 ? Math.sin(Math.PI / 2 * cu / 0.7) : Math.cos(Math.PI / 2 * (cu - 0.7) / 0.3);
      } else if (this.hop && tau < C + A) {
        var hu = (tau - C) / A;
        hopLift = HH * 4 * hu * (1 - hu);
      }
    }
    if (hopLift > 0 && !(this.hopLift > 0)) this.sq.v -= 2.2;
    else if (!(hopLift > 0) && this.hopLift > 0) { this.sq.v += 2.6; this.land.v += 34; }
    this.hopLift = hopLift;
    this.crouch = crouch;
    bobY += crouch * 1.8 + this.land.p;
    this.bobY = bobY;
    /* springs, two substeps */
    var h = dt / 2, breeze = Math.sin(this.t * 1.3) * 0.04, tb = this.tb;
    for (var k = 0; k < 2; k++) {
      this.hair.step(-0.34 * Math.min(1.2, sN) - 0.2 * tb + breeze, -acc * 2.6, h);
      this.hair2.step(this.hair.p, 0, h);
      this.skirt.step(-0.075 * Math.min(1.2, sN) - 0.045 * tb - 0.03 * this.hang, -acc * 0.9 + (bobY - this.bounce.p) * 1.5, h);
      this.cape.step(-0.9 * Math.min(1.2, sN) - 0.35 * tb + breeze * 0.5, -acc * 2.4, h);
      this.lean.step((0.085 * Math.min(1.2, sN) + 0.06 * sp + (this.wantCarry ? -0.02 : 0)) * (1 - this.hang), -acc * 0.9 * (1 - this.hang), h);
      this.sq.step(0, 0, h);
      this.bounce.step(bobY - hopLift * 0.5, 0, h);
      this.charm.step(-0.25 * Math.min(1.2, sN) - 0.12 * tb, -acc * 3 + (bobY - this.bounce.p) * 6, h);
      this.carry.step(carry ? 1 : 0, 0, h);
      this.land.step(0, 0, h);
      this.cheerArm.step(this.hop && !this.hop.quiet ? (hopLift > 0 ? 0.85 : 0.2) : 0, 0, h);
      this.legSw.step(-0.28 * Math.min(1.2, sN) * this.hang, -acc * 0.8 * this.hang, h);
    }
    /* blinks, glances, fidgets */
    this.blinkT -= dt;
    this.blinkAge += dt;
    if (this.blinkT <= 0) {
      this.blinkAge = 0;
      this.blinkT = Math.random() < 0.2 ? 0.28 : 2 + Math.random() * 3.5;
    }
    if (!moving && this.idle > 1) {
      this.lookT -= dt;
      if (this.lookT <= 0 && this.lookDur <= 0) {
        var opts = ['f', 'b', 'u', 'f'];
        this.look = opts[Math.floor(Math.random() * opts.length)];
        this.lookDur = 0.9 + Math.random() * 0.8;
        this.lookAge = 0;
        this.lookT = 3 + Math.random() * 4;
      }
      this.fidgetT -= dt;
      if (this.fidgetT <= 0) { this.fidgetAge = 0; this.fidgetT = 6 + Math.random() * 5; }
    }
    if (this.lookDur > 0) {
      this.lookAge += dt;
      if (this.lookAge >= this.lookDur || moving) { this.lookDur = 0; this.look = 'o'; }
    }
    this.fidgetAge += dt;
    if (moving) this.fidgetAge = 9;
    for (var i = this.puffs.length - 1; i >= 0; i--) {
      var pf = this.puffs[i];
      pf.age += dt;
      pf.x += pf.vx * dt;
      pf.vx *= 1 - dt * 4;
      if (pf.age >= pf.life) this.puffs.splice(i, 1);
    }
  };
  Rig.prototype.pose = function (lift) {
    var P = basePose();
    P.t = this.t;
    P.face = this.drawFace;
    var tm = Math.abs(Math.cos(Math.PI * this.turnT));
    var turning = this.turnT < 1, mid = turning ? 1 - tm : 0;
    P.turnSx = 1 - 0.12 * mid;
    P.sq = this.sq.p + mid * 0.03;
    P.front = turning && this.turnT > 0.26 && this.turnT < 0.74;
    /* between ticks (a 120 Hz screen, or a late frame), step the gait
       on so a planted foot stays planted under the interpolated body */
    var a = this.alpha, dp = this.phase - this.prevPhase;
    if (dp < -0.5) dp += 1;
    P.phase = (this.prevPhase + dp * a + 1) % 1;
    /* the gait tucks in through a turn so the feet don't skate */
    P.amp = this.amp * (1 - 0.6 * Math.sin(Math.PI * Math.min(1, this.turnT)));
    P.stance = this.stance || 0.5;
    P.run = this.run || 0;
    P.sprint = this.sprint;
    P.bobY = this.prevBob + ((this.bobY || 0) - this.prevBob) * a;
    P.hang = this.hang;
    P.legSw = this.legSw.p;
    P.air = this.hang > 0.5;
    P.lean = this.lean.p;
    P.sway = this.hair.p;
    P.sway2 = this.hair2.p;
    P.skirt = this.skirt.p;
    P.cape = this.cape.p;
    P.charm = this.charm.p;
    if (this.tb > 0.01) {
      /* turbo: hair tips and hem flutter in the wind */
      var ft = (this.t + (a - 1) / 60) * TAU;
      P.sway2 += Math.sin(ft * 4.3) * 0.045 * this.tb;
      P.skirt += Math.sin(ft * 5.1 + 1) * 0.012 * this.tb;
    }
    P.bounce = (this.bobY || 0) - this.hopLift * 0.5 - this.bounce.p;
    P.carry = this.cheerArm.p;
    P.sq += this.crouch * 0.05;
    var still = 1 - Math.min(1, this.amp * 2);
    P.breath = Math.sin(this.t * TAU / 3.2) * still;
    P.hipX = Math.sin(this.t * TAU / 5.3) * 0.35 * still * (1 - this.hang);
    P.tilt = Math.sin(this.t * 0.9) * 0.022 * still;
    P.lift = (lift || 0) + this.hopLift;
    /* fidget: a little rock up on the toes, arms swinging in */
    if (this.fidgetAge < 0.8) {
      var u = this.fidgetAge / 0.8, fk = Math.sin(Math.PI * u);
      P.lift += fk * 1.2;
      P.fidget = fk;
      P.tilt += fk * 0.05;
    }
    if (this.look === 'u') P.tilt -= 0.05;
    else if (this.look === 'b') P.tilt += 0.04;
    P.mouth = this.moving || this.idle < 0.4 || this.hop || P.carry > 0.5 || this.carry.p > 0.5 || this.hang > 0.5 ? 1 : 0;
    var ba = this.blinkAge;
    /* mid-turn her eyes already look the new way */
    var look = turning ? (this.drawFace === this.face ? 'f' : 'b') : (this.moving || this.hang > 0.5 ? 'f' : this.look);
    P.eyes = ba < 0.04 ? 'h' : ba < 0.1 ? 'c' : ba < 0.15 ? 'h' : look;
    return P;
  };

  /* Turbo: three soft wind lines that slip away behind her and fade. */
  var STREAK_Y = [-15, -31, -45];
  function drawStreaks(c, rig, x, y, sc) {
    var tt = rig.t + (rig.alpha - 1) / 60, f = rig.face;
    c.save();
    c.lineCap = 'round';
    c.lineWidth = 1.6 * sc;
    c.strokeStyle = '#ffffff';
    for (var i = 0; i < 3; i++) {
      var u = (tt * 1.7 + i * 0.37) % 1;
      var x0 = x - f * (11 + 24 * u) * sc, len = (9 + 7 * rig.tb) * sc, yy = y + (STREAK_Y[i] + 2 * i * u) * sc;
      c.globalAlpha = Math.sin(Math.PI * u) * 0.5 * rig.tb;
      c.beginPath();
      c.moveTo(x0, yy);
      c.lineTo(x0 - f * len, yy);
      c.stroke();
    }
    c.restore();
  }

  function drawPuffs(c, rig, sc) {
    if (!rig.puffs.length) return;
    var spr = puffSprite();
    for (var i = 0; i < rig.puffs.length; i++) {
      var pf = rig.puffs[i], u = pf.age / pf.life;
      var r = (pf.r + u * 5) * sc;
      c.globalAlpha = Math.pow(1 - u, 1.5) * 0.7;
      c.drawImage(spr, pf.x - r, pf.y - r * 0.9 - u * 3 * sc, r * 2, r * 1.6);
    }
    c.globalAlpha = 1;
  }

  /* ==================================================================
     Public API
     ================================================================== */
  /* frame: 0 standing, >0 walking. facing: 1 right, -1 left. lift raises
     the body for a hop. tm: a clock in 60 Hz ticks (menus). rig: a Rig
     that drives everything instead. */
  function drawCharacter(c, x, y, cust, frame, facing, scale, blink, lift, tm, rig) {
    var P = rig ? rig.pose(lift) : stillPose(frame, facing, blink, lift, tm, x);
    if (rig && rig.tb > 0.02) drawStreaks(c, rig, x, y, scale || 1);
    drawFigure(c, x, y, cust || Game.MOMOKO_DEFAULT, scale || 1, P);
    if (rig) drawPuffs(c, rig, scale || 1);
  }

  /* Head-and-shoulders chip for the designer's character picker. */
  function drawPortrait(c, cx, cy, size, cust) {
    c.save();
    c.beginPath();
    c.arc(cx, cy, size / 2, 0, TAU);
    c.clip();
    var pg = c.createLinearGradient(0, cy - size / 2, 0, cy + size / 2);
    pg.addColorStop(0, '#6fbfee');
    pg.addColorStop(1, '#d9f1ee');
    c.fillStyle = pg;
    c.fillRect(cx - size, cy - size, size * 2, size * 2);
    var sc = size / 34;
    drawFigure(c, cx, cy + size * 1.05, cust, sc, stillPose(0, 1, false, 0, 0));
    c.restore();
    c.beginPath();
    c.arc(cx, cy, size / 2, 0, TAU);
    E.ink(c, 2.5);
  }

  /* ==================================================================
     Designer tiles
     ================================================================== */
  /* What an option tile shows. Most are a crop of her wearing the option
     ([x, y, w, h] in local units, feet at the origin), framed on the part
     it changes. Things that sit behind her or are small in her hand are
     painted on their own instead: { box, draw }. */
  var CROP = {
    hairStyle: [-25, -67, 50, 42],
    outfit: [-19, -31.5, 38, 32],
    shoes: [-6.8, -9.4, 15.6, 11.4],
    hat: [-24.5, -71, 49, 41.2],
    accessory: [-13, -33.4, 26, 21.9],
    charm: [-15.5, -47.5, 31, 26],
    eyes: [-9.2, -44, 21.4, 18],
    skin: [-17, -56, 34, 30],
  };
  var CLIP_CROP = [0.6, -53.2, 19, 16];
  var CROP_OF = {
    accessory: { ribbon: [-9, -62.5, 30, 25.2], cape: [-19, -33, 38, 32] },
    charm: { heartClip: CLIP_CROP, starClip: CLIP_CROP, flowerClip: CLIP_CROP, butterflyClip: CLIP_CROP },
    hat: { witchHat: [-26, -80, 52, 43.7], bunnyEars: [-24.5, -76, 49, 41.2], partyHat: [-24.5, -76, 49, 41.2] },
    hairStyle: { topKnot: [-25, -70, 50, 42] },
  };
  function wingPair(g, fn) {
    for (var s = 1; s >= -1; s -= 2) {
      g.save();
      g.translate(s * 1.4, 0);
      g.scale(s * WING_K, WING_K);
      if (s < 0) LIT = -LIT;
      fn(g);
      if (s < 0) LIT = -LIT;
      g.restore();
    }
  }
  var HERO = {
    accessory: {
      backpack: { box: [-18.6, -31.2, 14.2, 19.6], draw: backpackArt },
      satchel: { box: [-6, -1.6, 12, 10.4], draw: satchelArt },
      camera: { box: [-5.4, -2, 10.8, 9.4], draw: cameraArt },
      wand: { box: [-11.6, -12.8, 16.4, 22.4], draw: wandArt },
      teddy: { box: [-3.2, -1.2, 9.2, 13.4], draw: function (g) { bearArt(g, '#c8915a', '#f4dcb0'); } },
    },
    back: {
      butterfly: { box: [-36.5, -30.5, 73, 55.5], draw: function (g) { wingPair(g, butterflyWing); } },
      fairy: { box: [-36.5, -30.5, 73, 55.5], draw: function (g) { wingPair(g, fairyWing); } },
      angel: { box: [-31, -25.5, 62, 39], draw: function (g) { wingPair(g, angelWing); } },
      leafCape: { box: [-17.5, -2.5, 35, 25.5], draw: function (g) { bodyChains({ back: 'leafCape' })[0].draw(g); } },
      bearPack: { box: [-19, -35.5, 15.5, 23], draw: bearPackArt },
      foxTail: { box: [-19, -19, 21.5, 24.5], draw: foxTailArt },
    },
  };
  var tileCache = {}, tileCount = 0;
  /* field: the record key the option sets; cust: the look with it applied. */
  function drawOption(c, field, x, y, w, h, cust) {
    var cu = norm(cust), v = cu[field];
    var hero = HERO[field] && HERO[field][v];
    /* painted once at the size it is shown (the designer is scaled up on
       tablets), then blitted */
    var m = c.getTransform();
    var res = Math.min(4, Math.round(Math.sqrt(m.a * m.a + m.b * m.b) * 100) / 100);
    var key = (hero ? v : custKey(cu)) + field + w + 'x' + h + '@' + res;
    var cv = tileCache[key];
    if (!cv) {
      if (tileCount > 260) { tileCache = {}; tileCount = 0; }
      cv = document.createElement('canvas');
      cv.width = Math.ceil(w * res);
      cv.height = Math.ceil(h * res);
      var g = cv.getContext('2d');
      g.scale(res, res);
      var R = hero ? hero.box : (CROP_OF[field] && CROP_OF[field][v]) || CROP[field];
      var s = Math.min(w / R[2], h / R[3]) * (hero ? 0.86 : 1);
      var ox = w / 2 - (R[0] + R[2] / 2) * s, oy = h / 2 - (R[1] + R[3] / 2) * s;
      if (hero) {
        var shs = shadowSprite();
        g.globalAlpha = 0.7;
        g.drawImage(shs, w * 0.2, h * 0.86, w * 0.6, h * 0.12);
        g.globalAlpha = 1;
        g.translate(ox, oy - h * 0.02);
        g.scale(s, s);
        g.lineJoin = 'round';
        g.lineCap = 'round';
        LIT = 1;
        hero.draw(g);
      } else {
        var P = stillPose(0, 1, false, 0, 0);
        P.breath = 0; P.hipX = 0; P.tilt = 0; P.sway = 0; P.sway2 = 0; P.skirt = 0;
        drawFigure(g, ox, oy, cu, s, P, field === 'outfit' || field === 'shoes' ? 'shadow' : true);
      }
      tileCache[key] = cv;
      tileCount++;
    }
    c.drawImage(cv, x, y, w, h);
  }

  /* Small emblems for the designer's tabs, about 22 units across, each
     painted once at the size it is shown and then blitted. */
  var ICON = 28, iconCache = {};
  function drawTabIcon(c, id, cx, cy) {
    var m = c.getTransform();
    var res = Math.min(6, Math.round(Math.sqrt(m.a * m.a + m.b * m.b) * 100) / 100);
    var key = id + '@' + res;
    var cv = iconCache[key];
    if (!cv) {
      cv = iconCache[key] = document.createElement('canvas');
      cv.width = cv.height = Math.ceil(ICON * res);
      var g = cv.getContext('2d');
      g.scale(res, res);
      paintTabIcon(g, id, ICON / 2, ICON / 2);
    }
    c.drawImage(cv, cx - ICON / 2, cy - ICON / 2, ICON, ICON);
  }
  function paintTabIcon(c, id, cx, cy) {
    c.save();
    c.translate(cx, cy);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    LIT = 1;
    var hair = '#e06088', i;
    switch (id) {
      case 'hair':
        cel(c, function () { capsule(c, -8.6, -3, 2.6, -9.6, 7.4, 1.5); }, hair, { s: 1, ink: 1.2 });
        cel(c, function () { capsule(c, 8.6, -3, 2.6, 9.6, 7.4, 1.5); }, hair, { s: 1, ink: 1.2 });
        cel(c, function () { c.beginPath(); c.arc(0, 0.6, 7.6, Math.PI, TAU); c.lineTo(7.6, 4.4); c.lineTo(5, 1); c.lineTo(2.4, 4.6); c.lineTo(0, 1); c.lineTo(-2.4, 4.6); c.lineTo(-5, 1); c.lineTo(-7.6, 4.4); c.closePath(); },
          hair, { s: 1.6, ink: 1.2 });
        c.beginPath(); c.arc(-0.6, 0.8, 5.2, Math.PI * 1.15, Math.PI * 1.6);
        stroke(c, tone(hair, 'hi'), 1.3);
        break;
      case 'outfit':
        var dc = '#ff9ec4';
        cel(c, function () { c.beginPath(); c.moveTo(-3.6, -1); c.lineTo(3.6, -1); c.lineTo(9, 9); c.quadraticCurveTo(0, 11.6, -9, 9); c.closePath(); }, dc, { s: 1.6, ink: 1.2 });
        cel(c, function () { ell(c, -5.6, -5.4, 3, 2.6); }, dc, { s: 1, ink: 1.2 });
        cel(c, function () { ell(c, 5.6, -5.4, 3, 2.6); }, dc, { s: 1, ink: 1.2 });
        cel(c, function () { c.beginPath(); c.moveTo(-3.6, -8.4); c.quadraticCurveTo(0, -6, 3.6, -8.4); c.lineTo(4, -0.6); c.lineTo(-4, -0.6); c.closePath(); }, dc, { s: 1.2, ink: 1.2 });
        c.beginPath(); c.moveTo(-4, -0.8); c.lineTo(4, -0.8);
        stroke(c, '#fffaf2', 1.4);
        break;
      case 'shoes':
        var sc = '#d0584a';
        cel(c, function () {
          c.beginPath();
          c.moveTo(-9.4, 6); c.quadraticCurveTo(-10.4, -3.4, -4.4, -4.4);
          c.quadraticCurveTo(1, -3.6, 4.6, -0.4); c.quadraticCurveTo(10.4, 0.6, 9.6, 6);
          c.closePath();
        }, sc, { s: 1.6, ink: 1.2 });
        c.fillStyle = '#fffaf2';
        c.fillRect(-9.2, 4.6, 18.6, 1.6);
        c.beginPath(); c.moveTo(-9.4, 6.4); c.lineTo(9.6, 6.4);
        stroke(c, tone(sc, 'ink'), 1.2);
        c.beginPath(); c.moveTo(-4.4, -3.6); c.quadraticCurveTo(-0.6, -1, 2.6, -2.4);
        stroke(c, tone(sc, 'ink'), 1.3);
        glint(c, 5.6, 1.6, 2, 0.7, 0.8, 0.3);
        break;
      case 'hat':
        cel(c, function () { ell(c, 0, 4.4, 11, 3.4); }, STRAW, { s: 1.2, ink: 1.2 });
        cel(c, function () { c.beginPath(); c.moveTo(-6.4, 4); c.bezierCurveTo(-6.8, -5, -3, -7.6, 0, -7.6); c.bezierCurveTo(3, -7.6, 6.8, -5, 6.4, 4); c.quadraticCurveTo(0, 5.6, -6.4, 4); c.closePath(); },
          '#f2d684', { s: 1.6, ink: 1.2 });
        cel(c, function () { c.beginPath(); c.moveTo(-6.5, 1); c.quadraticCurveTo(0, 2.8, 6.5, 1); c.lineTo(6.4, 4); c.quadraticCurveTo(0, 5.6, -6.4, 4); c.closePath(); }, '#d2483e', { s: 0.6, ink: 0.9 });
        break;
      case 'extra':
        c.scale(2.3, 2.3);
        bow(c, 0, 0, '#ff8a9c', 1);
        break;
      case 'charm':
        metal(c, function () { starPath(c, 0, 0.4, 9.6, 0.5); }, '#ffd83a', -9.6, -9.2, 9.6, 10, { ink: 1.2, inkCol: '#a8701a' });
        break;
      case 'back':
        c.scale(0.33, 0.33);
        c.translate(0, 3);
        c.lineWidth = 1;
        wingPair(c, butterflyWing);
        break;
      case 'eyes':
        c.scale(2.5, 2.5);
        eye(c, 0, 0.2, 3.1, 1, 'o', irisOf('#7c3e22'));
        break;
      case 'skin':
        for (i = 0; i < 3; i++) {
          (function (px, col) {
            cel(c, function () { ell(c, px, i === 1 ? -1.6 : 1.6, 5.4, 5.4); }, col, { warm: true, s: 1.4, ink: 1.2 });
          })([-6.4, 0, 6.4][i], ['#ffddbb', '#c58a5c', '#7a4f31'][i]);
        }
        break;
    }
    c.restore();
  }

  /* ---- Walkers: the player and the friends share the rig ---- */
  function Walker(x, y) {
    this.x = x;
    this.y = y;
    this.facing = 1;
    this.frame = 0;
    this.blink = false;
    this.rig = new Rig();
    this.lastX = x;
    this.lastY = y;
    this.fromX = x;
    this.fromY = y;
    this.carry = false;
  }
  Walker.prototype.animate = function (moving) {
    var dt = 1 / 60;
    var dx = this.x - this.lastX, dy = this.y - this.lastY;
    /* where this tick started, for drawing between ticks (not across a jump) */
    var jump = Math.abs(dx) > 40 || Math.abs(dy) > 40;
    this.fromX = jump ? this.x : this.lastX;
    this.fromY = jump ? this.y : this.lastY;
    this.lastX = this.x;
    this.lastY = this.y;
    var speed = Math.sqrt(dx * dx + dy * dy) / dt;
    if (!moving || speed > 900) speed = 0;   /* a teleport is not a sprint */
    this.rig.update(dt, this.x, this.y, speed, this.facing, this.carry);
    this.frame = moving ? 1 : 0;
    this.blink = this.rig.blinkAge < 0.15;
  };
  /* The engine steps at a fixed 60 Hz; Game.renderAlpha (0..1) says how
     far the screen is past the last tick, so a 120 Hz iPad (or a late
     frame) sees her glide instead of moving every other frame. */
  Walker.prototype.renderX = function () {
    var a = Game.renderAlpha === undefined ? 1 : Game.renderAlpha;
    return this.fromX + (this.x - this.fromX) * a;
  };
  Walker.prototype.renderY = function () {
    var a = Game.renderAlpha === undefined ? 1 : Game.renderAlpha;
    return this.fromY + (this.y - this.fromY) * a;
  };
  Walker.prototype.drawAt = function (c, cust, scale) {
    this.rig.scale = scale;
    this.rig.alpha = Game.renderAlpha === undefined ? 1 : Game.renderAlpha;
    drawCharacter(c, this.renderX(), this.renderY(), cust, this.frame, this.facing, scale, this.blink, 0, undefined, this.rig);
    this.rig.alpha = 1;
  };

  var SPEED = 3.2;
  function Player(x, y) {
    Walker.call(this, x, y);
    this.holdT = 0;          /* seconds the current direction has been held */
    this.hx = 0;
    this.hy = 0;
    this.driveAt = -1e9;
    this.vx = 0;
    this.vy = 0;
    this.coast = 0;          /* 1 .. 0 while extra speed runs out after a release */
    this.coastStep = 0;
    this.coastK = 0;
    this.turbo = 0;          /* 0 .. 1: speed multiplier - 1 while held */
  }
  Player.prototype = Object.create(Walker.prototype);
  Player.prototype.constructor = Player;
  /* Turbo: hold a direction and after 5 s she starts to speed up, easing
     (smoothstep) to twice her walking speed at 10 s. Letting go, or
     turning back the other way on either axis, puts her back to normal:
     the timer starts over and any extra speed runs out over a quarter
     second instead of a dead stop. Gaps with no drive() (the zipline, a
     cutscene, the shop, being in the other scene) count as letting go.
     dx, dy: -1 / 0 / 1. sp: walking speed, px per tick. ky: vertical
     speed as a fraction of sp. Moves her and returns whether she moved. */
  var TURBO_WAIT = 5, TURBO_FULL = 10, TURBO_COAST = 0.25;
  Player.prototype.drive = function (dx, dy, sp, ky) {
    var dt = 1 / 60, now = performance.now();
    var held = dx !== 0 || dy !== 0;
    if (now - this.driveAt > 200) this.hx = this.hy = this.turbo = this.coast = 0;
    if (!held || dx * this.hx < 0 || dy * this.hy < 0 || !(this.hx || this.hy)) this.holdT = 0;
    this.driveAt = now;
    if (held) {
      var was = this.holdT;
      this.holdT += dt;
      if (was < TURBO_WAIT && this.holdT >= TURBO_WAIT && Game.audio) Game.audio.play('whoosh');
      var u = Math.max(0, Math.min(1, (this.holdT - TURBO_WAIT) / (TURBO_FULL - TURBO_WAIT)));
      this.turbo = u * u * (3 - 2 * u);
      this.vx = dx * sp * (1 + this.turbo);
      this.vy = dy * sp * ky * (1 + this.turbo);
      this.coast = 0;
    } else {
      if (this.hx || this.hy) {
        /* just let go: at a plain walk she stops dead, as she always has */
        this.coastK = this.turbo;
        this.coast = this.turbo > 0.01 ? 1 : 0;
        this.coastStep = dt / (TURBO_COAST * Math.max(0.01, this.turbo));
      }
      this.coast = Math.max(0, this.coast - this.coastStep);
      this.turbo = 0;
      if (!this.coast) this.vx = this.vy = 0;
    }
    this.hx = dx;
    this.hy = dy;
    var k = held ? 1 : this.coast;
    this.x += this.vx * k;
    this.y += this.vy * k;
    this.rig.turbo = held ? this.turbo : this.coastK * this.coast;
    return held || this.coast > 0;
  };
  Player.prototype.update = function (keys, minX, maxX) {
    var dx = keys.left && !keys.right ? -1 : keys.right && !keys.left ? 1 : 0;
    if (dx) this.facing = dx;
    var moving = this.drive(dx, 0, SPEED, 0);
    if (this.x < minX) this.x = minX;
    if (this.x > maxX) this.x = maxX;
    this.carry = !!(Game.bag && Game.bag.items && Game.bag.items.length);
    this.animate(moving);
  };
  Player.prototype.draw = function (c, cust) { this.drawAt(c, cust, E.HERO_SCALE); };

  /* Friends drift back and forth inside a patch around their home x. */
  function Friend(def) {
    Walker.call(this, def.meadowX, Game.MEADOW.groundY);
    this.def = def;
    this.homeX = def.meadowX;
    this.range = 100;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.pauseTimer = Math.floor(Math.random() * 120);
  }
  Friend.prototype = Object.create(Walker.prototype);
  Friend.prototype.constructor = Friend;
  Friend.prototype.update = function () {
    var moving = false;
    if (this.pauseTimer > 0) {
      this.pauseTimer--;
    } else {
      this.x += this.dir * 0.8;
      this.facing = this.dir;
      moving = true;
      if (this.x > this.homeX + this.range) { this.dir = -1; this.pauseTimer = 60 + Math.floor(Math.random() * 90); }
      if (this.x < this.homeX - this.range) { this.dir = 1; this.pauseTimer = 60 + Math.floor(Math.random() * 90); }
    }
    this.animate(moving);
  };
  Friend.prototype.draw = function (c, cust) { this.drawAt(c, cust, E.FRIEND_SCALE); };

  E.drawCharacter = drawCharacter;
  E.drawPortrait = drawPortrait;
  E.drawOption = drawOption;
  E.drawTabIcon = drawTabIcon;
  E.Rig = Rig;
  E.Player = Player;
  E.Friend = Friend;
  E.HERO_SCALE = 1.3;
  /* Where her fists are in the hanging pose (local units above her feet,
     either side of centre), so the zipline can put its handle there. */
  E.HANG_GRIP_X = 15.3;
  E.HANG_GRIP_Y = 41.0;
  E.FRIEND_SCALE = 1.15;
})();
