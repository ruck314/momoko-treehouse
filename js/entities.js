/* entities.js – all character and scenery painting.
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

  /* ---- Offscreen sprite memo (static scenery only) ---- */
  var spriteCache = {};
  function getCachedSprite(key, w, h, drawFn) {
    if (spriteCache[key]) return spriteCache[key];
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    drawFn(cv.getContext('2d'));
    spriteCache[key] = cv;
    return cv;
  }

  /* ---- Shape helpers ---- */
  function ink(c, w) {
    c.strokeStyle = PAL.ink;
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

  function fillRound(c, x, y, w, h, r, fill, outline) {
    roundRect(c, x, y, w, h, r);
    c.fillStyle = fill;
    c.fill();
    if (outline !== false) ink(c, 2);
  }

  function fillEllipse(c, cx, cy, rx, ry, fill, outline) {
    c.beginPath();
    c.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    if (outline !== false) ink(c, 2);
  }

  function fillPath(c, pts, fill, close, outline) {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (close !== false) c.closePath();
    c.fillStyle = fill;
    c.fill();
    if (outline !== false) ink(c, 2);
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

  /* ==================================================================
     Characters
     Drawn with feet at (0,0) in local space, ~56px tall at scale 1.
     ================================================================== */

  var CH = {
    headR: 13,
    headY: -41,
    torsoTop: -30,
    torsoBot: -12,
    torsoW: 20,
  };

  function drawHair(c, cust, back) {
    var col = cust.hair;
    var dark = shade(col, -22);
    var hy = CH.headY;
    var r = CH.headR;
    if (back) {
      /* Behind-the-head volume, painted before the face. */
      switch (cust.hairStyle) {
        case 'twinTails':
          fillEllipse(c, -r - 6, hy + 6, 7, 12, col);
          fillEllipse(c, r + 6, hy + 6, 7, 12, col);
          break;
        case 'longBraids':
          fillRound(c, -r - 6, hy - 2, 8, 26, 4, col);
          fillRound(c, r - 2, hy - 2, 8, 26, 4, col);
          fillEllipse(c, -r - 2, hy + 25, 4, 4, dark);
          fillEllipse(c, r + 2, hy + 25, 4, 4, dark);
          break;
        case 'buns':
          fillEllipse(c, -r - 4, hy - 6, 7, 7, col);
          fillEllipse(c, r + 4, hy - 6, 7, 7, col);
          break;
        case 'ponytail':
          fillPath(c, [[r - 2, hy - 4], [r + 12, hy + 4], [r + 9, hy + 20], [r + 1, hy + 8]], col);
          break;
        case 'bob':
          fillEllipse(c, 0, hy + 3, r + 3, r + 2, col);
          break;
      }
    } else {
      /* Fringe over the forehead. */
      c.save();
      c.beginPath();
      c.arc(0, hy, r + 1.5, Math.PI, Math.PI * 2);
      c.closePath();
      c.fillStyle = col;
      c.fill();
      ink(c, 2);
      c.restore();
      if (cust.hairStyle === 'bob') {
        fillRound(c, -r - 2, hy - 2, 5, 14, 2.5, col);
        fillRound(c, r - 3, hy - 2, 5, 14, 2.5, col);
      }
      /* A soft highlight so flat hair still reads as round. */
      c.save();
      c.globalAlpha = 0.35;
      fillEllipse(c, -5, hy - 7, 5, 3, shade(col, 40), false);
      c.restore();
    }
  }

  function drawOutfit(c, cust, legSwing) {
    var col = cust.outfitColor;
    var dark = shade(col, -20);
    var light = shade(col, 22);
    var top = CH.torsoTop, bot = CH.torsoBot;

    switch (cust.outfit) {
      case 'frillyDress':
        fillPath(c, [[-9, top], [9, top], [16, bot + 8], [-16, bot + 8]], col);
        /* Frill scallops along the hem. */
        c.beginPath();
        for (var i = -16; i < 16; i += 8) {
          c.moveTo(i, bot + 8);
          c.arc(i + 4, bot + 8, 4, Math.PI, 0, true);
        }
        c.fillStyle = light;
        c.fill();
        ink(c, 1.5);
        break;
      case 'sailorDress':
        fillPath(c, [[-9, top], [9, top], [15, bot + 7], [-15, bot + 7]], col);
        fillPath(c, [[-9, top], [9, top], [6, top + 8], [-6, top + 8]], PAL.cream);
        fillRound(c, -4, top + 6, 8, 4, 2, '#c05a48');
        break;
      case 'starDress':
        fillPath(c, [[-9, top], [9, top], [15, bot + 7], [-15, bot + 7]], col);
        c.fillStyle = PAL.sun;
        for (var s = 0; s < 3; s++) star(c, -7 + s * 7, bot - 1 + (s % 2) * 4, 2.6);
        break;
      case 'overalls':
        fillRound(c, -10, top + 3, 20, (bot + 4) - (top + 3), 4, col);
        fillRound(c, -8, top - 1, 3.5, 9, 1.5, col);
        fillRound(c, 4.5, top - 1, 3.5, 9, 1.5, col);
        fillRound(c, -9, top - 2, 18, 8, 3, PAL.cream);
        fillRound(c, -10, top + 3, 20, (bot + 4) - (top + 3), 4, col);
        fillRound(c, -4, top + 8, 8, 6, 2, dark);
        break;
      case 'sweater':
        fillRound(c, -11, top, 22, (bot + 5) - top, 6, col);
        c.strokeStyle = dark;
        c.lineWidth = 1.5;
        for (var y = top + 5; y < bot + 3; y += 5) {
          c.beginPath(); c.moveTo(-10, y); c.lineTo(10, y); c.stroke();
        }
        roundRect(c, -11, top, 22, (bot + 5) - top, 6);
        ink(c, 2);
        break;
    }
    return legSwing;
  }

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

  function drawShoe(c, cust, x, y) {
    var col = cust.shoeColor;
    switch (cust.shoes) {
      case 'maryJane':
        fillRound(c, x - 5, y - 5, 10, 6, 3, col);
        c.strokeStyle = shade(col, -30);
        c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x - 4, y - 4); c.lineTo(x + 4, y - 4); c.stroke();
        break;
      case 'sneaker':
        fillRound(c, x - 6, y - 6, 12, 7, 3, col);
        fillRound(c, x - 6, y - 2, 12, 3, 1.5, PAL.cream);
        break;
      case 'boots':
        fillRound(c, x - 5, y - 11, 10, 12, 3, col);
        fillRound(c, x - 6, y - 3, 12, 4, 2, shade(col, -30));
        break;
    }
  }

  function drawHat(c, cust) {
    var hy = CH.headY, r = CH.headR;
    switch (cust.hat) {
      case 'strawHat':
        fillEllipse(c, 0, hy - 6, r + 10, 5, '#e8c76a');
        fillEllipse(c, 0, hy - 11, r - 2, 7, '#f0d585');
        fillRound(c, -r + 1, hy - 10, (r - 1) * 2, 4, 2, '#c05a48');
        break;
      case 'beret':
        fillEllipse(c, -1, hy - 10, r + 2, 7, cust.outfitColor);
        fillEllipse(c, 6, hy - 15, 2.5, 2.5, shade(cust.outfitColor, -25));
        break;
      case 'flowerCrown':
        for (var i = -2; i <= 2; i++) {
          var fx = i * 6.5;
          var fy = hy - 10 + Math.abs(i) * 1.6;
          fillEllipse(c, fx, fy, 3.6, 3.2, i % 2 === 0 ? PAL.peach : PAL.cream, false);
          fillEllipse(c, fx, fy, 1.3, 1.3, PAL.sun, false);
        }
        break;
    }
  }

  function drawAccessory(c, cust) {
    switch (cust.accessory) {
      case 'scarf':
        fillRound(c, -10, CH.torsoTop - 3, 20, 6, 3, '#c05a48');
        fillPath(c, [[4, CH.torsoTop + 2], [10, CH.torsoTop + 3], [8, CH.torsoTop + 15], [3, CH.torsoTop + 13]], '#c05a48');
        break;
      case 'backpack':
        fillRound(c, -15, CH.torsoTop + 2, 8, 14, 3, '#4e8f3c');
        fillRound(c, -14, CH.torsoTop + 6, 6, 4, 2, shade('#4e8f3c', -25));
        break;
      case 'ribbon':
        fillEllipse(c, -6, CH.headY - CH.headR + 1, 4.5, 3.5, PAL.peach);
        fillEllipse(c, 2, CH.headY - CH.headR + 1, 4.5, 3.5, PAL.peach);
        fillEllipse(c, -2, CH.headY - CH.headR + 1, 2, 2, shade(PAL.peach, -25));
        break;
    }
  }

  function drawFace(c, cust, blink) {
    var hy = CH.headY;
    if (blink) {
      c.strokeStyle = PAL.ink;
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(-7, hy + 1); c.lineTo(-2, hy + 1); c.stroke();
      c.beginPath(); c.moveTo(2, hy + 1); c.lineTo(7, hy + 1); c.stroke();
    } else {
      fillEllipse(c, -4.5, hy + 1, 2.2, 2.8, PAL.ink, false);
      fillEllipse(c, 4.5, hy + 1, 2.2, 2.8, PAL.ink, false);
      fillEllipse(c, -3.8, hy + 0.2, 0.8, 1, '#ffffff', false);
      fillEllipse(c, 5.2, hy + 0.2, 0.8, 1, '#ffffff', false);
    }
    /* Blush */
    c.save();
    c.globalAlpha = 0.5;
    fillEllipse(c, -8, hy + 5, 3, 2, PAL.peach, false);
    fillEllipse(c, 8, hy + 5, 3, 2, PAL.peach, false);
    c.restore();
    /* Smile */
    c.beginPath();
    c.arc(0, hy + 4, 3.2, 0.15 * Math.PI, 0.85 * Math.PI);
    c.strokeStyle = PAL.ink;
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    c.stroke();
  }

  /* frame: 0..3 walk cycle (or 0 when standing). facing: 1 right, -1 left. */
  function drawCharacter(c, x, y, cust, frame, facing, scale, blink) {
    if (!cust) cust = Game.MOMOKO_DEFAULT;
    var sc = scale || 1;
    var f = facing || 1;
    c.save();
    c.translate(x, y);
    c.scale(sc * f, sc);

    var swing = 0, bob = 0;
    if (frame > 0) {
      swing = [0, 4, 0, -4][frame % 4];
      bob = [0, -1, 0, -1][frame % 4];
    }
    c.translate(0, bob);

    /* Ground shadow */
    c.save();
    c.globalAlpha = 0.16;
    fillEllipse(c, 0, 1, 13, 3.5, '#000000', false);
    c.restore();

    drawHair(c, cust, true);

    /* Legs */
    fillRound(c, -7 + swing * 0.5, CH.torsoBot, 6, 12, 3, cust.skin);
    fillRound(c, 1 - swing * 0.5, CH.torsoBot, 6, 12, 3, cust.skin);
    drawShoe(c, cust, -4 + swing * 0.5, 0);
    drawShoe(c, cust, 4 - swing * 0.5, 0);

    /* Back arm */
    fillRound(c, -13 - swing * 0.4, CH.torsoTop + 3, 5, 14, 2.5, cust.skin);

    drawOutfit(c, cust, swing);

    /* Front arm */
    fillRound(c, 8 + swing * 0.4, CH.torsoTop + 3, 5, 14, 2.5, cust.skin);

    /* Head */
    fillEllipse(c, 0, CH.headY, CH.headR, CH.headR + 0.5, cust.skin);
    drawHair(c, cust, false);
    drawFace(c, cust, blink);
    drawHat(c, cust);
    drawAccessory(c, cust);

    c.restore();
  }

  /* Head-and-shoulders chip for the designer's character picker. */
  function drawPortrait(c, cx, cy, size, cust) {
    c.save();
    c.beginPath();
    c.arc(cx, cy, size / 2, 0, Math.PI * 2);
    c.closePath();
    c.clip();
    c.fillStyle = PAL.sky;
    c.fillRect(cx - size, cy - size, size * 2, size * 2);
    var sc = size / 46;
    drawCharacter(c, cx, cy + size * 0.72, cust, 0, 1, sc, false);
    c.restore();
    c.beginPath();
    c.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ink(c, 2.5);
  }

  /* ==================================================================
     Meadow scenery
     ================================================================== */

  function drawHill(c, d) {
    c.beginPath();
    c.moveTo(d.x - d.w / 2, d.y);
    c.quadraticCurveTo(d.x, d.y - d.h, d.x + d.w / 2, d.y);
    c.closePath();
    c.fillStyle = shade(PAL.grass, -14);
    c.fill();
  }

  function drawBgTree(c, d) {
    var s = d.scale;
    var key = 'bgTree' + s.toFixed(2);
    var w = 200 * s, h = 260 * s;
    var spr = getCachedSprite(key, w, h, function (g) {
      g.save();
      g.translate(w / 2, h);
      g.scale(s, s);
      /* trunk */
      fillPath(g, [[-11, 0], [-7, -90], [7, -90], [11, 0]], shade(PAL.bark, -8));
      /* canopy: three overlapping blobs */
      fillEllipse(g, -28, -120, 40, 34, shade(PAL.leafDark, -6));
      fillEllipse(g, 30, -126, 38, 32, shade(PAL.leafDark, -6));
      fillEllipse(g, 0, -152, 48, 42, PAL.leafDark);
      g.restore();
    });
    c.drawImage(spr, d.x - w / 2, d.y - h);
  }

  function drawBush(c, d) {
    var spr = getCachedSprite('bush', 90, 56, function (g) {
      g.translate(45, 54);
      fillEllipse(g, -16, -10, 18, 15, PAL.leaf);
      fillEllipse(g, 16, -10, 18, 15, PAL.leaf);
      fillEllipse(g, 0, -18, 22, 19, PAL.leafLight);
    });
    c.drawImage(spr, d.x - 45, d.y - 54);
  }

  function drawStump(c, d) {
    var spr = getCachedSprite('stump', 60, 44, function (g) {
      g.translate(30, 42);
      fillRound(g, -16, -26, 32, 26, 5, PAL.bark);
      fillEllipse(g, 0, -26, 16, 6, PAL.barkLight);
      fillEllipse(g, 0, -26, 8, 3, shade(PAL.barkLight, -14), false);
      fillEllipse(g, 0, -26, 3, 1.2, shade(PAL.barkLight, -26), false);
    });
    c.drawImage(spr, d.x - 30, d.y - 42);
  }

  function drawRock(c, d) {
    var spr = getCachedSprite('rock', 54, 34, function (g) {
      g.translate(27, 32);
      fillPath(g, [[-20, 0], [-14, -16], [2, -22], [16, -13], [20, 0]], '#a9a29a');
      g.save();
      g.globalAlpha = 0.4;
      fillPath(g, [[-12, -14], [0, -19], [8, -12], [-2, -10]], '#cdc7bf', true, false);
      g.restore();
    });
    c.drawImage(spr, d.x - 27, d.y - 32);
  }

  var FLOWER_COLORS = ['#ff9ec4', '#ffd24a', '#fff4dc', '#b06aa8', '#8fd0e8'];
  function drawFlowers(c, d) {
    var n = d.n || 4;
    var key = 'flowers' + n;
    var w = n * 18 + 10, h = 30;
    var spr = getCachedSprite(key, w, h, function (g) {
      for (var i = 0; i < n; i++) {
        var fx = 10 + i * 18;
        var col = FLOWER_COLORS[(i * 3) % FLOWER_COLORS.length];
        g.strokeStyle = PAL.grassDark;
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(fx, h); g.lineTo(fx, h - 13); g.stroke();
        for (var p = 0; p < 5; p++) {
          var a = (Math.PI * 2 / 5) * p;
          fillEllipse(g, fx + Math.cos(a) * 3.4, (h - 16) + Math.sin(a) * 3.4, 2.6, 2.6, col, false);
        }
        fillEllipse(g, fx, h - 16, 1.9, 1.9, PAL.sun, false);
      }
    });
    c.drawImage(spr, d.x - w / 2, d.y - h);
  }

  function drawMushroom(c, d) {
    var spr = getCachedSprite('mushroom', 34, 30, function (g) {
      g.translate(17, 28);
      fillRound(g, -4, -12, 8, 12, 3, PAL.cream);
      fillPath(g, [[-13, -11], [-8, -20], [8, -20], [13, -11]], '#d9534f');
      fillEllipse(g, -5, -14, 2.4, 1.8, PAL.cream, false);
      fillEllipse(g, 4, -16, 2, 1.6, PAL.cream, false);
    });
    c.drawImage(spr, d.x - 17, d.y - 28);
  }

  function drawSignpost(c, d) {
    var spr = getCachedSprite('signpost', 76, 76, function (g) {
      g.translate(38, 74);
      fillRound(g, -3, -56, 6, 56, 2, PAL.bark);
      fillRound(g, -30, -56, 60, 22, 4, PAL.barkLight);
      g.fillStyle = PAL.ink;
      g.font = 'bold 12px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('SHOP', -8, -45);
      /* arrow pointing back down the path */
      fillPath(g, [[14, -50], [24, -45], [14, -40]], PAL.ink, true, false);
    });
    c.drawImage(spr, d.x - 38, d.y - 74);
  }

  function drawMeadowDecor(c, d) {
    switch (d.type) {
      case 'hill': drawHill(c, d); break;
      case 'bgTree': drawBgTree(c, d); break;
      case 'bush': drawBush(c, d); break;
      case 'stump': drawStump(c, d); break;
      case 'rock': drawRock(c, d); break;
      case 'flowers': drawFlowers(c, d); break;
      case 'mushroom': drawMushroom(c, d); break;
      case 'signpost': drawSignpost(c, d); break;
    }
  }

  /* ---- The shop building ---- */
  function drawShop(c, x, groundY, t) {
    var w = 300, h = 210;
    var left = x - w / 2;
    var top = groundY - h;

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

    /* roof */
    fillPath(c, [[left - 16, top + 50], [x, top - 6], [left + w + 16, top + 50]], '#8a6340');
    /* roof shingles */
    c.save();
    c.globalAlpha = 0.35;
    c.strokeStyle = PAL.ink;
    c.lineWidth = 1.2;
    for (var r = 1; r <= 3; r++) {
      var ry = top + 50 - r * 13;
      var half = (w / 2 + 16) * (1 - (r * 13) / 56);
      c.beginPath(); c.moveTo(x - half, ry); c.lineTo(x + half, ry); c.stroke();
    }
    c.restore();

    /* sign board */
    fillRound(c, x - 96, top + 56, 192, 30, 6, '#c05a48');
    c.fillStyle = PAL.cream;
    c.font = 'bold 15px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('ACORN & PLANK', x, top + 72);

    /* window */
    fillRound(c, left + 24, top + 100, 74, 56, 5, '#bfe6f2');
    c.strokeStyle = PAL.ink;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(left + 61, top + 100); c.lineTo(left + 61, top + 156);
    c.moveTo(left + 24, top + 128); c.lineTo(left + 98, top + 128);
    c.stroke();
    /* stacked planks visible through the window */
    fillRound(c, left + 30, top + 138, 26, 5, 2, PAL.barkLight, false);
    fillRound(c, left + 66, top + 140, 26, 5, 2, PAL.bark, false);

    /* door */
    var doorW = 62, doorH = 96;
    var dx = x + 58 - doorW / 2;
    var dy = groundY - doorH;
    fillRound(c, dx, dy, doorW, doorH, 6, '#a9773f');
    fillRound(c, dx + 7, dy + 8, doorW - 14, 34, 4, '#c69a5e');
    fillEllipse(c, dx + doorW - 13, dy + doorH / 2, 3.4, 3.4, PAL.sun);

    /* awning */
    var sway = Math.sin(t / 40) * 1.5;
    for (var i = 0; i < 5; i++) {
      var ax = left + 12 + i * 56;
      fillPath(c, [[ax, top + 92], [ax + 56, top + 92], [ax + 46 + sway, top + 112], [ax + 10 + sway, top + 112]],
        i % 2 === 0 ? '#c05a48' : PAL.cream);
    }

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

  /* ==================================================================
     Player / friend movement
     ================================================================== */
  function Walker(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.facing = 1;
    this.frame = 0;
    this.animTimer = 0;
    this.blinkTimer = Math.floor(Math.random() * 200);
    this.blink = false;
  }
  Walker.prototype.animate = function (moving) {
    if (moving) {
      this.animTimer++;
      if (this.animTimer >= 7) {
        this.animTimer = 0;
        this.frame = (this.frame % 4) + 1;
      }
    } else {
      this.frame = 0;
      this.animTimer = 0;
    }
    this.blinkTimer--;
    if (this.blinkTimer <= 0) {
      this.blink = !this.blink;
      this.blinkTimer = this.blink ? 8 : 120 + Math.floor(Math.random() * 180);
    }
  };

  var SPEED = 3.2;

  function Player(x, y) { Walker.call(this, x, y); }
  Player.prototype = Object.create(Walker.prototype);
  Player.prototype.constructor = Player;
  Player.prototype.update = function (keys, minX, maxX) {
    var moving = false;
    if (keys.left && !keys.right) { this.x -= SPEED; this.facing = -1; moving = true; }
    else if (keys.right && !keys.left) { this.x += SPEED; this.facing = 1; moving = true; }
    if (this.x < minX) this.x = minX;
    if (this.x > maxX) this.x = maxX;
    this.animate(moving);
  };
  Player.prototype.draw = function (c, cust) {
    drawCharacter(c, this.x, this.y, cust, this.frame, this.facing, 1, this.blink);
  };

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
  Friend.prototype.draw = function (c, cust) {
    drawCharacter(c, this.x, this.y, cust, this.frame, this.facing, 1, this.blink);
  };

  window.Game.entities = {
    getCachedSprite: getCachedSprite,
    ink: ink,
    roundRect: roundRect,
    fillRound: fillRound,
    fillEllipse: fillEllipse,
    fillPath: fillPath,
    shade: shade,
    star: star,
    drawCharacter: drawCharacter,
    drawPortrait: drawPortrait,
    drawMeadowDecor: drawMeadowDecor,
    drawShop: drawShop,
    drawMaterialIcon: drawMaterialIcon,
    Particle: Particle,
    spawnBurst: spawnBurst,
    Player: Player,
    Friend: Friend,
  };
})();
