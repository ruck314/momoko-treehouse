/* piano.js – the playable piano.
 *
 * Two octaves, C4-B5, playable by touch (real polyphony via the raw
 * pointer hook in input.js), by mouse, and by computer keyboard. Plus a
 * songbook with Listen and Follow-along modes.
 *
 * Stuck notes are the failure mode that would ruin this screen, so every
 * exit path funnels through allNotesOff(), and audio.startVoice() carries
 * its own hard auto-release as a second line of defence.
 */
(function () {
  'use strict';
  window.Game = window.Game || {};
  var PAL = Game.PAL;
  var E = Game.entities;

  var W = 800, H = 480;

  /* ---- Keyboard geometry ---- */
  var X0 = 64, WHITE_W = 48, WHITE_H = 230, KEY_TOP = 200;
  var BLACK_W = 30, BLACK_H = 145;
  var WHITE_PER_OCT = 7;
  var WHITE_SEMI = [0, 2, 4, 5, 7, 9, 11];
  var BLACK_AFTER = [0, 1, 3, 4, 5];   /* black key follows these white degrees */
  var BASE_MIDI = 60;                  /* C4 */

  var whites = [];
  var blacks = [];

  (function buildKeys() {
    var i, oct, deg;
    for (i = 0; i < 14; i++) {
      oct = Math.floor(i / WHITE_PER_OCT);
      deg = i % WHITE_PER_OCT;
      whites.push({
        midi: BASE_MIDI + oct * 12 + WHITE_SEMI[deg],
        isBlack: false,
        x: X0 + i * WHITE_W,
        y: KEY_TOP,
        w: WHITE_W,
        h: WHITE_H,
      });
    }
    for (oct = 0; oct < 2; oct++) {
      for (var b = 0; b < BLACK_AFTER.length; b++) {
        deg = BLACK_AFTER[b];
        i = oct * WHITE_PER_OCT + deg;
        blacks.push({
          midi: BASE_MIDI + oct * 12 + WHITE_SEMI[deg] + 1,
          isBlack: true,
          x: X0 + (i + 1) * WHITE_W - BLACK_W / 2,
          y: KEY_TOP,
          w: BLACK_W,
          h: BLACK_H,
        });
      }
    }
  })();

  /* Keyboard map – classic tracker layout. */
  var WHITE_CODES = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM',
                     'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU'];
  var BLACK_CODES = ['KeyS', 'KeyD', 'KeyG', 'KeyH', 'KeyJ',
                     'Digit2', 'Digit3', 'Digit5', 'Digit6', 'Digit7'];
  var codeToKey = {};
  (function buildCodeMap() {
    for (var i = 0; i < WHITE_CODES.length; i++) codeToKey[WHITE_CODES[i]] = whites[i];
    for (var b = 0; b < BLACK_CODES.length; b++) codeToKey[BLACK_CODES[b]] = blacks[b];
  })();

  /* ---- Note names ---- */
  var NOTE_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function noteToMidi(name) {
    var letter = name.charAt(0).toUpperCase();
    var idx = 1;
    var acc = 0;
    if (name.charAt(1) === '#') { acc = 1; idx = 2; }
    else if (name.charAt(1) === 'b') { acc = -1; idx = 2; }
    var octave = parseInt(name.slice(idx), 10);
    return (octave + 1) * 12 + NOTE_SEMI[letter] + acc;
  }
  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /* ---- State ---- */
  var octaveShift = 0;            /* in semitones, multiples of 12 */
  var MIN_SHIFT = -24, MAX_SHIFT = 24;
  var mode = 'free';              /* 'free' | 'listen' | 'follow' */
  var songIdx = 0;
  var voicesByPointer = {};       /* pointerId -> { key, voice } */
  var voicesByCode = {};          /* keyboard code -> { key, voice } */
  var pressed = {};               /* midi -> frames remaining of highlight */
  var listenTimer = 0, listenIdx = 0;
  var followIdx = 0;
  var celebrate = 0;
  var hintTimer = 0;
  var t = 0;
  var sparkles = [];

  /* ---- Buttons (hit-tested in game space) ---- */
  var BTN_EXIT = { x: 672, y: 12, w: 116, h: 36 };
  var BTN_OCT_DOWN = { x: 500, y: 12, w: 40, h: 36 };
  var BTN_OCT_UP = { x: 592, y: 12, w: 40, h: 36 };
  var BTN_LISTEN = { x: 552, y: 132, w: 108, h: 40 };
  var BTN_FOLLOW = { x: 668, y: 132, w: 120, h: 40 };

  function songChip(i) {
    return { x: 16 + i * 106, y: 132, w: 98, h: 40 };
  }

  function hit(b, mx, my) {
    return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
  }

  function keyAt(mx, my) {
    var i;
    /* Blacks sit on top, so they must be tested first. */
    for (i = 0; i < blacks.length; i++) {
      var k = blacks[i];
      if (mx >= k.x && mx <= k.x + k.w && my >= k.y && my <= k.y + k.h) return k;
    }
    for (i = 0; i < whites.length; i++) {
      var wk = whites[i];
      if (mx >= wk.x && mx <= wk.x + wk.w && my >= wk.y && my <= wk.y + wk.h) return wk;
    }
    return null;
  }

  /* ---- Sounding ---- */
  function soundingMidi(key) {
    return key.midi + octaveShift;
  }

  function noteOn(key) {
    var midi = soundingMidi(key);
    var voice = Game.audio.startVoice(midiToFreq(midi), 1);
    pressed[key.midi] = 6;
    if (mode === 'follow') advanceFollow(midi);
    return voice;
  }

  function advanceFollow(midi) {
    var song = Game.SONGS[songIdx];
    if (followIdx >= song.notes.length) return;
    var target = noteToMidi(song.notes[followIdx]);
    if (midi !== target) return;      /* wrong key just sounds; never advances */
    followIdx++;
    for (var s = 0; s < 6; s++) {
      sparkles.push({
        x: 400 + (Math.random() - 0.5) * 200, y: 178,
        vx: (Math.random() - 0.5) * 3, vy: -1 - Math.random() * 2,
        life: 30 + Math.random() * 20, max: 50,
      });
    }
    if (followIdx >= song.notes.length) {
      celebrate = 150;
      mode = 'free';
      Game.audio.play('sparkle');
      var flags = Game.flags || {};
      if (!flags.songsDone) flags.songsDone = [];
      if (flags.songsDone.indexOf(song.id) === -1) flags.songsDone.push(song.id);
      if (Game.engine && Game.engine.save) Game.engine.save();
    }
  }

  function allNotesOff() {
    var id;
    for (id in voicesByPointer) {
      if (voicesByPointer[id] && voicesByPointer[id].voice) voicesByPointer[id].voice.release();
    }
    for (id in voicesByCode) {
      if (voicesByCode[id] && voicesByCode[id].voice) voicesByCode[id].voice.release();
    }
    voicesByPointer = {};
    voicesByCode = {};
    pressed = {};
  }

  /* ---- Pointer handling ---- */
  function onPointer(phase, id, mx, my) {
    if (phase === 'start') {
      if (my < KEY_TOP) { handleUiTap(mx, my); return; }
      var k = keyAt(mx, my);
      if (!k) return;
      voicesByPointer[id] = { key: k, voice: noteOn(k) };
    } else if (phase === 'move') {
      var rec = voicesByPointer[id];
      if (!rec) return;
      var nk = keyAt(mx, my);
      if (nk === rec.key) return;
      /* Sliding across the keyboard is a glissando, which is the first
         thing anyone tries. */
      if (rec.voice) rec.voice.release();
      if (nk) {
        rec.key = nk;
        rec.voice = noteOn(nk);
      } else {
        delete voicesByPointer[id];
      }
    } else {
      var r = voicesByPointer[id];
      if (r && r.voice) r.voice.release();
      delete voicesByPointer[id];
    }
  }

  function handleUiTap(mx, my) {
    var i;
    if (hit(BTN_EXIT, mx, my)) { Game.audio.play('select'); requestExit(); return; }
    if (hit(BTN_OCT_DOWN, mx, my)) {
      if (octaveShift > MIN_SHIFT) { octaveShift -= 12; Game.audio.play('select'); }
      return;
    }
    if (hit(BTN_OCT_UP, mx, my)) {
      if (octaveShift < MAX_SHIFT) { octaveShift += 12; Game.audio.play('select'); }
      return;
    }
    if (hit(BTN_LISTEN, mx, my)) {
      Game.audio.play('select');
      if (mode === 'listen') { mode = 'free'; }
      else { mode = 'listen'; listenIdx = 0; listenTimer = 0; }
      return;
    }
    if (hit(BTN_FOLLOW, mx, my)) {
      Game.audio.play('select');
      if (mode === 'follow') { mode = 'free'; }
      else { mode = 'follow'; followIdx = 0; celebrate = 0; }
      return;
    }
    for (i = 0; i < Game.SONGS.length; i++) {
      if (hit(songChip(i), mx, my)) {
        songIdx = i;
        listenIdx = 0; listenTimer = 0; followIdx = 0; celebrate = 0;
        Game.audio.play('select');
        return;
      }
    }
  }

  /* ---- Keyboard handling ---- */
  function onKey(down, code) {
    if (code === null) { allNotesOff(); return false; }
    if (down) {
      if (code === 'Comma') { if (octaveShift > MIN_SHIFT) octaveShift -= 12; return true; }
      if (code === 'Period') { if (octaveShift < MAX_SHIFT) octaveShift += 12; return true; }
      var k = codeToKey[code];
      if (!k) return false;
      if (voicesByCode[code]) return true;
      voicesByCode[code] = { key: k, voice: noteOn(k) };
      return true;
    }
    var rec = voicesByCode[code];
    if (rec) {
      if (rec.voice) rec.voice.release();
      delete voicesByCode[code];
      return true;
    }
    return false;
  }

  /* ---- Lifecycle ---- */
  var exitRequested = false;

  function enter() {
    exitRequested = false;
    mode = 'free';
    listenIdx = 0; listenTimer = 0; followIdx = 0; celebrate = 0;
    hintTimer = 260;
    sparkles = [];
    Game.audio.init();
    Game.audio.resume();
    Game.audio.stopMusic();
    Game.input.setRawTouchListener(onPointer);
    Game.input.setKeyCapture(onKey);
  }

  function exit() {
    allNotesOff();
    Game.input.setRawTouchListener(null);
    Game.input.setKeyCapture(null);
  }

  function requestExit() { exitRequested = true; }

  /* Returns 'exit' when the player wants out; the engine owns the state. */
  function update(keys, jp) {
    t++;
    if (hintTimer > 0) hintTimer--;
    if (celebrate > 0) celebrate--;

    for (var m in pressed) {
      pressed[m]--;
      if (pressed[m] <= 0) delete pressed[m];
    }

    for (var s = sparkles.length - 1; s >= 0; s--) {
      var sp = sparkles[s];
      sp.x += sp.vx; sp.y += sp.vy; sp.vy += 0.06; sp.life--;
      if (sp.life <= 0) sparkles.splice(s, 1);
    }

    if (mode === 'listen') runListen();

    if (exitRequested || jp.pause) { exitRequested = false; return 'exit'; }
    return null;
  }

  function runListen() {
    var song = Game.SONGS[songIdx];
    if (listenTimer > 0) { listenTimer--; return; }
    if (listenIdx >= song.notes.length) { mode = 'free'; return; }
    var midi = noteToMidi(song.notes[listenIdx]);
    var beats = song.beats[listenIdx];
    var secs = beats * (60 / song.tempo);
    Game.audio.pianoPluck(midiToFreq(midi), Math.max(0.25, secs * 0.9), 0, 0.3);
    pressed[midi - octaveShift] = Math.max(6, Math.floor(secs * 60 * 0.8));
    listenTimer = Math.floor(secs * 60);
    listenIdx++;
  }

  /* ---- Drawing ---- */
  function draw(c) {
    /* Music-room backdrop so it reads as sitting down at the piano. */
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#dfe4f2');
    g.addColorStop(1, '#8f93b8');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    drawTopBar(c);
    drawSongStrip(c);
    drawKeyboard(c);
    drawSparkles(c);

    if (celebrate > 0) drawCelebration(c);
  }

  function drawTopBar(c) {
    c.fillStyle = 'rgba(58, 40, 20, 0.85)';
    c.fillRect(0, 0, W, 60);
    c.fillStyle = PAL.cream;
    c.font = 'bold 24px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(Game.i18n.t('pianoTitle'), 20, 30);

    /* Octave control */
    c.font = 'bold 14px monospace';
    c.textAlign = 'right';
    c.fillStyle = PAL.creamDark;
    c.fillText(Game.i18n.t('pianoOctave'), 492, 30);
    button(c, BTN_OCT_DOWN, '−', false);
    button(c, BTN_OCT_UP, '+', false);
    c.fillStyle = PAL.cream;
    c.font = 'bold 16px monospace';
    c.textAlign = 'center';
    c.fillText(octaveShift === 0 ? '0' : (octaveShift > 0 ? '+' + (octaveShift / 12) : String(octaveShift / 12)), 566, 30);

    button(c, BTN_EXIT, Game.i18n.t('pianoExit'), false);
  }

  function drawSongStrip(c) {
    var song = Game.SONGS[songIdx];

    c.fillStyle = 'rgba(255, 244, 220, 0.75)';
    E.roundRect(c, 12, 68, W - 24, 56, 8);
    c.fill();
    E.ink(c, 2);

    c.fillStyle = PAL.ink;
    c.font = 'bold 18px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(Game.i18n.t(song.titleKey), 26, 96);

    if (mode === 'follow') {
      var done = followIdx >= song.notes.length;
      c.font = 'bold 15px monospace';
      c.textAlign = 'right';
      if (done) {
        c.fillText(Game.i18n.t('pianoWellDone'), W - 26, 96);
      } else {
        c.fillText(Game.i18n.t('pianoNextNote') + ' ' + song.notes[followIdx], W - 26, 96);
        /* Progress bar so a small player can see the song shrinking. */
        var pw = 220, px = W - 26 - pw, py = 110;
        c.fillStyle = 'rgba(74,51,32,0.2)';
        E.roundRect(c, px, py, pw, 6, 3); c.fill();
        c.fillStyle = PAL.leaf;
        E.roundRect(c, px, py, pw * (followIdx / song.notes.length), 6, 3); c.fill();
      }
    } else if (mode === 'listen') {
      c.font = 'bold 15px monospace';
      c.textAlign = 'right';
      c.fillText('♪ ' + Game.i18n.t('pianoListen'), W - 26, 96);
    } else if (hintTimer > 0) {
      c.font = '14px monospace';
      c.textAlign = 'right';
      c.fillStyle = 'rgba(74,51,32,0.75)';
      c.fillText(Game.input.isTouch() ? Game.i18n.t('pianoHintTouch') : Game.i18n.t('pianoHintKeys'), W - 26, 96);
    }

    for (var i = 0; i < Game.SONGS.length; i++) {
      var b = songChip(i);
      var sel = (i === songIdx);
      c.fillStyle = sel ? PAL.sun : 'rgba(255,244,220,0.8)';
      E.roundRect(c, b.x, b.y, b.w, b.h, 8);
      c.fill();
      E.ink(c, sel ? 2.5 : 1.6);
      c.fillStyle = PAL.ink;
      c.font = 'bold 11px monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      wrapLabel(c, Game.i18n.t(Game.SONGS[i].titleKey), b.x + b.w / 2, b.y + b.h / 2, b.w - 10);
    }

    button(c, BTN_LISTEN, Game.i18n.t(mode === 'listen' ? 'pianoStop' : 'pianoListen'), mode === 'listen');
    button(c, BTN_FOLLOW, Game.i18n.t(mode === 'follow' ? 'pianoStop' : 'pianoFollow'), mode === 'follow');
  }

  /* Two-line centred label for the narrow song chips. */
  function wrapLabel(c, text, cx, cy, maxW) {
    if (c.measureText(text).width <= maxW) {
      c.fillText(text, cx, cy);
      return;
    }
    var words = text.split(' ');
    var line1 = '', line2 = '';
    for (var i = 0; i < words.length; i++) {
      var trial = line1 ? line1 + ' ' + words[i] : words[i];
      if (c.measureText(trial).width <= maxW && !line2) line1 = trial;
      else line2 = line2 ? line2 + ' ' + words[i] : words[i];
    }
    if (!line2) {
      /* No spaces to break on (Japanese titles) – split by character. */
      var half = Math.ceil(text.length / 2);
      line1 = text.slice(0, half);
      line2 = text.slice(half);
    }
    c.fillText(line1, cx, cy - 7);
    c.fillText(line2, cx, cy + 7);
  }

  function button(c, b, label, active) {
    c.fillStyle = active ? PAL.peach : 'rgba(255,244,220,0.9)';
    E.roundRect(c, b.x, b.y, b.w, b.h, 8);
    c.fill();
    E.ink(c, 2);
    c.fillStyle = PAL.ink;
    c.font = 'bold 13px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, b.x + b.w / 2, b.y + b.h / 2);
  }

  function followTargetMidi() {
    if (mode !== 'follow') return null;
    var song = Game.SONGS[songIdx];
    if (followIdx >= song.notes.length) return null;
    return noteToMidi(song.notes[followIdx]);
  }

  function drawKeyboard(c) {
    var i, k;
    var target = followTargetMidi();

    /* Case */
    c.fillStyle = '#5a3c22';
    E.roundRect(c, X0 - 18, KEY_TOP - 26, WHITE_W * 14 + 36, WHITE_H + 46, 10);
    c.fill();
    E.ink(c, 2.5);
    c.fillStyle = '#3b2a16';
    E.roundRect(c, X0 - 10, KEY_TOP - 18, WHITE_W * 14 + 20, 16, 5);
    c.fill();

    /* Fallboard nameplate */
    c.fillStyle = PAL.sun;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    var plate = Game.i18n.t('title');
    E.fitText(c, plate, 300, 11);
    c.fillText(plate, X0 + WHITE_W * 7, KEY_TOP - 10);

    /* White keys */
    for (i = 0; i < whites.length; i++) {
      k = whites[i];
      var down = !!pressed[k.midi];
      var isTarget = (target !== null && soundingMidi(k) === target);
      c.fillStyle = down ? '#e8e0cc' : '#fffdf6';
      E.roundRect(c, k.x + 1, k.y, k.w - 2, k.h + (down ? 3 : 0), 5);
      c.fill();
      c.strokeStyle = '#6b5a44';
      c.lineWidth = 1.5;
      c.stroke();
      if (isTarget) {
        c.save();
        c.globalAlpha = 0.55 + Math.sin(t / 8) * 0.2;
        c.fillStyle = PAL.leafLight;
        E.roundRect(c, k.x + 1, k.y + k.h - 56, k.w - 2, 54, 5);
        c.fill();
        c.restore();
      }
      /* Note letter along the bottom lip – helps with Follow mode. */
      c.fillStyle = 'rgba(74,51,32,0.45)';
      c.font = 'bold 11px monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(midiName(soundingMidi(k)), k.x + k.w / 2, k.y + k.h - 14);
    }

    /* Black keys on top */
    for (i = 0; i < blacks.length; i++) {
      k = blacks[i];
      var bdown = !!pressed[k.midi];
      var btarget = (target !== null && soundingMidi(k) === target);
      c.fillStyle = bdown ? '#4a4038' : '#2a231c';
      E.roundRect(c, k.x, k.y, k.w, k.h + (bdown ? 3 : 0), 4);
      c.fill();
      c.strokeStyle = '#15100b';
      c.lineWidth = 1.5;
      c.stroke();
      if (btarget) {
        c.save();
        c.globalAlpha = 0.6 + Math.sin(t / 8) * 0.2;
        c.fillStyle = PAL.leafLight;
        E.roundRect(c, k.x + 2, k.y + k.h - 40, k.w - 4, 36, 4);
        c.fill();
        c.restore();
      }
      /* Sheen along the top edge */
      c.save();
      c.globalAlpha = 0.25;
      c.fillStyle = '#ffffff';
      E.roundRect(c, k.x + 4, k.y + 4, k.w - 8, 6, 3);
      c.fill();
      c.restore();
    }
  }

  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function midiName(midi) {
    return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  function drawSparkles(c) {
    for (var i = 0; i < sparkles.length; i++) {
      var s = sparkles[i];
      c.save();
      c.globalAlpha = Math.max(0, s.life / s.max);
      c.fillStyle = PAL.sun;
      E.star(c, s.x, s.y, 5);
      c.restore();
    }
  }

  function drawCelebration(c) {
    c.save();
    c.globalAlpha = Math.min(1, celebrate / 40);
    c.fillStyle = 'rgba(255, 244, 220, 0.92)';
    E.roundRect(c, 180, 70, 440, 60, 12);
    c.fill();
    E.ink(c, 3);
    c.fillStyle = PAL.ink;
    c.font = 'bold 20px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(Game.i18n.t('pianoWellDone'), 400, 100);
    c.restore();
  }

  /* Ambient phrase the resident pianist friend plays in the music room. */
  function playAmbientPhrase() {
    var song = Game.SONGS[0];
    var when = Game.audio.now();
    for (var i = 0; i < 8; i++) {
      var midi = noteToMidi(song.notes[i % song.notes.length]);
      Game.audio.pianoPluck(midiToFreq(midi), 0.45, when + i * 0.34, 0.13);
    }
  }

  window.Game.piano = {
    enter: enter,
    exit: exit,
    update: update,
    draw: draw,
    allNotesOff: allNotesOff,
    playAmbientPhrase: playAmbientPhrase,
    noteToMidi: noteToMidi,
    midiToFreq: midiToFreq,
  };
})();
