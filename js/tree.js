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

  function canopyBack(c, a) {
    var x = a.x, g = a.groundY;
    E.fillEllipse(c, x - 96, g - 268, 66, 52, PAL.leafDark);
    E.fillEllipse(c, x + 100, g - 258, 62, 50, PAL.leafDark);
    E.fillEllipse(c, x - 34, g - 316, 76, 60, PAL.leaf);
    E.fillEllipse(c, x + 52, g - 322, 70, 56, PAL.leaf);
    E.fillEllipse(c, x + 6, g - 352, 62, 48, PAL.leafLight);
  }

  function canopyFront(c, a, t) {
    var x = a.x, g = a.groundY;
    var sway = Math.sin(t / 70) * 2;
    c.save();
    c.globalAlpha = 0.95;
    E.fillEllipse(c, x - 118 + sway, g - 300, 42, 32, PAL.leafLight);
    E.fillEllipse(c, x + 126 - sway, g - 288, 38, 30, PAL.leafLight);
    c.restore();
  }

  function trunk(c, a) {
    var x = a.x, g = a.groundY;
    /* Root flare, then a tapering trunk. */
    E.fillPath(c, [
      [x - 46, g], [x - 34, g - 40], [x - 28, a.trunkTop + 40], [x - 20, a.trunkTop],
      [x + 20, a.trunkTop], [x + 28, a.trunkTop + 40], [x + 34, g - 40], [x + 46, g],
    ], PAL.bark);

    /* Bark grain */
    c.save();
    c.globalAlpha = 0.35;
    c.strokeStyle = PAL.barkDark;
    c.lineWidth = 2;
    for (var i = 0; i < 4; i++) {
      var bx = x - 20 + i * 13;
      c.beginPath();
      c.moveTo(bx, g - 16);
      c.quadraticCurveTo(bx + 6, g - 130, bx - 2, a.trunkTop + 20);
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
    E.fillEllipse(c, x - 36, g + 2, 26, 8, PAL.grassDark, false);
    E.fillEllipse(c, x + 36, g + 2, 26, 8, PAL.grassDark, false);
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
    ], PAL.barkLight);
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
    /* Deck */
    E.fillRound(c, x - pw / 2, a.platformY, pw, ph, 4, PAL.barkLight);
    c.strokeStyle = E.shade(PAL.barkLight, -26);
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

  function layerWalls(c, a, ext) {
    var col = ext.wallColor;
    var hx = a.houseX, hy = a.houseTop, hw = a.houseW, hh = a.houseH;
    E.fillRound(c, hx, hy, hw, hh, 5, col);

    c.save();
    c.beginPath();
    E.roundRect(c, hx + 1, hy + 1, hw - 2, hh - 2, 4);
    c.clip();
    switch (ext.wallMat) {
      case 'plank':
        c.strokeStyle = E.shade(col, -20);
        c.lineWidth = 1.6;
        for (var y = hy + 12; y < hy + hh; y += 12) {
          c.beginPath(); c.moveTo(hx, y); c.lineTo(hx + hw, y); c.stroke();
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
    c.restore();

    E.roundRect(c, hx, hy, hw, hh, 5);
    E.ink(c, 2.5);

    /* Corner posts read as timber framing whatever the wall material. */
    E.fillRound(c, hx - 3, hy, 8, hh, 3, PAL.bark);
    E.fillRound(c, hx + hw - 5, hy, 8, hh, 3, PAL.bark);
  }

  function layerRoof(c, a, ext) {
    var x = a.x, hx = a.houseX, hy = a.houseTop, hw = a.houseW;
    var col = ext.roofColor;
    var eaveL = hx - 16, eaveR = hx + hw + 16;
    var apex = hy - a.roofH;

    switch (ext.roofStyle) {
      case 'gable':
        E.fillPath(c, [[eaveL, hy + 4], [x, apex], [eaveR, hy + 4]], col);
        c.save();
        c.globalAlpha = 0.3;
        c.strokeStyle = PAL.ink;
        c.lineWidth = 1.3;
        for (var r = 1; r <= 3; r++) {
          var ry = hy + 4 - r * 11;
          var half = (eaveR - eaveL) / 2 * (1 - (r * 11) / (a.roofH + 4));
          c.beginPath(); c.moveTo(x - half, ry); c.lineTo(x + half, ry); c.stroke();
        }
        c.restore();
        break;
      case 'round':
        c.beginPath();
        c.moveTo(eaveL, hy + 4);
        c.quadraticCurveTo(x, apex - 22, eaveR, hy + 4);
        c.closePath();
        c.fillStyle = col;
        c.fill();
        E.ink(c, 2.5);
        c.save();
        c.globalAlpha = 0.28;
        c.strokeStyle = PAL.ink;
        c.lineWidth = 1.3;
        for (var q = 1; q <= 3; q++) {
          c.beginPath();
          c.moveTo(eaveL + q * 12, hy + 4);
          c.quadraticCurveTo(x, apex - 22 + q * 12, eaveR - q * 12, hy + 4);
          c.stroke();
        }
        c.restore();
        break;
      case 'thatch':
        c.beginPath();
        c.moveTo(eaveL, hy + 8);
        c.quadraticCurveTo(x - 40, apex + 6, x, apex - 4);
        c.quadraticCurveTo(x + 40, apex + 6, eaveR, hy + 8);
        c.closePath();
        c.fillStyle = '#d9bb72';
        c.fill();
        E.ink(c, 2.5);
        c.save();
        c.globalAlpha = 0.45;
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
    E.fillRound(c, eaveL - 2, hy + 2, (eaveR - eaveL) + 4, 8, 3, E.shade(col, -22));
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
    }
    E.fillEllipse(c, cx + w / 2 - 9, bottom - h / 2, 3.6, 3.6, ext.trimColor);
    /* Doorstep */
    E.fillRound(c, cx - w / 2 - 4, bottom - 3, w + 8, 6, 3, PAL.bark);
  }

  function drawWindow(c, a, ext, cx) {
    var cy = a.winCy;
    var s = a.winSize;
    var frame = PAL.cream;
    switch (ext.windowStyle) {
      case 'square':
        E.fillRound(c, cx - s / 2 - 3, cy - s / 2 - 3, s + 6, s + 6, 4, frame);
        E.fillRound(c, cx - s / 2, cy - s / 2, s, s, 2, PAL.sky);
        break;
      case 'round':
        E.fillEllipse(c, cx, cy, s / 2 + 4, s / 2 + 4, frame);
        E.fillEllipse(c, cx, cy, s / 2, s / 2, PAL.sky);
        break;
      case 'diamond':
        E.fillPath(c, [[cx, cy - s / 2 - 4], [cx + s / 2 + 4, cy], [cx, cy + s / 2 + 4], [cx - s / 2 - 4, cy]], frame);
        E.fillPath(c, [[cx, cy - s / 2], [cx + s / 2, cy], [cx, cy + s / 2], [cx - s / 2, cy]], PAL.sky);
        break;
      case 'bay':
        E.fillPath(c, [[cx - s / 2 - 6, cy - s / 2 - 3], [cx + s / 2 + 6, cy - s / 2 - 3],
                       [cx + s / 2 + 1, cy + s / 2 + 3], [cx - s / 2 - 1, cy + s / 2 + 3]], frame);
        E.fillRound(c, cx - s / 2, cy - s / 2, s, s, 2, PAL.sky);
        break;
    }
    /* Muntins + a warm glow so the house looks lived in. */
    c.strokeStyle = frame;
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(cx, cy - s / 2 + 2); c.lineTo(cx, cy + s / 2 - 2);
    c.moveTo(cx - s / 2 + 2, cy); c.lineTo(cx + s / 2 - 2, cy);
    c.stroke();
    c.save();
    c.globalAlpha = 0.35;
    E.fillEllipse(c, cx - s / 5, cy - s / 5, s / 5, s / 6, '#ffffff', false);
    c.restore();
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
    if (d.bunting) decorBunting(c, a, t);
    if (d.flowerBox) decorFlowerBox(c, a);
    if (d.lantern) decorLantern(c, a, t);
    if (d.sign) decorSign(c, a, ext);
    if (d.windChime) decorWindChime(c, a, t);
    if (d.birdhouse) decorBirdhouse(c, a);
    if (d.swing) decorSwing(c, a, t);
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
    c.save();
    c.globalAlpha = 0.35;
    E.fillEllipse(c, 0, 15, 20, 20, PAL.sun, false);
    c.restore();
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
    walls: function (c, a, ext, t) { layerWalls(c, a, ext); },
    roof: function (c, a, ext, t) { layerRoof(c, a, ext); },
    openings: function (c, a, ext, t) { layerOpenings(c, a, ext); },
    extras: function (c, a, ext, t) { layerExtras(c, a, ext, t); },
    ladder: function (c, a, ext, t) { layerLadder(c, a); },
  };

  /* stageIndex = number of completed stages. ghost=true paints the next
     stage translucently so the goal is visible on the tree itself. */
  function drawTree(c, x, groundY, stageIndex, ext, t, ghost) {
    var a = anchors(x, groundY);
    var stages = Game.BUILD_STAGES;
    var done = {};
    for (var i = 0; i < stageIndex && i < stages.length; i++) done[stages[i].id] = true;
    var nextId = (ghost && stageIndex < stages.length) ? stages[stageIndex].id : null;

    canopyBack(c, a);
    trunk(c, a);
    branches(c, a);

    for (var p = 0; p < PAINT_ORDER.length; p++) {
      var id = PAINT_ORDER[p];
      if (done[id]) {
        LAYERS[id](c, a, ext, t);
      } else if (id === nextId) {
        c.save();
        c.globalAlpha = 0.22;
        LAYERS[id](c, a, ext, t);
        c.restore();
      }
    }

    canopyFront(c, a, t);
    return a;
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
    PAINT_ORDER: PAINT_ORDER,
  };
})();
