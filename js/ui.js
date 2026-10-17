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

  /* The rectangle the ambient backdrops fill, in game coordinates. It is
     the 800x480 viewport everywhere except on touch devices, where the
     engine widens it to the whole canvas for the title, designer, intro
     and victory screens so the meadow fills the bezel instead of a dark
     frame. Everything else on those screens stays clipped to the
     viewport via clipGame(). */
  var VIEW = { x: 0, y: 0, w: W, h: H };
  function setView(x, y, w, h) {
    VIEW.x = x; VIEW.y = y; VIEW.w = w; VIEW.h = h;
    E.setView(x, y, w, h);
  }
  function clipGame(c) { c.beginPath(); c.rect(0, 0, W, H); c.clip(); }
  /* Grass from gy down to the bottom of the view, under the painted band. */
  function fillViewGrass(c, gy) {
    var gg = c.createLinearGradient(0, gy, 0, H);
    gg.addColorStop(0, '#78bb51');
    gg.addColorStop(1, '#5c9a3d');
    c.fillStyle = gg;
    c.fillRect(VIEW.x, gy, VIEW.w, VIEW.y + VIEW.h - gy);
  }

  /* ================================================================
     Shared helpers
     ================================================================ */

  var FONT = '"M PLUS Rounded 1c", sans-serif';

  /* True when the mouse is over the rect, in whatever coordinate space
     the caller is currently drawing in (the pointer is stored in
     backing-store pixels and mapped back through the live transform). */
  var anyHot = false;
  function pointerOver(c, x, y, w, h) {
    var p = Game.input && Game.input.pointer;
    if (!p || p.px < 0 || !c.getTransform) return false;
    var pt = c.getTransform().inverse().transformPoint(new DOMPoint(p.px, p.py));
    var over = pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
    if (over) anyHot = true;
    return over;
  }

  /* Shrink the font until text fits maxW, stopping at `min` (default 8). */
  function fitFont(c, text, maxW, size, weight, min) {
    min = min || 8;
    while (true) {
      c.font = (weight ? weight + ' ' : '') + size + 'px ' + FONT;
      if (size <= min || c.measureText(text).width <= maxW) break;
      size--;
    }
  }

  /* Rounded, glossy button with a drop shadow and hover / press feedback.
     Colours stay the warm cream / wood / sun palette set by `opts`. */
  function button(c, b, label, opts) {
    opts = opts || {};
    var fill = opts.active ? (opts.activeFill || PAL.sun) : (opts.fill || PAL.cream);
    if (opts.disabled) fill = '#b9ad99';
    var r = opts.r === undefined ? 9 : opts.r;
    var hot = !opts.disabled && pointerOver(c, b.x, b.y, b.w, b.h);
    var pressed = hot && Game.input.pointer.down;
    var oy = pressed ? 2 : 0;
    c.save();
    if (!pressed) {
      c.fillStyle = 'rgba(36, 23, 8, 0.28)';
      E.roundRect(c, b.x, b.y + 3, b.w, b.h, r);
      c.fill();
    }
    c.fillStyle = fill;
    E.roundRect(c, b.x, b.y + oy, b.w, b.h, r);
    c.fill();
    if (hot) {
      c.fillStyle = 'rgba(255, 255, 255, 0.28)';
      c.fill();
    }
    /* Soft top gloss */
    c.fillStyle = 'rgba(255, 255, 255, 0.3)';
    E.roundRect(c, b.x + 3, b.y + oy + 2, b.w - 6, b.h * 0.42, Math.max(2, r - 3));
    c.fill();
    E.roundRect(c, b.x, b.y + oy, b.w, b.h, r);
    E.ink(c, opts.active || hot ? 3 : 2);
    c.fillStyle = opts.disabled ? '#6d6459' : PAL.ink;
    fitFont(c, label, b.w - 12, opts.font || 15, 'bold');
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, b.x + b.w / 2, b.y + oy + b.h / 2 + 1);
    c.restore();
  }

  /* Hover tint for selectable tiles (grid cells, swatches, portraits). */
  function tileFill(c, r, sel, hotFill, baseFill) {
    var hot = !sel && pointerOver(c, r.x, r.y, r.w, r.h);
    return sel ? PAL.sun : (hot ? hotFill : baseFill);
  }

  /* Split text into lines that fit maxWidth. Breaks on spaces and \n, and
     falls back to per-character breaks for runs with no spaces (Japanese). */
  function layoutLines(c, text, maxWidth) {
    var out = [];
    var paras = String(text).split('\n');
    for (var li = 0; li < paras.length; li++) {
      var words = paras[li].split(' ');
      var line = '';
      for (var i = 0; i < words.length; i++) {
        var word = words[i];
        var test = line ? line + ' ' + word : word;
        if (c.measureText(test).width <= maxWidth) { line = test; continue; }
        if (line) { out.push(line); line = ''; }
        /* Word alone is too wide: break it character by character. */
        while (c.measureText(word).width > maxWidth && word.length > 1) {
          var n = word.length - 1;
          while (n > 1 && c.measureText(word.slice(0, n)).width > maxWidth) n--;
          /* Don't start a line with closing punctuation, or end one with
             an opening bracket. */
          while (n > 1 && ('、。！？」）ー'.indexOf(word.charAt(n)) >= 0 ||
                           '「（'.indexOf(word.charAt(n - 1)) >= 0)) n--;
          out.push(word.slice(0, n));
          word = word.slice(n);
        }
        line = word;
      }
      out.push(line);
    }
    return out;
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
  var toast = { text: '', timer: 0, fresh: false };
  function showToast(text, frames) {
    toast.text = text;
    toast.timer = frames || 120;
    toast.fresh = true;
  }
  /* Called by the engine whenever the screen changes. A toast raised by
     the action that changed the screen survives; an older one (e.g. a
     "bag full" from the shop) must not follow her out into the meadow. */
  function dropStaleToast() {
    if (!toast.fresh) toast.timer = 0;
  }
  function endFrame() { toast.fresh = false; }
  function drawToast(c) {
    if (toast.timer <= 0) return;
    toast.timer--;
    var a = Math.min(1, toast.timer / 22);
    var lines = toast.text.split('\n');
    c.save();
    c.globalAlpha = a;
    c.font = 'bold 16px "M PLUS Rounded 1c", sans-serif';
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

  /* The title column (words + buttons) shares one centre line, clear of
     the tree house on the left. */
  var TITLE_CX = 532;
  var TITLE_BTN = {
    play: { x: TITLE_CX - 100, y: 250, w: 200, h: 50 },
    how: { x: TITLE_CX - 100, y: 312, w: 200, h: 40 },
    lang: { x: TITLE_CX - 100, y: 362, w: 95, h: 40 },
    sound: { x: TITLE_CX + 5, y: 362, w: 95, h: 40 },
    reset: { x: 640, y: 418, w: 146, h: 34 },
  };
  var showInstructions = false;
  var confirmReset = false;
  var RESET_YES = { x: 300, y: 300, w: 90, h: 42 };
  var RESET_NO = { x: 410, y: 300, w: 90, h: 42 };
  var TITLE_GROUND = 414;

  function drawTitleScreen(c) {
    t++;
    /* The same sky and far hills as the meadow, sun moved off the title. */
    E.drawMeadowSky(c, 640, t, TITLE_GROUND, Game.MEADOW.width, 724);
    drawTitleGround(c);
    c.save();
    clipGame(c);

    /* A finished tree house, with Momoko and Lila out front */
    E.softShadow(c, 172, TITLE_GROUND + 8, 96, 7, 0.2);
    c.save();
    c.translate(172, TITLE_GROUND + 8);
    c.scale(0.6, 0.6);
    Game.tree.drawTree(c, 0, 0, Game.BUILD_STAGES.length, Game.EXT_DEFAULT, t, false);
    c.restore();
    var lila = Game.FRIEND_DEFS[0];
    var hop = Math.max(0, Math.sin(t / 22)) * 6;
    /* Both stand just in front of the tree, on the same patch of grass. */
    var feetY = TITLE_GROUND + 22;
    E.softShadow(c, 300, feetY, 20, 4, 0.22);
    E.drawCharacter(c, 300, feetY, Game.customization, 0, -1, 1.25, (t % 220) < 8, hop);
    E.softShadow(c, 46, feetY, 18, 4, 0.22);
    E.drawCharacter(c, 46, feetY, Game.friends && Game.friends[lila.id] ? Game.friends[lila.id].cust : lila.defaultCust,
      0, 1, 1.1, (t % 260) < 8);
    drawButterflies(c);

    /* Title */
    var bob = Math.sin(t / 40) * 3;
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.font = 'bold 30px ' + FONT;
    c.strokeStyle = 'rgba(255, 250, 236, 0.92)';
    c.lineWidth = 6;
    c.strokeText(T('title'), TITLE_CX, 106 + bob);
    c.fillStyle = PAL.ink;
    c.fillText(T('title'), TITLE_CX, 106 + bob);
    fitFont(c, T('title2'), 360, 58, 'bold', 30);
    c.fillStyle = 'rgba(36, 23, 8, 0.22)';
    c.fillText(T('title2'), TITLE_CX + 2, 162 + bob + 4);
    c.strokeStyle = PAL.cream;
    c.lineWidth = 9;
    c.strokeText(T('title2'), TITLE_CX, 162 + bob);
    c.fillStyle = '#3b6b2a';
    c.fillText(T('title2'), TITLE_CX, 162 + bob);
    /* subtitle sits on a little cream ribbon so clouds never wash it out */
    c.font = 'bold 15px ' + FONT;
    var sw = c.measureText(T('titleSubtitle')).width + 30;
    c.fillStyle = 'rgba(255, 244, 220, 0.85)';
    E.roundRect(c, TITLE_CX - sw / 2, 200 + bob, sw, 26, 13);
    c.fill();
    c.fillStyle = '#5a7a3a';
    c.fillText(T('titleSubtitle'), TITLE_CX, 214 + bob);
    c.restore();
    /* Pop the viewport clip so the overlays below can dim the whole
       tablet screen, bezel included. */
    c.restore();

    if (confirmReset) {
      drawResetConfirm(c);
      return;
    }
    /* The buttons aren't clickable under the How to Play card, so don't
       paint them there either. */
    if (showInstructions) {
      drawInstructionsOverlay(c);
      drawVersionStamp(c);
      return;
    }

    button(c, TITLE_BTN.play, T('play'), { font: 22, activeFill: PAL.sun, fill: PAL.sun, r: 12 });
    button(c, TITLE_BTN.how, T('howToPlay'), { font: 15 });
    button(c, TITLE_BTN.lang, T('language') + ': ' + T('langLabel'), { font: 14 });
    button(c, TITLE_BTN.sound, Game.audio.isMuted() ? T('soundOff') : T('soundOn'), { font: 14 });
    if (hasSave()) button(c, TITLE_BTN.reset, T('startOver'), { font: 12, fill: 'rgba(255,244,220,0.7)' });

    drawVersionStamp(c);
  }

  /* Grass band with tufts and flowers, painted once. */
  function drawTitleGround(c, groundY) {
    var gy = groundY || TITLE_GROUND, gh = H - TITLE_GROUND;
    /* `flat` paints the same tufts and flowers on plain deep grass with
       no top edge, for the rows tiled below the viewport on tablets, so
       the bezel grass has no repeating seams. */
    function paintGrass(g, flat) {
      var rnd = E.seeded(77);
      if (flat) {
        g.fillStyle = '#5c9a3d';
        g.fillRect(0, 0, W, gh + 6);
      } else {
        var gr = g.createLinearGradient(0, 6, 0, gh + 6);
        gr.addColorStop(0, '#78bb51');
        gr.addColorStop(1, '#5c9a3d');
        g.fillStyle = gr;
        g.fillRect(0, 6, W, gh);
        g.fillStyle = 'rgba(75, 132, 51, 0.55)';
        g.fillRect(0, 6, W, 3);
      }
      g.lineCap = 'round';
      for (var i = 0; i < 110; i++) {
        var x = rnd() * W, y = 14 + rnd() * (gh - 10);
        var hgt = 4 + (y / gh) * 6 + rnd() * 3;
        g.strokeStyle = rnd() < 0.55 ? 'rgba(66, 120, 44, 0.75)' : 'rgba(150, 210, 104, 0.85)';
        g.lineWidth = 1.4;
        for (var b = -1; b <= 1; b++) {
          g.beginPath();
          g.moveTo(x + b * 2, y);
          g.quadraticCurveTo(x + b * 2.5, y - hgt * 0.6, x + b * 4.5, y - hgt * (b === 0 ? 1.15 : 0.85));
          g.stroke();
        }
      }
      var cols = ['#ff9ec4', '#ffd24a', '#fff4dc', '#b06aa8', '#8fd0e8'];
      for (var f = 0; f < 30; f++) {
        var fx = rnd() * W, fy = 18 + rnd() * (gh - 16), fr = 1.8 + rnd();
        var col = cols[Math.floor(rnd() * cols.length)];
        for (var q = 0; q < 5; q++) {
          var a = q * Math.PI * 2 / 5;
          E.fillEllipse(g, fx + Math.cos(a) * fr, fy + Math.sin(a) * fr, fr * 0.8, fr * 0.8, col, false);
        }
        E.fillEllipse(g, fx, fy, fr * 0.55, fr * 0.55, PAL.sun, false);
      }
    }
    var spr = E.getCachedSprite('titleGround', W, gh + 6, function (g) { paintGrass(g, false); });
    /* Tile the band across (and below) the view so the grass runs on
       under the bezel on tablets; inside the viewport this is one tile. */
    fillViewGrass(c, gy);
    var x1 = VIEW.x + VIEW.w, y1 = VIEW.y + VIEW.h;
    for (var tx = Math.floor(VIEW.x / W) * W; tx < x1; tx += W) {
      c.drawImage(spr, tx, gy - 6, spr.lw, spr.lh);
    }
    if (y1 > H) {
      var deep = E.getCachedSprite('titleGroundDeep', W, gh + 6, function (g) { paintGrass(g, true); });
      for (var ty = H; ty < y1; ty += deep.lh) {
        for (var tx2 = Math.floor(VIEW.x / W) * W; tx2 < x1; tx2 += W) {
          c.drawImage(deep, tx2, ty, deep.lw, deep.lh);
        }
      }
    }
  }

  /* Two butterflies looping lazily over the grass, one either side of Momoko,
     clear of the button column. */
  function drawButterflies(c) {
    var cols = [PAL.peach, PAL.sky];
    for (var i = 0; i < 2; i++) {
      var k = t / (150 + i * 40) + i * 2.4;
      var x = 366 - i * 134 + Math.sin(k) * (40 - i * 18);
      var y = 384 + Math.sin(k * 2.3) * (22 - i * 10) + i * 8;
      var flap = Math.abs(Math.sin(t / 4 + i));
      c.save();
      c.translate(x, y);
      c.rotate(Math.cos(k) * 0.3);
      c.fillStyle = cols[i];
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
      E.fillRound(c, -1, -6, 2, 12, 1, PAL.ink, false);
      c.restore();
    }
  }

  function drawInstructionsOverlay(c) {
    /* Click anywhere closes it. */
    pointerOver(c, 0, 0, W, H);
    c.fillStyle = 'rgba(36, 23, 8, 0.72)';
    c.fillRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    panel(c, 110, 100, 580, 280, PAL.cream);
    c.fillStyle = PAL.ink;
    c.font = 'bold 20px "M PLUS Rounded 1c", sans-serif';
    c.fillText(T('howToPlay'), W / 2, 134);
    c.font = '15px "M PLUS Rounded 1c", sans-serif';
    multiline(c, T('instructions'), W / 2, 190, 24);
    c.font = '13px "M PLUS Rounded 1c", sans-serif';
    c.fillStyle = 'rgba(74,51,32,0.7)';
    c.fillText(T('closeHint'), W / 2, 352);
  }

  function drawResetConfirm(c) {
    c.fillStyle = 'rgba(36, 23, 8, 0.72)';
    c.fillRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    panel(c, 200, 190, 400, 180, PAL.cream);
    c.fillStyle = PAL.ink;
    c.font = 'bold 16px "M PLUS Rounded 1c", sans-serif';
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
    /* In the corner of the screen, not of the viewport, on tablets. */
    var rx = VIEW.x + VIEW.w, by = VIEW.y + VIEW.h;
    c.font = '11px "M PLUS Rounded 1c", sans-serif';
    var vw = c.measureText(Game.VERSION || '').width + 12;
    c.fillStyle = 'rgba(255, 244, 220, 0.6)';
    E.roundRect(c, rx - 2 - vw, by - 20, vw, 16, 8);
    c.fill();
    c.fillStyle = 'rgba(74, 51, 32, 0.6)';
    c.textAlign = 'right';
    c.textBaseline = 'bottom';
    c.fillText(Game.VERSION || '', rx - 8, by - 6);
    c.restore();
  }

  /* ================================================================
     Intro
     ================================================================ */
  /* Story on a card at the left, a picture of the bare tree at the right. */
  var INTRO = {
    panel: { x: 24, y: 22, w: 462, h: 380 },
    pic: { x: 504, y: 22, w: 272, h: 436 },
    textW: 418,
  };
  var INTRO_BTN = { x: 175, y: 414, w: 160, h: 44 };

  function drawIntroScreen(c) {
    t++;
    /* The same meadow as the title so the menus read as one place. */
    E.drawMeadowSky(c, 640, t, TITLE_GROUND, Game.MEADOW.width, 724);
    drawTitleGround(c);
    clipGame(c);

    drawIntroPicture(c);

    var P = INTRO.panel;
    c.fillStyle = 'rgba(36, 23, 8, 0.16)';
    E.roundRect(c, P.x, P.y + 4, P.w, P.h, 12);
    c.fill();
    panel(c, P.x, P.y, P.w, P.h, 'rgba(255, 248, 232, 0.97)');
    c.fillStyle = 'rgba(123, 196, 90, 0.25)';
    E.roundRect(c, P.x + 6, P.y + 6, P.w - 12, 46, 8);
    c.fill();

    var cx = P.x + P.w / 2;
    c.fillStyle = '#3b6b2a';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    fitFont(c, T('introTitle'), P.w - 40, 24, 'bold', 16);
    c.fillText(T('introTitle'), cx, P.y + 30);

    /* Keep the string's own line breaks (they are set on phrase
       boundaries) unless a line is too wide for the card; then re-flow
       that paragraph. */
    c.fillStyle = PAL.ink;
    c.font = '14px ' + FONT;
    var paras = T('introText').split('\n\n');
    var lines = [];
    for (var i = 0; i < paras.length; i++) {
      var pl = paras[i].split('\n');
      for (var q = 0; q < pl.length; q++) {
        if (c.measureText(pl[q]).width > INTRO.textW) {
          pl = layoutLines(c, paras[i].replace(/([、。])\n/g, '$1').replace(/\n/g, ' '), INTRO.textW);
          break;
        }
      }
      if (i > 0) lines.push(null);
      lines = lines.concat(pl);
    }
    var top = P.y + 66, bottom = P.y + P.h - 16;
    var lh = 21, gap = 10, total = 0;
    for (var k = 0; k < lines.length; k++) total += lines[k] === null ? gap : lh;
    if (total > bottom - top) { lh = 19; gap = 6; total = 0; for (k = 0; k < lines.length; k++) total += lines[k] === null ? gap : lh; }
    var y = top + Math.max(0, (bottom - top - total) / 2) + lh / 2;
    for (k = 0; k < lines.length; k++) {
      if (lines[k] === null) { y += gap; continue; }
      c.fillText(lines[k], cx, y);
      y += lh;
    }

    button(c, INTRO_BTN, T('continueBtn'), { fill: PAL.sun, font: 16 });
  }

  /* Little framed outdoor scene -- sky, sun, a far hill and grass -- shared
     by the intro picture and the designer previews. Caller clips. */
  function sceneBackdrop(c, x, y, w, h, gy) {
    var sky = c.createLinearGradient(0, y, 0, gy);
    sky.addColorStop(0, '#9cd4ea');
    sky.addColorStop(1, '#e4f3dc');
    c.fillStyle = sky;
    c.fillRect(x, y, w, gy - y);
    var sx = x + w - 50, sy = y + 50;
    var sg = c.createRadialGradient(sx, sy, 12, sx, sy, 60);
    sg.addColorStop(0, 'rgba(255, 236, 160, 0.5)');
    sg.addColorStop(1, 'rgba(255, 236, 160, 0)');
    c.fillStyle = sg;
    c.fillRect(sx - 60, sy - 60, 120, 120);
    E.fillEllipse(c, sx, sy, 22, 22, PAL.sun, false);
    E.fillEllipse(c, sx - 6, sy - 6, 10, 8, 'rgba(255,255,255,0.35)', false);
    c.fillStyle = '#a3cd90';
    c.beginPath();
    c.moveTo(x, gy - 30);
    c.quadraticCurveTo(x + w * 0.4, gy - 70, x + w, gy - 24);
    c.lineTo(x + w, gy); c.lineTo(x, gy);
    c.fill();
    var gg = c.createLinearGradient(0, gy, 0, y + h);
    gg.addColorStop(0, '#78bb51');
    gg.addColorStop(1, '#5c9a3d');
    c.fillStyle = gg;
    c.fillRect(x, gy, w, y + h - gy);
    c.fillStyle = 'rgba(75, 132, 51, 0.55)';
    c.fillRect(x, gy, w, 3);
  }

  /* Colour chip; the chosen one gets a thick ring and a tick. */
  function swatch(c, r, col, sel) {
    var hot = !sel && pointerOver(c, r.x, r.y, r.w, r.h);
    c.fillStyle = col;
    E.roundRect(c, r.x, r.y, r.w, r.h, 8);
    c.fill();
    c.fillStyle = 'rgba(255, 255, 255, 0.25)';
    E.roundRect(c, r.x + 3, r.y + 3, r.w - 6, r.h * 0.36, 5);
    c.fill();
    E.roundRect(c, r.x, r.y, r.w, r.h, 8);
    E.ink(c, sel ? 4 : (hot ? 3 : 1.8));
    if (sel) {
      var cx = r.x + r.w - 6, cy = r.y + 6;
      E.fillEllipse(c, cx, cy, 9, 9, PAL.leaf);
      c.strokeStyle = PAL.cream;
      c.lineWidth = 2.4;
      c.beginPath();
      c.moveTo(cx - 4, cy); c.lineTo(cx - 1, cy + 3.5); c.lineTo(cx + 4.5, cy - 3.5);
      c.stroke();
    }
  }

  function sectionLabel(c, text, x, y) {
    c.fillStyle = 'rgba(74,51,32,0.7)';
    c.font = 'bold 12px ' + FONT;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(text, x, y);
  }

  function drawIntroPicture(c) {
    var R = INTRO.pic;
    c.fillStyle = 'rgba(36, 23, 8, 0.16)';
    E.roundRect(c, R.x, R.y + 4, R.w, R.h, 12);
    c.fill();
    c.save();
    E.roundRect(c, R.x, R.y, R.w, R.h, 12);
    c.clip();
    var gy = R.y + R.h - 46;
    sceneBackdrop(c, R.x, R.y, R.w, R.h, gy);

    /* The bare tree, waiting */
    var tx = R.x + 172;
    E.softShadow(c, tx, gy + 4, 70, 6, 0.2);
    c.save();
    c.translate(tx, gy + 4);
    c.scale(0.62, 0.62);
    Game.tree.drawTree(c, 0, 0, 0, Game.EXT_DEFAULT, t, false);
    c.restore();

    /* Momoko looking up at it, dreaming of the finished house up in the
       open sky, clear of the canopy */
    var mx = R.x + 40, my = gy + 24;
    E.softShadow(c, mx, my, 16, 4, 0.22);
    E.drawCharacter(c, mx, my, Game.customization, 0, 1, 1.15, (t % 200) < 8);
    var bob = Math.sin(t / 30) * 2;
    var dots = [[52, 300, 3], [56, 254, 4], [60, 204, 5], [64, 152, 6.5]];
    for (var d = 0; d < dots.length; d++) {
      E.fillEllipse(c, R.x + dots[d][0], R.y + dots[d][1] + bob, dots[d][2], dots[d][2], '#ffffff');
    }
    E.fillEllipse(c, R.x + 82, R.y + 88 + bob, 50, 40, '#ffffff');
    c.save();
    c.translate(R.x + 82, R.y + 116 + bob);
    c.scale(0.15, 0.15);
    Game.tree.drawTree(c, 0, 0, Game.BUILD_STAGES.length, Game.EXT_DEFAULT, t, false);
    c.restore();
    c.restore();
    E.roundRect(c, R.x, R.y, R.w, R.h, 12);
    E.ink(c, 2);
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

    /* The same meadow as the title so the menus read as one place. */
    E.drawMeadowSky(c, 640, t, TITLE_GROUND, Game.MEADOW.width, 724);
    drawTitleGround(c);
    clipGame(c);

    /* Header */
    c.fillStyle = PAL.ink;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.font = 'bold 22px "M PLUS Rounded 1c", sans-serif';
    c.fillText(T('customTitle') + ': ' + T(nameKeyFor(target)), 22, 32);

    /* Preview */
    panel(c, CUST.previewX, CUST.previewY, CUST.previewW, CUST.previewH, '#cfe9f2');
    c.save();
    c.beginPath();
    E.roundRect(c, CUST.previewX + 2, CUST.previewY + 2, CUST.previewW - 4, CUST.previewH - 4, 9);
    c.clip();
    sceneBackdrop(c, CUST.previewX, CUST.previewY, CUST.previewW, CUST.previewH,
      CUST.previewY + CUST.previewH - 62);
    var pcx = CUST.previewX + CUST.previewW / 2;
    var pcy = CUST.previewY + CUST.previewH - 40;
    E.softShadow(c, pcx, pcy, 40, 8, 0.24);
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
      c.fillStyle = tileFill(c, r, sel, PAL.cream, 'rgba(255,244,220,0.9)');
      E.roundRect(c, r.x, r.y, r.w, r.h, 8);
      c.fill();
      E.ink(c, sel ? 3 : 1.8);
      drawVariantIcon(c, tab.id, vid, r.x + 40, r.y + r.h / 2, cust);
      c.fillStyle = PAL.ink;
      fitFont(c, T(tab.labelPrefix + vid), r.w - 80, 12, 'bold');
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(T(tab.labelPrefix + vid), r.x + 74, r.y + r.h / 2);
    }

    /* Colour swatches */
    if (tab.colorField && tab.colors) {
      for (var s = 0; s < tab.colors.length; s++) {
        swatch(c, swatchRect(s), tab.colors[s], cust[tab.colorField] === tab.colors[s]);
      }
    }

    /* Character picker */
    if (roster.length > 1) {
      c.fillStyle = 'rgba(74,51,32,0.7)';
      c.font = 'bold 12px "M PLUS Rounded 1c", sans-serif';
      c.textAlign = 'left';
      c.fillText(T('customPickWho'), CUST.pickerX, CUST.pickerY - 14);
      for (var p = 0; p < roster.length; p++) {
        var pr = portraitRect(p);
        var pcust = custRecord(roster[p].id);
        var pHot = roster[p].id !== target && pointerOver(c, pr.x, pr.y, pr.w, pr.h);
        if (roster[p].id === target || pHot) {
          c.fillStyle = pHot ? 'rgba(255, 244, 220, 0.8)' : PAL.sun;
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
        c.font = 'bold 13px "M PLUS Rounded 1c", sans-serif';
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
        c.font = 'bold 15px "M PLUS Rounded 1c", sans-serif';
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
    tabY: 72, tabH: 36, tabW: 150, tabGap: 8, tabX: 167,   /* (800 - 3*150 - 2*8) / 2 */
    matCols: 7, matCellW: 98, matCellH: 104, matY: 116,
    furCols: 9, furCellW: 86, furCellH: 74, furY: 112,
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
    /* Timber walls run out across the bezel on tablets; the shelves and
       buttons stay in the viewport. */
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#6b4a2f');
    g.addColorStop(0.35, '#c9a86a');
    g.addColorStop(1, '#8a6340');
    c.fillStyle = g;
    c.fillRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    clipGame(c);

    drawShopWall(c);

    /* Banner */
    var bg = c.createLinearGradient(0, 0, 0, 60);
    bg.addColorStop(0, '#4a3520');
    bg.addColorStop(1, '#33240f');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, 60);
    c.fillStyle = 'rgba(255, 210, 74, 0.35)';
    c.fillRect(0, 58, W, 2);
    c.fillStyle = PAL.sun;
    c.font = 'bold 22px "M PLUS Rounded 1c", sans-serif';
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
      c.font = 'bold 17px "M PLUS Rounded 1c", sans-serif';
      c.textAlign = 'center';
      c.fillText(T(cur.lockKey), W / 2, 220);
    } else {
      drawShopGrid(c);
    }

    drawBagPanel(c);
    drawBuildList(c);

    c.font = '12px "M PLUS Rounded 1c", sans-serif';
    var hw = c.measureText(T('shopHint')).width + 24;
    c.fillStyle = 'rgba(36, 23, 8, 0.55)';
    E.roundRect(c, W / 2 - hw / 2, 336, hw, 15, 7.5);
    c.fill();
    c.fillStyle = PAL.cream;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(T('shopHint'), W / 2, 344);
  }

  /* Plank wall with a shelf board under each row of goods, and bunting
     strung under the banner. The wall is static, so it is cached. */
  var BUNTING = [PAL.peach, PAL.sun, PAL.leafLight, PAL.sky, '#b06aa8'];
  function drawShopWall(c) {
    var spr = E.getCachedSprite('shopWall', W, 290, function (g) {
      var rnd = E.seeded(55);
      g.strokeStyle = 'rgba(74, 51, 32, 0.16)';
      g.lineWidth = 2;
      for (var x = 0; x < W; x += 64) {
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 290); g.stroke();
      }
      for (var k = 0; k < 14; k++) {
        var kx = rnd() * W, ky = 20 + rnd() * 250;
        g.fillStyle = 'rgba(74, 51, 32, 0.14)';
        g.beginPath(); g.ellipse(kx, ky, 5, 3, 0, 0, Math.PI * 2); g.fill();
      }
      for (var gl = 0; gl < 40; gl++) {
        var gx = rnd() * W, gy = rnd() * 290;
        g.strokeStyle = 'rgba(74, 51, 32, 0.08)';
        g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + 2, gy + 30 + rnd() * 40); g.stroke();
      }
    });
    c.drawImage(spr, 0, 60, spr.lw, spr.lh);

    var rows = shopTab === 'materials' ? [SHOP.matY + SHOP.matCellH, SHOP.matY + 2 * SHOP.matCellH]
      : shopTab === 'furniture' ? [SHOP.furY + SHOP.furCellH, SHOP.furY + 2 * SHOP.furCellH, SHOP.furY + 3 * SHOP.furCellH]
      : [324];
    for (var r = 0; r < rows.length; r++) {
      var y = rows[r] - 3;
      c.fillStyle = 'rgba(36, 23, 8, 0.25)';
      c.fillRect(6, y + 6, W - 12, 4);
      E.fillRound(c, 6, y, W - 12, 7, 2, '#8a6340');
      c.fillStyle = 'rgba(255, 230, 180, 0.3)';
      c.fillRect(8, y + 1, W - 16, 2);
    }

    /* bunting, gently swaying */
    c.strokeStyle = PAL.ink;
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(0, 62);
    c.quadraticCurveTo(W / 2, 66, W, 62);
    c.stroke();
    for (var f = 0; f < 21; f++) {
      var fx = 10 + f * 38;
      var u = fx / W;
      var fy = 62 + 8 * u * (1 - u);       /* on the curve above */
      var sw = Math.sin(t / 30 + f) * 1.5;
      E.fillPath(c, [[fx - 6, fy], [fx + 6, fy], [fx + sw, fy + 9]], BUNTING[f % BUNTING.length], true);
    }
  }

  function drawShopGrid(c) {
    var cells = shopGrid();
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var flashing = shopFlashTimer > 0 && shopFlash === cell.type;
      var owned = cell.kind === 'piano' && Game.flags.pianoOwned;

      var cellHot = !owned && pointerOver(c, cell.x + 4, cell.y + 4, cell.w - 8, cell.h - 8);
      c.fillStyle = owned ? 'rgba(180,170,150,0.75)'
        : (flashing ? PAL.sun : (cellHot ? PAL.cream : 'rgba(255, 244, 220, 0.92)'));
      E.roundRect(c, cell.x + 4, cell.y + 4, cell.w - 8, cell.h - 8, 8);
      c.fill();
      E.ink(c, flashing || cellHot ? 3 : 1.8);

      if (cell.kind === 'material') {
        E.drawMaterialIcon(c, cell.type, cell.x + cell.w / 2, cell.y + cell.h / 2 - 8, 46);
        c.fillStyle = PAL.ink;
        fitFont(c, T('mat_' + cell.type), cell.w - 16, 12, 'bold', 10);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(T('mat_' + cell.type), cell.x + cell.w / 2, cell.y + cell.h - 22);
      } else if (cell.kind === 'furniture') {
        drawFurnitureIcon(c, cell.type, cell.x + cell.w / 2, cell.y + 31, cell.w - 22, 38);
        c.fillStyle = PAL.ink;
        fitFont(c, T('furniture_' + cell.type), cell.w - 16, 11, 'bold', 8);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(T('furniture_' + cell.type), cell.x + cell.w / 2, cell.y + cell.h - 14);
      } else {
        drawFurniture(c, 'piano', cell.x + cell.w / 2, cell.y + cell.h - 34, 'placed');
        c.fillStyle = PAL.ink;
        c.font = 'bold 15px "M PLUS Rounded 1c", sans-serif';
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
    c.font = 'bold 14px "M PLUS Rounded 1c", sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(T('shopCart') + ' ' + bagUsed() + ' / ' + Game.bag.MAX, p.x + 14, p.y + 20);

    var s = SHOP.slot;
    var fullW = Game.bag.MAX * s.size + (Game.bag.MAX - 1) * s.gap;
    if (hasPianoInBag()) {
      /* One wide cell, so it reads as a single very large purchase. */
      c.fillStyle = '#f6e6c8';
      E.roundRect(c, s.x, s.y, fullW, s.size, 8);
      c.fill();
      E.ink(c, 2);
      drawFurniture(c, 'piano', s.x + 62, s.y + s.size - 6, 'palette');
      c.fillStyle = PAL.ink;
      c.font = 'bold 13px "M PLUS Rounded 1c", sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(T('furniture_piano'), s.x + 118, s.y + s.size / 2);
    } else {
      for (var i = 0; i < Game.bag.MAX; i++) {
        var sx = s.x + i * (s.size + s.gap);
        var item = Game.bag.items[i];
        c.fillStyle = item ? '#f6e6c8' : 'rgba(74,51,32,0.12)';
        E.roundRect(c, sx, s.y, s.size, s.size, 8);
        c.fill();
        E.ink(c, item ? 2 : 1.4);
        if (item) drawBagItemIcon(c, item, sx + s.size / 2, s.y + s.size / 2, 34);
      }
    }

    if (Game.bag.items.length === 0) {
      c.fillStyle = 'rgba(74,51,32,0.65)';
      c.font = '12px "M PLUS Rounded 1c", sans-serif';
      c.textAlign = 'left';
      fitFont(c, T('shopCartEmpty'), p.w - 146, 12, '', 10);
      c.fillText(T('shopCartEmpty'), p.x + 132, p.y + 20);
    }

    button(c, SHOP.emptyBtn, T('shopEmptyBag'),
      { font: 12, fill: Game.bag.items.length ? '#e88a7a' : 'rgba(255,244,220,0.45)',
        disabled: Game.bag.items.length === 0 });
  }

  function drawBagItemIcon(c, item, cx, cy, size) {
    if (item.kind === 'material') E.drawMaterialIcon(c, item.type, cx, cy, size);
    else drawFurnitureIcon(c, item.type, cx, cy, size, size);
  }

  function drawBuildList(c) {
    var p = SHOP.listPanel;
    panel(c, p.x, p.y, p.w, p.h);
    c.fillStyle = PAL.ink;
    c.font = 'bold 13px "M PLUS Rounded 1c", sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'middle';

    var stage = currentStage();
    if (!stage) {
      c.fillText(T('buildDone'), p.x + 14, p.y + 24);
      c.fillStyle = 'rgba(74,51,32,0.75)';
      c.font = '12px ' + FONT;
      var hl = layoutLines(c, T('shopDoneHint'), p.w - 28);
      for (var h = 0; h < hl.length; h++) c.fillText(hl[h], p.x + 14, p.y + 52 + h * 18);
      return;
    }
    c.fillText(T('shopBuildList') + ': ' + T('stage_' + stage.id), p.x + 14, p.y + 20);

    var remaining = remainingNeeds(stage);
    var keys = Object.keys(stage.needs);
    var col = 0, row = 0;
    c.font = 'bold 11px "M PLUS Rounded 1c", sans-serif';
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

  /* How much of the bag is used. Most things take one slot; the piano is a
     single item that takes all five. */
  function bagUsed() {
    var n = 0;
    for (var i = 0; i < Game.bag.items.length; i++) n += (Game.bag.items[i].slots || 1);
    return n;
  }

  function buyItem(cell) {
    if (cell.kind === 'piano') {
      if (Game.flags.pianoOwned) { showToast(T('shopPianoSold')); Game.audio.play('deny'); return; }
      if (Game.bag.items.length > 0) { showToast(T('shopPianoHeavy')); Game.audio.play('deny'); return; }
      /* One item that occupies the whole bag, rather than five copies of a
         piano -- five pianos in the bag read as five pianos. */
      Game.bag.items.push({ kind: 'piano', type: 'piano', slots: Game.bag.MAX });
      shopFlash = 'piano'; shopFlashTimer = 20;
      showToast(T('shopPianoHeavy'));
      Game.audio.play('pickup');
      return;
    }
    if (bagUsed() >= Game.bag.MAX) {
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
      while (remaining[keys[i]] > 0 && bagUsed() < Game.bag.MAX) {
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
    if (!stage) {
      /* Sized to the message, so "finished!" can't run off the panel. */
      c.font = 'bold 15px ' + FONT;
      pw = Math.max(pw, c.measureText(T('buildDone')).width + 28);
      ph = 44;
    }
    panel(c, px, py, pw, ph, 'rgba(255, 244, 220, 0.88)');
    c.fillStyle = PAL.ink;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    if (!stage) {
      c.font = 'bold 15px ' + FONT;
      c.fillText(T('buildDone'), px + 14, py + ph / 2 + 1);
      return;
    }
    c.font = 'bold 12px "M PLUS Rounded 1c", sans-serif';
    c.fillStyle = 'rgba(74,51,32,0.75)';
    c.fillText(T('buildNext'), px + 12, py + 15);
    /* One pip per stage along the top right: how far along the house is. */
    var nStages = Game.BUILD_STAGES.length, done = Game.build.stageIndex;
    for (var si = 0; si < nStages; si++) {
      var pcx = px + pw - 14 - (nStages - 1 - si) * 13, pcy = py + 15;
      c.beginPath();
      c.arc(pcx, pcy, 4.5, 0, Math.PI * 2);
      c.fillStyle = si < done ? PAL.leafLight : (si === done ? PAL.sun : 'rgba(74,51,32,0.14)');
      c.fill();
      E.ink(c, 1.2);
    }
    fitFont(c, T('stage_' + stage.id), pw - 24, 15, 'bold');
    c.fillStyle = PAL.ink;
    c.fillText(T('stage_' + stage.id), px + 12, py + 33);

    var remaining = remainingNeeds(stage);
    var keys = Object.keys(stage.needs);
    var ix = px + 12;
    c.font = 'bold 12px "M PLUS Rounded 1c", sans-serif';
    for (var i = 0; i < keys.length && i < 5; i++) {
      var left = remaining[keys[i]] || 0;
      E.drawMaterialIcon(c, keys[i], ix + 8, py + 50, 17);
      c.fillStyle = left === 0 ? PAL.leaf : PAL.ink;
      c.fillText(left === 0 ? '✓' : ('×' + left), ix + 19, py + 51);
      ix += 44;
    }
  }

  function drawBagHud(c) {
    var n = Game.bag.MAX;
    var size = 34, gap = 6;
    var totalW = n * size + (n - 1) * gap;
    /* Panel top lines up with the build HUD's on the left. */
    var x0 = W - totalW - 16, y0 = 18;
    c.save();
    c.globalAlpha = 0.9;
    c.fillStyle = 'rgba(255,244,220,0.8)';
    E.roundRect(c, x0 - 10, y0 - 8, totalW + 20, size + 16, 10);
    c.fill();
    c.restore();
    E.roundRect(c, x0 - 10, y0 - 8, totalW + 20, size + 16, 10);
    E.ink(c, 2);
    if (hasPianoInBag()) {
      c.fillStyle = '#f6e6c8';
      E.roundRect(c, x0, y0, totalW, size, 6);
      c.fill();
      E.ink(c, 1.4);
      drawFurniture(c, 'piano', x0 + totalW / 2, y0 + size - 3, 'palette');
    } else {
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
  }

  /* Bobbing icons above the player's head so it's obvious she's loaded. */
  function drawCarryOverlay(c, player, camX) {
    var n = Game.bag.items.length;
    if (n === 0) return;
    var sx = player.x - camX;
    var baseY = player.y - 74;
    if (hasPianoInBag()) {
      /* One piano bobbing overhead, not five. */
      var bobP = Math.sin(t / 14) * 3;
      c.save();
      c.globalAlpha = 0.95;
      E.fillEllipse(c, sx, baseY + bobP - 8, 30, 22, 'rgba(255,244,220,0.9)');
      drawFurniture(c, 'piano', sx, baseY + bobP + 4, 'palette');
      c.restore();
      return;
    }
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

  /* Floating "press DO to ..." bubble above an interactable. The key is
     drawn as a little key cap (Space) on keyboards, or a sun-yellow DO
     chip on touch, so it never depends on a glyph the font may lack. */
  function drawPrompt(c, sx, sy, label) {
    var bob = Math.sin(t / 12) * 3;
    var touch = Game.input.isTouch();
    var key = touch ? T('actionBtn') : 'Space';
    c.font = 'bold 9px ' + FONT;
    var kw = Math.max(touch ? 22 : 34, c.measureText(key).width + 10);
    c.font = 'bold 13px ' + FONT;
    var lw = c.measureText(label).width;
    var w = 8 + kw + 7 + lw + 12;
    var x = sx - w / 2, y = sy + bob;
    c.save();
    c.fillStyle = 'rgba(36, 23, 8, 0.22)';
    E.roundRect(c, x, y + 3, w, 30, 15);
    c.fill();
    c.fillStyle = 'rgba(255, 244, 220, 0.97)';
    E.roundRect(c, x, y, w, 30, 15);
    c.fill();
    E.ink(c, 2);

    /* key cap: darker skirt, lighter top face */
    var kx = x + 8, ky = y + 6;
    if (touch) {
      E.fillRound(c, kx, ky, kw, 18, 9, PAL.sun, false);
      E.ink(c, 1.5);
    } else {
      E.fillRound(c, kx, ky + 1, kw, 18, 5, PAL.creamDark, false);
      c.fillStyle = '#fffaf0';
      E.roundRect(c, kx + 2, ky + 1, kw - 4, 13, 4);
      c.fill();
      E.roundRect(c, kx, ky + 1, kw, 18, 5);
      E.ink(c, 1.5);
    }
    c.fillStyle = PAL.ink;
    c.font = 'bold 9px ' + FONT;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(key, kx + kw / 2, ky + (touch ? 9.5 : 8));
    c.font = 'bold 13px ' + FONT;
    c.textAlign = 'left';
    c.fillText(label, kx + kw + 7, y + 16);
    c.restore();
  }

  /* ================================================================
     Build cutscene
     ================================================================ */
  /* The camera glides to frame the tree, the new part fades and settles
     into place under a shower of sparkles, and a compact ribbon at the top
     names it -- nothing covers the house that was just built. Particles
     live in world space so they stay on the tree while the camera moves. */
  var CUT_LEN = 120;
  var cutscene = { timer: 0, stageId: null, particles: [] };

  function startBuildCutscene(stageId) {
    cutscene.timer = CUT_LEN;
    cutscene.stageId = stageId;
    cutscene.particles = [];
    Game.audio.play('build');
  }

  /* 0..1: how far the new layer has settled (eased). */
  function cutsceneReveal() {
    var k = Math.max(0, Math.min(1, (CUT_LEN - cutscene.timer - 8) / 34));
    return k * k * (3 - 2 * k);
  }

  /* Where on the tree the new part is, in world space, and how wide. */
  function cutsceneFocus() {
    var M = Game.MEADOW;
    var a = Game.tree.anchors(M.tree.x, M.tree.groundY);
    switch (cutscene.stageId) {
      case 'platform': return { x: a.x, y: a.platformY, w: a.platformW };
      case 'walls': return { x: a.x, y: a.houseTop + a.houseH / 2, w: a.houseW };
      case 'roof': return { x: a.x, y: a.houseTop - a.roofH / 2, w: a.houseW + 30 };
      case 'ladder': return { x: a.ladderX + a.ladderW / 2, y: a.platformY + 60, w: 40 };
      case 'openings': return { x: a.x, y: a.winCy + 8, w: a.houseW };
      default: return { x: a.x, y: a.houseTop + 20, w: a.houseW + 60 };
    }
  }

  var CUT_COLORS = [PAL.sun, PAL.cream, PAL.leafLight, PAL.peach, '#ffffff'];
  function updateBuildCutscene() {
    cutscene.timer--;
    for (var i = cutscene.particles.length - 1; i >= 0; i--) {
      cutscene.particles[i].update();
      if (cutscene.particles[i].life <= 0) cutscene.particles.splice(i, 1);
    }
    var f = cutsceneFocus();
    var age = CUT_LEN - cutscene.timer;
    var before = cutscene.particles.length;
    /* one big pop as the part lands, then a gentle shower over it */
    if (age === 34) E.spawnBurst(cutscene.particles, f.x, f.y, 44, CUT_COLORS, 5);
    if (age > 34 && age < 84 && age % 4 === 0) {
      E.spawnBurst(cutscene.particles, f.x + (Math.random() - 0.5) * f.w, f.y - 10,
        6, CUT_COLORS, 2.8);
    }
    /* chunkier than the delivery puff, so they read as celebration */
    for (var n = before; n < cutscene.particles.length; n++) cutscene.particles[n].size *= 1.6;
    return cutscene.timer <= 0 ? 'done' : null;
  }

  function drawBuildCutsceneOverlay(c) {
    var age = CUT_LEN - cutscene.timer;
    var out = Math.min(1, cutscene.timer / 24);          /* fade at the end */
    var camX = Game.engine.getCameraX();
    var f = cutsceneFocus();
    var fx = f.x - camX, fy = f.y;

    /* Soft vignette that keeps the tree bright. */
    c.save();
    var v = c.createRadialGradient(fx, 260, 120, fx, 260, 560);
    v.addColorStop(0, 'rgba(36, 23, 8, 0)');
    v.addColorStop(1, 'rgba(36, 23, 8, 0.42)');
    c.globalAlpha = out * Math.min(1, age / 16);
    c.fillStyle = v;
    c.fillRect(0, 0, W, H);

    /* Warm glow blooming behind the new part as it settles. */
    var gk = Math.sin(Math.min(1, age / 70) * Math.PI);
    if (gk > 0) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.32 * gk * out;
      var gl = c.createRadialGradient(fx, fy, 6, fx, fy, f.w * 0.75 + 40);
      gl.addColorStop(0, 'rgba(255, 226, 140, 0.9)');
      gl.addColorStop(1, 'rgba(255, 226, 140, 0)');
      c.fillStyle = gl;
      c.fillRect(fx - f.w - 60, fy - f.w - 60, f.w * 2 + 120, f.w * 2 + 120);
    }
    c.restore();

    /* Particles plus a ring of twinkling stars around the new part. */
    c.save();
    c.translate(-camX, 0);
    for (var i = 0; i < cutscene.particles.length; i++) cutscene.particles[i].draw(c);
    c.restore();
    if (age > 30) {
      c.save();
      for (var s = 0; s < 7; s++) {
        var tw = Math.sin(age / 6 + s * 1.9);
        if (tw <= 0) continue;
        var ang = s * 0.9 + age / 90;
        var sx = fx + Math.cos(ang) * (f.w / 2 + 18);
        var sy = fy + Math.sin(ang) * 46;
        c.globalAlpha = tw * out;
        c.fillStyle = '#fff6c8';
        E.star(c, sx, sy, 4 + tw * 4);
      }
      c.restore();
    }

    /* Ribbon banner at the top: drops in, then lifts away. */
    var drop = Math.min(1, age / 16);
    drop = 1 - (1 - drop) * (1 - drop);
    var by = -70 + drop * 82 - (1 - out) * 40;
    var title = T('stage_' + cutscene.stageId);
    c.save();
    c.globalAlpha = out;
    c.font = 'bold 22px ' + FONT;
    var bw = Math.max(250, Math.min(420, c.measureText(title).width + 120));
    var bx = W / 2 - bw / 2, bh = 58;
    /* ribbon tails */
    E.fillPath(c, [[bx + 14, by + 14], [bx - 26, by + 18], [bx - 12, by + 36], [bx - 26, by + 54], [bx + 14, by + 50]], '#e0a92a');
    E.fillPath(c, [[bx + bw - 14, by + 14], [bx + bw + 26, by + 18], [bx + bw + 12, by + 36], [bx + bw + 26, by + 54], [bx + bw - 14, by + 50]], '#e0a92a');
    c.fillStyle = 'rgba(36, 23, 8, 0.25)';
    E.roundRect(c, bx, by + 4, bw, bh, 12);
    c.fill();
    E.fillRound(c, bx, by, bw, bh, 12, PAL.cream);
    c.fillStyle = 'rgba(255, 210, 74, 0.35)';
    E.roundRect(c, bx + 4, by + 4, bw - 8, 18, 8);
    c.fill();
    c.fillStyle = '#e0a92a';
    E.star(c, bx + 26, by + bh / 2, 9); E.ink(c, 1.5);
    E.star(c, bx + bw - 26, by + bh / 2, 9); E.ink(c, 1.5);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = PAL.ink;
    c.font = 'bold 12px ' + FONT;
    c.fillText(T('stageBuilt'), W / 2, by + 15);
    c.fillStyle = '#3b6b2a';
    fitFont(c, title, bw - 80, 22, 'bold', 14);
    c.fillText(title, W / 2, by + 37);
    c.restore();
  }

  /* ================================================================
     Exterior customizer
     ================================================================ */

  var EXT = {
    previewX: 18, previewY: 52, previewW: 316, previewH: 404,
    /* Five tabs span exactly the grid below: 350 .. 782. */
    tabX: 350, tabY: 58, tabW: 83.2, tabH: 36, tabGap: 4,
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

    /* The same meadow as the character designer, out across the bezel
       on tablets; the controls stay in the viewport. */
    E.drawMeadowSky(c, 640, t, TITLE_GROUND, Game.MEADOW.width, 724);
    drawTitleGround(c);
    clipGame(c);

    c.fillStyle = PAL.ink;
    c.font = 'bold 22px "M PLUS Rounded 1c", sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(T('extTitle'), 20, 28);

    /* Live preview */
    panel(c, EXT.previewX, EXT.previewY, EXT.previewW, EXT.previewH, '#cfe9f2');
    c.save();
    c.beginPath();
    E.roundRect(c, EXT.previewX + 2, EXT.previewY + 2, EXT.previewW - 4, EXT.previewH - 4, 9);
    c.clip();
    sceneBackdrop(c, EXT.previewX, EXT.previewY, EXT.previewW, EXT.previewH,
      EXT.previewY + EXT.previewH - 48);
    E.softShadow(c, EXT.previewX + EXT.previewW / 2, EXT.previewY + EXT.previewH - 38, 100, 8, 0.2);
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
        /* Selected = sun yellow, same as every other tile in the game. */
        c.fillStyle = tileFill(c, dr, on, PAL.cream, 'rgba(255,244,220,0.9)');
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
        fitFont(c, T(tab.labelPrefix + tab.toggles[d]), dr.w - 54, 13, 'bold');
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText(T(tab.labelPrefix + tab.toggles[d]), dr.x + 46, dr.y + dr.h / 2);
      }
    } else {
      for (var v = 0; v < tab.variants.length; v++) {
        var r = extCellRect(v);
        var sel = ext[tab.field] === tab.variants[v];
        c.fillStyle = tileFill(c, r, sel, PAL.cream, 'rgba(255,244,220,0.9)');
        E.roundRect(c, r.x, r.y, r.w, r.h, 8);
        c.fill();
        E.ink(c, sel ? 3 : 1.8);
        drawExtIcon(c, tab.id, tab.variants[v], r.x + 34, r.y + r.h / 2, ext);
        c.fillStyle = PAL.ink;
        fitFont(c, T(tab.labelPrefix + tab.variants[v]), r.w - 76, 13, 'bold');
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.fillText(T(tab.labelPrefix + tab.variants[v]), r.x + 68, r.y + r.h / 2);
      }
    }

    if (tab.colorField && tab.colors) {
      sectionLabel(c, T('colourLabel'), EXT.swatchX, EXT.swatchY - 16);
      for (var s = 0; s < tab.colors.length; s++) {
        swatch(c, extSwatchRect(s), tab.colors[s], ext[tab.colorField] === tab.colors[s]);
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

     Laid out like the house-decorating screen in momoko-in-space: a slim
     top bar (room tabs, Clear All, Go Outside), one compact palette row
     (a 3x2 block of category tabs, then the item tiles), and the room
     below -- a full-height back wall and a walk-around floor. Momoko walks
     it in 2D and everything -- furniture, Momoko, the friend who lives
     here -- is depth-sorted by y so she can stand behind or in front of
     the furniture.
     ================================================================ */

  var ROOM = {
    /* top bar */
    tabX: 10, tabY: 5, tabW: 112, tabH: 30, tabGap: 6,
    clear: { x: 490, y: 7, w: 142, h: 26 },
    exit: { x: 648, y: 5, w: 140, h: 30 },
    /* palette strip: categories in a 3x2 block, tiles in one row */
    stripY: 40, stripH: 82,
    catX: 10, catY: 47, catW: 72, catH: 31, catGap: 4, catCols: 3,
    /* No category holds more than six pieces, so one row always fits. */
    itemX: 246, itemY: 46, itemW: 84, itemH: 70, itemGap: 6,
    /* the room: the wall now runs from the strip down to the skirting */
    wallTop: 122, floorY: 252,
    /* Unchanged from v1.3 so saved furniture positions stay where they
       were (they are still clamped on entry, see clampPlaced()). */
    floor: { left: 34, right: 700, top: 300, bottom: 452 },
    door: { x: 744, y: 372 },
    windows: [150, 650],
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
    var col = i % ROOM.catCols, row = Math.floor(i / ROOM.catCols);
    return { x: ROOM.catX + col * (ROOM.catW + ROOM.catGap),
             y: ROOM.catY + row * (ROOM.catH + ROOM.catGap), w: ROOM.catW, h: ROOM.catH };
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
    /* The piano isn't in FURNITURE_TYPES (it's a shop special), but it still
       belongs on the Fun shelf -- greyed out with a zero badge until you own
       one, so it's discoverable rather than appearing from nowhere. */
    if (roomCat === 'fun') out.push({ type: 'piano', count: store.piano || 0 });
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

  /* Keep every placed piece on the walkable floor, whatever an older
     layout or a hand-edited save left behind. Moves pieces, never drops. */
  function clampPlaced(items) {
    var f = ROOM.floor;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (typeof it.x !== 'number' || isNaN(it.x)) it.x = (f.left + f.right) / 2;
      if (typeof it.y !== 'number' || isNaN(it.y)) it.y = (f.top + f.bottom) / 2;
      it.x = Math.max(f.left, Math.min(f.right, it.x));
      it.y = Math.max(f.top, Math.min(f.bottom, it.y));
    }
  }

  /* ---- update ---- */
  function updateHouseInterior(keys, jp) {
    validateSelection();
    clampPlaced(Game.rooms[Game.currentRoom] || []);
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

  /* Half-width of each piece's floor shadow; 0 for flat or wall-hung
     pieces (rug, pictures, clock, the ceiling-hung disco ball). */
  var FOOTPRINT = {
    bed: 54, bunkBed: 52, hammock: 50, cushion: 22, chair: 24, stool: 18,
    sofa: 58, beanbag: 30, table: 50, coffeeTable: 42, desk: 46, shelf: 36,
    fridge: 32, lamp: 18, lantern: 16, candle: 22, fireplace: 50, rug: 0,
    painting: 0, mirror: 0, plant: 20, clock: 0, teaSet: 30, toybox: 32,
    easel: 28, discoBall: 0, piano: 60,
  };

  /* ---- draw ---- */
  function drawHouseInterior(c) {
    t++;
    var rd = roomDef(Game.currentRoom);
    var items = Game.rooms[Game.currentRoom] || [];
    var p = ensureRoomPlayer();

    /* Back wall: plank lines, darker toward the corners */
    var g = c.createLinearGradient(0, ROOM.wallTop, 0, ROOM.floorY);
    g.addColorStop(0, rd.wallA);
    g.addColorStop(1, rd.wallB);
    c.fillStyle = g;
    c.fillRect(0, ROOM.wallTop, W, ROOM.floorY - ROOM.wallTop);
    c.save();
    c.globalAlpha = 0.11;
    c.strokeStyle = PAL.ink;
    c.lineWidth = 2;
    for (var wy = ROOM.wallTop + 24; wy < ROOM.floorY - 10; wy += 18) {
      c.beginPath(); c.moveTo(0, wy); c.lineTo(W, wy); c.stroke();
    }
    c.restore();
    drawWallpaper(c, rd);
    var cg = c.createLinearGradient(0, 0, W, 0);
    cg.addColorStop(0, 'rgba(74, 51, 32, 0.16)');
    cg.addColorStop(0.18, 'rgba(74, 51, 32, 0)');
    cg.addColorStop(0.82, 'rgba(74, 51, 32, 0)');
    cg.addColorStop(1, 'rgba(74, 51, 32, 0.16)');
    c.fillStyle = cg;
    c.fillRect(0, ROOM.wallTop, W, ROOM.floorY - ROOM.wallTop);

    for (var wi = 0; wi < ROOM.windows.length; wi++) {
      drawInteriorWindow(c, ROOM.windows[wi], ROOM.wallTop + 22, rd);
    }

    /* Crown moulding under the palette strip */
    c.fillStyle = E.shade(rd.floor, 6);
    c.fillRect(0, ROOM.wallTop, W, 9);
    c.fillStyle = 'rgba(255, 244, 220, 0.35)';
    c.fillRect(0, ROOM.wallTop + 9, W, 2);
    c.fillStyle = 'rgba(36, 23, 8, 0.18)';
    c.fillRect(0, ROOM.wallTop + 11, W, 4);

    /* Floor, in perspective so the room reads as a space you walk around */
    c.fillStyle = rd.floor;
    c.fillRect(0, ROOM.floorY, W, H - ROOM.floorY);
    var fg = c.createLinearGradient(0, ROOM.floorY, 0, H);
    fg.addColorStop(0, 'rgba(36, 23, 8, 0.22)');
    fg.addColorStop(0.35, 'rgba(36, 23, 8, 0)');
    fg.addColorStop(1, 'rgba(255, 244, 220, 0.08)');
    c.fillStyle = fg;
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
    /* Sunlight from the two windows lying across the floorboards */
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (var lw = 0; lw < ROOM.windows.length; lw++) {
      var wx = ROOM.windows[lw];
      var lg = c.createLinearGradient(0, ROOM.floorY, 0, ROOM.floorY + 150);
      lg.addColorStop(0, 'rgba(255, 230, 160, 0.16)');
      lg.addColorStop(1, 'rgba(255, 230, 160, 0)');
      c.fillStyle = lg;
      c.beginPath();
      c.moveTo(wx - 50, ROOM.floorY);
      c.lineTo(wx + 50, ROOM.floorY);
      c.lineTo(wx + 130, ROOM.floorY + 150);
      c.lineTo(wx - 10, ROOM.floorY + 150);
      c.closePath();
      c.fill();
    }
    c.restore();

    /* Skirting board with a lit top edge and a contact shadow on the floor */
    c.fillStyle = PAL.bark;
    c.fillRect(0, ROOM.floorY - 12, W, 12);
    c.fillStyle = PAL.barkLight;
    c.fillRect(0, ROOM.floorY - 12, W, 3);
    c.fillStyle = 'rgba(36, 23, 8, 0.25)';
    c.fillRect(0, ROOM.floorY, W, 4);

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
      if (e.item) {
        var fw = FOOTPRINT[e.item.type] === undefined ? 30 : FOOTPRINT[e.item.type];
        if (fw) E.softShadow(c, e.item.x, e.item.y + 1, fw, Math.max(4, fw * 0.17), 0.3);
        drawFurniture(c, e.item.type, e.item.x, e.item.y, 'placed', e.item.flip);
      }
      else if (e.friend) {
        E.softShadow(c, fs.x, fs.y + 1, 18, 4, 0.26);
        E.drawCharacter(c, fs.x, fs.y, Game.friends[e.friend.id].cust, 0, -1, 1, false);
      } else {
        E.softShadow(c, p.x, p.y + 1, 18, 4, 0.26);
        E.drawCharacter(c, p.x, p.y, Game.customization, p.frame, p.facing, 1, p.blink);
      }
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

    /* The two-step hint lives on the wall between the windows; once a
       piece is picked it turns into the sun-yellow "tap the floor" call-out,
       right where the eye already is. */
    var pillTxt = selectedPiece ? T('furnitureTapFloor') : T('furnitureHint');
    c.font = 'bold ' + (selectedPiece ? 14 : 12) + 'px ' + FONT;
    var pw = Math.min(330, c.measureText(pillTxt).width + 36);
    var px0 = (W - pw) / 2, py0 = ROOM.wallTop + 26;
    c.save();
    c.globalAlpha = selectedPiece ? 0.96 : 0.8;
    panel(c, px0, py0, pw, 30, selectedPiece ? PAL.sun : PAL.cream);
    c.restore();
    c.fillStyle = PAL.ink;
    fitFont(c, pillTxt, pw - 20, selectedPiece ? 14 : 12, 'bold', 9);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(pillTxt, W / 2, py0 + 16);
    if (selectedPiece) {
      /* Translucent ghost of the piece, bobbing, so it's clear what lands.
         It follows the mouse over the floor (clamped exactly as placePiece
         will clamp it); on touch there's no hover, so it waits mid-floor. */
      var gx = W / 2, gy = 396;
      var mp = Game.input.pointer;
      if (mp.px >= 0 && mp.y > ROOM.stripY + ROOM.stripH) {
        gx = Math.max(ROOM.floor.left, Math.min(ROOM.floor.right, mp.x));
        gy = Math.max(ROOM.floor.top, Math.min(ROOM.floor.bottom, mp.y));
      }
      c.save();
      c.globalAlpha = 0.42 + Math.sin(t / 12) * 0.14;
      drawFurniture(c, selectedPiece, gx, gy + Math.sin(t / 12) * 4, 'placed');
      c.restore();
    }

    drawToast(c);
  }

  /* A faint motif on each room's wall, in its accent colour: leaves in the
     main room, stars in the bedroom, gingham in the kitchen, notes in the
     music room. Cached per room. */
  function drawWallpaper(c, rd) {
    var h = ROOM.floorY - ROOM.wallTop;
    var spr = E.getCachedSprite('wallpaper-' + rd.id, W, h, function (g) {
      g.globalAlpha = 0.2;
      g.fillStyle = rd.accent;
      g.strokeStyle = rd.accent;
      var x, y, row = 0;
      if (rd.id === 'kitchen') {
        for (x = 0; x < W; x += 24) g.fillRect(x, 0, 12, h);
        g.globalAlpha = 0.12;
        for (y = 0; y < h; y += 24) g.fillRect(0, y, W, 12);
        return;
      }
      for (y = 22; y < h; y += 34, row++) {
        for (x = (row % 2) * 30 + 14; x < W; x += 60) {
          if (rd.id === 'bed') {
            E.star(g, x, y, 5);
          } else if (rd.id === 'music') {
            g.beginPath(); g.ellipse(x, y + 5, 4, 3, -0.4, 0, Math.PI * 2); g.fill();
            g.lineWidth = 1.6;
            g.beginPath(); g.moveTo(x + 3.5, y + 4); g.lineTo(x + 3.5, y - 8); g.lineTo(x + 8, y - 5); g.stroke();
          } else {
            g.beginPath(); g.ellipse(x, y, 3, 6, 0.6, 0, Math.PI * 2); g.fill();
          }
        }
      }
    });
    c.drawImage(spr, 0, ROOM.wallTop, spr.lw, spr.lh);
  }

  function drawRoomDoor(c) {
    var d = ROOM.door;
    /* Daylight spilling in under and around the door: a warm wedge that
       fades out across the floor, plus a bright sliver at the threshold. */
    c.save();
    var sg = c.createLinearGradient(0, d.y, 0, d.y + 76);
    sg.addColorStop(0, 'rgba(255, 226, 140, 0.5)');
    sg.addColorStop(1, 'rgba(255, 226, 140, 0)');
    c.fillStyle = sg;
    c.beginPath();
    c.moveTo(d.x - 34, d.y);
    c.lineTo(d.x + 34, d.y);
    c.quadraticCurveTo(d.x + 50, d.y + 40, d.x + 44, d.y + 76);
    c.lineTo(d.x - 96, d.y + 76);
    c.quadraticCurveTo(d.x - 66, d.y + 36, d.x - 34, d.y);
    c.closePath();
    c.fill();
    c.restore();
    /* frame, then the door itself */
    E.fillRound(c, d.x - 40, d.y - 110, 80, 112, 7, PAL.bark);
    E.fillRound(c, d.x - 34, d.y - 104, 68, 104, 6, '#a9773f');
    E.fillRound(c, d.x - 26, d.y - 94, 52, 34, 4, '#c69a5e');
    E.fillRound(c, d.x - 26, d.y - 52, 52, 40, 4, '#c69a5e');
    E.fillEllipse(c, d.x + 20, d.y - 56, 4, 4, PAL.sun);
    c.fillStyle = 'rgba(255, 236, 170, 0.9)';
    c.fillRect(d.x - 32, d.y - 3, 64, 3);
  }

  function drawInteriorWindow(c, cx, cy, rd) {
    var ww = 116, wh = 74;
    var x = cx - ww / 2;
    /* frame and outdoor view */
    E.fillRound(c, x, cy, ww, wh, 6, PAL.cream);
    c.save();
    c.beginPath(); E.roundRect(c, x + 7, cy + 7, ww - 14, wh - 14, 3); c.clip();
    var sky = c.createLinearGradient(0, cy, 0, cy + wh);
    sky.addColorStop(0, '#9cd4ea');
    sky.addColorStop(1, '#e4f3dc');
    c.fillStyle = sky;
    c.fillRect(x, cy, ww, wh);
    E.fillEllipse(c, cx + 26, cy + 22, 12, 7, '#ffffff', false);
    E.fillEllipse(c, cx - 24, cy + wh + 2, 46, 26, '#a3cd90', false);
    E.fillEllipse(c, cx + 30, cy + wh + 6, 44, 28, PAL.leafLight, false);
    E.fillEllipse(c, cx - 2, cy + 34, 16, 14, PAL.leaf, false);
    c.fillStyle = PAL.bark;
    c.fillRect(cx - 3, cy + 42, 6, 20);
    c.restore();
    /* glazing bars */
    c.strokeStyle = PAL.cream;
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(cx, cy + 6); c.lineTo(cx, cy + wh - 6);
    c.moveTo(x + 6, cy + wh / 2); c.lineTo(x + ww - 6, cy + wh / 2);
    c.stroke();
    E.roundRect(c, x, cy, ww, wh, 6);
    E.ink(c, 2.5);
    /* soft pane glint */
    c.save();
    c.globalAlpha = 0.35;
    E.fillPath(c, [[x + 14, cy + 30], [x + 30, cy + 10], [x + 38, cy + 10], [x + 22, cy + 30]], '#ffffff', true, false);
    c.restore();
    /* sill, then curtains gathered at each side in the room's accent */
    E.fillRound(c, x - 8, cy + wh - 2, ww + 16, 9, 3, E.shade(rd.floor, 8));
    E.fillRound(c, x - 14, cy - 8, ww + 28, 7, 3, PAL.bark);
    var cur = rd.accent;
    E.fillPath(c, [[x - 12, cy - 2], [x + 14, cy - 2], [x + 4, cy + 34], [x - 4, cy + 62], [x - 14, cy + 62]], cur);
    E.fillPath(c, [[x + ww + 12, cy - 2], [x + ww - 14, cy - 2], [x + ww - 4, cy + 34], [x + ww + 4, cy + 62], [x + ww + 14, cy + 62]], cur);
    E.fillRound(c, x - 13, cy + 34, 14, 5, 2, E.shade(cur, -20));
    E.fillRound(c, x + ww - 1, cy + 34, 14, 5, 2, E.shade(cur, -20));
  }

  function drawRoomTabs(c) {
    c.fillStyle = 'rgba(59, 42, 22, 0.96)';
    c.fillRect(0, 0, W, ROOM.stripY);
    for (var i = 0; i < Game.ROOMS.length; i++) {
      button(c, roomTabRect(i), T(Game.ROOMS[i].nameKey),
        { active: Game.ROOMS[i].id === Game.currentRoom, font: 12, r: 7 });
    }
    button(c, ROOM.clear, T('furnitureClear'), { font: 11, fill: '#e88a7a', r: 6 });
    button(c, ROOM.exit, T('furnitureExit'), { font: 13, fill: PAL.leafLight });
  }

  function drawPalette(c) {
    c.fillStyle = 'rgba(36, 23, 8, 0.9)';
    c.fillRect(0, ROOM.stripY, W, ROOM.stripH);
    c.strokeStyle = 'rgba(255, 210, 74, 0.45)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, ROOM.stripY + ROOM.stripH);
    c.lineTo(W, ROOM.stripY + ROOM.stripH);
    c.stroke();
    /* divider between the category block and the tiles */
    c.strokeStyle = 'rgba(255, 244, 220, 0.18)';
    c.beginPath();
    c.moveTo(ROOM.itemX - 6, ROOM.stripY + 8);
    c.lineTo(ROOM.itemX - 6, ROOM.stripY + ROOM.stripH - 8);
    c.stroke();

    for (var i = 0; i < Game.FURNITURE_CATEGORIES.length; i++) {
      button(c, catRect(i), T('furnitureCat_' + Game.FURNITURE_CATEGORIES[i]),
        { active: Game.FURNITURE_CATEGORIES[i] === roomCat, font: 11, r: 6 });
    }

    var items = paletteItems();
    for (var k = 0; k < items.length && k < 6; k++) {
      var ir = paletteItemRect(k);
      var owned = items[k].count > 0;
      var sel = selectedPiece === items[k].type;
      var itemHot = !sel && pointerOver(c, ir.x, ir.y, ir.w, ir.h);
      c.fillStyle = sel ? PAL.sun : (owned ? (itemHot ? '#fffaf0' : 'rgba(255,244,220,0.95)')
                                           : (itemHot ? 'rgba(255,244,220,0.42)' : 'rgba(255,244,220,0.28)'));
      E.roundRect(c, ir.x, ir.y, ir.w, ir.h, 8);
      c.fill();
      E.ink(c, sel ? 3.5 : (itemHot ? 2.6 : 1.6));

      /* Shop-sized icon, shrunk a touch so the tallest piece clears the badge */
      c.save();
      if (!owned) c.globalAlpha = 0.45;
      drawFurnitureIcon(c, items[k].type, ir.x + ir.w / 2, ir.y + 30, ir.w - 26, 36);
      c.restore();

      c.fillStyle = owned ? PAL.ink : 'rgba(255,244,220,0.8)';
      fitFont(c, T('furniture_' + items[k].type), ir.w - 8, 10, 'bold', 8);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(T('furniture_' + items[k].type), ir.x + ir.w / 2, ir.y + ir.h - 9);

      /* Count badge -- green when owned, a muted zero when you don't own one. */
      E.fillEllipse(c, ir.x + ir.w - 9, ir.y + 9, 8.5, 8.5, owned ? PAL.leaf : 'rgba(74,51,32,0.5)');
      c.fillStyle = PAL.cream;
      c.font = 'bold 10px ' + FONT;
      c.fillText(String(items[k].count), ir.x + ir.w - 9, ir.y + 9.5);
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
    for (i = 0; i < items.length && i < 6; i++) {
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
  /* Pieces differ wildly in height (a cushion vs a fridge) and wall pieces
     hang well above their anchor, so icons are fitted to their real ink
     bounds, measured once per piece on a scratch canvas. */
  var iconBounds = {};
  function furnitureBounds(type) {
    if (iconBounds[type]) return iconBounds[type];
    var S = 160, ox = 80, oy = 120;
    var cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    var g = cv.getContext('2d');
    drawFurniture(g, type, ox, oy, 'palette');
    var d = g.getImageData(0, 0, S, S).data;
    var x0 = S, y0 = S, x1 = -1, y1 = -1;
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        if (d[(y * S + x) * 4 + 3] < 40) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    var b = x1 < 0 ? { x: -20, y: -30, w: 40, h: 30 }
                   : { x: x0 - ox, y: y0 - oy, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    iconBounds[type] = b;
    return b;
  }

  /* Palette-sized piece, centred in a bw x bh box at (cx, cy). Never grown
     past 1.3x, so small things stay small-looking. */
  function drawFurnitureIcon(c, type, cx, cy, bw, bh) {
    var b = furnitureBounds(type);
    var k = Math.min(1.3, bw / b.w, bh / b.h);
    c.save();
    c.translate(cx, cy);
    c.scale(k, k);
    drawFurniture(c, type, -(b.x + b.w / 2), -(b.y + b.h / 2), 'palette');
    c.restore();
  }

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
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        var plateName = T('friend_momoko');
        E.fitText(c, plateName, 90, 8);
        c.fillText(plateName, 0, -73);
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
    c.fillRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    panel(c, 250, 120, 300, 290);
    c.fillStyle = PAL.ink;
    c.font = 'bold 24px "M PLUS Rounded 1c", sans-serif';
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

  /* Party scene: the meadow backdrop, the finished tree on the right,
     everyone hopping on the grass in front of it, confetti drifting down
     and sparkles round the house. The words and the button live together
     in one panel on the left, clear of the friends below it. */
  var VICTORY = {
    panel: { x: 24, y: 22, w: 360, h: 286 },
    textTop: 76, textBottom: 232, textW: 318,
    tree: { x: 604, groundY: 440, scale: 0.8 },
    spots: [72, 164, 256, 408, 724],
    groundY: 428,
  };
  var VICTORY_BTN = { x: 114, y: 246, w: 180, h: 46 };

  var CONFETTI = (function () {
    var rnd = E.seeded(31);
    var cols = [PAL.sun, PAL.peach, PAL.leafLight, PAL.skyDeep, '#b06aa8', PAL.cream];
    var out = [];
    for (var i = 0; i < 64; i++) {
      out.push({ x: rnd() * W, y: rnd() * (H + 40), v: 0.5 + rnd() * 0.9, ph: rnd() * 6.28,
                 spin: 0.03 + rnd() * 0.08, w: 4 + rnd() * 4, h: 2.5 + rnd() * 3,
                 col: cols[Math.floor(rnd() * cols.length)] });
    }
    return out;
  })();

  function drawVictory(c) {
    t++;
    var V = VICTORY;
    E.drawMeadowSky(c, 1500, t, V.groundY, Game.MEADOW.width);
    /* late-afternoon warmth over the sky */
    var wg = c.createLinearGradient(0, VIEW.y, 0, V.groundY);
    wg.addColorStop(0, 'rgba(255, 214, 150, 0.32)');
    wg.addColorStop(1, 'rgba(255, 214, 150, 0)');
    c.fillStyle = wg;
    c.fillRect(VIEW.x, VIEW.y, VIEW.w, V.groundY - VIEW.y);
    drawTitleGround(c, V.groundY);
    clipGame(c);

    var TR = V.tree;
    E.softShadow(c, TR.x, TR.groundY + 2, 130, 9, 0.22);
    c.save();
    c.translate(TR.x, TR.groundY);
    c.scale(TR.scale, TR.scale);
    Game.tree.drawTree(c, 0, 0, Game.BUILD_STAGES.length, Game.exterior, t, false);
    c.restore();

    /* sparkles twinkling round the house */
    var a = Game.tree.anchors(0, 0);
    c.save();
    c.fillStyle = '#fff6c8';
    for (var s = 0; s < 9; s++) {
      var tw = Math.sin(t / 9 + s * 2.1);
      if (tw <= 0) continue;
      var ang = s * 0.7 + t / 160;
      var sx = TR.x + Math.cos(ang) * (a.houseW * 0.62) * TR.scale * 1.25;
      var sy = TR.groundY + (a.houseTop + 20) * TR.scale + Math.sin(ang) * 70 * TR.scale;
      c.globalAlpha = tw;
      E.star(c, sx, sy, 3 + tw * 4);
    }
    c.restore();

    /* Everyone hops in front of the tree, turning to each other now and then. */
    var roster = designRoster();
    for (var i = 0; i < roster.length; i++) {
      var cx = V.spots[i % V.spots.length];
      var hop = Math.max(0, Math.sin(t / 8 + i * 1.3)) * 9;
      var face = (Math.floor(t / 70 + i) % 2) ? 1 : -1;
      E.drawCharacter(c, cx, 452, custRecord(roster[i].id), 0, face, 1, false, hop);
    }

    /* confetti, deterministic so it never needs per-frame randomness */
    c.save();
    for (var k = 0; k < CONFETTI.length; k++) {
      var p = CONFETTI[k];
      var py = (p.y + t * p.v) % (H + 40) - 20;
      var px = p.x + Math.sin(t * 0.03 + p.ph) * 14;
      c.save();
      c.translate(px, py);
      c.rotate(t * p.spin + p.ph);
      c.scale(1, Math.abs(Math.cos(t * p.spin * 1.7 + p.ph)) * 0.8 + 0.2);
      c.fillStyle = p.col;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
    }
    c.restore();

    /* The words and the button share one panel, with real padding. */
    var P = V.panel;
    c.save();
    c.fillStyle = 'rgba(36, 23, 8, 0.2)';
    E.roundRect(c, P.x, P.y + 4, P.w, P.h, 12);
    c.fill();
    c.restore();
    panel(c, P.x, P.y, P.w, P.h, 'rgba(255, 244, 220, 0.96)');
    c.fillStyle = 'rgba(255, 210, 74, 0.3)';
    E.roundRect(c, P.x + 6, P.y + 6, P.w - 12, 44, 8);
    c.fill();
    c.fillStyle = PAL.ink;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var cxP = P.x + P.w / 2;
    fitFont(c, T('victoryTitle'), P.w - 40, 26, 'bold', 16);
    c.fillText(T('victoryTitle'), cxP, P.y + 29);
    c.font = '13px ' + FONT;
    /* The string's single line breaks were set for a wider panel; re-flow
       each paragraph to this one and keep only the paragraph gaps. */
    var paras = T('victoryText').split('\n\n');
    for (var pi = 0; pi < paras.length; pi++) paras[pi] = paras[pi].replace(/([、。])\n/g, '$1').replace(/\n/g, ' ');
    var lines = layoutLines(c, paras.join('\n\n'), V.textW);
    var lh = Math.min(20, (V.textBottom - V.textTop) / lines.length);
    var ty = V.textTop + (V.textBottom - V.textTop - lines.length * lh) / 2 + lh / 2;
    for (var li = 0; li < lines.length; li++) c.fillText(lines[li], cxP, ty + li * lh);

    button(c, VICTORY_BTN, T('victoryAgain'), { fill: PAL.sun, font: 15 });
  }

  function handleVictoryClick(mx, my) {
    if (hit(VICTORY_BTN, mx, my)) return 'continue';
    return null;
  }

  /* ================================================================ */

  /* Canvas text doesn't trigger web-font downloads reliably (Safari), so
     ask for every weight we draw with, covering all game text. Cached
     scenery sprites with words on them are repainted once it lands. */
  if (document.fonts && document.fonts.load) {
    var sample = Game.i18n.allText();
    ['400', '700'].forEach(function (wgt) {
      document.fonts.load(wgt + ' 16px "M PLUS Rounded 1c"', sample)
        .then(function () { E.clearSpriteCache(); })
        .catch(function () {});
    });
  }

  window.Game.ui = {
    setView: setView,
    VIEW: VIEW,
    /* shared */
    button: button, hit: hit, panel: panel, multiline: multiline,
    FONT: FONT, pointerOver: pointerOver, fitFont: fitFont, layoutLines: layoutLines,
    beginFrame: function () { anyHot = false; },
    isHot: function () { return anyHot; },
    showToast: showToast, drawToast: drawToast,
    dropStaleToast: dropStaleToast, endFrame: endFrame,
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
    bagUsed: bagUsed, hasPianoInBag: hasPianoInBag,
    /* cutscene */
    startBuildCutscene: startBuildCutscene, updateBuildCutscene: updateBuildCutscene,
    drawBuildCutsceneOverlay: drawBuildCutsceneOverlay,
    cutsceneReveal: cutsceneReveal,
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
