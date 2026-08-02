/* audio.js – Web Audio API sound effects, cozy music, and the piano voice.
   Core graph and the playNote/noise primitives are ported from
   momoko-in-space. New here: startVoice(), a key-held sustaining piano
   voice that playNote (fire-and-forget, fixed duration) can't express. */
(function () {
  'use strict';
  window.Game = window.Game || {};

  var ctx = null;
  var masterGain = null;
  var musicGain = null;
  var sfxGain = null;
  var pianoGain = null;
  var currentMusic = null;
  var muted = false;
  var initialized = false;

  function init() {
    if (initialized) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.5;
      masterGain.connect(ctx.destination);

      musicGain = ctx.createGain();
      musicGain.gain.value = 0.3;
      musicGain.connect(masterGain);

      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.6;
      sfxGain.connect(masterGain);

      /* The piano gets its own bus so held chords can't swamp the mix. */
      pianoGain = ctx.createGain();
      pianoGain.gain.value = 0.5;
      pianoGain.connect(masterGain);

      initialized = true;
    } catch (e) { /* Web Audio not available */ }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  /* ---- primitives ---- */
  function playNote(freq, type, duration, gain, dest, startTime) {
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.3, startTime || ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, (startTime || ctx.currentTime) + duration);
    osc.connect(g);
    g.connect(dest || sfxGain);
    osc.start(startTime || ctx.currentTime);
    osc.stop((startTime || ctx.currentTime) + duration);
  }

  function noise(duration, dest, startTime, gain) {
    if (!ctx) return;
    var bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain || 0.15, startTime || ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, (startTime || ctx.currentTime) + duration);
    src.connect(g);
    g.connect(dest || sfxGain);
    src.start(startTime || ctx.currentTime);
  }

  /* ---- Piano voice ----
     Three oscillators (fundamental triangle, octave sine, twelfth sine)
     plus a short filtered noise thunk for the hammer. Sustains until
     release() so key-hold feels right, with a hard auto-release so a
     dropped touchend can never leave a note ringing forever. */
  var MAX_HOLD = 2.5;

  function startVoice(freq, velocity) {
    if (!ctx || muted) return null;
    var t = ctx.currentTime;
    var vel = velocity === undefined ? 1 : velocity;
    var peak = 0.34 * vel;

    var g = ctx.createGain();
    g.connect(pianoGain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.12);

    var oscs = [];
    function addOsc(type, mult, level) {
      var o = ctx.createOscillator();
      var og = ctx.createGain();
      o.type = type;
      o.frequency.value = freq * mult;
      og.gain.value = level;
      o.connect(og);
      og.connect(g);
      o.start(t);
      oscs.push(o);
    }
    addOsc('triangle', 1, 1.0);
    addOsc('sine', 2, 0.33);
    addOsc('sine', 3, 0.16);

    /* Hammer thunk – brief, low-passed so it reads as felt on string. */
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(4000, freq * 6);
    lp.connect(g);
    noise(0.006, lp, t, 0.4 * vel);

    var released = false;
    var voice = {
      release: function () {
        if (released || !ctx) return;
        released = true;
        var now = ctx.currentTime;
        try {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
          g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
        } catch (e) { /* node already torn down */ }
        for (var i = 0; i < oscs.length; i++) {
          try { oscs[i].stop(now + 0.35); } catch (e) { /* already stopped */ }
        }
      },
      stop: function () {
        released = true;
        for (var i = 0; i < oscs.length; i++) {
          try { oscs[i].stop(); } catch (e) { /* already stopped */ }
        }
        try { g.disconnect(); } catch (e) { /* already disconnected */ }
      },
    };

    /* Safety net: a lost touchend must not sustain forever. */
    setTimeout(function () { voice.release(); }, MAX_HOLD * 1000);
    return voice;
  }

  /* One-shot piano note for Listen mode and the friend pianist. */
  function pianoPluck(freq, duration, startTime, gain) {
    if (!ctx) return;
    var when = startTime || ctx.currentTime;
    var lvl = (gain === undefined ? 0.3 : gain);
    playNote(freq, 'triangle', duration, lvl, pianoGain, when);
    playNote(freq * 2, 'sine', duration * 0.7, lvl * 0.3, pianoGain, when);
    playNote(freq * 3, 'sine', duration * 0.5, lvl * 0.14, pianoGain, when);
  }

  /* ---- SFX ---- */
  function hammer() {
    if (!ctx) return;
    var t = ctx.currentTime;
    noise(0.05, sfxGain, t, 0.35);
    playNote(180, 'square', 0.05, 0.25, sfxGain, t);
    playNote(120, 'triangle', 0.09, 0.2, sfxGain, t + 0.02);
  }

  function saw() {
    if (!ctx) return;
    var t = ctx.currentTime;
    for (var i = 0; i < 3; i++) noise(0.09, sfxGain, t + i * 0.11, 0.2);
  }

  function pickup() {
    if (!ctx) return;
    var t = ctx.currentTime;
    playNote(660, 'triangle', 0.07, 0.22, sfxGain, t);
    playNote(880, 'triangle', 0.07, 0.22, sfxGain, t + 0.07);
    playNote(1100, 'triangle', 0.1, 0.18, sfxGain, t + 0.14);
  }

  function drop() {
    if (!ctx) return;
    var t = ctx.currentTime;
    playNote(320, 'triangle', 0.08, 0.2, sfxGain, t);
    playNote(220, 'triangle', 0.12, 0.18, sfxGain, t + 0.07);
  }

  function menuSelect() {
    if (!ctx) return;
    playNote(620, 'square', 0.06, 0.14, sfxGain);
  }

  function deny() {
    if (!ctx) return;
    var t = ctx.currentTime;
    playNote(200, 'square', 0.08, 0.18, sfxGain, t);
    playNote(150, 'square', 0.12, 0.18, sfxGain, t + 0.08);
  }

  /* Stage-complete fanfare – a warm major arpeggio with a hammer tail. */
  function buildComplete() {
    if (!ctx) return;
    var t = ctx.currentTime;
    noise(0.06, sfxGain, t, 0.3);
    var notes = [392, 494, 587, 784];
    for (var i = 0; i < notes.length; i++) {
      playNote(notes[i], 'triangle', 0.22, 0.26, sfxGain, t + 0.06 + i * 0.09);
      playNote(notes[i] * 0.5, 'sine', 0.22, 0.12, sfxGain, t + 0.06 + i * 0.09);
    }
  }

  function victoryJingle() {
    if (!ctx) return;
    var t = ctx.currentTime;
    var notes = [523, 587, 659, 784, 659, 784, 1047];
    var dur = [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.5];
    var time = t;
    for (var i = 0; i < notes.length; i++) {
      playNote(notes[i], 'triangle', dur[i], 0.28, sfxGain, time);
      playNote(notes[i] * 0.5, 'sine', dur[i], 0.14, sfxGain, time);
      time += dur[i];
    }
  }

  function sparkle() {
    if (!ctx) return;
    var t = ctx.currentTime;
    for (var i = 0; i < 4; i++) {
      playNote(880 + i * 220, 'sine', 0.12, 0.12, sfxGain, t + i * 0.05);
    }
  }

  /* ---- Music ---- */
  var musicInterval = null;

  /* Meadow BGM – slow pentatonic in G, the kind of thing you can leave on. */
  var meadowPattern = [
    [392, 'triangle'], [440, 'triangle'], [494, 'triangle'], [440, 'triangle'],
    [392, 'triangle'], [330, 'triangle'], [392, 'triangle'], [494, 'triangle'],
    [587, 'triangle'], [494, 'triangle'], [440, 'triangle'], [392, 'triangle'],
    [330, 'triangle'], [294, 'triangle'], [330, 'triangle'], [392, 'triangle'],
    [440, 'triangle'], [494, 'triangle'], [587, 'triangle'], [494, 'triangle'],
    [440, 'triangle'], [392, 'triangle'], [330, 'triangle'], [294, 'triangle'],
    [262, 'triangle'], [330, 'triangle'], [392, 'triangle'], [330, 'triangle'],
    [294, 'triangle'], [262, 'triangle'], [220, 'triangle'], [196, 'triangle'],
  ];
  var meadowBass = [
    98, 98, 147, 147, 98, 98, 131, 131,
    147, 147, 110, 110, 98, 98, 147, 147,
    110, 110, 147, 147, 110, 110, 98, 98,
    131, 131, 98, 98, 87, 87, 98, 98,
  ];

  /* Title – same tunes an octave up with a lilt, a bit more sparkle. */
  var titlePattern = [
    [523, 'triangle'], [659, 'triangle'], [784, 'triangle'], [659, 'triangle'],
    [880, 'triangle'], [784, 'triangle'], [659, 'triangle'], [523, 'triangle'],
    [587, 'triangle'], [698, 'triangle'], [880, 'triangle'], [698, 'triangle'],
    [784, 'triangle'], [659, 'triangle'], [587, 'triangle'], [494, 'triangle'],
    [523, 'triangle'], [659, 'triangle'], [784, 'triangle'], [1047, 'triangle'],
    [880, 'triangle'], [784, 'triangle'], [659, 'triangle'], [587, 'triangle'],
    [523, 'triangle'], [494, 'triangle'], [440, 'triangle'], [494, 'triangle'],
    [523, 'triangle'], [587, 'triangle'], [659, 'triangle'], [523, 'triangle'],
  ];
  var titleBass = [
    131, 131, 196, 196, 175, 175, 131, 131,
    147, 147, 220, 220, 196, 196, 147, 147,
    131, 131, 196, 196, 175, 175, 147, 147,
    131, 131, 110, 110, 131, 131, 196, 131,
  ];

  /* Indoors – sparser, softer, sine-led. */
  var insidePattern = [
    [330, 'sine'], [392, 'sine'], [440, 'sine'], [392, 'sine'],
    [330, 'sine'], [294, 'sine'], [330, 'sine'], [392, 'sine'],
    [440, 'sine'], [494, 'sine'], [440, 'sine'], [392, 'sine'],
    [330, 'sine'], [294, 'sine'], [262, 'sine'], [294, 'sine'],
  ];
  var insideBass = [
    131, 131, 110, 110, 98, 98, 131, 131,
    147, 147, 110, 110, 98, 98, 87, 87,
  ];

  function startMusic(type) {
    stopMusic();
    if (!ctx || muted) return;
    var pattern, bass, tempo, lead;
    if (type === 'title') {
      pattern = titlePattern; bass = titleBass; tempo = 132; lead = 0.13;
    } else if (type === 'inside') {
      pattern = insidePattern; bass = insideBass; tempo = 88; lead = 0.12;
    } else {
      pattern = meadowPattern; bass = meadowBass; tempo = 104; lead = 0.14;
    }
    var beatDur = 60 / tempo;
    var noteIdx = 0;

    function scheduleNotes() {
      if (!ctx || muted) return;
      var t = ctx.currentTime;
      for (var i = 0; i < 4; i++) {
        var idx = (noteIdx + i) % pattern.length;
        var note = pattern[idx];
        var bNote = bass[idx % bass.length];
        var when = t + i * beatDur;
        playNote(note[0], note[1], beatDur * 0.8, lead, musicGain, when);
        playNote(bNote, 'sine', beatDur * 0.9, 0.11, musicGain, when);
      }
      noteIdx = (noteIdx + 4) % pattern.length;
    }

    scheduleNotes();
    musicInterval = setInterval(scheduleNotes, beatDur * 4 * 1000);
    currentMusic = type;
  }

  function stopMusic() {
    if (musicInterval) {
      clearInterval(musicInterval);
      musicInterval = null;
    }
    currentMusic = null;
  }

  function toggleMute() {
    muted = !muted;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.5;
    if (muted) stopMusic();
    return muted;
  }

  function setMuted(m) {
    muted = !!m;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.5;
    if (muted) stopMusic();
  }

  window.Game.audio = {
    init: init,
    resume: resume,
    play: function (name) {
      if (muted || !ctx) return;
      resume();
      switch (name) {
        case 'hammer': hammer(); break;
        case 'saw': saw(); break;
        case 'pickup': pickup(); break;
        case 'drop': drop(); break;
        case 'select': menuSelect(); break;
        case 'deny': deny(); break;
        case 'build': buildComplete(); break;
        case 'victory': victoryJingle(); break;
        case 'sparkle': sparkle(); break;
      }
    },
    startVoice: function (freq, velocity) {
      if (!ctx) init();
      resume();
      return startVoice(freq, velocity);
    },
    pianoPluck: function (freq, duration, startTime, gain) {
      if (!ctx) return;
      resume();
      pianoPluck(freq, duration, startTime, gain);
    },
    now: function () { return ctx ? ctx.currentTime : 0; },
    startMusic: function (type) { resume(); startMusic(type); },
    stopMusic: stopMusic,
    toggleMute: toggleMute,
    setMuted: setMuted,
    isMuted: function () { return muted; },
    currentMusic: function () { return currentMusic; },
  };
})();
