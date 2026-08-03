/* ui.js – every screen except the piano.
 *
 * Layout constants for each screen are declared once and used by both the
 * painter and the hit-tester, so the two can never drift apart. That is
 * the single most important convention in this file.
 */
(function () {
  'use strict';
  window.Game = window.Game || {};
  var PAL = Game.PAL;
  var E = Game.entities;

  var W = 800, H = 480;
  var t = 0;

  /* ================================================================
     Shared helpers
     ================================================================ */

  function button(c, b, label, opts) {
    opts = opts || {};
    var fill = opts.active ? (opts.activeFill || PAL.sun) : (opts.fill || PAL.cream);
    if (opts.disabled) fill = '#b9ad99';
    c.fillStyle = fill;
    E.roundRect(c, b.x, b.y, b.w, b.h, opts.r === undefined ? 9 : opts.r);
    c.fill();
    E.ink(c, opts.active ? 3 : 2);
    c.fillStyle = opts.disabled ? '#6d6459' : PAL.ink;
    c.font = 'bold ' + (opts.font || 15) + 'px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
  }

  function hit(b, mx, my) {
    return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
  }

  function panel(c, x, y, w, h, fill, alpha) {
    c.save();
    if (alpha !== undefined) c.globalAlpha = alpha;
    c.fillStyle = fill || 'rgba(255, 244, 220, 0.92)';
    E.roundRect(c, x, y, w, h, 10);
    c.fill();
    c.restore();
    E.roundRect(c, x, y, w, h, 10);
    E.ink(c, 2);
  }

  /* Draws text with \n honoured, centred on cx. Returns the height used. */
  function multiline(c, text, cx, y, lineH, align) {
    var lines = String(text).split('\n');
    c.textAlign = align || 'center';
    c.textBaseline = 'middle';
    for (var i = 0; i < lines.length; i++) {
      c.fillText(lines[i], cx, y + i * lineH);
    }
    return lines.length * lineH;
  }

  function T(k) { return Game.i18n.t(k); }

  /* ---- Toast (transient message over gameplay) ---- */
  var toast = { text: '', timer: 0 };
  function showToast(text, frames) {
    toast.text = text;
    toast.timer = frames || 120;
  }
  function drawToast(c) {
    if (toast.timer <= 0) return;
    toast.timer--;
    var a = Math.min(1, toast.timer / 22);
    var lines = toast.text.split('\n');
    c.save();
    c.globalAlpha = a;
    c.font = 'bold 16px monospace';
    var maxW = 0;
    for (var i = 0; i < lines.length; i++) maxW = Math.max(maxW, c.measureText(lines[i]).width);
    var bw = maxW + 40, bh = lines.length * 22 + 22;
    panel(c, (W - bw) / 2, 96, bw, bh);
    c.fillStyle = PAL.ink;
    multiline(c, toast.text, W / 2, 96 + bh / 2 - ((lines.length - 1) * 11), 22);
    c.restore();
  }

  /* ================================================================
     Title screen
     ================================================================ */

  var TITLE_BTN = {
    play: { x: 300, y: 250, w: 200, h: 50 },
    how: { x: 300, y: 312, w: 200, h: 40 },
    lang: { x: 300, y: 362, w: 95, h: 36 },
    sound: { x: 405, y: 362, w: 95, h: 36 },
    reset: { x: 640, y: 428, w: 146, h: 34 },
  };
  var showInstructions = false;
  var confirmReset = false;
  var RESET_YES = { x: 300, y: 300, w: 90, h: 42 };
  var RESET_NO = { x: 410, y: 300, w: 90, h: 42 };

  function drawTitleScreen(c) {
    t++;
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PAL.sky);
    g.addColorStop(0.72, '#dff0d8');
    g.addColorStop(1, PAL.grass);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    /* Sun and drifting clouds */
    E.fillEllipse(c, 700, 74, 40, 40, PAL.sun, false);
    c.save();
    c.globalAlpha = 0.85;
    cloud(c, ((t * 0.25) % (W + 260)) - 130, 78, 1);
    cloud(c, ((t * 0.16 + 420) % (W + 260)) - 130, 132, 0.7);
    c.restore();

    /* A finished tree house as the backdrop, small and off to the side */
    c.save();
    c.translate(150, 452);
    c.scale(0.52, 0.52);
    Game.tree.drawTree(c, 0, 0, Game.BUILD_STAGES.length, Game.EXT_DEFAULT, t, false);
    c.restore();

    /* Ground */
    c.fillStyle = PAL.grass;
    c.fillRect(0, 430, W, H - 430);
    c.fillStyle = PAL.grassDark;
    c.fillRect(0, 430, W, 5);

    /* Title */
    var bob = Math.sin(t / 40) * 4;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = PAL.ink;
    c.font = 'bold 30px monospace';
    c.fillText(T('title'), W / 2 + 60, 108 + bob);
    c.font = 'bold 52px monospace';
    c.fillStyle = '#3b6b2a';
    c.strokeStyle = PAL.cream;
    c.lineWidth = 6;
    c.lineJoin = 'round';
    c.strokeText(T('title2'), W / 2 + 60, 158 + bob);
    c.fillText(T('title2'), W / 2 + 60, 158 + bob);
    c.font = '16px monospace';
    c.fillStyle = PAL.ink;
    c.fillText(T('titleSubtitle'), W / 2 + 60, 198 + bob);

    if (confirmReset) {
      drawResetConfirm(c);
      return;
    }

    button(c, TITLE_BTN.play, T('play'), { font: 20, activeFill: PAL.sun, fill: PAL.sun });
    button(c, TITLE_BTN.how, T('howToPlay'), { font: 15 });
    button(c, TITLE_BTN.lang, T('language') + ': ' + T('langLabel'), { font: 12 });
    button(c, TITLE_BTN.sound, Game.audio.isMuted() ? T('soundOff') : T('soundOn'), { font: 12 });
    if (hasSave()) button(c, TITLE_BTN.reset, T('startOver'), { font: 12, fill: 'rgba(255,244,220,0.7)' });

    if (showInstructions) drawInstructionsOverlay(c);
    drawVersionStamp(c);
  }

  function cloud(c, x, y, s) {
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    E.fillEllipse(c, -34, 6, 30, 20, '#ffffff', false);
    E.fillEllipse(c, 34, 8, 26, 17, '#ffffff', false);
    E.fillEllipse(c, 0, -6, 40, 27, '#ffffff', false);
    c.restore();
  }

  function drawInstructionsOverlay(c) {
    c.fillStyle = 'rgba(36, 23, 8, 0.62)';
    c.fillRect(0, 0, W, H);
    panel(c, 110, 100, 580, 280);
    c.fillStyle = PAL.ink;
    c.font = 'bold 20px monospace';
    c.fillText(T('howToPlay'), W / 2, 134);
    c.font = '15px monospace';
    multiline(c, T('instructions'), W / 2, 190, 24);
    c.font = '13px monospace';
    c.fillStyle = 'rgba(74,51,32,0.7)';
    c.fillText('(tap anywhere to close)', W / 2, 352);
  }

  function drawResetConfirm(c) {
    c.fillStyle = 'rgba(36, 23, 8, 0.62)';
    c.fillRect(0, 0, W, H);
    panel(c, 200, 190, 400, 180);
    c.fillStyle = PAL.ink;
    c.font = 'bold 16px monospace';
    multiline(c, T('startOverConfirm'), W / 2, 236, 24);
    button(c, RESET_YES, T('yes'), { fill: '#e88a7a' });
    button(c, RESET_NO, T('no'));
  }

  function hasSave() {
    return Game.build && Game.build.stageIndex > 0;
  }

  /* Returns an action string for the engine. */
  function handleTitleClick(mx, my) {
    if (confirmReset) {
      if (hit(RESET_YES, mx, my)) { confirmReset = false; return 'reset'; }
      if (hit(RESET_NO, mx, my)) { confirmReset = false; return null; }
      return null;
    }
    if (showInstructions) { showInstructions = false; return null; }
    if (hit(TITLE_BTN.play, mx, my)) return 'play';
    if (hit(TITLE_BTN.how, mx, my)) { showInstructions = true; return 'select'; }
    if (hit(TITLE_BTN.lang, mx, my)) return 'lang';
    if (hit(TITLE_BTN.sound, mx, my)) return 'sound';
    if (hasSave() && hit(TITLE_BTN.reset, mx, my)) { confirmReset = true; return 'select'; }
    return null;
  }

  function drawVersionStamp(c) {
    c.save();
    c.fillStyle = 'rgba(74, 51, 32, 0.45)';
    c.font = '11px monospace';
    c.textAlign = 'right';
    c.textBaseline = 'bottom';
    c.fillText(Game.VERSION || '', W - 8, H - 6);
    c.restore();
  }

  /* ================================================================
     Intro
     ================================================================ */
  var INTRO_BTN = { x: 320, y: 414, w: 160, h: 44 };

  function drawIntroScreen(c) {
    t++;
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f2e0c0');
    g.addColorStop(1, '#d8c39a');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    c.save();
    c.globalAlpha = 0.25;
    c.translate(660, 430);
    c.scale(0.5, 0.5);
    Game.tree.drawTree(c, 0, 0, 0, Game.EXT_DEFAULT, t, false);
    c.restore();

    c.fillStyle = PAL.ink;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'bold 26px monospace';
    c.fillText(T('introTitle'), W / 2, 52);
    c.font = '14px monospace';
    multiline(c, T('introText'), W / 2, 104, 21);

    button(c, INTRO_BTN, T('continueBtn'), { fill: PAL.sun, font: 16 });
  }

  function handleIntroClick(mx, my) {
    if (hit(INTRO_BTN, mx, my)) return 'continue';
    return null;
  }

  /* ================================================================
     Character designer
     ================================================================ */

  var CUST = {
    previewX: 22, previewY: 58, previewW: 252, previewH: 318,
    tabX: 290, tabY: 60, tabW: 78, tabH: 38, tabGap: 4,
    gridX: 292, gridY: 110, cellW: 158, cellH: 84, cols: 3, gap: 6,
    swatchX: 296, swatchY: 296, swatchSize: 40, swatchGap: 10,
    pickerX: 24, pickerY: 398, portrait: 54, portraitGap: 12,
    done: { x: 632, y: 412, w: 152, h: 46 },
  };
  var customTab = 'hair';

  function tabRect(i) {
    return { x: CUST.tabX + i * (CUST.tabW + CUST.tabGap), y: CUST.tabY, w: CUST.tabW, h: CUST.tabH };
  }
  function cellRect(i) {
    var col = i % CUST.cols, row = Math.floor(i / CUST.cols);
    return {
      x: CUST.gridX + col * (CUST.cellW + CUST.gap),
      y: CUST.gridY + row * (CUST.cellH + CUST.gap),
      w: CUST.cellW, h: CUST.cellH,
    };
  }
  function swatchRect(i) {
    return {
      x: CUST.swatchX + i * (CUST.swatchSize + CUST.swatchGap),
      y: CUST.swatchY, w: CUST.swatchSize, h: CUST.swatchSize,
    };
  }
  function portraitRect(i) {
    return {
      x: CUST.pickerX + i * (CUST.portrait + CUST.portraitGap),
      y: CUST.pickerY, w: CUST.portrait, h: CUST.portrait,
    };
  }

  /* Everyone who can currently be designed: Momoko plus unlocked friends. */
  function designRoster() {
    var list = [{ id: 'momoko', nameKey: 'friend_momoko' }];
    for (var i = 0; i < Game.FRIEND_DEFS.length; i++) {
      var d = Game.FRIEND_DEFS[i];
      if (Game.friends && Game.friends[d.id] && Game.friends[d.id].unlocked) {
        list.push({ id: d.id, nameKey: d.nameKey });
      }
    }
    return list;
  }

  function custRecord(id) {
    if (id === 'momoko') return Game.customization;
    return Game.friends[id].cust;
  }

  function getTab(id) {
    for (var i = 0; i < Game.CUSTOM_TABS.length; i++) {
      if (Game.CUSTOM_TABS[i].id === id) return Game.CUSTOM_TABS[i];
    }
    return Game.CUSTOM_TABS[0];
  }

  function drawCustomizeScreen(c) {
    t++;
    var target = Game.designTarget || 'momoko';
    var cust = custRecord(target);
    var tab = getTab(customTab);
    var roster = designRoster();

    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f4e6cd');
    g.addColorStop(1, '#e0cba5');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    /* Header */
    c.fillStyle = PAL.ink;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.font = 'bold 22px monospace';
    c.fillText(T('customTitle') + ': ' + T(nameKeyFor(target)), 22, 32);

    /* Preview */
    panel(c, CUST.previewX, CUST.previewY, CUST.previewW, CUST.previewH, '#cfe9f2');
    c.save();
    c.beginPath();
    E.roundRect(c, CUST.previewX + 2, CUST.previewY + 2, CUST.previewW - 4, CUST.previewH - 4, 9);
    c.clip();
    /* grass strip under the preview character */
    c.fillStyle = PAL.grass;
    c.fillRect(CUST.previewX, CUST.previewY + CUST.previewH - 62, CUST.previewW, 62);
    c.fillStyle = PAL.grassDark;
    c.fillRect(CUST.previewX, CUST.previewY + CUST.previewH - 62, CUST.previewW, 4);
    var pcx = CUST.previewX + CUST.previewW / 2;
    var pcy = CUST.previewY + CUST.previewH - 40;
    var walkFrame = Math.floor(t / 9) % 4 + 1;
    E.drawCharacter(c, pcx, pcy, cust, walkFrame, 1, 2.35, false);
    c.restore();

    /* Tabs */
    for (var i = 0; i < Game.CUSTOM_TABS.length; i++) {
      var tb = tabRect(i);
      var isSel = Game.CUSTOM_TABS[i].id === customTab;
      button(c, tb, T(Game.CUSTOM_TABS[i].labelKey), { active: isSel, font: 12, r: 7 });
    }

    /* Variant grid */
    for (var v = 0; v < tab.variants.length; v++) {
      var r = cellRect(v);
      var vid = tab.variants[v];
      var sel = tab.field && cust[tab.field] === vid;
      c.fillStyle = sel ? PAL.sun : 'rgba(255,244,220,0.9)';
      E.roundRect(c, r.x, r.y, r.w, r.h, 8);
      c.fill();
      E.ink(c, sel ? 3 : 1.8);
      drawVariantIcon(c, tab.id, vid, r.x + 40, r.y + r.h / 2, cust);
      c.fillStyle = PAL.ink;
      c.font = 'bold 12px monospace';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(T(tab.labelPrefix + vid), r.x + 74, r.y + r.h / 2);
    }

    /* Colour swatches */
    if (tab.colorField && tab.colors) {
      for (var s = 0; s < tab.colors.length; s++) {
        var sr = swatchRect(s);
        c.fillStyle = tab.colors[s];
        E.roundRect(c, sr.x, sr.y, sr.w, sr.h, 8);
        c.fill();
        E.ink(c, cust[tab.colorField] === tab.colors[s] ? 4 : 1.8);
      }
    }

    /* Character picker */
    if (roster.length > 1) {
      c.fillStyle = 'rgba(74,51,32,0.7)';
      c.font = 'bold 12px monospace';
      c.textAlign = 'left';
      c.fillText(T('customPickWho'), CUST.pickerX, CUST.pickerY - 14);
      for (var p = 0; p < roster.length; p++) {
        var pr = portraitRect(p);
        var pcust = custRecord(roster[p].id);
        if (roster[p].id === target) {
          c.fillStyle = PAL.sun;
          E.roundRect(c, pr.x - 4, pr.y - 4, pr.w + 8, pr.h + 8, 12);
          c.fill();
        }
        E.drawPortrait(c, pr.x + pr.w / 2, pr.y + pr.h / 2, pr.w, pcust);
      }
    }

    button(c, CUST.done, T(Game.flags.introSeen ? 'customDone' : 'customStart'),
      { fill: PAL.leafLight, font: 17 });
  }

  function nameKeyFor(id) {
    if (id === 'momoko') return 'friend_momoko';
    for (var i = 0; i < Game.FRIEND_DEFS.length; i++) {
      if (Game.FRIEND_DEFS[i].id === id) return Game.FRIEND_DEFS[i].nameKey;
    }
    return 'friend_momoko';
  }

  function handleCustomizeClick(mx, my) {
    var target = Game.designTarget || 'momoko';
    var cust = custRecord(target);
    var tab = getTab(customTab);
    var i;

    for (i = 0; i < Game.CUSTOM_TABS.length; i++) {
      if (hit(tabRect(i), mx, my)) { customTab = Game.CUSTOM_TABS[i].id; return 'select'; }
    }
    for (i = 0; i < tab.variants.length; i++) {
      if (hit(cellRect(i), mx, my)) {
        if (tab.field) cust[tab.field] = tab.variants[i];
        return 'select';
      }
    }
    if (tab.colorField && tab.colors) {
      for (i = 0; i < tab.colors.length; i++) {
        if (hit(swatchRect(i), mx, my)) { cust[tab.colorField] = tab.colors[i]; return 'select'; }
      }
    }
    var roster = designRoster();
    if (roster.length > 1) {
      for (i = 0; i < roster.length; i++) {
        if (hit(portraitRect(i), mx, my)) { Game.designTarget = roster[i].id; return 'select'; }
      }
    }
    if (hit(CUST.done, mx, my)) return 'done';
    return null;
  }

  /* ---- Variant icons ---- */
  function drawVariantIcon(c, tabId, id, cx, cy, cust) {
    c.save();
    c.translate(cx, cy);
    switch (tabId) {
      case 'hair': drawHairIcon(c, id, cust.hair); break;
      case 'outfit': drawOutfitIcon(c, id, cust.outfitColor); break;
      case 'shoes': drawShoeIcon(c, id, cust.shoeColor); break;
      case 'hat': drawHatIcon(c, id, cust); break;
      case 'extra': drawAccIcon(c, id, cust); break;
    }
    c.restore();
  }

  function drawHairIcon(c, id, col) {
    E.fillEllipse(c, 0, 2, 15, 16, '#ffddbb');
    switch (id) {
      case 'twinTails':
        E.fillEllipse(c, -17, 4, 7, 11, col);
        E.fillEllipse(c, 17, 4, 7, 11, col);
        break;
      case 'longBraids':
        E.fillRound(c, -19, -4, 8, 24, 4, col);
        E.fillRound(c, 11, -4, 8, 24, 4, col);
        break;
      case 'buns':
        E.fillEllipse(c, -15, -10, 7, 7, col);
        E.fillEllipse(c, 15, -10, 7, 7, col);
        break;
      case 'bob':
        E.fillEllipse(c, 0, 0, 18, 16, col);
        E.fillEllipse(c, 0, 5, 14, 12, '#ffddbb');
        break;
      case 'ponytail':
        E.fillPath(c, [[12, -8], [26, 0], [22, 16], [10, 4]], col);
        break;
    }
    c.beginPath();
    c.arc(0, -1, 16, Math.PI, Math.PI * 2);
    c.closePath();
    c.fillStyle = col;
    c.fill();
    E.ink(c, 2);
  }

  function drawOutfitIcon(c, id, col) {
    switch (id) {
      case 'frillyDress':
        E.fillPath(c, [[-8, -16], [8, -16], [16, 16], [-16, 16]], col);
        E.fillEllipse(c, -8, 16, 5, 4, E.shade(col, 22), false);
        E.fillEllipse(c, 0, 16, 5, 4, E.shade(col, 22), false);
        E.fillEllipse(c, 8, 16, 5, 4, E.shade(col, 22), false);
        break;
      case 'sailorDress':
        E.fillPath(c, [[-8, -16], [8, -16], [15, 16], [-15, 16]], col);
        E.fillPath(c, [[-8, -16], [8, -16], [5, -6], [-5, -6]], PAL.cream);
        break;
      case 'starDress':
        E.fillPath(c, [[-8, -16], [8, -16], [15, 16], [-15, 16]], col);
        c.fillStyle = PAL.sun;
        E.star(c, -5, 4, 4); E.star(c, 6, 9, 3.4);
        break;
      case 'overalls':
        E.fillRound(c, -11, -10, 22, 26, 4, col);
        E.fillRound(c, -9, -17, 4, 9, 2, col);
        E.fillRound(c, 5, -17, 4, 9, 2, col);
        E.fillRound(c, -5, -2, 10, 7, 2, E.shade(col, -20));
        break;
      case 'sweater':
        E.fillRound(c, -13, -14, 26, 28, 7, col);
        c.strokeStyle = E.shade(col, -22);
        c.lineWidth = 1.5;
        for (var y = -8; y < 12; y += 6) {
          c.beginPath(); c.moveTo(-11, y); c.lineTo(11, y); c.stroke();
        }
        break;
    }
  }

  function drawShoeIcon(c, id, col) {
    switch (id) {
      case 'maryJane':
        E.fillRound(c, -14, 0, 13, 9, 4, col);
        E.fillRound(c, 1, 0, 13, 9, 4, col);
        break;
      case 'sneaker':
        E.fillRound(c, -15, -2, 14, 11, 4, col);
        E.fillRound(c, 1, -2, 14, 11, 4, col);
        E.fillRound(c, -15, 4, 14, 4, 2, PAL.cream, false);
        E.fillRound(c, 1, 4, 14, 4, 2, PAL.cream, false);
        break;
      case 'boots':
        E.fillRound(c, -14, -12, 12, 21, 4, col);
        E.fillRound(c, 2, -12, 12, 21, 4, col);
        break;
    }
  }

  function drawHatIcon(c, id, cust) {
    E.fillEllipse(c, 0, 8, 14, 14, '#ffddbb');
    switch (id) {
      case 'none':
        c.fillStyle = 'rgba(74,51,32,0.5)';
        c.font = 'bold 13px monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('—', 0, -10);
        break;
      case 'strawHat':
        E.fillEllipse(c, 0, -4, 24, 6, '#e8c76a');
        E.fillEllipse(c, 0, -11, 13, 8, '#f0d585');
        break;
      case 'beret':
        E.fillEllipse(c, -1, -8, 16, 8, cust.outfitColor);
        E.fillEllipse(c, 7, -14, 2.6, 2.6, E.shade(cust.outfitColor, -25));
        break;
      case 'flowerCrown':
        for (var i = -2; i <= 2; i++) {
          E.fillEllipse(c, i * 7, -7 + Math.abs(i) * 1.6, 4, 3.6, i % 2 === 0 ? PAL.peach : PAL.cream, false);
          E.fillEllipse(c, i * 7, -7 + Math.abs(i) * 1.6, 1.5, 1.5, PAL.sun, false);
        }
        break;
    }
  }

  function drawAccIcon(c, id, cust) {
    switch (id) {
      case 'none':
        c.fillStyle = 'rgba(74,51,32,0.5)';
        c.font = 'bold 15px monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('—', 0, 0);
        break;
      case 'scarf':
        E.fillRound(c, -15, -6, 30, 8, 4, '#c05a48');
        E.fillPath(c, [[6, 0], [14, 2], [11, 18], [3, 15]], '#c05a48');
        break;
      case 'backpack':
        E.fillRound(c, -11, -12, 22, 24, 5, '#4e8f3c');
        E.fillRound(c, -8, -2, 16, 8, 3, E.shade('#4e8f3c', -25));
        break;
      case 'ribbon':
        E.fillEllipse(c, -8, 0, 7, 5.5, PAL.peach);
        E.fillEllipse(c, 8, 0, 7, 5.5, PAL.peach);
        E.fillEllipse(c, 0, 0, 3.4, 3.4, E.shade(PAL.peach, -25));
        break;
    }
  }

  /* ================================================================
     Shop
     ================================================================ */

  var SHOP = {
    tabY: 72, tabH: 36, tabW: 150, tabGap: 8, tabX: 100,
    matCols: 7, matCellW: 98, matCellH: 104, matY: 116,
    furCols: 8, furCellW: 94, furCellH: 70, furY: 118,
    bagPanel: { x: 12, y: 352, w: 452, h: 114 },
    listPanel: { x: 476, y: 352, w: 312, h: 114 },
    slot: { x: 20, y: 384, size: 54, gap: 8 },
    emptyBtn: { x: 334, y: 384, w: 118, h: 54 },
    fillBtn: { x: 496, y: 424, w: 132, h: 32 },
    exit: { x: 646, y: 12, w: 140, h: 38 },
  };
  var shopTab = 'materials';
  var shopFlash = null, shopFlashTimer = 0;

  function shopTabRect(i) {
    return { x: SHOP.tabX + i * (SHOP.tabW + SHOP.tabGap), y: SHOP.tabY, w: SHOP.tabW, h: SHOP.tabH };
  }

  function shopTabs() {
    return [
      { id: 'materials', labelKey: 'shopTabMaterials', locked: false },
      { id: 'furniture', labelKey: 'shopTabFurniture', locked: !Game.flags.canEnter, lockKey: 'shopLockedFurniture' },
      { id: 'special', labelKey: 'shopTabSpecial', locked: !Game.flags.canDecorate, lockKey: 'shopLockedSpecial' },
    ];
  }

  /* Pure layout, reused by painter and hit-test. */
  function shopGrid() {
    var out = [];
    var i, col, row;
    if (shopTab === 'materials') {
      var startX = (W - SHOP.matCols * SHOP.matCellW) / 2;
      for (i = 0; i < Game.MATERIALS.length; i++) {
        col = i % SHOP.matCols; row = Math.floor(i / SHOP.matCols);
        out.push({
          kind: 'material', type: Game.MATERIALS[i].type,
          x: startX + col * SHOP.matCellW, y: SHOP.matY + row * SHOP.matCellH,
          w: SHOP.matCellW, h: SHOP.matCellH,
        });
      }
    } else if (shopTab === 'furniture') {
      var fx = (W - SHOP.furCols * SHOP.furCellW) / 2;
      for (i = 0; i < Game.FURNITURE_TYPES.length; i++) {
        col = i % SHOP.furCols; row = Math.floor(i / SHOP.furCols);
        out.push({
          kind: 'furniture', type: Game.FURNITURE_TYPES[i].type,
          x: fx + col * SHOP.furCellW, y: SHOP.furY + row * SHOP.furCellH,
          w: SHOP.furCellW, h: SHOP.furCellH,
        });
      }
    } else {
      out.push({ kind: 'piano', type: 'piano', x: 290, y: 140, w: 220, h: 180 });
    }
    return out;
  }

  function startShopInterior() {
    shopFlash = null;
    shopFlashTimer = 0;
    if (shopTab === 'furniture' && !Game.flags.canEnter) shopTab = 'materials';
    if (shopTab === 'special' && !Game.flags.canDecorate) shopTab = 'materials';
  }

  function updateShopInterior(keys, jp) {
    if (shopFlashTimer > 0) shopFlashTimer--;
    if (jp.pause) return 'exit';
    return null;
  }

  function drawShopInterior(c) {
    t++;
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#6b4a2f');
    g.addColorStop(0.35, '#c9a86a');
    g.addColorStop(1, '#8a6340');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    /* Plank wall behind the shelves */
    c.save();
    c.globalAlpha = 0.18;
    c.strokeStyle = PAL.ink;
    c.lineWidth = 2;
    for (var wy = 70; wy < 350; wy += 26) {
      c.beginPath(); c.moveTo(0, wy); c.lineTo(W, wy); c.stroke();
    }
    c.restore();

    /* Banner */
    c.fillStyle = '#3b2a16';
    c.fillRect(0, 0, W, 60);
    c.fillStyle = PAL.sun;
    c.font = 'bold 22px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(T('shopTitle'), 20, 30);
    button(c, SHOP.exit, T('shopExit'), { font: 13 });

    /* Tabs */
    var tabs = shopTabs();
    for (var i = 0; i < tabs.length; i++) {
      var r = shopTabRect(i);
      button(c, r, T(tabs[i].labelKey), {
        active: tabs[i].id === shopTab,
        disabled: tabs[i].locked,
        font: 13, r: 7,
      });
    }

    var cur = null;
    for (var ti = 0; ti < tabs.length; ti++) if (tabs[ti].id === shopTab) cur = tabs[ti];
    if (cur && cur.locked) {
      c.fillStyle = PAL.cream;
      c.font = 'bold 17px monospace';
      c.textAlign = 'center';
      c.fillText(T(cur.lockKey), W / 2, 220);
    } else {
      drawShopGrid(c);
    }

    drawBagPanel(c);
    drawBuildList(c);

    c.fillStyle = 'rgba(255,244,220,0.8)';
    c.font = '12px monospace';
    c.textAlign = 'center';
    c.fillText(T('shopHint'), W / 2, 340);
  }

  function drawShopGrid(c) {
    var cells = shopGrid();
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var flashing = shopFlashTimer > 0 && shopFlash === cell.type;
      var owned = cell.kind === 'piano' && Game.flags.pianoOwned;

      c.fillStyle = owned ? 'rgba(180,170,150,0.75)'
        : (flashing ? PAL.sun : 'rgba(255, 244, 220, 0.92)');
      E.roundRect(c, cell.x + 4, cell.y + 4, cell.w - 8, cell.h - 8, 8);
      c.fill();
      E.ink(c, flashing ? 3 : 1.8);

      if (cell.kind === 'material') {
        E.drawMaterialIcon(c, cell.type, cell.x + cell.w / 2, cell.y + cell.h / 2 - 8, 46);
        c.fillStyle = PAL.ink;
        c.font = 'bold 11px monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(T('mat_' + cell.type), cell.x + cell.w / 2, cell.y + cell.h - 22);
      } else if (cell.kind === 'furniture') {
        drawFurniture(c, cell.type, cell.x + cell.w / 2, cell.y + cell.h - 24, 'palette');
        c.fillStyle = PAL.ink;
        c.font = 'bold 9px monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(T('furniture_' + cell.type), cell.x + cell.w / 2, cell.y + cell.h - 12);
      } else {
        drawFurniture(c, 'piano', cell.x + cell.w / 2, cell.y + cell.h - 34, 'placed');
        c.fillStyle = PAL.ink;
        c.font = 'bold 15px monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(T(owned ? 'shopPianoSold' : 'furniture_piano'), cell.x + cell.w / 2, cell.y + cell.h - 16);
      }
    }
  }

  function drawBagPanel(c) {
    var p = SHOP.bagPanel;
    panel(c, p.x, p.y, p.w, p.h);
    c.fillStyle = PAL.ink;
    c.font = 'bold 14px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(T('shopCart') + ' ' + Game.bag.items.length + ' / ' + Game.bag.MAX, p.x + 14, p.y + 20);

    for (var i = 0; i < Game.bag.MAX; i++) {
      var s = SHOP.slot;
      var sx = s.x + i * (s.size + s.gap);
      var item = Game.bag.items[i];
      c.fillStyle = item ? '#f6e6c8' : 'rgba(74,51,32,0.12)';
      E.roundRect(c, sx, s.y, s.size, s.size, 8);
      c.fill();
      E.ink(c, item ? 2 : 1.4);
      if (item) drawBagItemIcon(c, item, sx + s.size / 2, s.y + s.size / 2, 34);
    }

    if (Game.bag.items.length === 0) {
      c.fillStyle = 'rgba(74,51,32,0.6)';
      c.font = '11px monospace';
      c.textAlign = 'left';
      c.fillText(T('shopCartEmpty'), p.x + 132, p.y + 20);
    }

    button(c, SHOP.emptyBtn, T('shopEmptyBag'),
      { font: 12, fill: Game.bag.items.length ? '#e88a7a' : 'rgba(255,244,220,0.45)',
        disabled: Game.bag.items.length === 0 });
  }

  function drawBagItemIcon(c, item, cx, cy, size) {
    if (item.kind === 'material') E.drawMaterialIcon(c, item.type, cx, cy, size);
    else drawFurniture(c, item.type, cx, cy + size * 0.36, 'palette');
  }

  function drawBuildList(c) {
    var p = SHOP.listPanel;
    panel(c, p.x, p.y, p.w, p.h);
    c.fillStyle = PAL.ink;
    c.font = 'bold 13px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';

    var stage = currentStage();
    if (!stage) {
      c.fillText(T('buildDone'), p.x + 14, p.y + 24);
      return;
    }
    c.fillText(T('shopBuildList') + ': ' + T('stage_' + stage.id), p.x + 14, p.y + 20);

    var remaining = remainingNeeds(stage);
    var keys = Object.keys(stage.needs);
    var col = 0, row = 0;
    c.font = 'bold 11px monospace';
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var left = remaining[k] || 0;
      var ix = p.x + 16 + col * 98;
      var iy = p.y + 44 + row * 26;
      E.drawMaterialIcon(c, k, ix + 9, iy, 20);
      c.fillStyle = left === 0 ? PAL.leaf : PAL.ink;
      c.textAlign = 'left';
      c.fillText(left === 0 ? '✓' : ('×' + left), ix + 24, iy);
      c.fillStyle = 'rgba(74,51,32,0.75)';
      c.fillText(T('mat_' + k), ix + 44, iy);
      col++;
      if (col >= 3) { col = 0; row++; }
    }

    button(c, SHOP.fillBtn, T('shopFillBag'), { font: 12, fill: PAL.leafLight });
  }

  function handleShopInteriorClick(mx, my) {
    var i;
    if (hit(SHOP.exit, mx, my)) return 'exit';

    var tabs = shopTabs();
    for (i = 0; i < tabs.length; i++) {
      if (hit(shopTabRect(i), mx, my)) {
        if (tabs[i].locked) { showToast(T(tabs[i].lockKey)); Game.audio.play('deny'); return null; }
        shopTab = tabs[i].id;
        return 'select';
      }
    }

    if (hit(SHOP.fillBtn, mx, my)) { fillBag(); return null; }
    if (hit(SHOP.emptyBtn, mx, my)) {
      if (Game.bag.items.length === 0) { Game.audio.play('deny'); return null; }
      /* Everything in the shop is free, so emptying the bag just puts it
         back on the shelf -- nothing to refund. */
      Game.bag.items = [];
      showToast(T('shopBagEmptied'));
      Game.audio.play('drop');
      return null;
    }

    var cur = null;
    for (i = 0; i < tabs.length; i++) if (tabs[i].id === shopTab) cur = tabs[i];
    if (cur && cur.locked) return null;

    var cells = shopGrid();
    for (i = 0; i < cells.length; i++) {
      if (hit(cells[i], mx, my)) { buyItem(cells[i]); return null; }
    }
    return null;
  }

  function buyItem(cell) {
    if (cell.kind === 'piano') {
      if (Game.flags.pianoOwned) { showToast(T('shopPianoSold')); Game.audio.play('deny'); return; }
      if (Game.bag.items.length > 0) { showToast(T('shopPianoHeavy')); Game.audio.play('deny'); return; }
      /* The piano fills the whole bag – heavy, and it keeps delivery simple. */
      for (var i = 0; i < Game.bag.MAX; i++) Game.bag.items.push({ kind: 'piano', type: 'piano' });
      shopFlash = 'piano'; shopFlashTimer = 20;
      showToast(T('shopPianoHeavy'));
      Game.audio.play('pickup');
      return;
    }
    if (Game.bag.items.length >= Game.bag.MAX) {
      showToast(T('bagFull'));
      Game.audio.play('deny');
      return;
    }
    if (hasPianoInBag()) { showToast(T('shopPianoHeavy')); Game.audio.play('deny'); return; }
    Game.bag.items.push({ kind: cell.kind, type: cell.type });
    shopFlash = cell.type;
    shopFlashTimer = 16;
    Game.audio.play('pickup');
  }

  function hasPianoInBag() {
    for (var i = 0; i < Game.bag.items.length; i++) {
      if (Game.bag.items[i].kind === 'piano') return true;
    }
    return false;
  }

  /* Top up the bag with whatever the current stage still needs. */
  function fillBag() {
    var stage = currentStage();
    if (!stage) { showToast(T('buildDone')); Game.audio.play('deny'); return; }
    if (hasPianoInBag()) { showToast(T('shopPianoHeavy')); Game.audio.play('deny'); return; }
    var remaining = remainingNeeds(stage);
    /* Subtract what is already in the bag so a second press doesn't
       double-load the same planks. */
    for (var b = 0; b < Game.bag.items.length; b++) {
      var it = Game.bag.items[b];
      if (it.kind === 'material' && remaining[it.type] > 0) remaining[it.type]--;
    }
    var added = 0;
    var keys = Object.keys(remaining);
    for (var i = 0; i < keys.length; i++) {
      while (remaining[keys[i]] > 0 && Game.bag.items.length < Game.bag.MAX) {
        Game.bag.items.push({ kind: 'material', type: keys[i] });
        remaining[keys[i]]--;
        added++;
      }
    }
    if (added > 0) { shopTab = 'materials'; Game.audio.play('pickup'); }
    else { showToast(T('bagFull')); Game.audio.play('deny'); }
  }

  /* ---- Build-stage maths (shared by shop, HUD and engine) ---- */
  function currentStage() {
    var idx = Game.build.stageIndex;
    if (idx >= Game.BUILD_STAGES.length) return null;
    return Game.BUILD_STAGES[idx];
  }

  /* Materials sit in one pile (Game.build.stock). Anything left over after
     a stage completes stays in the pile and counts toward the next one, so
     an over-delivery is never wasted. */
  function remainingNeeds(stage) {
    var out = {};
    var keys = Object.keys(stage.needs);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      out[k] = Math.max(0, stage.needs[k] - (Game.build.stock[k] || 0));
    }
    return out;
  }

  function stageSatisfied(stage) {
    var r = remainingNeeds(stage);
    var keys = Object.keys(r);
    for (var i = 0; i < keys.length; i++) if (r[keys[i]] > 0) return false;
    return true;
  }

  /* ================================================================
     Build HUD, bag pips, prompts, carry overlay
     ================================================================ */

  function drawBuildHud(c) {
    var stage = currentStage();
    var px = 12, py = 10, pw = 236, ph = 62;
    panel(c, px, py, pw, ph, 'rgba(255, 244, 220, 0.88)');
    c.fillStyle = PAL.ink;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    if (!stage) {
      c.font = 'bold 14px monospace';
      c.fillText(T('buildDone'), px + 14, py + ph / 2);
      return;
    }
    c.font = 'bold 11px monospace';
    c.fillStyle = 'rgba(74,51,32,0.7)';
    c.fillText(T('buildNext'), px + 12, py + 15);
    c.font = 'bold 15px monospace';
    c.fillStyle = PAL.ink;
    c.fillText(T('stage_' + stage.id), px + 12, py + 33);

    var remaining = remainingNeeds(stage);
    var keys = Object.keys(stage.needs);
    var ix = px + 12;
    c.font = 'bold 10px monospace';
    for (var i = 0; i < keys.length && i < 5; i++) {
      var left = remaining[keys[i]] || 0;
      E.drawMaterialIcon(c, keys[i], ix + 8, py + 50, 17);
      c.fillStyle = left === 0 ? PAL.leaf : PAL.ink;
      c.fillText(left === 0 ? '✓' : ('×' + left), ix + 19, py + 52);
      ix += 44;
    }
  }

  function drawBagHud(c) {
    var n = Game.bag.MAX;
    var size = 34, gap = 6;
    var totalW = n * size + (n - 1) * gap;
    var x0 = W - totalW - 16, y0 = 12;
    c.save();
    c.globalAlpha = 0.9;
    c.fillStyle = 'rgba(255,244,220,0.8)';
    E.roundRect(c, x0 - 10, y0 - 8, totalW + 20, size + 16, 10);
    c.fill();
    c.restore();
    E.roundRect(c, x0 - 10, y0 - 8, totalW + 20, size + 16, 10);
    E.ink(c, 2);
    for (var i = 0; i < n; i++) {
      var sx = x0 + i * (size + gap);
      var item = Game.bag.items[i];
      c.fillStyle = item ? '#f6e6c8' : 'rgba(74,51,32,0.14)';
      E.roundRect(c, sx, y0, size, size, 6);
      c.fill();
      E.ink(c, 1.4);
      if (item) drawBagItemIcon(c, item, sx + size / 2, y0 + size / 2, 22);
    }
  }

  /* Bobbing icons above the player's head so it's obvious she's loaded. */
  function drawCarryOverlay(c, player, camX) {
    var n = Game.bag.items.length;
    if (n === 0) return;
    var sx = player.x - camX;
    var baseY = player.y - 74;
    for (var i = 0; i < n; i++) {
      var offset = (i - (n - 1) / 2) * 20;
      var bob = Math.sin(t / 14 + i * 0.9) * 3;
      c.save();
      c.globalAlpha = 0.95;
      E.fillEllipse(c, sx + offset, baseY + bob, 11, 11, 'rgba(255,244,220,0.9)');
      drawBagItemIcon(c, Game.bag.items[i], sx + offset, baseY + bob, 16);
      c.restore();
    }
  }

  /* Floating "press DO to ..." bubble above an interactable. */
  function drawPrompt(c, sx, sy, label) {
    var bob = Math.sin(t / 12) * 3;
    c.font = 'bold 13px monospace';
    var w = c.measureText(label).width + 34;
    var x = sx - w / 2, y = sy + bob;
    c.fillStyle = 'rgba(255, 244, 220, 0.95)';
    E.roundRect(c, x, y, w, 30, 15);
    c.fill();
    E.ink(c, 2);
    E.fillEllipse(c, x + 16, y + 15, 9, 9, PAL.sun);
    c.fillStyle = PAL.ink;
    c.font = 'bold 10px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(Game.input.isTouch() ? T('actionBtn') : '␣', x + 16, y + 16);
    c.font = 'bold 13px monospace';
    c.fillText(label, x + 16 + (w - 16) / 2, y + 16);
  }

  /* ================================================================
     Build cutscene
     ================================================================ */
  var cutscene = { timer: 0, stageId: null, particles: [] };

  function startBuildCutscene(stageId) {
    cutscene.timer = 110;
    cutscene.stageId = stageId;
    cutscene.particles = [];
    Game.audio.play('build');
  }

  function updateBuildCutscene() {
    cutscene.timer--;
    for (var i = cutscene.particles.length - 1; i >= 0; i--) {
      cutscene.particles[i].update();
      if (cutscene.particles[i].life <= 0) cutscene.particles.splice(i, 1);
    }
    if (cutscene.timer % 7 === 0 && cutscene.timer > 40) {
      E.spawnBurst(cutscene.particles, 400 + (Math.random() - 0.5) * 260, 250,
        6, [PAL.sun, PAL.cream, PAL.leafLight], 3.4);
    }
    return cutscene.timer <= 0 ? 'done' : null;
  }

  function drawBuildCutsceneOverlay(c) {
    var a = Math.min(1, cutscene.timer / 30);
    c.save();
    c.globalAlpha = a * 0.55;
    c.fillStyle = '#241708';
    c.fillRect(0, 0, W, H);
    c.restore();

    for (var i = 0; i < cutscene.particles.length; i++) cutscene.particles[i].draw(c);

    c.save();
    c.globalAlpha = a;
    panel(c, 220, 178, 360, 104);
    c.fillStyle = PAL.ink;
    c.font = 'bold 15px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(T('stageBuilt'), 400, 208);
    c.font = 'bold 22px monospace';
    c.fillStyle = '#3b6b2a';
    c.fillText(T('stage_' + cutscene.stageId), 400, 244);
    c.restore();
  }

  /* ================================================================
     Exterior customizer
     ================================================================ */

  var EXT = {
    previewX: 18, previewY: 52, previewW: 316, previewH: 404,
    tabX: 348, tabY: 58, tabW: 86, tabH: 36, tabGap: 4,
    gridX: 350, gridY: 106, cellW: 212, cellH: 62, cols: 2, gap: 8,
    swatchX: 352, swatchY: 316, swatchSize: 42, swatchGap: 12,
    done: { x: 636, y: 410, w: 148, h: 46 },
  };
  var extTab = 'wall';

  function extTabRect(i) {
    return { x: EXT.tabX + i * (EXT.tabW + EXT.tabGap), y: EXT.tabY, w: EXT.tabW, h: EXT.tabH };
  }
  function extCellRect(i) {
    var col = i % EXT.cols, row = Math.floor(i / EXT.cols);
    return {
      x: EXT.gridX + col * (EXT.cellW + EXT.gap),
      y: EXT.gridY + row * (EXT.cellH + EXT.gap),
      w: EXT.cellW, h: EXT.cellH,
    };
  }
  function extSwatchRect(i) {
    return {
      x: EXT.swatchX + i * (EXT.swatchSize + EXT.swatchGap),
      y: EXT.swatchY, w: EXT.swatchSize, h: EXT.swatchSize,
    };
  }
  function getExtTab(id) {
    for (var i = 0; i < Game.EXT_TABS.length; i++) if (Game.EXT_TABS[i].id === id) return Game.EXT_TABS[i];
    return Game.EXT_TABS[0];
  }

  function drawExteriorScreen(c) {
    t++;
    var ext = Game.exterior;
    var tab = getExtTab(extTab);

    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PAL.sky);
    g.addColorStop(1, '#dff0d8');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    c.fillStyle = PAL.ink;
    c.font = 'bold 22px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(T('extTitle'), 20, 28);

    /* Live preview */
    panel(c, EXT.previewX, EXT.previewY, EXT.previewW, EXT.previewH, '#cfe9f2');
    c.save();
    c.beginPath();
    E.roundRect(c, EXT.previewX + 2, EXT.previewY + 2, EXT.previewW - 4, EXT.previewH - 4, 9);
    c.clip();
    c.fillStyle = PAL.grass;
    c.fillRect(EXT.previewX, EXT.previewY + EXT.previewH - 48, EXT.previewW, 48);
    Game.tree.drawTreePreview(c, EXT.previewX + EXT.previewW / 2,
      EXT.previewY + EXT.previewH - 40, 0.72, Game.BUILD_STAGES.length, ext, t);
    c.restore();

    /* Tabs */
    for (var i = 0; i < Game.EXT_TABS.length; i++) {
      button(c, extTabRect(i), T(Game.EXT_TABS[i].labelKey),
        { active: Game.EXT_TABS[i].id === extTab, font: 11, r: 7 });
    }

    if (tab.toggles) {
      for (var d = 0; d < tab.toggles.length; d++) {
        var dr = extCellRect(d);
        var on = !!ext.decor[tab.toggles[d]];
        c.fillStyle = on ? PAL.leafLight : 'rgba(255,244,220,0.9)';
        E.roundRect(c, dr.x, dr.y, dr.w, dr.h, 8);
        c.fill();
        E.ink(c, on ? 3 : 1.8);
        /* checkbox */
        c.fillStyle = on ? PAL.leaf : 'rgba(74,51,32,0.15)';
        E.roundRect(c, dr.x + 12, dr.y + dr.h / 2 - 11, 22, 22, 5);
        c.fill();
        E.ink(c, 1.6);
        if (on) {
          c.strokeStyle = PAL.cream;
          c.lineWidth = 3;
          c.beginPath();
          c.moveTo(dr.x + 17, dr.y + dr.h / 2);
          c.lineTo(dr.x + 22, dr.y + dr.h / 2 + 5);
          c.lineTo(dr.x + 29, dr.y + dr.h / 2 - 6);
          c.stroke();
        }
        c.fillStyle = PAL.ink;
        c.font = 'bold 13px monospace';
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText(T(tab.labelPrefix + tab.toggles[d]), dr.x + 46, dr.y + dr.h / 2);
      }
    } else {
      for (var v = 0; v < tab.variants.length; v++) {
        var r = extCellRect(v);
        var sel = ext[tab.field] === tab.variants[v];
        c.fillStyle = sel ? PAL.sun : 'rgba(255,244,220,0.9)';
        E.roundRect(c, r.x, r.y, r.w, r.h, 8);
        c.fill();
        E.ink(c, sel ? 3 : 1.8);
        drawExtIcon(c, tab.id, tab.variants[v], r.x + 34, r.y + r.h / 2, ext);
        c.fillStyle = PAL.ink;
        c.font = 'bold 13px monospace';
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText(T(tab.labelPrefix + tab.variants[v]), r.x + 68, r.y + r.h / 2);
      }
    }

    if (tab.colorField && tab.colors) {
      for (var s = 0; s < tab.colors.length; s++) {
        var sr = extSwatchRect(s);
        c.fillStyle = tab.colors[s];
        E.roundRect(c, sr.x, sr.y, sr.w, sr.h, 8);
        c.fill();
        E.ink(c, ext[tab.colorField] === tab.colors[s] ? 4 : 1.8);
      }
    }

    button(c, EXT.done, T('extDone'), { fill: PAL.leafLight, font: 17 });
  }

  function drawExtIcon(c, tabId, id, cx, cy, ext) {
    c.save();
    c.translate(cx, cy);
    switch (tabId) {
      case 'wall':
        E.fillRound(c, -22, -16, 44, 32, 4, ext.wallColor);
        c.save();
        c.beginPath(); E.roundRect(c, -21, -15, 42, 30, 3); c.clip();
        if (id === 'plank') {
          c.strokeStyle = E.shade(ext.wallColor, -22); c.lineWidth = 1.4;
          for (var y = -8; y < 16; y += 8) { c.beginPath(); c.moveTo(-22, y); c.lineTo(22, y); c.stroke(); }
        } else if (id === 'log') {
          for (var ly = -10; ly < 18; ly += 11) E.fillEllipse(c, 0, ly, 23, 5.5, E.shade(ext.wallColor, 8));
        } else if (id === 'shingle') {
          for (var sy = -14, row = 0; sy < 18; sy += 8, row++) {
            for (var sx = -24 + (row % 2) * 7; sx < 24; sx += 14) {
              E.fillEllipse(c, sx, sy, 7, 5, E.shade(ext.wallColor, row % 2 ? 6 : -6), false);
            }
          }
        } else {
          c.save(); c.globalAlpha = 0.25;
          for (var d = 0; d < 30; d++) {
            E.fillEllipse(c, -22 + ((d * 17) % 44), -16 + ((d * 11) % 32), 2, 2, E.shade(ext.wallColor, -40), false);
          }
          c.restore();
        }
        c.restore();
        E.roundRect(c, -22, -16, 44, 32, 4); E.ink(c, 2);
        break;
      case 'roof':
        if (id === 'gable') E.fillPath(c, [[-24, 14], [0, -14], [24, 14]], ext.roofColor);
        else if (id === 'round') {
          c.beginPath(); c.moveTo(-24, 14);
          c.quadraticCurveTo(0, -24, 24, 14); c.closePath();
          c.fillStyle = ext.roofColor; c.fill(); E.ink(c, 2);
        } else if (id === 'thatch') {
          c.beginPath(); c.moveTo(-24, 14);
          c.quadraticCurveTo(-10, -12, 0, -15);
          c.quadraticCurveTo(10, -12, 24, 14); c.closePath();
          c.fillStyle = '#d9bb72'; c.fill(); E.ink(c, 2);
        } else {
          E.fillPath(c, [[-24, 14], [-16, -6], [16, -6], [24, 14]], PAL.bark);
          E.fillPath(c, [[-20, 0], [-14, -10], [14, -10], [20, 0]], PAL.grassDark);
          E.fillEllipse(c, -6, -10, 6, 5, PAL.leafLight, false);
          E.fillEllipse(c, 7, -10, 6, 5, PAL.leafLight, false);
        }
        break;
      case 'door':
        var wd = 24, hd = 32;
        if (id === 'round') {
          c.beginPath();
          c.moveTo(-wd / 2, 16); c.lineTo(-wd / 2, 16 - hd + wd / 2);
          c.arc(0, 16 - hd + wd / 2, wd / 2, Math.PI, 0);
          c.lineTo(wd / 2, 16); c.closePath();
          c.fillStyle = '#a9773f'; c.fill(); E.ink(c, 2);
        } else if (id === 'arched') {
          c.beginPath();
          c.moveTo(-wd / 2, 16); c.lineTo(-wd / 2, -6);
          c.quadraticCurveTo(0, -22, wd / 2, -6);
          c.lineTo(wd / 2, 16); c.closePath();
          c.fillStyle = '#a9773f'; c.fill(); E.ink(c, 2);
        } else if (id === 'dutch') {
          E.fillRound(c, -wd / 2, -16, wd, 14, 3, '#a9773f');
          E.fillRound(c, -wd / 2, 1, wd, 15, 3, E.shade('#a9773f', -12));
        } else {
          E.fillRound(c, -wd / 2, -16, wd, hd, 4, '#a9773f');
          c.beginPath();
          c.moveTo(0, -1);
          c.bezierCurveTo(-9, -9, -5, -16, 0, -12);
          c.bezierCurveTo(5, -16, 9, -9, 0, -1);
          c.closePath();
          c.fillStyle = PAL.sky; c.fill(); E.ink(c, 1.6);
        }
        break;
      case 'window':
        var s = 28;
        if (id === 'square') { E.fillRound(c, -s / 2 - 3, -s / 2 - 3, s + 6, s + 6, 3, PAL.cream); E.fillRound(c, -s / 2, -s / 2, s, s, 2, PAL.sky); }
        else if (id === 'round') { E.fillEllipse(c, 0, 0, s / 2 + 3, s / 2 + 3, PAL.cream); E.fillEllipse(c, 0, 0, s / 2, s / 2, PAL.sky); }
        else if (id === 'diamond') { E.fillPath(c, [[0, -s / 2 - 3], [s / 2 + 3, 0], [0, s / 2 + 3], [-s / 2 - 3, 0]], PAL.cream); E.fillPath(c, [[0, -s / 2], [s / 2, 0], [0, s / 2], [-s / 2, 0]], PAL.sky); }
        else { E.fillPath(c, [[-s / 2 - 5, -s / 2 - 3], [s / 2 + 5, -s / 2 - 3], [s / 2, s / 2 + 3], [-s / 2, s / 2 + 3]], PAL.cream); E.fillRound(c, -s / 2 + 1, -s / 2, s - 2, s, 2, PAL.sky); }
        break;
    }
    c.restore();
  }

  function handleExteriorClick(mx, my) {
    var ext = Game.exterior;
    var tab = getExtTab(extTab);
    var i;
    for (i = 0; i < Game.EXT_TABS.length; i++) {
      if (hit(extTabRect(i), mx, my)) { extTab = Game.EXT_TABS[i].id; return 'select'; }
    }
    if (tab.toggles) {
      for (i = 0; i < tab.toggles.length; i++) {
        if (hit(extCellRect(i), mx, my)) {
          ext.decor[tab.toggles[i]] = !ext.decor[tab.toggles[i]];
          return 'select';
        }
      }
    } else {
      for (i = 0; i < tab.variants.length; i++) {
        if (hit(extCellRect(i), mx, my)) { ext[tab.field] = tab.variants[i]; return 'select'; }
      }
    }
    if (tab.colorField && tab.colors) {
      for (i = 0; i < tab.colors.length; i++) {
        if (hit(extSwatchRect(i), mx, my)) { ext[tab.colorField] = tab.colors[i]; return 'select'; }
      }
    }
    if (hit(EXT.done, mx, my)) return 'done';
    return null;
  }

  /* ================================================================
     House interior

     Laid out like the house-decorating screen in momoko-in-space: the
     palette strip lives across the top (title, Clear All, category tabs,
     item tiles), and the room below is a walk-around floor. Momoko walks
     it in 2D and everything -- furniture, Momoko, the friend who lives
     here -- is depth-sorted by y so she can stand behind or in front of
     the furniture.
     ================================================================ */

  var ROOM = {
    /* top bar */
    tabX: 12, tabY: 6, tabW: 118, tabH: 32, tabGap: 6,
    exit: { x: 648, y: 6, w: 138, h: 32 },
    /* palette strip */
    stripY: 44, stripH: 154,
    clear: { x: 690, y: 50, w: 96, h: 26 },
    catX: 12, catY: 78, catW: 96, catH: 26, catGap: 2,
    itemX: 20, itemY: 110, itemW: 68, itemH: 78, itemGap: 10,
    /* the room */
    wallTop: 198, floorY: 252,
    /* `top` is far enough down the floor that even the tallest piece (the
       piano, ~104px) clears the palette strip above. */
    floor: { left: 34, right: 700, top: 300, bottom: 452 },
    door: { x: 744, y: 372 },
  };
  var roomCat = 'sleep';
  var selectedPiece = null;
  /* Each room remembers where Momoko was standing. */
  var roomPos = {};
  var roomPlayer = null;

  function roomTabRect(i) {
    return { x: ROOM.tabX + i * (ROOM.tabW + ROOM.tabGap), y: ROOM.tabY, w: ROOM.tabW, h: ROOM.tabH };
  }
  function catRect(i) {
    return { x: ROOM.catX + i * (ROOM.catW + ROOM.catGap), y: ROOM.catY, w: ROOM.catW, h: ROOM.catH };
  }
  function paletteItemRect(i) {
    return { x: ROOM.itemX + i * (ROOM.itemW + ROOM.itemGap), y: ROOM.itemY, w: ROOM.itemW, h: ROOM.itemH };
  }

  function roomDef(id) {
    for (var i = 0; i < Game.ROOMS.length; i++) if (Game.ROOMS[i].id === id) return Game.ROOMS[i];
    return Game.ROOMS[0];
  }

  /* Every furniture type in the current category, owned or not. Showing the
     whole catalogue (dimmed when you don't own a piece yet) is what makes it
     obvious that furniture comes from the shop. */
  function paletteItems() {
    var store = Game.furnitureStock;
    var out = [];
    for (var i = 0; i < Game.FURNITURE_TYPES.length; i++) {
      var ft = Game.FURNITURE_TYPES[i];
      if (ft.cat !== roomCat) continue;
      out.push({ type: ft.type, count: store[ft.type] || 0 });
    }
    if (roomCat === 'fun' && (store.piano || 0) > 0) {
      out.push({ type: 'piano', count: store.piano });
    }
    return out;
  }

  function getRoomPos(id) {
    if (!roomPos[id]) roomPos[id] = { x: 150, y: 410 };
    return roomPos[id];
  }

  function ensureRoomPlayer() {
    if (!roomPlayer) roomPlayer = new E.Player(150, 410);
    var p = getRoomPos(Game.currentRoom);
    roomPlayer.x = p.x;
    roomPlayer.y = p.y;
    return roomPlayer;
  }

  /* Where the friend who lives in this room stands. */
  function friendSpot() { return { x: 592, y: 336 }; }

  function residentOf(roomId) {
    for (var i = 0; i < Game.FRIEND_DEFS.length; i++) {
      var d = Game.FRIEND_DEFS[i];
      if (d.homeRoom === roomId && Game.friends[d.id] && Game.friends[d.id].unlocked) return d;
    }
    return null;
  }

  function findPiano(items) {
    for (var i = 0; i < items.length; i++) if (items[i].type === 'piano') return items[i];
    return null;
  }

  /* A selection can outlive its stock -- place the last one, reload with a
     stale selection, clear a room. Drop it rather than leaving a piece
     selected that can never be placed (taps would silently do nothing). */
  function validateSelection() {
    if (selectedPiece && !(Game.furnitureStock[selectedPiece] > 0)) selectedPiece = null;
  }

  /* ---- update ---- */
  function updateHouseInterior(keys, jp) {
    validateSelection();
    var p = ensureRoomPlayer();
    var f = ROOM.floor;
    var moving = false;
    var SP = 3.2;

    if (keys.left && !keys.right) { p.x -= SP; p.facing = -1; moving = true; }
    else if (keys.right && !keys.left) { p.x += SP; p.facing = 1; moving = true; }
    if (keys.up && !keys.down) { p.y -= SP * 0.72; moving = true; }
    else if (keys.down && !keys.up) { p.y += SP * 0.72; moving = true; }

    if (p.x < f.left) p.x = f.left;
    if (p.x > f.right) p.x = f.right;
    if (p.y < f.top) p.y = f.top;
    if (p.y > f.bottom) p.y = f.bottom;
    p.animate(moving);

    var store = getRoomPos(Game.currentRoom);
    store.x = p.x;
    store.y = p.y;

    if (jp.action) {
      var near = nearestInRoom(p);
      if (near) return near;
    }
    /* Escape / the pause button walks her back outside. */
    if (jp.pause) return 'exit';
    return null;
  }

  /* What Momoko is standing next to, if anything. */
  function nearestInRoom(p) {
    var items = Game.rooms[Game.currentRoom] || [];
    var piano = findPiano(items);
    if (piano && Math.abs(p.x - piano.x) < 70 && Math.abs(p.y - piano.y) < 70) return 'piano';
    var resident = residentOf(Game.currentRoom);
    if (resident) {
      var fs = friendSpot();
      if (Math.abs(p.x - fs.x) < 62 && Math.abs(p.y - fs.y) < 62) return 'design:' + resident.id;
    }
    if (Math.abs(p.x - ROOM.floor.right) < 40 && Math.abs(p.y - ROOM.door.y) < 80) return 'exit';
    return null;
  }

  /* ---- draw ---- */
  function drawHouseInterior(c) {
    t++;
    var rd = roomDef(Game.currentRoom);
    var items = Game.rooms[Game.currentRoom] || [];
    var p = ensureRoomPlayer();

    /* Back wall */
    var g = c.createLinearGradient(0, ROOM.wallTop, 0, ROOM.floorY);
    g.addColorStop(0, rd.wallA);
    g.addColorStop(1, rd.wallB);
    c.fillStyle = g;
    c.fillRect(0, ROOM.wallTop, W, ROOM.floorY - ROOM.wallTop);
    c.save();
    c.globalAlpha = 0.13;
    c.strokeStyle = PAL.ink;
    c.lineWidth = 2;
    for (var wy = ROOM.wallTop + 16; wy < ROOM.floorY; wy += 18) {
      c.beginPath(); c.moveTo(0, wy); c.lineTo(W, wy); c.stroke();
    }
    c.restore();

    drawInteriorWindow(c, 150, ROOM.wallTop + 4, rd);
    drawInteriorWindow(c, 470, ROOM.wallTop + 4, rd);

    /* Floor, in perspective so the room reads as a space you walk around */
    c.fillStyle = rd.floor;
    c.fillRect(0, ROOM.floorY, W, H - ROOM.floorY);
    c.save();
    c.globalAlpha = 0.4;
    c.strokeStyle = E.shade(rd.floor, -26);
    c.lineWidth = 2;
    for (var i = -6; i <= 20; i++) {
      var topX = i * 60;
      c.beginPath();
      c.moveTo(topX, ROOM.floorY);
      c.lineTo(W / 2 + (topX - W / 2) * 2.1, H);
      c.stroke();
    }
    for (var d = 0; d < 6; d++) {
      var yy = ROOM.floorY + Math.pow(d / 5, 1.7) * (H - ROOM.floorY);
      c.beginPath(); c.moveTo(0, yy); c.lineTo(W, yy); c.stroke();
    }
    c.restore();
    /* Skirting board */
    c.fillStyle = PAL.bark;
    c.fillRect(0, ROOM.floorY - 10, W, 10);

    drawRoomDoor(c);

    /* Depth-sorted: furniture, Momoko and the resident friend all mingle. */
    var layer = [];
    for (var fi = 0; fi < items.length; fi++) {
      layer.push({ y: items[fi].y, item: items[fi] });
    }
    var resident = residentOf(Game.currentRoom);
    var fs = friendSpot();
    if (resident) layer.push({ y: fs.y, friend: resident });
    layer.push({ y: p.y, player: true });
    layer.sort(function (a, b) { return a.y - b.y; });

    for (var li = 0; li < layer.length; li++) {
      var e = layer[li];
      if (e.item) drawFurniture(c, e.item.type, e.item.x, e.item.y, 'placed', e.item.flip);
      else if (e.friend) E.drawCharacter(c, fs.x, fs.y, Game.friends[e.friend.id].cust, 0, -1, 1, false);
      else E.drawCharacter(c, p.x, p.y, Game.customization, p.frame, p.facing, 1, p.blink);
    }

    /* Prompts for whatever she is standing next to */
    var near = nearestInRoom(p);
    if (near === 'piano') {
      var pi = findPiano(items);
      drawPrompt(c, pi.x, pi.y - 132, T('promptPiano'));
    } else if (near && near.indexOf('design:') === 0) {
      drawPrompt(c, fs.x, fs.y - 106, T('promptTalk'));
    } else if (near === 'exit') {
      drawPrompt(c, ROOM.door.x - 30, ROOM.door.y - 118, T('furnitureExit'));
    }

    drawPalette(c);
    drawRoomTabs(c);

    /* Placement call-out sits over the room, where the eye already is. */
    if (selectedPiece) {
      var bw = 420, bx = (W - bw) / 2;
      c.save();
      c.globalAlpha = 0.94;
      panel(c, bx, 210, bw, 38, PAL.sun);
      c.restore();
      c.fillStyle = PAL.ink;
      c.font = 'bold 14px monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(T('furnitureTapFloor'), W / 2, 229);
      /* Translucent ghost of the piece, bobbing, so it's clear what lands. */
      c.save();
      c.globalAlpha = 0.42 + Math.sin(t / 12) * 0.14;
      drawFurniture(c, selectedPiece, W / 2, 396 + Math.sin(t / 12) * 4, 'placed');
      c.restore();
    }

    drawToast(c);
  }

  function drawRoomDoor(c) {
    var d = ROOM.door;
    E.fillRound(c, d.x - 34, d.y - 104, 68, 104, 6, '#a9773f');
    E.fillRound(c, d.x - 26, d.y - 94, 52, 44, 4, '#c69a5e');
    E.fillEllipse(c, d.x + 20, d.y - 50, 4, 4, PAL.sun);
    /* Daylight spilling in past the frame */
    c.save();
    c.globalAlpha = 0.22;
    E.fillPath(c, [[d.x - 34, d.y], [d.x + 34, d.y], [d.x + 54, d.y + 26], [d.x - 54, d.y + 26]], PAL.sun, true, false);
    c.restore();
  }

  function drawInteriorWindow(c, cx, cy, rd) {
    E.fillRound(c, cx - 44, cy, 88, 40, 5, PAL.cream);
    E.fillRound(c, cx - 38, cy + 5, 76, 30, 3, PAL.sky);
    c.save();
    c.beginPath(); E.roundRect(c, cx - 38, cy + 5, 76, 30, 3); c.clip();
    E.fillEllipse(c, cx - 18, cy + 34, 28, 20, PAL.leaf, false);
    E.fillEllipse(c, cx + 22, cy + 30, 24, 18, PAL.leafDark, false);
    E.fillEllipse(c, cx + 2, cy + 16, 20, 14, PAL.leafLight, false);
    c.restore();
    c.strokeStyle = PAL.cream;
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(cx, cy + 5); c.lineTo(cx, cy + 35);
    c.moveTo(cx - 38, cy + 20); c.lineTo(cx + 38, cy + 20);
    c.stroke();
    E.roundRect(c, cx - 44, cy, 88, 40, 5);
    E.ink(c, 2.5);
    c.fillStyle = rd.accent;
    E.fillPath(c, [[cx - 48, cy - 4], [cx + 48, cy - 4], [cx + 48, cy + 6], [cx - 48, cy + 6]], rd.accent);
  }

  function drawRoomTabs(c) {
    c.fillStyle = 'rgba(59, 42, 22, 0.92)';
    c.fillRect(0, 0, W, ROOM.stripY);
    for (var i = 0; i < Game.ROOMS.length; i++) {
      button(c, roomTabRect(i), T(Game.ROOMS[i].nameKey),
        { active: Game.ROOMS[i].id === Game.currentRoom, font: 12, r: 7 });
    }
    button(c, ROOM.exit, T('furnitureExit'), { font: 13, fill: PAL.leafLight });
  }

  function drawPalette(c) {
    c.fillStyle = 'rgba(36, 23, 8, 0.86)';
    c.fillRect(0, ROOM.stripY, W, ROOM.stripH);
    c.strokeStyle = 'rgba(255, 210, 74, 0.45)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, ROOM.stripY + ROOM.stripH);
    c.lineTo(W, ROOM.stripY + ROOM.stripH);
    c.stroke();

    c.fillStyle = PAL.sun;
    c.font = 'bold 14px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(T('furnitureTitle'), 14, ROOM.stripY + 18);
    /* The two-step instruction, right where the two steps happen. */
    c.fillStyle = 'rgba(255, 244, 220, 0.8)';
    c.font = '11px monospace';
    c.fillText(T('furnitureHint'), 152, ROOM.stripY + 18);

    button(c, ROOM.clear, T('furnitureClear'), { font: 11, fill: '#e88a7a', r: 6 });

    for (var i = 0; i < Game.FURNITURE_CATEGORIES.length; i++) {
      button(c, catRect(i), T('furnitureCat_' + Game.FURNITURE_CATEGORIES[i]),
        { active: Game.FURNITURE_CATEGORIES[i] === roomCat, font: 10, r: 6 });
    }

    var items = paletteItems();
    for (var k = 0; k < items.length && k < 9; k++) {
      var ir = paletteItemRect(k);
      var owned = items[k].count > 0;
      var sel = selectedPiece === items[k].type;
      c.fillStyle = sel ? PAL.sun : (owned ? 'rgba(255,244,220,0.95)' : 'rgba(255,244,220,0.28)');
      E.roundRect(c, ir.x, ir.y, ir.w, ir.h, 8);
      c.fill();
      E.ink(c, sel ? 3.5 : 1.6);

      c.save();
      if (!owned) c.globalAlpha = 0.45;
      drawFurniture(c, items[k].type, ir.x + ir.w / 2, ir.y + ir.h - 22, 'palette');
      c.restore();

      c.fillStyle = owned ? PAL.ink : 'rgba(74,51,32,0.6)';
      c.font = 'bold 8px monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(T('furniture_' + items[k].type), ir.x + ir.w / 2, ir.y + ir.h - 9);

      /* Count badge, or a little cart when you don't own one yet. */
      if (owned) {
        E.fillEllipse(c, ir.x + ir.w - 10, ir.y + 10, 10, 10, PAL.leaf);
        c.fillStyle = PAL.cream;
        c.font = 'bold 11px monospace';
        c.fillText(String(items[k].count), ir.x + ir.w - 10, ir.y + 10);
      } else {
        E.fillEllipse(c, ir.x + ir.w - 10, ir.y + 10, 10, 10, 'rgba(74,51,32,0.5)');
        c.fillStyle = PAL.cream;
        c.font = 'bold 10px monospace';
        c.fillText('0', ir.x + ir.w - 10, ir.y + 10);
      }
    }
  }

  /* ---- clicks ---- */
  function handleHouseInteriorClick(mx, my) {
    var i;
    validateSelection();
    for (i = 0; i < Game.ROOMS.length; i++) {
      if (hit(roomTabRect(i), mx, my)) {
        Game.currentRoom = Game.ROOMS[i].id;
        selectedPiece = null;
        ensureRoomPlayer();
        return 'select';
      }
    }
    if (hit(ROOM.exit, mx, my)) return 'exit';
    if (hit(ROOM.clear, mx, my)) { clearRoom(); return null; }

    for (i = 0; i < Game.FURNITURE_CATEGORIES.length; i++) {
      if (hit(catRect(i), mx, my)) {
        roomCat = Game.FURNITURE_CATEGORIES[i];
        selectedPiece = null;
        return 'select';
      }
    }

    var items = paletteItems();
    for (i = 0; i < items.length && i < 9; i++) {
      if (hit(paletteItemRect(i), mx, my)) {
        if (items[i].count <= 0) {
          showToast(T('furnitureNeedBuy'));
          Game.audio.play('deny');
          return null;
        }
        selectedPiece = (selectedPiece === items[i].type) ? null : items[i].type;
        return 'select';
      }
    }

    /* Below the palette strip is the room itself. */
    if (my > ROOM.stripY + ROOM.stripH) {
      if (selectedPiece) { placePiece(mx, my); return null; }

      var placed = Game.rooms[Game.currentRoom] || [];
      var pianoItem = findPiano(placed);
      if (pianoItem && Math.abs(mx - pianoItem.x) < 60 && my > pianoItem.y - 100 && my < pianoItem.y + 20) {
        return 'piano';
      }
      var resident = residentOf(Game.currentRoom);
      var fs = friendSpot();
      if (resident && Math.abs(mx - fs.x) < 44 && my > fs.y - 96 && my < fs.y + 16) {
        return 'design:' + resident.id;
      }
      if (Math.abs(mx - ROOM.door.x) < 40 && my > ROOM.door.y - 110 && my < ROOM.door.y + 10) {
        return 'exit';
      }
      /* Otherwise pick up whatever was tapped, topmost first. */
      for (i = placed.length - 1; i >= 0; i--) {
        var it = placed[i];
        if (Math.abs(mx - it.x) < 42 && my > it.y - 78 && my < it.y + 18) {
          placed.splice(i, 1);
          addStock(it.type, 1);
          if (it.type === 'piano') Game.flags.pianoPlaced = anyPianoPlaced();
          Game.audio.play('drop');
          saveRooms();
          return null;
        }
      }
    }
    return null;
  }

  function placePiece(mx, my) {
    var type = selectedPiece;
    var store = Game.furnitureStock;
    if (!store[type]) { selectedPiece = null; return; }
    var f = ROOM.floor;
    var x = Math.max(f.left, Math.min(f.right, mx));
    var y = Math.max(f.top, Math.min(f.bottom, my));
    Game.rooms[Game.currentRoom].push({ type: type, x: x, y: y, flip: false });
    store[type]--;
    if (store[type] <= 0) {
      delete store[type];
      selectedPiece = null;
    }
    if (type === 'piano') {
      Game.flags.pianoPlaced = true;
      Game.audio.play('sparkle');
    } else {
      Game.audio.play('drop');
    }
    saveRooms();
  }

  function clearRoom() {
    var placed = Game.rooms[Game.currentRoom] || [];
    if (placed.length === 0) { Game.audio.play('deny'); return; }
    for (var i = 0; i < placed.length; i++) addStock(placed[i].type, 1);
    Game.rooms[Game.currentRoom] = [];
    Game.flags.pianoPlaced = anyPianoPlaced();
    Game.audio.play('drop');
    showToast(T('furniturePickUp'));
    saveRooms();
  }

  function anyPianoPlaced() {
    for (var i = 0; i < Game.ROOMS.length; i++) {
      if (findPiano(Game.rooms[Game.ROOMS[i].id] || [])) return true;
    }
    return false;
  }

  function addStock(type, n) {
    Game.furnitureStock[type] = (Game.furnitureStock[type] || 0) + n;
  }

  function saveRooms() {
    if (Game.engine && Game.engine.save) Game.engine.save();
  }

  /* ================================================================
     Furniture painter
     Anchor is bottom-centre. mode: 'placed' (full) or 'palette' (small).
     ================================================================ */
  function drawFurniture(c, type, x, y, mode, flip) {
    var s = mode === 'palette' ? 0.52 : 1;
    var absY = y;               /* pre-translate, so hanging pieces can reach the ceiling */
    c.save();
    c.translate(x, y);
    c.scale(s * (flip ? -1 : 1), s);

    var wood = '#a9773f';
    var woodD = E.shade(wood, -22);
    var cloth = PAL.peach;

    switch (type) {
      case 'bed':
        E.fillRound(c, -46, -30, 92, 26, 5, '#e8e0d0');
        E.fillRound(c, -46, -38, 34, 16, 5, PAL.cream);
        E.fillRound(c, -14, -34, 60, 22, 5, cloth);
        E.fillRound(c, -50, -50, 8, 46, 4, wood);
        E.fillRound(c, 42, -42, 8, 38, 4, wood);
        break;
      case 'bunkBed':
        E.fillRound(c, -44, -30, 88, 22, 4, '#e8e0d0');
        E.fillRound(c, -44, -74, 88, 22, 4, '#e8e0d0');
        E.fillRound(c, -14, -32, 56, 18, 4, cloth);
        E.fillRound(c, -14, -76, 56, 18, 4, PAL.sky);
        E.fillRound(c, -48, -90, 7, 86, 3, wood);
        E.fillRound(c, 41, -90, 7, 86, 3, wood);
        for (var bl = 0; bl < 4; bl++) E.fillRound(c, -40 + bl * 10, -52, 5, 22, 2, wood);
        break;
      case 'hammock':
        c.strokeStyle = PAL.ink; c.lineWidth = 2;
        c.beginPath(); c.moveTo(-52, -70); c.lineTo(-52, -6); c.stroke();
        c.beginPath(); c.moveTo(52, -70); c.lineTo(52, -6); c.stroke();
        c.beginPath();
        c.moveTo(-52, -56);
        c.quadraticCurveTo(0, -6, 52, -56);
        c.lineTo(52, -46);
        c.quadraticCurveTo(0, 6, -52, -46);
        c.closePath();
        c.fillStyle = '#e8c76a'; c.fill(); E.ink(c, 2);
        break;
      case 'cushion':
        E.fillRound(c, -22, -22, 44, 22, 9, cloth);
        E.fillEllipse(c, -20, -11, 3.5, 3.5, PAL.cream, false);
        E.fillEllipse(c, 20, -11, 3.5, 3.5, PAL.cream, false);
        break;
      case 'chair':
        E.fillRound(c, -18, -30, 36, 8, 3, wood);
        E.fillRound(c, -18, -64, 36, 34, 5, E.shade(wood, 12));
        E.fillRound(c, -16, -22, 6, 22, 3, wood);
        E.fillRound(c, 10, -22, 6, 22, 3, wood);
        break;
      case 'stool':
        E.fillEllipse(c, 0, -26, 20, 8, cloth);
        E.fillRound(c, -16, -22, 5, 22, 2.5, wood);
        E.fillRound(c, 11, -22, 5, 22, 2.5, wood);
        E.fillRound(c, -14, -12, 28, 4, 2, wood);
        break;
      case 'sofa':
        E.fillRound(c, -54, -44, 108, 40, 8, cloth);
        E.fillRound(c, -54, -60, 108, 22, 8, E.shade(cloth, -12));
        E.fillRound(c, -60, -52, 14, 44, 6, E.shade(cloth, -18));
        E.fillRound(c, 46, -52, 14, 44, 6, E.shade(cloth, -18));
        E.fillRound(c, -34, -50, 30, 16, 6, PAL.cream);
        E.fillRound(c, 6, -50, 30, 16, 6, PAL.cream);
        break;
      case 'beanbag':
        c.beginPath();
        c.moveTo(-32, 0);
        c.quadraticCurveTo(-40, -34, -8, -40);
        c.quadraticCurveTo(30, -46, 34, -14);
        c.quadraticCurveTo(36, 0, 0, 0);
        c.closePath();
        c.fillStyle = PAL.leafLight; c.fill(); E.ink(c, 2);
        break;
      case 'table':
        E.fillRound(c, -40, -44, 80, 9, 4, wood);
        E.fillRound(c, -34, -35, 7, 35, 3, woodD);
        E.fillRound(c, 27, -35, 7, 35, 3, woodD);
        break;
      case 'coffeeTable':
        E.fillRound(c, -34, -26, 68, 8, 4, wood);
        E.fillRound(c, -28, -18, 6, 18, 3, woodD);
        E.fillRound(c, 22, -18, 6, 18, 3, woodD);
        break;
      case 'desk':
        E.fillRound(c, -44, -46, 88, 9, 4, wood);
        E.fillRound(c, -44, -37, 30, 37, 4, E.shade(wood, -8));
        E.fillRound(c, -40, -32, 22, 8, 2, PAL.cream, false);
        E.fillRound(c, -40, -20, 22, 8, 2, PAL.cream, false);
        E.fillRound(c, 34, -37, 8, 37, 3, woodD);
        break;
      case 'shelf':
        E.fillRound(c, -34, -86, 68, 86, 5, wood);
        for (var sh = 0; sh < 3; sh++) {
          var sy2 = -74 + sh * 26;
          E.fillRound(c, -30, sy2 + 18, 60, 5, 2, woodD, false);
          for (var bk = 0; bk < 5; bk++) {
            var bcol = [PAL.peach, PAL.sun, PAL.leafLight, PAL.sky, '#b06aa8'][(sh * 5 + bk) % 5];
            E.fillRound(c, -28 + bk * 11, sy2, 9, 18, 1.5, bcol, false);
          }
        }
        E.roundRect(c, -34, -86, 68, 86, 5); E.ink(c, 2);
        break;
      case 'lamp':
        E.fillRound(c, -10, -6, 20, 6, 3, woodD);
        E.fillRound(c, -3, -52, 6, 48, 2, wood);
        E.fillPath(c, [[-22, -52], [22, -52], [16, -78], [-16, -78]], PAL.sun);
        c.save(); c.globalAlpha = 0.28;
        E.fillEllipse(c, 0, -44, 30, 26, PAL.sun, false);
        c.restore();
        break;
      case 'lantern':
        E.fillRound(c, -12, -58, 24, 8, 3, wood);
        E.fillRound(c, -10, -50, 20, 26, 5, PAL.sun);
        E.fillRound(c, -12, -26, 24, 7, 3, wood);
        E.fillRound(c, -3, -19, 6, 19, 2, woodD);
        c.save(); c.globalAlpha = 0.3;
        E.fillEllipse(c, 0, -37, 26, 24, PAL.sun, false);
        c.restore();
        break;
      case 'candle':
        E.fillRound(c, -18, -10, 36, 10, 4, '#c9a86a');
        for (var cd = -1; cd <= 1; cd++) {
          E.fillRound(c, cd * 11 - 4, -32 + Math.abs(cd) * 6, 8, 24, 3, PAL.cream);
          E.fillEllipse(c, cd * 11, -36 + Math.abs(cd) * 6, 3.4, 5.5, PAL.sun, false);
        }
        break;
      case 'fireplace':
        E.fillRound(c, -34, -66, 68, 66, 6, '#8f8b85');
        E.fillRound(c, -22, -44, 44, 44, 5, '#3b2a16');
        E.fillEllipse(c, 0, -14, 16, 12, '#e8734a', false);
        E.fillEllipse(c, 0, -18, 9, 9, PAL.sun, false);
        E.fillRound(c, -40, -76, 80, 12, 4, wood);
        break;
      case 'rug':
        c.save();
        c.beginPath();
        c.ellipse(0, -4, 56, 18, 0, 0, Math.PI * 2);
        c.fillStyle = cloth; c.fill(); E.ink(c, 2);
        c.beginPath();
        c.ellipse(0, -4, 40, 12, 0, 0, Math.PI * 2);
        c.strokeStyle = PAL.cream; c.lineWidth = 4; c.stroke();
        c.beginPath();
        c.ellipse(0, -4, 22, 6, 0, 0, Math.PI * 2);
        c.strokeStyle = PAL.sun; c.lineWidth = 4; c.stroke();
        c.restore();
        break;
      case 'painting':
        E.fillRound(c, -30, -96, 60, 46, 4, wood);
        E.fillRound(c, -25, -91, 50, 36, 2, PAL.sky);
        E.fillEllipse(c, -10, -62, 16, 10, PAL.grass, false);
        E.fillEllipse(c, 12, -66, 14, 10, PAL.leaf, false);
        E.fillEllipse(c, 14, -84, 6, 6, PAL.sun, false);
        break;
      case 'mirror':
        E.fillRound(c, -22, -94, 44, 62, 20, wood);
        E.fillRound(c, -17, -89, 34, 52, 16, '#d9ecf2');
        c.save(); c.globalAlpha = 0.6;
        c.strokeStyle = '#ffffff'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(-8, -46); c.lineTo(6, -78); c.stroke();
        c.restore();
        break;
      case 'plant':
        E.fillPath(c, [[-16, 0], [-12, -24], [12, -24], [16, 0]], '#c07a4a');
        E.fillRound(c, -18, -28, 36, 8, 3, E.shade('#c07a4a', 14));
        for (var lf = -2; lf <= 2; lf++) {
          E.fillEllipse(c, lf * 9, -44 - Math.abs(lf) * -4, 8, 18, lf % 2 ? PAL.leaf : PAL.leafLight);
        }
        break;
      case 'clock':
        E.fillEllipse(c, 0, -88, 24, 24, wood);
        E.fillEllipse(c, 0, -88, 18, 18, PAL.cream);
        c.strokeStyle = PAL.ink; c.lineWidth = 2.4;
        c.beginPath(); c.moveTo(0, -88); c.lineTo(0, -100); c.stroke();
        c.beginPath(); c.moveTo(0, -88); c.lineTo(9, -84); c.stroke();
        break;
      case 'teaSet':
        E.fillRound(c, -26, -12, 52, 6, 3, PAL.cream);
        E.fillEllipse(c, -12, -22, 11, 10, PAL.cream);
        c.strokeStyle = PAL.ink; c.lineWidth = 2;
        c.beginPath(); c.arc(-1, -22, 5, -Math.PI / 2, Math.PI / 2); c.stroke();
        E.fillEllipse(c, 14, -20, 9, 8, cloth);
        E.fillEllipse(c, 14, -27, 4, 3, PAL.cream, false);
        break;
      case 'toybox':
        E.fillRound(c, -30, -34, 60, 34, 5, PAL.sky);
        E.fillRound(c, -33, -44, 66, 12, 4, E.shade(PAL.sky, -16));
        E.fillEllipse(c, 0, -38, 5, 4, PAL.sun);
        E.fillEllipse(c, -16, -50, 8, 8, PAL.peach);
        E.fillRound(c, 8, -56, 14, 14, 3, PAL.leafLight);
        break;
      case 'easel':
        E.fillRound(c, -3, -74, 6, 74, 2, wood);
        c.strokeStyle = wood; c.lineWidth = 5; c.lineCap = 'round';
        c.beginPath(); c.moveTo(0, -60); c.lineTo(-22, 0); c.stroke();
        c.beginPath(); c.moveTo(0, -60); c.lineTo(22, 0); c.stroke();
        E.fillRound(c, -26, -78, 52, 40, 3, PAL.cream);
        E.fillEllipse(c, -8, -54, 10, 7, PAL.leafLight, false);
        E.fillEllipse(c, 8, -62, 7, 7, PAL.peach, false);
        break;
      case 'fridge':
        E.fillRound(c, -28, -100, 56, 100, 7, '#eef2f4');
        /* freezer door on top, fridge door below */
        c.strokeStyle = E.shade('#eef2f4', -26);
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(-26, -66); c.lineTo(26, -66); c.stroke();
        E.fillRound(c, 14, -92, 5, 18, 2.5, '#b9c2c8');
        E.fillRound(c, 14, -58, 5, 30, 2.5, '#b9c2c8');
        /* a couple of magnets, because every fridge has them */
        E.fillEllipse(c, -12, -84, 5, 5, PAL.peach, false);
        E.fillRound(c, -18, -50, 14, 11, 2, PAL.sun, false);
        E.roundRect(c, -28, -100, 56, 100, 7);
        E.ink(c, 2);
        break;
      case 'discoBall':
        /* Hangs from the ceiling, so the chain length depends on where in
           the room it was placed. In the palette it gets a stub chain. */
        var chain = (mode === 'palette') ? 18 : Math.max(18, absY - ROOM.wallTop - 8);
        c.strokeStyle = PAL.ink;
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(0, -24); c.lineTo(0, -24 - chain); c.stroke();
        if (mode !== 'palette') E.fillRound(c, -11, -24 - chain - 7, 22, 8, 3, PAL.bark);
        E.fillEllipse(c, 0, 0, 24, 24, '#cfd8de');
        /* mirrored facets */
        c.save();
        c.beginPath(); c.arc(0, 0, 23, 0, Math.PI * 2); c.clip();
        c.strokeStyle = 'rgba(74,51,32,0.35)';
        c.lineWidth = 1.2;
        for (var dv = -24; dv <= 24; dv += 8) {
          c.beginPath(); c.moveTo(dv, -24); c.lineTo(dv, 24); c.stroke();
          c.beginPath(); c.moveTo(-24, dv); c.lineTo(24, dv); c.stroke();
        }
        var tiles = [[-12, -10, PAL.sky], [4, -14, PAL.peach], [12, 2, PAL.sun],
                     [-6, 8, PAL.leafLight], [-16, 4, '#ffffff'], [6, 12, PAL.sky]];
        for (var ti = 0; ti < tiles.length; ti++) {
          c.globalAlpha = 0.75;
          c.fillStyle = tiles[ti][2];
          c.fillRect(tiles[ti][0], tiles[ti][1], 7, 7);
        }
        c.restore();
        E.fillEllipse(c, 0, 0, 24, 24, 'rgba(0,0,0,0)');
        /* sparkles thrown off the ball */
        c.save();
        c.globalAlpha = 0.55 + Math.sin(t / 9) * 0.25;
        c.fillStyle = PAL.cream;
        E.star(c, -34, -14, 5);
        E.star(c, 33, 6, 4);
        E.star(c, 8, -34, 4);
        c.restore();
        break;
      case 'piano':
        /* Upright piano seen head-on. */
        E.fillRound(c, -58, -96, 116, 74, 6, '#6b4a2f');
        E.fillRound(c, -52, -90, 104, 34, 4, E.shade('#6b4a2f', 14));
        c.fillStyle = PAL.sun;
        c.font = 'bold 8px monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('MOMOKO', 0, -73);
        /* keybed */
        E.fillRound(c, -62, -26, 124, 16, 4, '#3b2a16');
        for (var wk = 0; wk < 12; wk++) {
          E.fillRound(c, -58 + wk * 9.7, -24, 8.4, 12, 1.5, '#fffdf6', false);
        }
        for (var bk2 = 0; bk2 < 12; bk2++) {
          if (bk2 % 7 === 2 || bk2 % 7 === 6) continue;
          E.fillRound(c, -54 + bk2 * 9.7, -24, 5, 7, 1, '#2a231c', false);
        }
        E.roundRect(c, -62, -26, 124, 16, 4); E.ink(c, 2);
        /* legs + pedals */
        E.fillRound(c, -54, -10, 12, 10, 3, '#5a3c22');
        E.fillRound(c, 42, -10, 12, 10, 3, '#5a3c22');
        E.fillRound(c, -8, -8, 16, 5, 2, PAL.sun);
        break;
      default:
        E.fillRound(c, -20, -34, 40, 34, 5, PAL.creamDark);
        break;
    }
    c.restore();
  }

  /* ================================================================
     Pause + victory
     ================================================================ */
  var PAUSE_BTN = {
    resume: { x: 300, y: 200, w: 200, h: 48 },
    lang: { x: 300, y: 258, w: 200, h: 40 },
    sound: { x: 300, y: 306, w: 200, h: 40 },
    quit: { x: 300, y: 354, w: 200, h: 40 },
  };

  function drawPauseMenu(c) {
    c.fillStyle = 'rgba(36, 23, 8, 0.66)';
    c.fillRect(0, 0, W, H);
    panel(c, 250, 120, 300, 290);
    c.fillStyle = PAL.ink;
    c.font = 'bold 24px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(T('paused'), W / 2, 160);
    button(c, PAUSE_BTN.resume, T('resume'), { fill: PAL.leafLight, font: 17 });
    button(c, PAUSE_BTN.lang, T('language') + ': ' + T('langLabel'), { font: 13 });
    button(c, PAUSE_BTN.sound, Game.audio.isMuted() ? T('soundOff') : T('soundOn'), { font: 13 });
    button(c, PAUSE_BTN.quit, T('quit'), { font: 13 });
    drawVersionStamp(c);
  }

  function handlePauseClick(mx, my) {
    if (hit(PAUSE_BTN.resume, mx, my)) return 'resume';
    if (hit(PAUSE_BTN.lang, mx, my)) return 'lang';
    if (hit(PAUSE_BTN.sound, mx, my)) return 'sound';
    if (hit(PAUSE_BTN.quit, mx, my)) return 'quit';
    return null;
  }

  var VICTORY_BTN = { x: 320, y: 412, w: 160, h: 44 };

  function drawVictory(c) {
    t++;
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#ffe9b8');
    g.addColorStop(1, PAL.grass);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    c.save();
    c.translate(400, 430);
    c.scale(0.62, 0.62);
    Game.tree.drawTree(c, 0, 0, Game.BUILD_STAGES.length, Game.exterior, t, false);
    c.restore();

    /* Everyone on the grass out front */
    var roster = designRoster();
    for (var i = 0; i < roster.length; i++) {
      var cx = 190 + i * 110;
      var frame = Math.floor(t / 10 + i) % 4 + 1;
      E.drawCharacter(c, cx, 446, custRecord(roster[i].id), frame, i % 2 === 0 ? 1 : -1, 1, false);
    }

    c.save();
    c.globalAlpha = 0.92;
    panel(c, 120, 40, 560, 150);
    c.restore();
    c.fillStyle = PAL.ink;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'bold 26px monospace';
    c.fillText(T('victoryTitle'), W / 2, 74);
    c.font = '13px monospace';
    multiline(c, T('victoryText'), W / 2, 108, 19);

    button(c, VICTORY_BTN, T('victoryAgain'), { fill: PAL.sun, font: 15 });
  }

  function handleVictoryClick(mx, my) {
    if (hit(VICTORY_BTN, mx, my)) return 'continue';
    return null;
  }

  /* ================================================================ */

  window.Game.ui = {
    /* shared */
    button: button, hit: hit, panel: panel, multiline: multiline,
    showToast: showToast, drawToast: drawToast,
    drawVersionStamp: drawVersionStamp,
    /* title / intro */
    drawTitleScreen: drawTitleScreen, handleTitleClick: handleTitleClick,
    drawIntroScreen: drawIntroScreen, handleIntroClick: handleIntroClick,
    /* designer */
    drawCustomizeScreen: drawCustomizeScreen, handleCustomizeClick: handleCustomizeClick,
    designRoster: designRoster, custRecord: custRecord,
    /* shop */
    startShopInterior: startShopInterior, updateShopInterior: updateShopInterior,
    drawShopInterior: drawShopInterior, handleShopInteriorClick: handleShopInteriorClick,
    /* hud */
    drawBuildHud: drawBuildHud, drawBagHud: drawBagHud,
    drawCarryOverlay: drawCarryOverlay, drawPrompt: drawPrompt,
    /* build stage maths */
    currentStage: currentStage, remainingNeeds: remainingNeeds, stageSatisfied: stageSatisfied,
    /* cutscene */
    startBuildCutscene: startBuildCutscene, updateBuildCutscene: updateBuildCutscene,
    drawBuildCutsceneOverlay: drawBuildCutsceneOverlay,
    /* exterior */
    drawExteriorScreen: drawExteriorScreen, handleExteriorClick: handleExteriorClick,
    /* interior */
    drawHouseInterior: drawHouseInterior, handleHouseInteriorClick: handleHouseInteriorClick,
    updateHouseInterior: updateHouseInterior, drawFurniture: drawFurniture,
    addStock: addStock, anyPianoPlaced: anyPianoPlaced, residentOf: residentOf,
    getRoomPlayer: function () { return roomPlayer; },
    getSelectedPiece: function () { return selectedPiece; },
    /* pause / victory */
    drawPauseMenu: drawPauseMenu, handlePauseClick: handlePauseClick,
    drawVictory: drawVictory, handleVictoryClick: handleVictoryClick,
  };
})();
