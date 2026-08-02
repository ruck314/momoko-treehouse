/* input.js – keyboard + touch controls
   Ported from momoko-in-space with three changes:
     1. Keyboard and touch state are tracked separately and OR'd together.
        The donor zeroed the keyboard every frame whenever the device
        reported any touch capability, which kills the keyboard on
        touchscreen laptops. This game targets touch and desktop equally.
     2. setRawTouchListener() exposes per-pointer events in game space so
        the piano can do real polyphony (the D-pad abstraction can't).
     3. setKeyCapture() lets the piano take over the keyboard wholesale. */
(function () {
  'use strict';
  window.Game = window.Game || {};

  /* Merged view read by gameplay code. */
  var keys = { left: false, right: false, up: false, down: false, action: false, pause: false };
  /* Keyboard-only state, held across frames. */
  var kb = { left: false, right: false, up: false, down: false, action: false, pause: false };
  var justPressed = { action: false, pause: false };
  var prevKeys = { action: false, pause: false };

  /* Touch state – each touch: { x, y, button } where button is a sticky binding
     so a finger that lands on a direction button keeps that button pressed
     even if the finger slides off it (matches keyboard hold feel). */
  var touches = {};
  var touchButtons = {
    up: { x: 0, y: 0, r: 0, active: false },
    down: { x: 0, y: 0, r: 0, active: false },
    left: { x: 0, y: 0, r: 0, active: false },
    right: { x: 0, y: 0, r: 0, active: false },
    action: { x: 0, y: 0, r: 0, active: false },
    pause: { x: 0, y: 0, r: 0, active: false },
  };
  var BUTTON_NAMES = ['up', 'down', 'left', 'right', 'action', 'pause'];
  var isTouchDevice = false;
  var canvas = null;
  var canvasRect = null;
  var GAME_W = 800;   /* logical game viewport width */
  var GAME_H = 480;   /* logical game viewport height */

  /* When set, every pointer down/move/up is forwarded here in game-space
     coordinates and the D-pad is bypassed entirely. Used by the piano. */
  var rawTouchListener = null;
  /* When set, keydown/keyup are forwarded here instead of driving movement.
     Escape still falls through so there is always a way out. */
  var keyCapture = null;
  var heldCodes = {};

  /* Helpers: the canvas's backing store is scaled by devicePixelRatio for
     crisp rendering, so canvas.width / canvas.height are *not* logical
     pixels. These helpers return the logical (pre-DPR) dimensions that
     all game/input math reasons about. */
  function dprFactor() {
    return Math.min(3, window.devicePixelRatio || 1);
  }
  function canvasLogicalW() {
    if (!canvas) return 0;
    return canvas.width / dprFactor();
  }
  function canvasLogicalH() {
    if (!canvas) return 0;
    return canvas.height / dprFactor();
  }
  /* On touch devices the canvas is wider (and sometimes taller) than the
     game viewport – control strips live on the sides, optional bezels
     above/below for tablets. Engine.js publishes Game.TOUCH_LEFT_W /
     Game.TOUCH_RIGHT_W / Game.GAME_Y; fall back to centred padding if
     it hasn't initialised yet. */
  function hasAsymmetricStrips() {
    return canvas &&
           typeof Game.TOUCH_LEFT_W === 'number' &&
           typeof Game.TOUCH_RIGHT_W === 'number' &&
           canvasLogicalW() > GAME_W;
  }
  function leftStripW() {
    if (hasAsymmetricStrips()) return Game.TOUCH_LEFT_W;
    return Math.max(0, Math.floor((canvasLogicalW() - GAME_W) / 2));
  }
  function rightStripW() {
    if (hasAsymmetricStrips()) return Game.TOUCH_RIGHT_W;
    return Math.max(0, Math.floor((canvasLogicalW() - GAME_W) / 2));
  }
  function topStripH() {
    if (canvas && typeof Game.GAME_Y === 'number') return Game.GAME_Y;
    return Math.max(0, Math.floor((canvasLogicalH() - GAME_H) / 2));
  }
  function gameOffsetX() { return leftStripW(); }
  function gameOffsetY() { return topStripH(); }

  /* ---- Keyboard ---- */
  function onKeyDown(e) {
    if (keyCapture) {
      if (e.code === 'Escape') { kb.pause = true; return; }
      if (heldCodes[e.code]) { e.preventDefault(); return; }  /* swallow auto-repeat */
      heldCodes[e.code] = true;
      if (keyCapture(true, e.code)) e.preventDefault();
      return;
    }
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': kb.left = true; break;
      case 'ArrowRight': case 'KeyD': kb.right = true; break;
      case 'ArrowUp': case 'KeyW': kb.up = true; break;
      case 'ArrowDown': case 'KeyS': kb.down = true; break;
      case 'Space': case 'KeyZ': kb.action = true; e.preventDefault(); break;
      case 'Escape': case 'KeyP': kb.pause = true; break;
    }
  }

  function onKeyUp(e) {
    if (keyCapture) {
      if (e.code === 'Escape') { kb.pause = false; return; }
      heldCodes[e.code] = false;
      keyCapture(false, e.code);
      return;
    }
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': kb.left = false; break;
      case 'ArrowRight': case 'KeyD': kb.right = false; break;
      case 'ArrowUp': case 'KeyW': kb.up = false; break;
      case 'ArrowDown': case 'KeyS': kb.down = false; break;
      case 'Space': case 'KeyZ': kb.action = false; break;
      case 'Escape': case 'KeyP': kb.pause = false; break;
    }
  }

  /* Releasing focus with keys held would otherwise latch them on. */
  function releaseAll() {
    kb.left = kb.right = kb.up = kb.down = kb.action = kb.pause = false;
    heldCodes = {};
    if (keyCapture) keyCapture(false, null);   /* null code = all-notes-off */
  }

  /* ---- Pointer coord mapping ---- */
  function clientToCanvas(cx, cy) {
    if (!canvasRect) canvasRect = canvas.getBoundingClientRect();
    return {
      x: (cx - canvasRect.left) / (canvasRect.width / canvasLogicalW()),
      y: (cy - canvasRect.top) / (canvasRect.height / canvasLogicalH())
    };
  }

  function toGameSpace(pos) {
    return { x: pos.x - gameOffsetX(), y: pos.y - gameOffsetY() };
  }

  function buttonAt(pos) {
    for (var i = 0; i < BUTTON_NAMES.length; i++) {
      if (hitTest(pos, touchButtons[BUTTON_NAMES[i]])) return BUTTON_NAMES[i];
    }
    return null;
  }

  function hitTest(pos, btn) {
    var dx = pos.x - btn.x;
    var dy = pos.y - btn.y;
    return (dx * dx + dy * dy) <= (btn.r * btn.r);
  }

  function processTouches() {
    for (var i = 0; i < BUTTON_NAMES.length; i++) touchButtons[BUTTON_NAMES[i]].active = false;

    var ids = Object.keys(touches);
    for (var i2 = 0; i2 < ids.length; i2++) {
      var tr = touches[ids[i2]];
      if (tr.button) touchButtons[tr.button].active = true;
    }

    /* Merge keyboard and touch rather than letting either clobber the other. */
    keys.up = kb.up || touchButtons.up.active;
    keys.down = kb.down || touchButtons.down.active;
    keys.left = kb.left || touchButtons.left.active;
    keys.right = kb.right || touchButtons.right.active;
    keys.action = kb.action || touchButtons.action.active;
    keys.pause = kb.pause || touchButtons.pause.active;
  }

  function onTouchStart(e) {
    e.preventDefault();
    isTouchDevice = true;
    canvasRect = canvas.getBoundingClientRect();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      var pos = clientToCanvas(t.clientX, t.clientY);
      if (rawTouchListener) {
        var g = toGameSpace(pos);
        rawTouchListener('start', t.identifier, g.x, g.y);
        continue;
      }
      touches[t.identifier] = { x: pos.x, y: pos.y, button: buttonAt(pos) };
    }
  }

  function onTouchMove(e) {
    e.preventDefault();
    canvasRect = canvas.getBoundingClientRect();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      var pos = clientToCanvas(t.clientX, t.clientY);
      if (rawTouchListener) {
        var g = toGameSpace(pos);
        rawTouchListener('move', t.identifier, g.x, g.y);
        continue;
      }
      var tr = touches[t.identifier];
      if (!tr) continue;
      tr.x = pos.x; tr.y = pos.y;
      /* Sticky: only re-bind if finger slides ONTO a different button.
         Sliding off into empty space keeps the existing button pressed. */
      var over = buttonAt(pos);
      if (over) tr.button = over;
    }
  }

  function onTouchEnd(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (rawTouchListener) {
        var pos = clientToCanvas(t.clientX, t.clientY);
        var g = toGameSpace(pos);
        rawTouchListener('end', t.identifier, g.x, g.y);
        continue;
      }
      delete touches[t.identifier];
    }
  }

  /* Mouse is routed into the same raw-pointer path under a reserved id so
     the piano is fully playable with a mouse on desktop. */
  var MOUSE_ID = 'mouse';
  var mouseDown = false;

  function onMouseDown(e) {
    if (!rawTouchListener) return;
    mouseDown = true;
    canvasRect = canvas.getBoundingClientRect();
    var g = toGameSpace(clientToCanvas(e.clientX, e.clientY));
    rawTouchListener('start', MOUSE_ID, g.x, g.y);
  }
  function onMouseMove(e) {
    if (!rawTouchListener || !mouseDown) return;
    var g = toGameSpace(clientToCanvas(e.clientX, e.clientY));
    rawTouchListener('move', MOUSE_ID, g.x, g.y);
  }
  function onMouseUp(e) {
    if (!rawTouchListener || !mouseDown) return;
    mouseDown = false;
    var g = toGameSpace(clientToCanvas(e.clientX, e.clientY));
    rawTouchListener('end', MOUSE_ID, g.x, g.y);
  }

  /* Layout touch buttons in canvas coordinates. On touch devices the
     canvas is wider than the game viewport (side strips on each side);
     the D-pad lives in the left strip and the action button in the right
     strip, so thumbs never cover gameplay. */
  function layoutButtons() {
    if (!canvas) return;
    var lStrip = leftStripW();
    var rStrip = rightStripW();
    var hasSideStrips = lStrip > 0;
    if (hasSideStrips) {
      var leftCx = lStrip / 2;
      var rightCx = canvasLogicalW() - rStrip / 2;
      var cy = canvasLogicalH() / 2;
      var pad = Math.floor(Math.min(54, Math.floor(lStrip / 4.5)) * 0.85);
      var spacing = Math.floor(Math.min(66, Math.floor(lStrip / 3.8)) * 0.85);
      touchButtons.up =    { x: leftCx, y: cy - spacing, r: pad, active: false };
      touchButtons.down =  { x: leftCx, y: cy + spacing, r: pad, active: false };
      touchButtons.left =  { x: leftCx - spacing, y: cy, r: pad, active: false };
      touchButtons.right = { x: leftCx + spacing, y: cy, r: pad, active: false };
      touchButtons.action = { x: rightCx, y: cy, r: 80, active: false };
      touchButtons.pause  = { x: rightCx, y: 30, r: 22, active: false };
    } else {
      /* Desktop fallback – buttons aren't drawn, but keep hit-tests defined. */
      var pad2 = 38, bx2 = 100, by2 = 370, sp2 = pad2 * 2;
      touchButtons.up =    { x: bx2, y: by2 - sp2, r: pad2, active: false };
      touchButtons.down =  { x: bx2, y: by2 + sp2, r: pad2, active: false };
      touchButtons.left =  { x: bx2 - sp2, y: by2, r: pad2, active: false };
      touchButtons.right = { x: bx2 + sp2, y: by2, r: pad2, active: false };
      touchButtons.action = { x: 700, y: 380, r: 50, active: false };
      touchButtons.pause  = { x: 770, y: 30, r: 25, active: false };
    }
  }

  function init(cvs) {
    canvas = cvs;
    canvasRect = canvas.getBoundingClientRect();
    layoutButtons();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  }

  /* Call once per frame before reading keys */
  function update() {
    justPressed.action = keys.action && !prevKeys.action;
    justPressed.pause = keys.pause && !prevKeys.pause;
    prevKeys.action = keys.action;
    prevKeys.pause = keys.pause;
  }

  function refreshLayout() {
    if (canvas) canvasRect = canvas.getBoundingClientRect();
  }

  /* Paint the bezel surrounding the game viewport plus (optionally) the
     touch buttons. Called every frame on touch devices so the bezel
     background is always present under the buttons. */
  function drawTouchStrip(c, showButtons) {
    if (!canvas) return;
    var cw = canvasLogicalW();
    var ch = canvasLogicalH();
    var gx = gameOffsetX();
    var gy = gameOffsetY();
    var rEdge = gx + GAME_W;
    var bEdge = gy + GAME_H;

    c.save();
    c.fillStyle = '#241708';
    c.fillRect(0, 0, cw, ch);

    if (gx > 0) paintEdgeGlow(c, gx - 10, 0, 10, ch, 'h', false);
    if (rEdge < cw) paintEdgeGlow(c, rEdge, 0, 10, ch, 'h', true);
    if (gy > 0) paintEdgeGlow(c, 0, gy - 10, cw, 10, 'v', false);
    if (bEdge < ch) paintEdgeGlow(c, 0, bEdge, cw, 10, 'v', true);

    if (gx > 0 || gy > 0 || rEdge < cw || bEdge < ch) {
      c.strokeStyle = '#5a3c1e';
      c.lineWidth = 2;
      if (gx > 0) { c.beginPath(); c.moveTo(gx + 0.5, 0); c.lineTo(gx + 0.5, ch); c.stroke(); }
      if (rEdge < cw) { c.beginPath(); c.moveTo(rEdge - 0.5, 0); c.lineTo(rEdge - 0.5, ch); c.stroke(); }
      if (gy > 0) { c.beginPath(); c.moveTo(0, gy + 0.5); c.lineTo(cw, gy + 0.5); c.stroke(); }
      if (bEdge < ch) { c.beginPath(); c.moveTo(0, bEdge - 0.5); c.lineTo(cw, bEdge - 0.5); c.stroke(); }
    }
    c.restore();

    if (showButtons) drawTouchButtons(c);
  }

  /* `dir` is 'h' for a vertical bezel band (gradient runs horizontally)
     or 'v' for a horizontal bezel band (gradient runs vertically). When
     `inward` is true the glow brightens toward the game-viewport side. */
  function paintEdgeGlow(c, x, y, w, h, dir, inward) {
    var grad = (dir === 'h')
      ? c.createLinearGradient(x, 0, x + w, 0)
      : c.createLinearGradient(0, y, 0, y + h);
    if (inward) {
      grad.addColorStop(0, 'rgba(160,210,120,0.22)');
      grad.addColorStop(1, 'rgba(36,23,8,0)');
    } else {
      grad.addColorStop(0, 'rgba(36,23,8,0)');
      grad.addColorStop(1, 'rgba(160,210,120,0.22)');
    }
    c.fillStyle = grad;
    c.fillRect(x, y, w, h);
  }

  function drawTouchButtons(c) {
    if (!isTouchDevice) return;
    c.save();
    c.globalAlpha = 0.9;

    var btns = ['up', 'down', 'left', 'right'];
    var arrows = ['▲', '▼', '◀', '▶'];
    for (var i = 0; i < btns.length; i++) {
      var b = touchButtons[btns[i]];
      c.fillStyle = b.active ? '#a8dd7a' : '#4a6b34';
      c.beginPath();
      c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#7bc45a';
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = '#fff4dc';
      c.font = 'bold 34px monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(arrows[i], b.x, b.y);
    }

    var centerX = (touchButtons.left.x + touchButtons.right.x) / 2;
    var centerY = (touchButtons.up.y + touchButtons.down.y) / 2;
    c.fillStyle = '#3b2a16';
    c.beginPath();
    c.arc(centerX, centerY, 22, 0, Math.PI * 2);
    c.fill();

    var ab = touchButtons.action;
    c.fillStyle = ab.active ? '#ffc36e' : '#d1892f';
    c.beginPath();
    c.arc(ab.x, ab.y, ab.r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#ffd24a';
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = '#3b2a16';
    c.font = 'bold 22px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var actionLabel = (window.Game && Game.i18n) ? Game.i18n.t('actionBtn') : 'DO';
    c.fillText(actionLabel, ab.x, ab.y);

    var pb = touchButtons.pause;
    c.fillStyle = pb.active ? '#c9b48e' : '#7a6448';
    c.beginPath();
    c.arc(pb.x, pb.y, pb.r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#c9b48e';
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = '#fff4dc';
    c.font = 'bold 20px monospace';
    c.fillText('II', pb.x, pb.y);

    c.restore();
  }

  /* Click handling for menus. Returns game-space coordinates (0..GAME_W,
     0..GAME_H) so menu hit-tests keep working regardless of whether the
     canvas is padded with side strips. */
  function getClickPos(e) {
    var rect = canvas.getBoundingClientRect();
    var cx, cy;
    if (e.changedTouches && e.changedTouches.length > 0) {
      cx = e.changedTouches[0].clientX;
      cy = e.changedTouches[0].clientY;
    } else {
      cx = e.clientX;
      cy = e.clientY;
    }
    var canvasX = (cx - rect.left) / (rect.width / canvasLogicalW());
    var canvasY = (cy - rect.top) / (rect.height / canvasLogicalH());
    return { x: canvasX - gameOffsetX(), y: canvasY - gameOffsetY() };
  }

  window.Game.input = {
    init: init,
    update: function () {
      processTouches();
      update();
    },
    refreshLayout: function () { refreshLayout(); layoutButtons(); },
    keys: keys,
    justPressed: justPressed,
    drawTouchStrip: drawTouchStrip,
    drawTouchButtons: drawTouchButtons,
    getClickPos: getClickPos,
    isTouch: function () { return isTouchDevice; },
    /* Piano hooks. Pass null to restore normal D-pad / movement handling. */
    setRawTouchListener: function (fn) {
      rawTouchListener = fn || null;
      if (rawTouchListener) touches = {};   /* drop any sticky D-pad bindings */
    },
    setKeyCapture: function (fn) {
      keyCapture = fn || null;
      heldCodes = {};
      if (keyCapture) { kb.left = kb.right = kb.up = kb.down = kb.action = false; }
    },
    releaseAll: releaseAll,
  };
})();
