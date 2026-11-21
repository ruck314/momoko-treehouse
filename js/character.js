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
              accessory: 'none', charm: 'none' };
  function norm(cu) {
    var o = {};
    for (var k in DEF) o[k] = (cu && cu[k]) || DEF[k];
    return o;
  }
  function custKey(cu) {
    return cu.skin + cu.hair + cu.outfitColor + cu.shoeColor + cu.hairStyle + cu.outfit + cu.shoes +
      cu.hat + cu.accessory + cu.charm;
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
  var IRIS = ['#3a1810', '#7c3e22', '#e8a258'];

  function eye(c, x, y, rx, side, state) {
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
    stroke(c, '#2a100c', 0.35);
    /* pupil and the glow ring under it */
    dot(c, ix, iy + 0.25, irx * 0.42, iry * 0.46, '#1a0806');
    c.beginPath();
    c.ellipse(ix, iy + 0.5, irx * 0.7, iry * 0.68, 0, 0.35, Math.PI - 0.35);
    stroke(c, 'rgba(255, 214, 150, 0.8)', 0.45);
    /* iris fleck lines */
    c.globalAlpha = 0.35;
    c.beginPath();
    for (var k = 0; k < 5; k++) {
      var a = Math.PI * (0.15 + k * 0.17);
      c.moveTo(ix + Math.cos(a) * irx * 0.5, iy + Math.sin(a) * iry * 0.5);
      c.lineTo(ix + Math.cos(a) * irx * 0.85, iy + Math.sin(a) * iry * 0.85);
    }
    stroke(c, '#ffe2b0', 0.25);
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
    for (var i = 0; i < 2; i++) eye(c, EYES[i].x, EYE_Y, EYES[i].rx, EYES[i].side, state);
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
    if (cu.hairStyle === 'buns') {
      bun(c, cu, -10.4, HY - 10.6);
      bun(c, cu, 10.4, HY - 10.6);
    }
  }
  function bun(c, cu, x, y) {
    var col = hairCol(cu);
    cel(c, function () { ell(c, x, y, 6.2, 5.9); }, col, { s: 2, ink: 0.8, x0: x - 6, x1: x + 6, y0: y - 6, y1: y + 6 });
    var ink = tone(col, 'ink');
    c.beginPath(); c.arc(x + 0.4, y + 0.4, 3.6, Math.PI * 0.8, Math.PI * 2.1); stroke(c, ink, 0.45);
    c.beginPath(); c.arc(x - 0.2, y + 0.6, 1.8, Math.PI * 1.1, Math.PI * 2.3); stroke(c, ink, 0.4);
    c.beginPath(); c.arc(x - LIT * 0.4, y + 0.2, 4.6, Math.PI * 1.15, Math.PI * 1.6);
    stroke(c, tone(col, 'hi'), 1.1);
    glint(c, x - LIT * 2.2, y - 3, 0.8, 0.45, 0.9);
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
    }
    drawCharm(c, cu);
    if (cu.accessory === 'ribbon') bow(c, 6.2, HY - 12.4, PAL.peach, 1.25);
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
    }
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
    } else if (cu.charm === 'sunnies') {
      for (var j = 0; j < 2; j++) {
        var ee = EYES[j];
        (function (x) {
          var p = function () { heartPath(c, x, EYE_Y + 0.4, 3.9); };
          p();
          var g = c.createLinearGradient(0, EYE_Y - 4, 0, EYE_Y + 4.5);
          g.addColorStop(0, 'rgba(214, 40, 110, 0.82)');
          g.addColorStop(1, 'rgba(255, 150, 190, 0.55)');
          c.fillStyle = g;
          c.fill();
          stroke(c, '#7a1840', 0.7);
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
      stroke(c, '#7a1840', 0.7);
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
        cel(c, band, '#d2483e', { s: 0.8, ink: 0.55 });
        bow(c, -10.2, HY - 12.4, '#d2483e', 0.7);
        c.beginPath();
        c.moveTo(-6, HY - 20.6); c.quadraticCurveTo(-1, HY - 22, 4, HY - 21);
        stroke(c, tone('#f2d684', 'hi'), 0.8);
        break;
      case 'beret':
        cel(c, function () { ell(c, -1.6, HY - 13.6, 15, 6.6, -0.14); }, oc, { s: 2, ink: 0.7, x0: -17, x1: 14, y0: HY - 20, y1: HY - 7 });
        c.beginPath();
        c.ellipse(-1.2, HY - 11.8, 13.4, 4.2, -0.14, 0.15, Math.PI - 0.15);
        stroke(c, tone(oc, 'd2'), 0.5);
        cel(c, function () { capsule(c, 1.4, HY - 19.6, 0.9, 2.2, HY - 21.8, 0.7); }, tone(oc, 'd1'), { s: 0.4, ink: 0.4 });
        glint(c, -7 * LIT, HY - 17.4, 3, 0.9, 0.5, -0.2);
        break;
      case 'flowerCrown':
        c.beginPath();
        c.ellipse(0, HY - 9.2, 13.4, 3.6, 0, Math.PI * 1.02, Math.PI * 1.98);
        stroke(c, '#3f7a30', 1.1);
        for (var i = -2; i <= 2; i++) {
          var fx = i * 6.2, fy = HY - 11.6 + Math.abs(i) * 1.6;
          var fc = i % 2 === 0 ? '#ffb0cc' : '#fff4dc';
          (function (fx, fy, fc, i) {
            cel(c, function () { ell(c, fx + 3.2, fy + 1.4, 2.4, 1.1, 0.5); }, PAL.leafLight || '#7bc45a', { s: 0.5, ink: 0.4 });
            for (var pp = 0; pp < 5; pp++) {
              var a = pp * TAU / 5 - Math.PI / 2 + i * 0.3;
              (function (px, py) {
                cel(c, function () { ell(c, px, py, 1.8, 1.8); }, fc, { s: 0.6, ink: 0.4 });
              })(fx + Math.cos(a) * 1.9, fy + Math.sin(a) * 1.9);
            }
            dot(c, fx, fy, 1.2, 1.2, PAL.sun);
            stroke(c, '#b07a18', 0.3);
          })(fx, fy, fc, i);
        }
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
        cel(c, function () { starPath(c, 2.4, HY - 12.6, 2.6); }, '#ffd24a', { s: 0.6, ink: 0.45 });
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
          glint(g, 1.6, -9, 0.5, 0.5, 0.9);
          glint(g, -3, -6, 0.35, 0.35, 0.8);
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
    if (sh === 'maryJane' || sh === 'sneaker') {
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
      } else {
        c.moveTo(-1.7, SHIN - 2.3); c.lineTo(1.7, SHIN - 2.3);
        c.moveTo(-1.6, SHIN - 1.5); c.lineTo(1.6, SHIN - 1.5);
        stroke(c, '#7aa0d8', 0.3);
      }
    } else if (sh === 'boots') {
      var bc = back ? tone(cu.shoeColor, 'd1') : cu.shoeColor;
      c.fillStyle = tone(bc, 'd2');
      c.fillRect(-3, 1.2, 6, 6);
      c.fillStyle = bc;
      c.fillRect(-3 - LIT * 0.7, 1.4, 6, 6);
      c.restore();
      cel(c, function () { c.beginPath(); c.ellipse(0, 1.5, 2.4, 0.95, 0, 0, TAU); }, mix(bc, '#fff4dc', 0.55), { s: 0.4, ink: 0.4, inkCol: tone(bc, 'ink') });
      c.beginPath();
      c.moveTo(-LIT * 1.1, 2.6); c.lineTo(-LIT * 1.1, SHIN - 0.6);
      c.globalAlpha = 0.6;
      stroke(c, tone(bc, 'hi'), 0.5);
      c.globalAlpha = 1;
    } else {
      c.restore();
    }
  }
  /* Shoe in the ankle frame: ankle at (0, 0), sole at y = ANKLE_H, toe +x. */
  function drawShoe(c, cu, back) {
    var col = back ? tone(cu.shoeColor, 'd1') : cu.shoeColor, sh = cu.shoes;
    var skin = back ? tone(cu.skin, 'd1', true) : cu.skin;
    var y = ANKLE_H;
    var foot = function (h, toe) {
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
      case 'sweater': case 'hoodie': return 'long';
      case 'yukata': return 'wide';
      case 'tutu': return 'none';
      default: return 'puff';
    }
  }
  function drawUpperArm(c, cu, back) {
    var skin = back ? tone(cu.skin, 'd1', true) : cu.skin;
    var sc = cu.outfit === 'overalls' ? '#fff4dc' : cu.outfitColor;
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
      c.beginPath();
      c.moveTo(-1.4, FORE - 1.6); c.lineTo(-1.4, FORE); c.moveTo(0, FORE - 1.6); c.lineTo(0, FORE); c.moveTo(1.4, FORE - 1.6); c.lineTo(1.4, FORE);
      stroke(c, tone(sc, 'd2'), 0.25);
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
  function bodyAccessory(c, cu) {
    switch (cu.accessory) {
      case 'scarf':
        var sc = '#d0504a';
        cel(c, function () {
          c.beginPath();
          c.moveTo(-6.4, -28.6); c.quadraticCurveTo(0, -26.6, 6.4, -28.6);
          c.quadraticCurveTo(7.6, -26.6, 6.2, -24.8); c.quadraticCurveTo(0, -22.6, -6.2, -24.8);
          c.quadraticCurveTo(-7.6, -26.6, -6.4, -28.6); c.closePath();
        }, sc, { s: 1, ink: 0.6, x0: -7, x1: 7, y0: -29, y1: -23 });
        c.beginPath();
        c.moveTo(-6, -27.2); c.quadraticCurveTo(0, -25.2, 6, -27.2);
        stroke(c, '#fff0d8', 0.55);
        break;
      case 'backpack':
        for (var s = -1; s <= 1; s += 2) {
          (function (side) {
            cel(c, function () { capsule(c, side * 4.8, -27.8, 1, side * 5.6, -21, 0.9); }, '#3f7a30', { s: 0.4, ink: 0.5 });
          })(s);
        }
        break;
      case 'necklace':
        c.beginPath();
        c.moveTo(-3.6, -27.8); c.quadraticCurveTo(-0.6, -24, 0.6, -24.2); c.quadraticCurveTo(2, -24.4, 3.8, -27.8);
        stroke(c, '#b08a2a', 0.45);
        c.setLineDash([0.4, 0.5]);
        stroke(c, '#ffe8a0', 0.3);
        c.setLineDash([]);
        break;
      case 'cape':
        /* the cape's shoulders drape over the sleeves' tops */
        for (var cs = -1; cs <= 1; cs += 2) {
          (function (side) {
            cel(c, function () {
              c.beginPath();
              c.moveTo(side * 3.4, -28.2);
              c.quadraticCurveTo(side * 8.6, -28.6, side * 9, -24.4);
              c.quadraticCurveTo(side * 6.6, -25.2, side * 4.6, -26.4);
              c.closePath();
            }, '#c8384a', { s: 0.6, ink: 0.5 });
          })(cs);
        }
        cel(c, function () { ell(c, -4.8, -27.2, 1.4, 1.4); }, '#ffd24a', { s: 0.4, ink: 0.45 });
        cel(c, function () { ell(c, 4.8, -27.2, 1.4, 1.4); }, '#ffd24a', { s: 0.4, ink: 0.45 });
        c.beginPath(); c.moveTo(-4.8, -27.2); c.quadraticCurveTo(0, -26, 4.8, -27.2);
        stroke(c, '#b08a2a', 0.4);
        break;
      case 'satchel':
        cel(c, function () {
          c.beginPath(); c.moveTo(5.6, -27.8); c.lineTo(7.2, -27.2); c.lineTo(-5.4, -16.4); c.lineTo(-6.8, -17.6); c.closePath();
        }, '#8a5a34', { s: 0.4, ink: 0.45 });
        break;
    }
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
    if (cu.outfit === 'hoodie') {
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
    if (cu.accessory === 'backpack') {
      var bc = '#4e8f3c';
      cel(c, function () {
        c.beginPath();
        c.moveTo(-6.8, -27); c.quadraticCurveTo(-13.4, -27.6, -13, -21);
        c.lineTo(-12.4, -15.6); c.quadraticCurveTo(-9, -14, -6.4, -15.6); c.closePath();
      }, bc, { s: 1.4, ink: 0.65, x0: -13, x1: -6, y0: -27, y1: -15 });
      cel(c, function () {
        c.beginPath(); c.moveTo(-12.6, -21.6); c.quadraticCurveTo(-11.6, -17, -9, -17.2); c.lineTo(-9.4, -21.4); c.closePath();
      }, tone(bc, 'd1'), { s: 0.5, ink: 0.5, inkCol: tone(bc, 'ink') });
      gem(c, -10.6, -21.2, 0.6, PAL.sun);
    }
  }
  /* Chain pieces hanging from the body (body frame). */
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
          g.fillStyle = '#ffd24a';
          g.fillRect(-15, 16.6, 30, 0.8);
          g.restore();
        } });
    }
    if (cu.accessory === 'scarf') {
      out.push({ k: 'sf', x: 3.4, y: -25, a: -0.08, bx: -2.6, by: -1, bw: 5.6, bh: 12, n: 3, m: 1.1, out: 1,
        draw: function (g) {
          var col = '#c24842';
          cel(g, function () {
            g.beginPath(); g.moveTo(-2, 0); g.lineTo(2.2, 0); g.lineTo(2.6, 9.4); g.lineTo(-1.8, 9.6); g.closePath();
          }, col, { s: 0.8, ink: 0.55, x0: -2, x1: 2.6, y0: 0, y1: 10 });
          g.beginPath();
          g.moveTo(-1.9, 3.4); g.lineTo(2.3, 3.3); g.moveTo(-1.8, 6.4); g.lineTo(2.5, 6.3);
          stroke(g, '#fff0d8', 0.55);
          g.beginPath();
          for (var i = 0; i < 4; i++) { g.moveTo(-1.5 + i * 1.3, 9.6); g.lineTo(-1.6 + i * 1.3, 10.8); }
          stroke(g, col, 0.5);
        } });
    }
    return out;
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
    if (cu.outfit === 'hoodie' || cu.outfit === 'yukata' || cu.accessory === 'backpack') {
      c.save();
      c.translate(0, cu.accessory === 'backpack' ? -P.bounce * 0.25 : 0);
      piece(c, ck + 'bk', -16, -40, 32, 30, res, function (g) { drawBack(g, cu); });
      c.restore();
    }
    c.save();
    head(c);
    c.translate(P.front ? 0 : -1, 0);
    piece(c, ck + 'hb', -18.5, HY - 18, 37, 33, res, function (g) { drawHairBack(g, cu); });
    c.translate(P.front ? 0 : 1, 0);
    for (var hc = 0; hc < hairChains.length; hc++) {
      var chh = hairChains[hc];
      drawChain(c, ck + chh.k, res, chh, chainAngles(chh, P));
    }
    c.restore();
    /* 3. far arm (+x), behind the torso */
    drawArm(c, cu, ck, res, 1, arms[1]);
    c.restore();

    /* 4. legs, far one (+x) first */
    for (var lg = 1; lg >= 0; lg--) {
      var L = legs[lg], back = lg === 1, tag = back ? 'b' : 'f';
      c.save();
      c.translate(L.ax, L.ay);
      c.rotate(L.pitch);
      piece(c, ck + 'sh' + tag, -4, -3, 10.5, 5.6, res, function (g) { drawShoe(g, cu, back); });
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
    piece(c, ck + 'sk', -17, WAIST_Y - 3, 34, 20, res, function (g) { drawSkirt(g, cu); });
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
      if (cu.charm === 'glasses' || cu.charm === 'sunnies') drawGlasses(g, cu);
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
      piece(c, ck + 'ht', -23, HY - 25, 46, 27, res, function (g) { drawHat(g, cu); });
      c.restore();
    }
    c.restore();

    /* 7. near arm (-x) */
    drawArm(c, cu, ck, res, 0, arms[0]);
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
  function drawArm(c, cu, ck, res, i, A) {
    var s = i === 0 ? -1 : 1, back = i === 1, tag = back ? 'b' : 'f';
    c.save();
    c.translate(s * SH_X, SH_Y - A.up);
    c.rotate(A.ua);
    c.scale(1, A.k);
    piece(c, ck + 'au' + tag, -4.6, -3.4, 9.2, 15.6, res, function (g) { drawUpperArm(g, cu, back); });
    c.translate(0, UPPER);
    c.rotate(A.fa);
    piece(c, ck + 'af' + tag, -3, -2.8, 6.4, FORE + 7, res, function (g) { drawForearm(g, cu, back); });
    c.restore();
  }
  /* Small swinging charms, drawn live: the necklace pendant, the satchel. */
  function pendants(c, cu, P) {
    if (cu.accessory === 'necklace') {
      c.save();
      c.translate(0.6, -24.4);
      c.rotate(-P.charm);
      cel(c, function () { heartPath(c, 0, 1.6, 1.25); }, '#ff5a8a', { s: 0.4, ink: 0.4 });
      glint(c, -0.4, 1.1, 0.35, 0.25, 0.95);
      c.restore();
    } else if (cu.accessory === 'satchel') {
      c.save();
      c.translate(-6.4, -17);
      c.rotate(-P.charm * 0.7);
      piece(c, custKey(cu) + 'sat' + (LIT < 0 ? 'L' : 'R') + pieceRes, -4.6, -1, 9.2, 8, pieceRes, function (g) {
        var col = '#b07a48';
        cel(g, function () {
          g.beginPath(); g.moveTo(-3.8, 0); g.lineTo(3.8, 0); g.quadraticCurveTo(4.4, 5.6, 3, 6.2); g.lineTo(-3, 6.2); g.quadraticCurveTo(-4.4, 5.6, -3.8, 0); g.closePath();
        }, col, { s: 1, ink: 0.55, x0: -4, x1: 4, y0: 0, y1: 6.2 });
        cel(g, function () {
          g.beginPath(); g.moveTo(-3.9, -0.2); g.lineTo(3.9, -0.2); g.lineTo(3.4, 3.2); g.quadraticCurveTo(0, 4.2, -3.4, 3.2); g.closePath();
        }, tone(col, 'd1'), { s: 0.5, ink: 0.5, inkCol: tone(col, 'ink') });
        gem(g, 0, 3.4, 0.7, PAL.sun);
      });
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

  /* Rendered crops of the hero for the designer's option tiles: the
     real renderer, painted live once into a canvas and kept. */
  var CROPS = {
    head:  [-22, -63, 44, 38],
    upper: [-20, -63, 40, 50],
    hat:   [-25, -69, 50, 48],
    face:  [-17, -56, 34, 30],
    body:  [-16, -31, 32, 32],
    shoes: [-8.6, -9.5, 18, 10.5],
    full:  [-21, -62, 42, 64],
  };
  var previewCache = {}, previewCount = 0;
  function drawPreview(c, kind, x, y, w, h, cust) {
    var cu = norm(cust);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var key = custKey(cu) + kind + w + 'x' + h + '@' + dpr;
    var cv = previewCache[key];
    if (!cv) {
      if (previewCount > 240) { previewCache = {}; previewCount = 0; }
      cv = document.createElement('canvas');
      cv.width = Math.ceil(w * dpr);
      cv.height = Math.ceil(h * dpr);
      var g = cv.getContext('2d');
      g.scale(dpr, dpr);
      var R = CROPS[kind] || CROPS.full;
      var s = Math.min(w / R[2], h / R[3]);
      var P = stillPose(0, 1, false, 0, 0);
      P.breath = 0; P.hipX = 0; P.tilt = 0; P.sway = 0; P.sway2 = 0; P.skirt = 0;
      drawFigure(g, w / 2 - (R[0] + R[2] / 2) * s, h / 2 - (R[1] + R[3] / 2) * s, cu, s, P, kind === 'full' || kind === 'body' || kind === 'shoes' ? 'shadow' : true);
      previewCache[key] = cv;
      previewCount++;
    }
    c.drawImage(cv, x, y, w, h);
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
  E.drawPreview = drawPreview;
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
