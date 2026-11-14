/* tree.js – the big tree and the tree house built into it.
 *
 * Painted as independent layers with a fixed paint order. drawTree() is
 * told which stages are done and paints only those, plus an optional
 * translucent ghost of the next one so the goal is always visible on the
 * tree itself. Style axes (wall material, roof style, door, window) are
 * separate painters sharing anchor points, so 4x4x4x4 looks cost four
 * painters rather than 256 cases.
 */
(function () {
  'use strict';
  window.Game = window.Game || {};
  var PAL = Game.PAL;
  var E = Game.entities;

  /* Paint order is fixed by geometry, not by the order stages are built
     (the ladder is built before the door but is painted in front of it). */
  var PAINT_ORDER = ['platform', 'walls', 'roof', 'openings', 'extras', 'ladder'];

  /* All layout in one place so every layer and every decoration agrees. */
  function anchors(x, groundY) {
    var platformY = groundY - 150;
    var houseW = 180, houseH = 104;
    var houseX = x - houseW / 2;
    var houseTop = platformY - houseH;
    return {
      x: x, groundY: groundY,
      trunkTop: groundY - 284,
      platformY: platformY,
      platformW: 214,
      platformH: 14,
      houseX: houseX, houseTop: houseTop, houseW: houseW, houseH: houseH,
      roofH: 46,
      doorCx: x + 50, doorW: 42, doorH: 64,
      win1Cx: x - 54, win2Cx: x - 6, winCy: houseTop + 42, winSize: 34,
      ladderX: x - 118, ladderW: 30,
      branchL: { x: x - 96, y: groundY - 214 },
      branchR: { x: x + 104, y: groundY - 196 },
    };
  }
  Game.treeAnchors = anchors;

  /* ---- Base tree (always painted) ---- */

  /* One clump of foliage: shaded underside, sunlit top-left and a few
     leaf scallops, so the canopy reads as rounded masses rather than
     flat discs. The light comes from the upper left, like the sun. */
  var LEAVES_LIT = [[-0.52, -0.2], [-0.12, -0.6], [0.3, -0.38], [-0.3, 0.1], [0.08, -0.12], [-0.62, 0.22]];
  var LEAVES_DARK = [[0.3, 0.36], [-0.1, 0.52], [0.58, 0.12], [0.02, 0.26]];
  function leafClump(c, cx, cy, rx, ry, col) {
    var deep = E.mix(col, '#0f3f4a', 0.5);
    E.fillEllipse(c, cx, cy, rx, ry, col, false);
    c.save();
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    c.clip();
    /* cool shaded belly in two steps, then a warm sunlit cap */
    E.fillEllipse(c, cx + rx * 0.18, cy + ry * 0.52, rx * 1.1, ry * 0.7, E.mix(col, '#0f3f4a', 0.24), false);
    E.fillEllipse(c, cx + rx * 0.3, cy + ry * 0.86, rx * 1.05, ry * 0.56, deep, false);
    E.fillEllipse(c, cx - rx * 0.26, cy - ry * 0.4, rx * 0.62, ry * 0.44, E.mix(col, '#e6f27a', 0.22), false);
    E.fillEllipse(c, cx - rx * 0.34, cy - ry * 0.52, rx * 0.36, ry * 0.24, E.mix(col, '#f2f79a', 0.42), false);
    var lr = Math.max(3, rx * 0.09), i;
    c.fillStyle = E.mix(col, '#f2f79a', 0.5);
    for (i = 0; i < LEAVES_LIT.length; i++) {
      c.beginPath();
      c.arc(cx + LEAVES_LIT[i][0] * rx, cy + LEAVES_LIT[i][1] * ry, lr, Math.PI, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = E.mix(col, '#0f3f4a', 0.62);
    for (i = 0; i < LEAVES_DARK.length; i++) {
      c.beginPath();
      c.arc(cx + LEAVES_DARK[i][0] * rx, cy + LEAVES_DARK[i][1] * ry, lr, 0, Math.PI);
      c.fill();
    }
    /* rim light where the sun catches the upper-left edge */
    c.beginPath();
    c.ellipse(cx, cy, rx - 2.5, ry - 2.5, 0, Math.PI * 0.95, Math.PI * 1.6);
    c.strokeStyle = 'rgba(240, 250, 170, 0.55)';
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    c.stroke();
    c.restore();
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    E.ink(c, 2, E.LEAF_INK);
  }

  function canopyBack(c, a) {
    var x = a.x, g = a.groundY;
    /* the deep heart of the crown, seen between the clumps */
    E.fillEllipse(c, x + 4, g - 286, 138, 78, '#234f33', false);
    leafClump(c, x - 96, g - 268, 66, 52, PAL.leafDark);
    leafClump(c, x + 100, g - 258, 62, 50, PAL.leafDark);
    leafClump(c, x - 34, g - 316, 76, 60, PAL.leaf);
    leafClump(c, x + 52, g - 322, 70, 56, PAL.leaf);
    leafClump(c, x + 6, g - 352, 62, 48, PAL.leafLight);
  }

  function canopyFront(c, a, t) {
    var x = a.x, g = a.groundY;
    var sway = Math.sin(t / 70) * 2;
    leafClump(c, x - 118 + sway, g - 300, 42, 32, PAL.leafLight);
    leafClump(c, x + 126 - sway, g - 288, 38, 30, PAL.leafLight);
  }

  function trunk(c, a) {
    var x = a.x, g = a.groundY;
    /* Root flare, then a tapering trunk. */
    var outline = [
      [x - 46, g], [x - 34, g - 40], [x - 28, a.trunkTop + 40], [x - 20, a.trunkTop],
      [x + 20, a.trunkTop], [x + 28, a.trunkTop + 40], [x + 34, g - 40], [x + 46, g],
    ];
    E.fillPath(c, outline, PAL.bark, true, false);
    /* Round it off: warm sun on the left, cool shade on the right. */
    var sh = c.createLinearGradient(x - 40, 0, x + 40, 0);
    sh.addColorStop(0, 'rgba(255, 214, 150, 0.38)');
    sh.addColorStop(0.3, 'rgba(255, 214, 150, 0.08)');
    sh.addColorStop(0.52, 'rgba(40, 24, 70, 0.06)');
    sh.addColorStop(1, 'rgba(40, 24, 70, 0.5)');
    E.fillPath(c, outline, sh, true, false);
    /* The crown shades the top of the trunk. */
    var ao = c.createLinearGradient(0, a.trunkTop, 0, a.trunkTop + 120);
    ao.addColorStop(0, 'rgba(24, 30, 50, 0.55)');
    ao.addColorStop(1, 'rgba(24, 30, 50, 0)');
    E.fillPath(c, outline, ao, true, false);
    E.fillPath(c, outline, 'rgba(0,0,0,0)');

    /* Bark grain */
    c.save();
    c.lineCap = 'round';
    for (var i = 0; i < 4; i++) {
      var bx = x - 20 + i * 13;
      c.globalAlpha = 0.42;
      c.strokeStyle = '#3d2618';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(bx, g - 16);
      c.quadraticCurveTo(bx + 6, g - 130, bx - 2, a.trunkTop + 20);
      c.stroke();
      /* each furrow has a lit lip on its sunny side */
      c.globalAlpha = 0.2;
      c.strokeStyle = '#ffdfae';
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(bx - 2.2, g - 18);
      c.quadraticCurveTo(bx + 3.8, g - 130, bx - 4.2, a.trunkTop + 60);
      c.stroke();
    }
    c.restore();

    /* A knot-hole, because every storybook tree has one. */
    E.fillEllipse(c, x - 12, g - 74, 9, 12, PAL.barkDark);
    c.save();
    c.globalAlpha = 0.5;
    E.fillEllipse(c, x - 12, g - 74, 4.5, 6, '#2e1d0e', false);
    c.restore();

    /* Grass tuft over the roots */
    E.fillEllipse(c, x - 36, g + 2, 26, 8, '#3f8f3a', false);
    E.fillEllipse(c, x + 36, g + 2, 26, 8, '#2f7d38', false);
    E.fillEllipse(c, x - 40, g - 1, 16, 4, 'rgba(176, 228, 104, 0.6)', false);
  }

  function branches(c, a) {
    var x = a.x, g = a.groundY;
    /* Left branch */
    E.fillPath(c, [
      [x - 24, g - 196], [a.branchL.x - 22, a.branchL.y - 6],
      [a.branchL.x - 22, a.branchL.y + 6], [x - 22, g - 182],
    ], PAL.barkLight);
    /* Right branch */
    E.fillPath(c, [
      [x + 22, g - 180], [a.branchR.x + 24, a.branchR.y - 5],
      [a.branchR.x + 24, a.branchR.y + 7], [x + 24, g - 166],
    ], E.mix(PAL.barkLight, E.COOL, 0.22));
    /* underside in shade */
    c.save();
    c.globalAlpha = 0.3;
    E.fillPath(c, [[x - 22, g - 187], [a.branchL.x - 22, a.branchL.y + 1],
                   [a.branchL.x - 22, a.branchL.y + 6], [x - 22, g - 182]], E.COOL, true, false);
    E.fillPath(c, [[x + 23, g - 171], [a.branchR.x + 24, a.branchR.y + 2],
                   [a.branchR.x + 24, a.branchR.y + 7], [x + 24, g - 166]], E.COOL, true, false);
    c.restore();
  }

  /* ---- Stage layers ---- */

  function layerPlatform(c, a) {
    var x = a.x;
    var pw = a.platformW, ph = a.platformH;
    /* Support struts angling back into the trunk */
    E.fillPath(c, [[x - 78, a.platformY + ph], [x - 22, a.platformY + 54],
                   [x - 12, a.platformY + 54], [x - 66, a.platformY + ph]], PAL.bark);
    E.fillPath(c, [[x + 78, a.platformY + ph], [x + 22, a.platformY + 54],
                   [x + 12, a.platformY + 54], [x + 66, a.platformY + ph]], PAL.bark);
    /* The deck shades the trunk and struts beneath it. */
    var ds = c.createLinearGradient(0, a.platformY + ph, 0, a.platformY + ph + 46);
    ds.addColorStop(0, 'rgba(30, 20, 56, 0.5)');
    ds.addColorStop(1, 'rgba(30, 20, 56, 0)');
    c.fillStyle = ds;
    c.beginPath();
    c.moveTo(x - 80, a.platformY + ph); c.lineTo(x + 80, a.platformY + ph);
    c.lineTo(x + 30, a.platformY + ph + 46); c.lineTo(x - 30, a.platformY + ph + 46);
    c.closePath();
    c.fill();
    /* Deck: lit top edge, shaded lower edge */
    var dg = c.createLinearGradient(0, a.platformY, 0, a.platformY + ph);
    dg.addColorStop(0, E.mix(PAL.barkLight, E.WARM, 0.3));
    dg.addColorStop(0.35, PAL.barkLight);
    dg.addColorStop(1, E.mix(PAL.barkLight, E.COOL, 0.38));
    E.fillRound(c, x - pw / 2, a.platformY, pw, ph, 4, dg);
    c.strokeStyle = E.shade(PAL.barkLight, -34);
    c.lineWidth = 1.4;
    for (var i = 1; i < 7; i++) {
      var px = x - pw / 2 + (pw / 7) * i;
      c.beginPath(); c.moveTo(px, a.platformY + 2); c.lineTo(px, a.platformY + ph - 2); c.stroke();
    }
    /* Little railing at the deck edges */
    E.fillRound(c, x - pw / 2 - 2, a.platformY - 22, 5, 24, 2, PAL.bark);
    E.fillRound(c, x + pw / 2 - 3, a.platformY - 22, 5, 24, 2, PAL.bark);
    E.fillRound(c, x - pw / 2 - 2, a.platformY - 22, pw + 4, 5, 2, PAL.bark);
  }

  /* Leaf shadows and coins of sunlight lying across the house: the crown
     overhead filters the light. Offsets are fractions of the box, and the
     whole pattern breathes sideways with the breeze. Caller clips. */
  var DAPPLE = [[0.08, 0.3, 15, 9, 0], [0.3, 0.62, 19, 10, 1], [0.52, 0.2, 13, 8, 0], [0.7, 0.5, 20, 11, 0],
                [0.9, 0.24, 14, 9, 1], [0.18, 0.84, 16, 8, 1], [0.6, 0.86, 15, 8, 0], [0.42, 0.42, 11, 7, 1],
                [0.82, 0.8, 13, 7, 1]];
  function dapple(c, x, y, w, h, t, strength) {
    if (!E.fxOn('dapple')) return;
    var ga = c.globalAlpha;
    for (var i = 0; i < DAPPLE.length; i++) {
      var d = DAPPLE[i];
      var dx = x + d[0] * w + Math.sin(t / 60 + i * 1.3) * 3;
      var dy = y + d[1] * h + Math.cos(t / 75 + i) * 1.5;
      c.globalAlpha = ga * strength * (d[4] ? 0.24 : 0.11);
      E.fillEllipse(c, dx, dy, d[2], d[3], d[4] ? '#fff2b0' : '#1c2a56', false);
      if (d[4]) {
        c.globalAlpha = ga * strength * 0.3;
        E.fillEllipse(c, dx - 1, dy - 1, d[2] * 0.5, d[3] * 0.5, '#fffbe0', false);
      }
    }
    c.globalAlpha = ga;
  }

  function layerWalls(c, a, ext, t) {
    var col = ext.wallColor;
    var hx = a.houseX, hy = a.houseTop, hw = a.houseW, hh = a.houseH;
    E.fillRound(c, hx, hy, hw, hh, 5, col);

    c.save();
    c.beginPath();
    E.roundRect(c, hx + 1, hy + 1, hw - 2, hh - 2, 4);
    c.clip();
    switch (ext.wallMat) {
      case 'plank':
        for (var y = hy + 12, pr = 0; y < hy + hh; y += 12, pr++) {
          /* every other board a touch different, a lit lip under each seam */
          if (pr % 2) { c.fillStyle = 'rgba(90, 50, 20, 0.07)'; c.fillRect(hx, y, hw, 12); }
          c.strokeStyle = E.mix(col, '#4a1f18', 0.42);
          c.lineWidth = 1.6;
          c.beginPath(); c.moveTo(hx, y); c.lineTo(hx + hw, y); c.stroke();
          c.strokeStyle = 'rgba(255, 240, 200, 0.4)';
          c.lineWidth = 1;
          c.beginPath(); c.moveTo(hx, y + 1.6); c.lineTo(hx + hw, y + 1.6); c.stroke();
          /* board ends, staggered */
          c.strokeStyle = E.mix(col, '#4a1f18', 0.3);
          c.lineWidth = 1.2;
          var bx0 = hx + 34 + (pr * 67) % 110;
          c.beginPath(); c.moveTo(bx0, y - 12); c.lineTo(bx0, y); c.stroke();
        }
        break;
      case 'log':
        for (var ly = hy + 10; ly < hy + hh + 10; ly += 20) {
          E.fillEllipse(c, hx + hw / 2, ly, hw / 2 + 4, 10, E.shade(col, 6), false);
          c.save();
          c.globalAlpha = 0.3;
          E.fillEllipse(c, hx + hw / 2, ly - 4, hw / 2, 3.5, E.shade(col, 26), false);
          c.restore();
          c.strokeStyle = E.shade(col, -26);
          c.lineWidth = 1.4;
          c.beginPath(); c.ellipse(hx + hw / 2, ly, hw / 2 + 4, 10, 0, 0, Math.PI * 2); c.stroke();
        }
        break;
      case 'shingle':
        for (var sy = hy + 4, row = 0; sy < hy + hh + 12; sy += 11, row++) {
          for (var sx = hx - 10 + (row % 2) * 10; sx < hx + hw + 10; sx += 20) {
            c.beginPath();
            c.moveTo(sx, sy + 11);
            c.lineTo(sx, sy + 4);
            c.quadraticCurveTo(sx + 10, sy - 3, sx + 20, sy + 4);
            c.lineTo(sx + 20, sy + 11);
            c.closePath();
            c.fillStyle = E.shade(col, row % 2 === 0 ? -4 : 4);
            c.fill();
            c.strokeStyle = E.shade(col, -24);
            c.lineWidth = 1;
            c.stroke();
          }
        }
        break;
      case 'stucco':
        c.save();
        c.globalAlpha = 0.18;
        for (var d = 0; d < 90; d++) {
          var dx = hx + ((d * 53) % hw);
          var dy = hy + ((d * 31) % hh);
          E.fillEllipse(c, dx, dy, 2.4, 2.4, E.shade(col, -40), false);
        }
        c.restore();
        break;
    }
    /* Light: warm from the left, cool shade to the right and toward the
       deck, then the dapple from the leaves overhead. */
    var lg = c.createLinearGradient(hx, 0, hx + hw, 0);
    lg.addColorStop(0, 'rgba(255, 236, 170, 0.26)');
    lg.addColorStop(0.4, 'rgba(255, 236, 170, 0)');
    lg.addColorStop(0.62, 'rgba(42, 30, 96, 0)');
    lg.addColorStop(1, 'rgba(42, 30, 96, 0.3)');
    c.fillStyle = lg;
    c.fillRect(hx, hy, hw, hh);
    var bg = c.createLinearGradient(0, hy + hh - 26, 0, hy + hh);
    bg.addColorStop(0, 'rgba(42, 30, 96, 0)');
    bg.addColorStop(1, 'rgba(42, 30, 96, 0.2)');
    c.fillStyle = bg;
    c.fillRect(hx, hy + hh - 26, hw, 26);
    dapple(c, hx, hy, hw, hh, t || 0, 1);
    c.restore();

    E.roundRect(c, hx, hy, hw, hh, 5);
    E.ink(c, 2.5, E.inkOf(col));

    /* Corner posts read as timber framing whatever the wall material. */
    var pg = c.createLinearGradient(hx - 3, 0, hx + 5, 0);
    pg.addColorStop(0, PAL.barkLight);
    pg.addColorStop(1, PAL.barkDark);
    E.fillRound(c, hx - 3, hy, 8, hh, 3, pg);
    c.translate(hw - 2, 0);
    E.fillRound(c, hx - 3, hy, 8, hh, 3, pg);
    c.translate(-(hw - 2), 0);
  }

  /* Sun on the left slope, cool shade on the right, a bright ridge, and
     the leaf dapple -- over whatever is inside the current clip. */
  function roofLight(c, x, eaveL, eaveR, top, bottom, t) {
    var g = c.createLinearGradient(eaveL, 0, eaveR, 0);
    g.addColorStop(0, 'rgba(255, 232, 170, 0.34)');
    g.addColorStop(0.46, 'rgba(255, 232, 170, 0.1)');
    g.addColorStop(0.54, 'rgba(42, 30, 96, 0.12)');
    g.addColorStop(1, 'rgba(42, 30, 96, 0.4)');
    c.fillStyle = g;
    c.fillRect(eaveL, top - 30, eaveR - eaveL, bottom - top + 40);
    dapple(c, eaveL + 20, top, eaveR - eaveL - 40, bottom - top, t + 140, 0.9);
  }

  function layerRoof(c, a, ext, t) {
    var x = a.x, hx = a.houseX, hy = a.houseTop, hw = a.houseW;
    var col = ext.roofColor;
    var eaveL = hx - 16, eaveR = hx + hw + 16;
    var apex = hy - a.roofH;
    var roofInk = E.inkOf(col);
    var chimney = ext.roofStyle === 'gable' || ext.roofStyle === 'round';
    if (part === 2) {
      if (chimney) chimneySmoke(c, x + 50, apex - 2, t);
      return;
    }

    /* The eave throws a band of shade across the top of the wall. */
    var es = c.createLinearGradient(0, hy + 8, 0, hy + 26);
    es.addColorStop(0, 'rgba(42, 26, 84, 0.42)');
    es.addColorStop(1, 'rgba(42, 26, 84, 0)');
    c.fillStyle = es;
    c.fillRect(hx + 5, hy + 8, hw - 10, 18);

    switch (ext.roofStyle) {
      case 'gable':
        E.fillPath(c, [[eaveL, hy + 4], [x, apex], [eaveR, hy + 4]], col, true, false);
        c.save();
        c.beginPath(); c.moveTo(eaveL, hy + 4); c.lineTo(x, apex); c.lineTo(eaveR, hy + 4); c.closePath();
        c.clip();
        /* scalloped tile courses */
        c.strokeStyle = E.mix(col, '#3a1030', 0.45);
        c.lineWidth = 1.2;
        for (var r = 0; r <= 4; r++) {
          var ry = hy + 4 - r * 10;
          c.beginPath();
          for (var tx = eaveL - 10 + (r % 2) * 8; tx < eaveR; tx += 16) {
            c.moveTo(tx, ry - 10);
            c.quadraticCurveTo(tx + 1, ry - 1, tx + 8, ry - 1);
            c.quadraticCurveTo(tx + 15, ry - 1, tx + 16, ry - 10);
          }
          c.stroke();
        }
        roofLight(c, x, eaveL, eaveR, apex, hy + 4, t);
        c.restore();
        c.beginPath(); c.moveTo(eaveL, hy + 4); c.lineTo(x, apex); c.lineTo(eaveR, hy + 4); c.closePath();
        E.ink(c, 2.5, roofInk);
        /* ridge highlight down the sunny slope */
        c.strokeStyle = 'rgba(255, 244, 210, 0.6)';
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(x - 4, apex + 5); c.lineTo(eaveL + 16, hy + 0.5); c.stroke();
        break;
      case 'round':
        c.beginPath();
        c.moveTo(eaveL, hy + 4);
        c.quadraticCurveTo(x, apex - 22, eaveR, hy + 4);
        c.closePath();
        c.fillStyle = col;
        c.fill();
        c.save();
        c.clip();
        c.globalAlpha = 0.4;
        c.strokeStyle = roofInk;
        c.lineWidth = 1.3;
        for (var q = 1; q <= 3; q++) {
          c.beginPath();
          c.moveTo(eaveL + q * 12, hy + 4);
          c.quadraticCurveTo(x, apex - 22 + q * 12, eaveR - q * 12, hy + 4);
          c.stroke();
        }
        c.globalAlpha = 1;
        roofLight(c, x, eaveL, eaveR, apex - 12, hy + 4, t);
        c.restore();
        c.beginPath();
        c.moveTo(eaveL, hy + 4);
        c.quadraticCurveTo(x, apex - 22, eaveR, hy + 4);
        c.closePath();
        E.ink(c, 2.5, roofInk);
        break;
      case 'thatch':
        c.beginPath();
        c.moveTo(eaveL, hy + 8);
        c.quadraticCurveTo(x - 40, apex + 6, x, apex - 4);
        c.quadraticCurveTo(x + 40, apex + 6, eaveR, hy + 8);
        c.closePath();
        c.fillStyle = '#e0c06e';
        c.fill();
        E.ink(c, 2.5, '#7a5a2a');
        c.save();
        c.clip();
        roofLight(c, x, eaveL, eaveR, apex - 4, hy + 8, t);
        c.globalAlpha = 0.5;
        c.strokeStyle = '#a98d4e';
        c.lineWidth = 1.4;
        for (var s = 0; s < 14; s++) {
          var sx = eaveL + 8 + s * ((eaveR - eaveL - 16) / 13);
          c.beginPath();
          c.moveTo(sx, hy + 8);
          c.quadraticCurveTo(sx + (x - sx) * 0.3, hy - 16, x + (sx - x) * 0.25, apex + 4);
          c.stroke();
        }
        c.restore();
        break;
      case 'garden':
        E.fillPath(c, [[eaveL, hy + 4], [eaveL + 14, apex + 10], [eaveR - 14, apex + 10], [eaveR, hy + 4]], PAL.bark);
        E.fillPath(c, [[eaveL + 2, apex + 16], [eaveL + 16, apex + 4], [eaveR - 16, apex + 4], [eaveR - 2, apex + 16]], PAL.grassDark);
        for (var gi = 0; gi < 7; gi++) {
          var gx = eaveL + 18 + gi * ((eaveR - eaveL - 36) / 6);
          E.fillEllipse(c, gx, apex + 4, 8, 7, PAL.leafLight, false);
          if (gi % 2 === 0) E.fillEllipse(c, gx, apex, 3.4, 3.4, PAL.peach, false);
        }
        c.strokeStyle = PAL.ink;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(eaveL, hy + 4); c.lineTo(eaveL + 14, apex + 10);
        c.lineTo(eaveR - 14, apex + 10); c.lineTo(eaveR, hy + 4);
        c.stroke();
        break;
    }

    /* Fascia board tidies the eave line for every style. */
    var fg = c.createLinearGradient(eaveL, 0, eaveR, 0);
    fg.addColorStop(0, E.shade(col, -10));
    fg.addColorStop(1, E.mix(E.shade(col, -30), E.COOL, 0.3));
    E.fillRound(c, eaveL - 2, hy + 2, (eaveR - eaveL) + 4, 8, 3, fg, false);
    c.fillStyle = 'rgba(255, 240, 210, 0.35)';
    c.fillRect(eaveL + 1, hy + 3, (eaveR - eaveL) * 0.55, 1.6);
    E.roundRect(c, eaveL - 2, hy + 2, (eaveR - eaveL) + 4, 8, 3);
    E.ink(c, 2, roofInk);

    /* A little chimney on the pitched roofs, with a lazy curl of smoke,
       so the house looks lived in from the moment the roof goes on. */
    if (chimney) {
      var cx = x + 50;
      var top = apex - 2;
      if (part === 0) chimneySmoke(c, cx, top, t);
      var cg = c.createLinearGradient(cx - 7, 0, cx + 7, 0);
      cg.addColorStop(0, '#d8705a');
      cg.addColorStop(1, '#8f3d4a');
      E.fillRound(c, cx - 7, top, 14, 30, 2, cg);
      E.fillRound(c, cx - 9, top - 3, 18, 6, 2, E.shade('#c05a48', -18));
    }
  }

  function chimneySmoke(c, cx, top, t) {
    c.save();
    c.globalAlpha = 0.5;
    var puff = Math.sin(t / 50) * 2;
    E.fillEllipse(c, cx + 4 + puff, top - 12, 5, 4, PAL.cream, false);
    E.fillEllipse(c, cx + 9 - puff, top - 21, 4, 3.4, PAL.cream, false);
    E.fillEllipse(c, cx + 13 + puff * 0.5, top - 29, 3, 2.6, PAL.cream, false);
    c.restore();
  }

  function layerOpenings(c, a, ext) {
    drawDoor(c, a, ext);
    drawWindow(c, a, ext, a.win1Cx);
    drawWindow(c, a, ext, a.win2Cx);
  }

  function drawDoor(c, a, ext) {
    var cx = a.doorCx, w = a.doorW, h = a.doorH;
    var bottom = a.platformY;
    var top = bottom - h;
    var wood = '#a9773f';

    switch (ext.door) {
      case 'round':
        c.beginPath();
        c.moveTo(cx - w / 2, bottom);
        c.lineTo(cx - w / 2, top + w / 2);
        c.arc(cx, top + w / 2, w / 2, Math.PI, 0);
        c.lineTo(cx + w / 2, bottom);
        c.closePath();
        c.fillStyle = wood;
        c.fill();
        E.ink(c, 2.5);
        break;
      case 'arched':
        c.beginPath();
        c.moveTo(cx - w / 2, bottom);
        c.lineTo(cx - w / 2, top + 16);
        c.quadraticCurveTo(cx, top - 12, cx + w / 2, top + 16);
        c.lineTo(cx + w / 2, bottom);
        c.closePath();
        c.fillStyle = wood;
        c.fill();
        E.ink(c, 2.5);
        break;
      case 'dutch':
        E.fillRound(c, cx - w / 2, top, w, h / 2 - 2, 4, wood);
        E.fillRound(c, cx - w / 2, top + h / 2 + 2, w, h / 2 - 2, 4, E.shade(wood, -10));
        break;
      case 'heart':
        E.fillRound(c, cx - w / 2, top, w, h, 5, wood);
        c.beginPath();
        var hy0 = top + 20;
        c.moveTo(cx, hy0 + 11);
        c.bezierCurveTo(cx - 13, hy0 - 1, cx - 7, hy0 - 12, cx, hy0 - 5);
        c.bezierCurveTo(cx + 7, hy0 - 12, cx + 13, hy0 - 1, cx, hy0 + 11);
        c.closePath();
        c.fillStyle = PAL.sky;
        c.fill();
        E.ink(c, 2);
        break;
    }

    /* Panel + knob, shared by every door shape. */
    if (ext.door !== 'heart') {
      E.fillRound(c, cx - w / 2 + 7, top + h * 0.42, w - 14, h * 0.4, 3, E.shade(wood, 14));
      /* recessed: shade along the top and left inside edge */
      c.strokeStyle = 'rgba(60, 28, 40, 0.35)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx - w / 2 + 9, top + h * 0.82 - 2); c.lineTo(cx - w / 2 + 9, top + h * 0.42 + 2.5);
      c.lineTo(cx + w / 2 - 9, top + h * 0.42 + 2.5);
      c.stroke();
    }
    /* the door stands in the shade of its frame on the right */
    c.fillStyle = 'rgba(42, 26, 84, 0.2)';
    c.fillRect(cx + w / 2 - 8, top + h * 0.34, 6.8, h * 0.66 - 4);
    c.fillStyle = 'rgba(255, 236, 190, 0.3)';
    c.fillRect(cx - w / 2 + 1.5, top + h * 0.34, 3, h * 0.66 - 4);
    E.fillEllipse(c, cx + w / 2 - 9, bottom - h / 2, 3.6, 3.6, ext.trimColor);
    E.fillEllipse(c, cx + w / 2 - 10, bottom - h / 2 - 1.2, 1.2, 1.2, '#ffffff', false);
    /* Doorstep */
    E.fillRound(c, cx - w / 2 - 4, bottom - 3, w + 8, 6, 3, PAL.bark);
  }

  function drawWindow(c, a, ext, cx) {
    var cy = a.winCy;
    var s = a.winSize;
    var frame = PAL.cream;
    /* Glass: sky reflected up top, the warm room showing through below. */
    var GLASS = c.createLinearGradient(0, cy - s / 2, 0, cy + s / 2);
    GLASS.addColorStop(0, '#8fd3f6');
    GLASS.addColorStop(0.5, '#cdeefa');
    GLASS.addColorStop(1, '#ffe9a8');
    switch (ext.windowStyle) {
      case 'square':
        E.fillRound(c, cx - s / 2 - 3, cy - s / 2 - 3, s + 6, s + 6, 4, frame);
        E.fillRound(c, cx - s / 2, cy - s / 2, s, s, 2, GLASS);
        break;
      case 'round':
        E.fillEllipse(c, cx, cy, s / 2 + 4, s / 2 + 4, frame);
        E.fillEllipse(c, cx, cy, s / 2, s / 2, GLASS);
        break;
      case 'diamond':
        E.fillPath(c, [[cx, cy - s / 2 - 4], [cx + s / 2 + 4, cy], [cx, cy + s / 2 + 4], [cx - s / 2 - 4, cy]], frame);
        E.fillPath(c, [[cx, cy - s / 2], [cx + s / 2, cy], [cx, cy + s / 2], [cx - s / 2, cy]], GLASS);
        break;
      case 'bay':
        E.fillPath(c, [[cx - s / 2 - 6, cy - s / 2 - 3], [cx + s / 2 + 6, cy - s / 2 - 3],
                       [cx + s / 2 + 1, cy + s / 2 + 3], [cx - s / 2 - 1, cy + s / 2 + 3]], frame);
        E.fillRound(c, cx - s / 2, cy - s / 2, s, s, 2, GLASS);
        break;
    }
    /* Curtains in the trim colour, gathered to each side, drawn on the
       glass before the muntins so the bars sit over them. */
    var cur = E.shade(ext.trimColor, -6);
    c.save();
    c.beginPath();
    if (ext.windowStyle === 'round') {
      c.ellipse(cx, cy, s / 2, s / 2, 0, 0, Math.PI * 2);
    } else if (ext.windowStyle === 'diamond') {
      c.moveTo(cx, cy - s / 2); c.lineTo(cx + s / 2, cy); c.lineTo(cx, cy + s / 2); c.lineTo(cx - s / 2, cy);
      c.closePath();
    } else {
      c.rect(cx - s / 2, cy - s / 2, s, s);
    }
    c.clip();
    /* the frame shades the top and left of the pane */
    c.fillStyle = 'rgba(30, 40, 90, 0.22)';
    c.fillRect(cx - s / 2, cy - s / 2, s, 4);
    E.fillPath(c, [[cx - s / 2, cy - s / 2], [cx - s / 2 + 11, cy - s / 2], [cx - s / 2 + 5, cy], [cx - s / 2 + 9, cy + s / 2], [cx - s / 2, cy + s / 2]], cur, true, false);
    E.fillPath(c, [[cx + s / 2, cy - s / 2], [cx + s / 2 - 11, cy - s / 2], [cx + s / 2 - 5, cy], [cx + s / 2 - 9, cy + s / 2], [cx + s / 2, cy + s / 2]], cur, true, false);
    c.restore();

    /* Muntins + a warm glow so the house looks lived in. */
    c.strokeStyle = frame;
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(cx, cy - s / 2 + 2); c.lineTo(cx, cy + s / 2 - 2);
    c.moveTo(cx - s / 2 + 2, cy); c.lineTo(cx + s / 2 - 2, cy);
    c.stroke();
    c.save();
    c.globalAlpha = 0.55;
    E.fillPath(c, [[cx - s / 2 + 12, cy + 1], [cx - 3, cy - s / 2 + 3], [cx + 3, cy - s / 2 + 3], [cx - s / 2 + 12, cy + 8]], '#ffffff', true, false);
    c.restore();
    E.glow(c, cx, cy + 6, s * 0.9, '255, 214, 130', 0.14);
  }

  function layerLadder(c, a) {
    var lx = a.ladderX, lw = a.ladderW;
    var topY = a.platformY + 2;
    var botY = a.groundY;
    /* Two rails leaning slightly inward at the top. */
    E.fillPath(c, [[lx - 3, botY], [lx + 2, topY], [lx + 7, topY], [lx + 2, botY]], PAL.barkLight);
    E.fillPath(c, [[lx + lw - 2, botY], [lx + lw - 6, topY], [lx + lw - 1, topY], [lx + lw + 3, botY]], PAL.barkLight);
    var rungs = 7;
    for (var i = 1; i <= rungs; i++) {
      var f = i / (rungs + 1);
      var y = botY + (topY - botY) * f;
      var xl = (lx - 3) + ((lx + 2) - (lx - 3)) * f;
      var xr = (lx + lw + 3) + ((lx + lw - 1) - (lx + lw + 3)) * f;
      E.fillRound(c, xl, y - 2.5, xr - xl, 5, 2.5, PAL.bark);
    }
  }

  function layerExtras(c, a, ext, t) {
    var d = ext.decor || {};
    /* The pieces that sway are painted live (part 2); the rest belong to
       the cached tree (part 1). part 0 paints everything. */
    var still = part !== 2, moving = part !== 1;
    if (d.bunting && moving) decorBunting(c, a, t);
    if (d.flowerBox && still) decorFlowerBox(c, a);
    if (d.lantern && moving) decorLantern(c, a, t);
    if (d.sign && moving) decorSign(c, a, ext);   /* hangs in front of the bunting */
    if (d.windChime && moving) decorWindChime(c, a, t);
    if (d.birdhouse && still) decorBirdhouse(c, a);
    if (d.swing && moving) decorSwing(c, a, t);
  }

  function decorBunting(c, a, t) {
    var x0 = a.houseX - 12, x1 = a.houseX + a.houseW + 12;
    var y0 = a.houseTop + 2;
    var sag = 16 + Math.sin(t / 60) * 2;
    c.strokeStyle = PAL.ink;
    c.lineWidth = 1.8;
    c.beginPath();
    c.moveTo(x0, y0);
    c.quadraticCurveTo((x0 + x1) / 2, y0 + sag * 2, x1, y0);
    c.stroke();
    var cols = [PAL.peach, PAL.sun, PAL.leafLight, PAL.sky, PAL.cream];
    var n = 8;
    for (var i = 0; i < n; i++) {
      var u = (i + 0.5) / n;
      var px = x0 + (x1 - x0) * u;
      var py = y0 + 2 * sag * u * (1 - u) * 2;
      E.fillPath(c, [[px - 6, py], [px + 6, py], [px, py + 14]], cols[i % cols.length], true, false);
    }
  }

  function decorFlowerBox(c, a) {
    var cx = a.win1Cx;
    var y = a.winCy + a.winSize / 2 + 4;
    E.fillRound(c, cx - 24, y, 48, 16, 3, PAL.bark);
    E.fillRound(c, cx - 24, y, 48, 5, 2, PAL.barkLight, false);
    for (var i = -1; i <= 1; i++) {
      E.fillEllipse(c, cx + i * 14, y - 6, 8, 6, PAL.leafLight, false);
      E.fillEllipse(c, cx + i * 14, y - 9, 5, 4.5, i === 0 ? PAL.sun : PAL.peach);
      E.fillEllipse(c, cx + i * 14, y - 9, 1.8, 1.8, PAL.cream, false);
    }
  }

  function decorLantern(c, a, t) {
    var cx = a.houseX + a.houseW + 10;
    var y = a.houseTop + 18;
    var sway = Math.sin(t / 45) * 0.09;
    c.save();
    c.translate(cx, y);
    c.rotate(sway);
    c.strokeStyle = PAL.ink;
    c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(0, -8); c.lineTo(0, 0); c.stroke();
    E.fillRound(c, -9, 0, 18, 6, 2, PAL.bark);
    E.fillRound(c, -7, 6, 14, 18, 4, PAL.sun);
    E.fillRound(c, -9, 24, 18, 5, 2, PAL.bark);
    if (E.fxOn('glow')) {
      E.glow(c, 0, 15, 44, '255, 214, 110', 0.75);
      E.fillEllipse(c, 0, 15, 3, 5, '#fffbe0', false);
    } else {
      c.save();
      c.globalAlpha = 0.35;
      E.fillEllipse(c, 0, 15, 20, 20, PAL.sun, false);
      c.restore();
    }
    c.restore();
  }

  function decorSign(c, a, ext) {
    var cx = a.doorCx;
    var y = a.houseTop + 8;
    E.fillRound(c, cx - 36, y, 72, 22, 5, PAL.barkLight);
    c.fillStyle = PAL.ink;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var name = Game.i18n.t('friend_momoko');
    E.fitText(c, name, 64, 12);
    c.fillText(name, cx, y + 12);
  }

  function decorWindChime(c, a, t) {
    var cx = a.x + a.platformW / 2 - 14;
    var y = a.platformY + a.platformH;
    var sway = Math.sin(t / 30) * 0.13;
    c.save();
    c.translate(cx, y);
    c.rotate(sway);
    c.strokeStyle = PAL.ink;
    c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 8); c.stroke();
    E.fillEllipse(c, 0, 11, 14, 5, '#c9a86a');
    for (var i = -1; i <= 1; i++) {
      c.beginPath(); c.moveTo(i * 9, 14); c.lineTo(i * 9, 22); c.stroke();
      E.fillRound(c, i * 9 - 2.5, 22, 5, 12 - Math.abs(i) * 3, 2.5, '#d6dae0');
    }
    c.restore();
  }

  function decorBirdhouse(c, a) {
    var p = a.branchL;
    var x = p.x - 12, y = p.y - 40;
    c.strokeStyle = PAL.ink;
    c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(x + 14, y + 34); c.lineTo(x + 14, p.y); c.stroke();
    E.fillRound(c, x, y + 12, 28, 24, 3, PAL.creamDark);
    E.fillPath(c, [[x - 4, y + 13], [x + 14, y - 2], [x + 32, y + 13]], '#c05a48');
    E.fillEllipse(c, x + 14, y + 22, 5, 5, PAL.ink, false);
    E.fillRound(c, x + 12, y + 27, 4, 8, 2, PAL.bark);
  }

  function decorSwing(c, a, t) {
    var p = a.branchR;
    var sway = Math.sin(t / 52) * 0.14;
    c.save();
    c.translate(p.x + 10, p.y);
    c.rotate(sway);
    c.strokeStyle = '#c9a86a';
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(-16, 0); c.lineTo(-16, 62); c.stroke();
    c.beginPath(); c.moveTo(16, 0); c.lineTo(16, 62); c.stroke();
    E.fillRound(c, -24, 62, 48, 9, 3, PAL.barkLight);
    c.restore();
  }

  var LAYERS = {
    platform: function (c, a, ext, t) { layerPlatform(c, a); },
    walls: function (c, a, ext, t) { layerWalls(c, a, ext, t); },
    roof: function (c, a, ext, t) { layerRoof(c, a, ext, t || 0); },
    openings: function (c, a, ext, t) { layerOpenings(c, a, ext); },
    extras: function (c, a, ext, t) { layerExtras(c, a, ext, t); },
    ladder: function (c, a, ext, t) { layerLadder(c, a); },
  };

  /* Which half of the tree is being painted: 0 = all of it live, 1 = only
     what never moves (into the cache), 2 = only what sways or drifts. */
  var part = 0;

  /* The tree is a few hundred shaded shapes that almost never change, so
     the still part is painted once per look (stage, ghost, exterior
     choices, language, effect flags) and blitted. A handful of looks are
     kept: the meadow's, the title's, the intro's two and the designer's
     latest. */
  var TS = { x: 215, y: 420, w: 430, h: 436 };
  var treeSprites = [];
  function treeSprite(stageIndex, ext, ghost) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var key = stageIndex + '|' + (ghost ? 1 : 0) + '|' + JSON.stringify(ext) + '|' +
              Game.i18n.getLang() + '|' + E.fxSig() + '|' + dpr + '|' + fontEpoch;
    for (var i = 0; i < treeSprites.length; i++) {
      if (treeSprites[i].key === key) {
        var hitSpr = treeSprites.splice(i, 1)[0];
        treeSprites.push(hitSpr);
        return hitSpr.cv;
      }
    }
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(TS.w * dpr);
    cv.height = Math.ceil(TS.h * dpr);
    var g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(TS.x, TS.y);
    part = 1;
    paintTree(g, anchors(0, 0), stageIndex, ext, 0, ghost, undefined);
    part = 0;
    treeSprites.push({ key: key, cv: cv });
    if (treeSprites.length > 6) treeSprites.shift();
    return cv;
  }
  /* Bumped when the web font arrives, so the name sign repaints in it. */
  var fontEpoch = 0;
  function clearCache() { fontEpoch++; treeSprites = []; }

  /* stageIndex = number of completed stages. ghost=true paints the next
     stage translucently so the goal is visible on the tree itself.
     reveal (0..1, optional) fades and settles the most recently finished
     stage into place -- the build cutscene drives it. */
  function drawTree(c, x, groundY, stageIndex, ext, t, ghost, reveal) {
    var a = anchors(x, groundY);
    if (reveal !== undefined && reveal < 1) {
      /* mid-cutscene: a layer is fading in, so paint it all live */
      paintTree(c, a, stageIndex, ext, t, ghost, reveal);
    } else {
      c.drawImage(treeSprite(stageIndex, ext, ghost), x - TS.x, groundY - TS.y, TS.w, TS.h);
      var stages = Game.BUILD_STAGES;
      part = 2;
      for (var i = 0; i < stageIndex && i < stages.length; i++) {
        if (stages[i].id === 'roof' || stages[i].id === 'extras') LAYERS[stages[i].id](c, a, ext, t);
      }
      part = 0;
    }
    canopyFront(c, a, t);
    return a;
  }

  function paintTree(c, a, stageIndex, ext, t, ghost, reveal) {
    var stages = Game.BUILD_STAGES;
    var done = {};
    for (var i = 0; i < stageIndex && i < stages.length; i++) done[stages[i].id] = true;
    var nextId = (ghost && stageIndex < stages.length) ? stages[stageIndex].id : null;
    var newId = (reveal !== undefined && stageIndex > 0) ? stages[stageIndex - 1].id : null;

    canopyBack(c, a);
    trunk(c, a);
    branches(c, a);

    for (var p = 0; p < PAINT_ORDER.length; p++) {
      var id = PAINT_ORDER[p];
      if (id === newId && reveal < 1) {
        c.save();
        c.globalAlpha = 0.22 + 0.78 * reveal;
        c.translate(0, -(1 - reveal) * 16);
        LAYERS[id](c, a, ext, t);
        c.restore();
      } else if (done[id]) {
        LAYERS[id](c, a, ext, t);
      } else if (id === nextId) {
        /* the ghost is a hint, not a thing: all of it goes in the cache */
        var was = part;
        part = 0;
        c.save();
        c.globalAlpha = 0.22;
        LAYERS[id](c, a, ext, t);
        c.restore();
        part = was;
      }
    }
  }

  /* Small preview used by the exterior customizer, drawn into a box. */
  function drawTreePreview(c, cx, cy, scale, stageIndex, ext, t) {
    c.save();
    c.translate(cx, cy);
    c.scale(scale, scale);
    drawTree(c, 0, 0, stageIndex, ext, t, false);
    c.restore();
  }

  window.Game.tree = {
    drawTree: drawTree,
    drawTreePreview: drawTreePreview,
    anchors: anchors,
    clearCache: clearCache,
    PAINT_ORDER: PAINT_ORDER,
  };
})();
