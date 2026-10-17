/* engine.js – game loop, state machine, camera, delivery and persistence. */
(function () {
  'use strict';
  window.Game = window.Game || {};
  var PAL = Game.PAL;
  var E = Game.entities;

  /* Logical playfield. On touch devices the canvas is widened past this
     and the control strips live in the margins; render() translates once
     so all game code keeps using 0..800 / 0..480. */
  var W = 800, H = 480;
  var CANVAS_W = W, CANVAS_H = H;
  var GAME_X = 0, GAME_Y = 0;

  /* Bump alongside CACHE_NAME in sw.js and tag the matching git release. */
  Game.VERSION = 'v1.7.0';

  var canvas, ctx;

  /* ---- Persistence ----
     Every game on ruck314.github.io shares one localStorage origin, and
     the hotel game already collides with the space game by reusing its
     keys. Everything here goes through KEY() so that can't happen again. */
  var NS = 'momoko-treehouse-';
  function KEY(n) { return NS + n; }

  var State = {
    TITLE: 'title',
    CUSTOMIZE: 'customize',
    INTRO: 'intro',
    PLAYING: 'playing',
    PAUSED: 'paused',
    SHOP_INTERIOR: 'shopInterior',
    BUILD_CUTSCENE: 'buildCutscene',
    EXTERIOR: 'exteriorCustomize',
    HOUSE_INTERIOR: 'houseInterior',
    PIANO: 'piano',
    VICTORY: 'victory',
  };
  var state = State.TITLE;
  var prevState = null;
  /* Where CUSTOMIZE should return to, and whether it's the opening one. */
  var customizeReturn = State.TITLE;

  var camera = { x: 0 };
  /* Frames left to ease back from the cutscene framing to following Momoko. */
  var camEase = 0;
  function treeCamX() {
    return Math.max(0, Math.min(Game.MEADOW.width - W, Game.MEADOW.tree.x - W / 2));
  }
  var player = null;
  var friends = {};           /* id -> Friend entity (meadow wanderers) */
  var particles = [];
  var t = 0;
  var ambientTimer = 600;

  /* ---- Mutable game state (all persisted) ---- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function freshState() {
    Game.customization = clone(Game.MOMOKO_DEFAULT);
    Game.friends = {};
    for (var i = 0; i < Game.FRIEND_DEFS.length; i++) {
      var d = Game.FRIEND_DEFS[i];
      Game.friends[d.id] = { unlocked: false, cust: clone(d.defaultCust) };
    }
    Game.build = { stageIndex: 0, stock: {} };
    Game.bag = { items: [], MAX: 5 };
    Game.exterior = clone(Game.EXT_DEFAULT);
    Game.rooms = { main: [], bed: [], kitchen: [], music: [] };
    Game.furnitureStock = {};
    Game.flags = { introSeen: false, canEnter: false, canDecorate: false,
                   pianoOwned: false, pianoPlaced: false, partySeen: false, songsDone: [] };
    Game.settings = { lang: 'en', muted: false };
    Game.currentRoom = 'main';
    Game.designTarget = 'momoko';
  }

  function save() {
    try {
      localStorage.setItem(KEY('customization'), JSON.stringify(Game.customization));
      localStorage.setItem(KEY('friends'), JSON.stringify(Game.friends));
      localStorage.setItem(KEY('build'), JSON.stringify({
        stageIndex: Game.build.stageIndex,
        stock: Game.build.stock,
        bag: Game.bag.items,
      }));
      localStorage.setItem(KEY('exterior'), JSON.stringify(Game.exterior));
      localStorage.setItem(KEY('rooms'), JSON.stringify(Game.rooms));
      localStorage.setItem(KEY('stock'), JSON.stringify(Game.furnitureStock));
      localStorage.setItem(KEY('flags'), JSON.stringify(Game.flags));
      localStorage.setItem(KEY('settings'), JSON.stringify(Game.settings));
    } catch (e) { /* storage may be disabled */ }
  }

  function readJSON(name) {
    try {
      var raw = localStorage.getItem(KEY(name));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* Merge saved values over defaults so a save written by an older build
     never leaves a field undefined. */
  function mergeInto(target, src) {
    if (!src) return target;
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      target[k] = src[k];
    }
    return target;
  }

  function load() {
    freshState();

    mergeInto(Game.customization, readJSON('customization'));

    var f = readJSON('friends');
    if (f) {
      for (var id in Game.friends) {
        if (!f[id]) continue;
        Game.friends[id].unlocked = !!f[id].unlocked;
        mergeInto(Game.friends[id].cust, f[id].cust);
      }
    }

    var b = readJSON('build');
    if (b) {
      Game.build.stageIndex = Math.max(0, Math.min(Game.BUILD_STAGES.length, b.stageIndex || 0));
      Game.build.stock = b.stock || {};
      Game.bag.items = Array.isArray(b.bag) ? b.bag.slice(0, Game.bag.MAX) : [];
      /* Saves from v1.1.0 and earlier stored the piano as five separate
         entries. Collapse them into the single whole-bag item. */
      var pianoCount = 0, rest = [];
      for (var bi = 0; bi < Game.bag.items.length; bi++) {
        if (Game.bag.items[bi] && Game.bag.items[bi].kind === 'piano') pianoCount++;
        else rest.push(Game.bag.items[bi]);
      }
      if (pianoCount > 0) {
        Game.bag.items = [{ kind: 'piano', type: 'piano', slots: Game.bag.MAX }];
      } else {
        Game.bag.items = rest;
      }
    }

    var ext = readJSON('exterior');
    if (ext) {
      mergeInto(Game.exterior, ext);
      Game.exterior.decor = mergeInto(clone(Game.EXT_DEFAULT.decor), ext.decor);
    }

    var r = readJSON('rooms');
    if (r) {
      for (var rid in Game.rooms) {
        if (Array.isArray(r[rid])) Game.rooms[rid] = r[rid];
      }
    }

    var st = readJSON('stock');
    if (st) Game.furnitureStock = st;

    mergeInto(Game.flags, readJSON('flags'));
    if (!Array.isArray(Game.flags.songsDone)) Game.flags.songsDone = [];

    applyStarterFurniture();

    mergeInto(Game.settings, readJSON('settings'));
    Game.i18n.setLang(Game.settings.lang || 'en');
    if (Game.settings.muted) Game.audio.setMuted(true);
  }

  /* Give each room the furniture it should never be without -- a bed in the
     bedroom, a table and fridge in the kitchen, a disco ball in the music
     room. Runs once per save, and only for rooms that are still empty, so
     it can't overwrite anything the player has arranged. Existing saves get
     it on their next load. */
  function applyStarterFurniture() {
    if (Game.flags.starterFurniture) return;
    var starters = Game.STARTER_FURNITURE || {};
    for (var roomId in starters) {
      if (!Object.prototype.hasOwnProperty.call(starters, roomId)) continue;
      if (!Game.rooms[roomId] || Game.rooms[roomId].length > 0) continue;
      for (var i = 0; i < starters[roomId].length; i++) {
        Game.rooms[roomId].push(clone(starters[roomId][i]));
      }
    }
    Game.flags.starterFurniture = true;
  }

  function resetSave() {
    try {
      var names = ['customization', 'friends', 'build', 'exterior', 'rooms', 'stock', 'flags'];
      for (var i = 0; i < names.length; i++) localStorage.removeItem(KEY(names[i]));
    } catch (e) { /* storage may be disabled */ }
    var lang = Game.settings.lang;
    var muted = Game.settings.muted;
    freshState();
    Game.settings.lang = lang;
    Game.settings.muted = muted;
    Game.i18n.setLang(lang);
    rebuildFriendEntities();
    save();
  }

  /* ---- Canvas layout ---- */
  function computeCanvasLayout() {
    var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (!isTouch) {
      CANVAS_W = W; CANVAS_H = H; GAME_X = 0; GAME_Y = 0;
      Game.TOUCH_LEFT_W = 0; Game.TOUCH_RIGHT_W = 0; Game.GAME_Y = 0;
      return;
    }
    var leftW = 260, rightW = 200;
    var aspect = window.innerWidth / Math.max(1, window.innerHeight);
    var targetAspect = (W + leftW + rightW) / H;
    if (aspect > targetAspect) {
      /* Ultra-wide: widen the strips rather than letterboxing. */
      var extra = Math.floor((aspect * H - (W + leftW + rightW)) / 2);
      leftW += extra; rightW += extra;
      CANVAS_H = H; GAME_Y = 0;
    } else {
      /* Taller than needed (iPad): add top/bottom bezel. The cap only
         guards against absurd aspects; a 760 cap left letterbox bars
         above and below the canvas on every iPad. */
      CANVAS_H = Math.min(H * 2, Math.round((W + leftW + rightW) / Math.max(0.5, aspect)));
      GAME_Y = Math.floor((CANVAS_H - H) / 2);
    }
    CANVAS_W = W + leftW + rightW;
    GAME_X = leftW;
    Game.TOUCH_LEFT_W = leftW;
    Game.TOUCH_RIGHT_W = rightW;
    Game.GAME_Y = GAME_Y;
  }

  function resizeBackingStore() {
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    var scale = Math.min(window.innerWidth / CANVAS_W, window.innerHeight / CANVAS_H);
    canvas.style.width = Math.floor(CANVAS_W * scale) + 'px';
    canvas.style.height = Math.floor(CANVAS_H * scale) + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  function onResize() {
    computeCanvasLayout();
    resizeBackingStore();
    Game.input.refreshLayout();
  }

  /* ---- Friend entities ---- */
  function rebuildFriendEntities() {
    friends = {};
    for (var i = 0; i < Game.FRIEND_DEFS.length; i++) {
      var d = Game.FRIEND_DEFS[i];
      if (Game.friends[d.id] && Game.friends[d.id].unlocked) {
        friends[d.id] = new E.Friend(d);
      }
    }
  }

  /* ---- Interaction points in the meadow ---- */
  function interactables() {
    var M = Game.MEADOW;
    var a = Game.tree.anchors(M.tree.x, M.tree.groundY);
    var list = [
      /* Above the roof: lower down it covers the shop's own sign. */
      { id: 'shop', x: M.shop.x + 58, r: 70, labelKey: 'promptShop', promptY: M.groundY - 254 },
      { id: 'build', x: M.tree.x + 10, r: 78, labelKey: 'promptBuild', promptY: M.groundY - 120 },
    ];
    if (Game.flags.canEnter) {
      list.push({ id: 'enter', x: a.ladderX + 15, r: 52, labelKey: 'promptEnter', promptY: M.groundY - 190 });
    }
    if (Game.flags.canDecorate) {
      list.push({ id: 'paint', x: M.paintPost.x, r: 52, labelKey: 'promptPaint', promptY: M.groundY - 110 });
    }
    for (var id in friends) {
      list.push({ id: 'friend:' + id, x: friends[id].x, r: 56, labelKey: 'promptTalk', promptY: M.groundY - 130 });
    }
    return list;
  }

  function nearest() {
    var list = interactables();
    var best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = Math.abs(player.x - list[i].x);
      if (d <= list[i].r && d < bestD) { best = list[i]; bestD = d; }
    }
    return best;
  }

  /* ---- Delivery ---- */
  /* `silent` is used when delivery is a side effect of something else (going
     up the ladder), where an empty bag is normal and shouldn't be scolded. */
  function deliverBag(silent) {
    if (Game.bag.items.length === 0) {
      if (!silent) {
        Game.ui.showToast(Game.i18n.t('nothingToDeliver'));
        Game.audio.play('deny');
      }
      return false;
    }

    var materials = 0, furniture = 0, piano = false;
    for (var i = 0; i < Game.bag.items.length; i++) {
      var it = Game.bag.items[i];
      if (it.kind === 'material') {
        Game.build.stock[it.type] = (Game.build.stock[it.type] || 0) + 1;
        materials++;
      } else if (it.kind === 'furniture') {
        Game.ui.addStock(it.type, 1);
        furniture++;
      } else if (it.kind === 'piano') {
        piano = true;
      }
    }
    if (piano) {
      Game.ui.addStock('piano', 1);
      Game.flags.pianoOwned = true;
    }
    Game.bag.items = [];

    E.spawnBurst(particles, player.x, player.y - 40, 12, [PAL.sun, PAL.cream, PAL.leafLight], 3);
    Game.audio.play('drop');

    var advanced = tryAdvanceStage();
    if (!advanced) {
      Game.ui.showToast(Game.i18n.t(
        (furniture > 0 || piano) ? 'deliveredFurniture' : 'deliveredSome'));
    }
    save();
    return true;
  }

  /* Completes one stage if the pile now covers it. Only ever one at a
     time – a delivery big enough to finish two stages shows the second
     cutscene when the first one ends. */
  function tryAdvanceStage() {
    var stage = Game.ui.currentStage();
    if (!stage || !Game.ui.stageSatisfied(stage)) return false;

    var keys = Object.keys(stage.needs);
    for (var i = 0; i < keys.length; i++) {
      Game.build.stock[keys[i]] -= stage.needs[keys[i]];
      if (Game.build.stock[keys[i]] <= 0) delete Game.build.stock[keys[i]];
    }
    Game.build.stageIndex++;
    for (var g = 0; g < stage.grants.length; g++) Game.flags[stage.grants[g]] = true;
    if (stage.unlocks && Game.friends[stage.unlocks]) {
      Game.friends[stage.unlocks].unlocked = true;
      rebuildFriendEntities();
    }
    Game.ui.startBuildCutscene(stage.id);
    state = State.BUILD_CUTSCENE;
    return true;
  }

  function checkVictory() {
    if (Game.flags.partySeen) return false;
    if (Game.build.stageIndex < Game.BUILD_STAGES.length) return false;
    if (!Game.flags.pianoPlaced) return false;
    for (var i = 0; i < Game.ROOMS.length; i++) {
      if ((Game.rooms[Game.ROOMS[i].id] || []).length < 3) return false;
    }
    return true;
  }

  /* ---- State transitions ---- */
  function startGame() {
    Game.audio.init();
    Game.audio.resume();
    if (!Game.flags.introSeen) {
      customizeReturn = State.INTRO;
      Game.designTarget = 'momoko';
      state = State.CUSTOMIZE;
    } else {
      enterPlaying();
    }
  }

  function enterPlaying() {
    state = State.PLAYING;
    Game.audio.startMusic('meadow');
  }

  function enterShop() {
    Game.ui.startShopInterior();
    state = State.SHOP_INTERIOR;
    Game.audio.play('select');
  }

  function enterHouse() {
    state = State.HOUSE_INTERIOR;
    Game.audio.startMusic('inside');
  }

  function enterPiano() {
    Game.piano.enter();
    state = State.PIANO;
  }

  function exitPiano() {
    Game.piano.exit();
    state = State.HOUSE_INTERIOR;
    Game.audio.startMusic('inside');
  }

  /* ---- Update ---- */
  function update() {
    t++;
    Game.input.update();
    var keys = Game.input.keys;
    var jp = Game.input.justPressed;

    switch (state) {
      case State.TITLE:
      case State.INTRO:
      case State.CUSTOMIZE:
      case State.EXTERIOR:
      case State.VICTORY:
        break;

      case State.PLAYING:
        updatePlaying(keys, jp);
        break;

      case State.PAUSED:
        if (jp.pause) { state = prevState || State.PLAYING; }
        break;

      case State.SHOP_INTERIOR:
        if (Game.ui.updateShopInterior(keys, jp) === 'exit') { state = State.PLAYING; save(); }
        break;

      case State.BUILD_CUTSCENE:
        /* Glide over to frame the whole tree while the new part goes on. */
        camera.x += (treeCamX() - camera.x) * 0.12;
        if (Game.ui.updateBuildCutscene() === 'done') {
          camEase = 40;
          /* Chain straight into the next stage if the pile already covers it. */
          state = State.PLAYING;
          if (!tryAdvanceStage() && checkVictory()) {
            Game.flags.partySeen = true;
            Game.audio.play('victory');
            state = State.VICTORY;
          }
          save();
        }
        break;

      case State.HOUSE_INTERIOR:
        var act = Game.ui.updateHouseInterior(keys, jp);
        if (act) applyInteriorAction(act);
        else updateAmbientPianist();
        break;

      case State.PIANO:
        if (Game.piano.update(keys, jp) === 'exit') exitPiano();
        break;
    }

    for (var i = particles.length - 1; i >= 0; i--) {
      particles[i].update();
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
  }

  function updatePlaying(keys, jp) {
    if (jp.pause) { prevState = state; state = State.PAUSED; return; }

    player.update(keys, 60, Game.MEADOW.width - 60);
    for (var id in friends) friends[id].update();

    var camTarget = Math.max(0, Math.min(Game.MEADOW.width - W, player.x - W / 2));
    if (camEase > 0) { camEase--; camera.x += (camTarget - camera.x) * 0.15; }
    else camera.x = camTarget;

    if (jp.action) {
      var target = nearest();
      if (!target) return;
      if (target.id === 'shop') { enterShop(); return; }
      if (target.id === 'build') { deliverBag(false); return; }
      if (target.id === 'enter') {
        /* The ladder sits in front of the build spot, so this is the hotspot
           the player actually reaches while carrying a full bag. Unload it
           here too, otherwise the shopping never makes it into the house. */
        deliverBag(true);
        /* A delivery that completes a stage opens its cutscene; let that
           play instead of yanking her indoors. */
        if (state === State.PLAYING) enterHouse();
        return;
      }
      if (target.id === 'paint') { state = State.EXTERIOR; Game.audio.play('select'); return; }
      if (target.id.indexOf('friend:') === 0) {
        var fid = target.id.slice(7);
        Game.ui.showToast(Game.i18n.t(friendDef(fid).greetKey) + '\n(' + Game.i18n.t('friendDesignPrompt') + ')', 150);
        Game.designTarget = fid;
        customizeReturn = State.PLAYING;
        state = State.CUSTOMIZE;
        return;
      }
    }
  }

  /* Shared by the interior's keyboard/D-pad path and its tap path so the
     two can't drift. */
  function applyInteriorAction(act) {
    if (act === 'exit') {
      Game.audio.play('select');
      state = State.PLAYING;
      Game.audio.startMusic('meadow');
      save();
      if (checkVictory()) {
        Game.flags.partySeen = true;
        Game.audio.play('victory');
        state = State.VICTORY;
        save();
      }
      return;
    }
    if (act === 'piano') { enterPiano(); return; }
    if (act.indexOf('design:') === 0) {
      Game.designTarget = act.slice(7);
      customizeReturn = State.HOUSE_INTERIOR;
      Game.audio.play('select');
      state = State.CUSTOMIZE;
      return;
    }
    if (act === 'select') Game.audio.play('select');
  }

  function friendDef(id) {
    for (var i = 0; i < Game.FRIEND_DEFS.length; i++) {
      if (Game.FRIEND_DEFS[i].id === id) return Game.FRIEND_DEFS[i];
    }
    return Game.FRIEND_DEFS[0];
  }

  /* The friend who lives in the music room noodles on a placed piano. */
  function updateAmbientPianist() {
    if (Game.currentRoom !== 'music') { ambientTimer = 600; return; }
    var resident = Game.ui.residentOf('music');
    if (!resident) return;
    var hasPiano = false;
    var items = Game.rooms.music || [];
    for (var i = 0; i < items.length; i++) if (items[i].type === 'piano') hasPiano = true;
    if (!hasPiano) return;
    ambientTimer--;
    if (ambientTimer <= 0) {
      ambientTimer = 720;
      Game.piano.playAmbientPhrase();
    }
  }

  /* ---- Render ---- */
  /* Runs fn with drawing clipped to the game viewport. The overlay
     states (pause, game over) widen the view to the whole canvas on
     tablets so their scrim covers the bezel too; the frozen scene under
     the menu still has to stay inside the 800x480 window. */
  function drawClipped(fn) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    fn();
    ctx.restore();
  }

  function render() {
    ctx.save();
    ctx.setTransform(Math.min(3, window.devicePixelRatio || 1), 0, 0,
                     Math.min(3, window.devicePixelRatio || 1), 0, 0);
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    /* Menu screens have no touch controls, so on a tablet they paint
       their own meadow across the whole canvas instead of sitting in a
       dark frame. Gameplay keeps the bezel so the D-pad has a quiet
       backdrop. */
    var bezel = GAME_X > 0 || GAME_Y > 0;
    var fullBleed = bezel && (
      state === State.TITLE || state === State.CUSTOMIZE ||
      state === State.INTRO || state === State.VICTORY);
    /* Pause and game-over dim the whole screen, bezel included, so the
       menu floats over the frozen game instead of a bright island. */
    var dimAll = bezel && (
      state === State.PAUSED);
    if (bezel && !fullBleed) {
      Game.input.drawTouchStrip(ctx, showTouchButtons());
    }

    ctx.translate(GAME_X, GAME_Y);
    if (fullBleed || dimAll) {
      Game.ui.setView(-GAME_X, -GAME_Y, CANVAS_W, CANVAS_H);
    } else {
      Game.ui.setView(0, 0, W, H);
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
    }
    Game.ui.beginFrame();
    if (state !== renderedState) {
      Game.ui.dropStaleToast();
      renderedState = state;
    }

    switch (state) {
      case State.TITLE: Game.ui.drawTitleScreen(ctx); break;
      case State.CUSTOMIZE: Game.ui.drawCustomizeScreen(ctx); Game.ui.drawToast(ctx); break;
      case State.INTRO: Game.ui.drawIntroScreen(ctx); break;
      case State.PLAYING: drawWorld(ctx); break;
      case State.PAUSED: drawClipped(function () { drawWorld(ctx); }); Game.ui.drawPauseMenu(ctx); break;
      case State.SHOP_INTERIOR: Game.ui.drawShopInterior(ctx); Game.ui.drawToast(ctx); break;
      case State.BUILD_CUTSCENE: drawWorld(ctx); Game.ui.drawBuildCutsceneOverlay(ctx); break;
      case State.EXTERIOR: Game.ui.drawExteriorScreen(ctx); break;
      case State.HOUSE_INTERIOR: Game.ui.drawHouseInterior(ctx); break;
      case State.PIANO: Game.piano.draw(ctx); break;
      case State.VICTORY: Game.ui.drawVictory(ctx); break;
    }

    ctx.restore();
    Game.ui.endFrame();
    updateChrome();
  }

  /* DOM bits that track the game state: the Game Center link only shows
     where it can't cover play (it sat on the room tabs, screen titles and
     the build HUD), and the cursor turns into a pointer over anything
     clickable. */
  var renderedState = null;
  var linkEl = null, lastLinkShown = null, lastCursor = null;
  function updateChrome() {
    if (!linkEl) linkEl = document.getElementById('game-center-link');
    var show = state === State.TITLE || state === State.PAUSED;
    if (linkEl && show !== lastLinkShown) {
      linkEl.classList.toggle('hidden', !show);
      lastLinkShown = show;
    }
    var cursor = Game.ui.isHot() ? 'pointer' : 'default';
    if (cursor !== lastCursor) { canvas.style.cursor = cursor; lastCursor = cursor; }
  }

  /* Touch buttons only make sense where the D-pad drives something.
     Momoko walks around indoors too, so the house counts. */
  function showTouchButtons() {
    return state === State.PLAYING || state === State.PAUSED ||
           state === State.BUILD_CUTSCENE || state === State.HOUSE_INTERIOR;
  }

  function drawWorld(c) {
    var M = Game.MEADOW;
    var camX = camera.x;

    /* Sky, clouds and the parallax ridges, then the grass band with its
       path -- all in entities.js. */
    E.drawMeadowSky(c, camX, t, M.groundY, M.width);
    E.drawMeadowGround(c, camX, M.groundY, H, M);

    /* Scenery (culled to the viewport) */
    c.save();
    c.translate(-camX, 0);
    for (var i = 0; i < M.decor.length; i++) {
      var d = M.decor[i];
      if (d.x < camX - 320 || d.x > camX + W + 320) continue;
      E.drawMeadowDecor(c, d);
    }

    /* Shop */
    if (M.shop.x > camX - 400 && M.shop.x < camX + W + 400) {
      E.softShadow(c, M.shop.x, M.groundY + 2, 176, 9, 0.2);
      E.drawShop(c, M.shop.x, M.groundY, t);
    }

    /* Paint post appears once the shell is finished */
    if (Game.flags.canDecorate) drawPaintPost(c, M.paintPost.x, M.groundY);

    /* The tree */
    if (M.tree.x > camX - 500 && M.tree.x < camX + W + 500) {
      E.softShadow(c, M.tree.x, M.tree.groundY + 3, 150, 10, 0.2);
      var building = state === State.BUILD_CUTSCENE;
      Game.tree.drawTree(c, M.tree.x, M.tree.groundY, Game.build.stageIndex, Game.exterior, t,
        !building, building ? Game.ui.cutsceneReveal() : undefined);
    }

    /* Friends */
    for (var fid in friends) {
      friends[fid].draw(c, Game.friends[fid].cust);
    }

    /* Player */
    player.draw(c, Game.customization);

    for (var p = 0; p < particles.length; p++) particles[p].draw(c);
    c.restore();

    /* Prompt for whatever she is standing next to */
    var target = nearest();
    if (target && state === State.PLAYING) {
      Game.ui.drawPrompt(c, target.x - camX, target.promptY, Game.i18n.t(target.labelKey));
    }

    Game.ui.drawCarryOverlay(c, player, camX);
    /* The cutscene's banner takes the top of the screen on its own, and
       under the pause card the HUD would only sit beneath the Game Center
       link. */
    if (state !== State.BUILD_CUTSCENE && state !== State.PAUSED) {
      Game.ui.drawBuildHud(c);
      Game.ui.drawBagHud(c);
    }
    Game.ui.drawToast(c);
  }

  function drawPaintPost(c, x, groundY) {
    E.fillRound(c, x - 4, groundY - 66, 8, 66, 3, PAL.bark);
    E.fillRound(c, x - 26, groundY - 96, 52, 34, 6, PAL.creamDark);
    /* three paint pots on a little shelf */
    var cols = [PAL.peach, PAL.leafLight, PAL.sky];
    for (var i = 0; i < 3; i++) {
      E.fillRound(c, x - 20 + i * 14, groundY - 88, 11, 18, 3, cols[i]);
      E.fillEllipse(c, x - 14.5 + i * 14, groundY - 88, 5.5, 2.6, E.shade(cols[i], 28), false);
    }
    /* brush leaning against the post */
    E.fillRound(c, x + 16, groundY - 40, 5, 34, 2, PAL.barkLight);
    E.fillRound(c, x + 15, groundY - 48, 7, 10, 2, PAL.sun);
  }

  /* ---- Clicks ---- */
  function onPointerDown(e) {
    /* The piano owns raw pointer input while it's open. */
    if (state === State.PIANO) return;
    Game.audio.init();
    Game.audio.resume();
    var pos = Game.input.getClickPos(e);
    var mx = pos.x, my = pos.y;
    var action;

    switch (state) {
      case State.TITLE:
        action = Game.ui.handleTitleClick(mx, my);
        if (action === 'play') { Game.audio.play('select'); startGame(); }
        else if (action === 'lang') { toggleLang(); }
        else if (action === 'sound') { toggleSound(); }
        else if (action === 'reset') { resetSave(); Game.audio.play('select'); }
        else if (action === 'select') Game.audio.play('select');
        break;

      case State.CUSTOMIZE:
        action = Game.ui.handleCustomizeClick(mx, my);
        if (action === 'done') {
          Game.audio.play('select');
          save();
          if (customizeReturn === State.INTRO) state = State.INTRO;
          else if (customizeReturn === State.HOUSE_INTERIOR) enterHouse();
          else enterPlaying();
        } else if (action === 'select') Game.audio.play('select');
        break;

      case State.INTRO:
        if (Game.ui.handleIntroClick(mx, my) === 'continue') {
          Game.flags.introSeen = true;
          Game.audio.play('select');
          save();
          enterPlaying();
        }
        break;

      case State.PAUSED:
        action = Game.ui.handlePauseClick(mx, my);
        if (action === 'resume') { Game.audio.play('select'); state = prevState || State.PLAYING; }
        else if (action === 'lang') toggleLang();
        else if (action === 'sound') toggleSound();
        else if (action === 'quit') { Game.audio.play('select'); save(); state = State.TITLE; Game.audio.startMusic('title'); }
        break;

      case State.SHOP_INTERIOR:
        if (Game.ui.handleShopInteriorClick(mx, my) === 'exit') {
          Game.audio.play('select');
          state = State.PLAYING;
          save();
        }
        break;

      case State.EXTERIOR:
        action = Game.ui.handleExteriorClick(mx, my);
        if (action === 'done') { Game.audio.play('select'); save(); state = State.PLAYING; }
        else if (action === 'select') { Game.audio.play('select'); save(); }
        break;

      case State.HOUSE_INTERIOR:
        action = Game.ui.handleHouseInteriorClick(mx, my);
        if (action) applyInteriorAction(action);
        break;

      case State.VICTORY:
        if (Game.ui.handleVictoryClick(mx, my) === 'continue') {
          Game.audio.play('select');
          enterPlaying();
        }
        break;
    }
  }

  function toggleLang() {
    var l = Game.i18n.toggle();
    Game.settings.lang = l;
    Game.audio.play('select');
    save();
  }

  function toggleSound() {
    var m = Game.audio.toggleMute();
    Game.settings.muted = m;
    if (!m) {
      if (state === State.TITLE) Game.audio.startMusic('title');
      else if (state === State.HOUSE_INTERIOR) Game.audio.startMusic('inside');
      else if (state !== State.PIANO) Game.audio.startMusic('meadow');
    }
    save();
  }

  /* ---- Safety: never leave a note ringing when the tab goes away ---- */
  function onVisibilityChange() {
    if (document.hidden) {
      if (Game.piano) Game.piano.allNotesOff();
      Game.input.releaseAll();
    }
  }

  /* ---- Boot ---- */
  var FIXED_DT = 1000 / 60;
  var lastTime = 0;
  var accumulator = 0;

  function gameLoop(timestamp) {
    var delta = timestamp - lastTime;
    lastTime = timestamp;
    if (delta > 100) delta = 100;      /* cap – avoid the spiral of death */
    accumulator += delta;
    while (accumulator >= FIXED_DT) {
      update();
      accumulator -= FIXED_DT;
    }
    render();
    requestAnimationFrame(gameLoop);
  }

  function init() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');

    load();
    computeCanvasLayout();
    resizeBackingStore();

    Game.input.init(canvas);
    Game.audio.init();
    /* audio.init() sets the master gain unconditionally, so re-apply the
       saved mute preference after it. */
    Game.audio.setMuted(Game.settings.muted);

    player = new E.Player(Game.MEADOW.playerStart.x, Game.MEADOW.playerStart.y);
    rebuildFriendEntities();

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', function () { setTimeout(onResize, 120); });
    document.addEventListener('visibilitychange', onVisibilityChange);

    /* input.js calls preventDefault on touchstart, which suppresses the
       synthesized click on touch devices – so menus need touchend too.
       The timestamp guard stops a double-fire where a browser sends both. */
    var lastTouchTap = -1e9;
    canvas.addEventListener('touchend', function (e) {
      lastTouchTap = performance.now();
      onPointerDown(e);
    });
    canvas.addEventListener('click', function (e) {
      if (performance.now() - lastTouchTap < 700) return;
      onPointerDown(e);
    });

    Game.audio.startMusic('title');
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
  }

  window.Game.engine = {
    init: init,
    save: save,
    getState: function () { return state; },
    getPlayer: function () { return player; },
    getCameraX: function () { return camera.x; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
