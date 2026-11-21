/* songs.js – the tree house soundtrack, in Game.music song format.
   Acoustic and folky: fingerpicked guitar, flute, kalimba, upright bass,
   a soft felt piano indoors.  The title and the meadow share the same
   opening motif (D G A B, rising), so the title tune "becomes" the walk. */
(function () {
  'use strict';
  window.Game = window.Game || {};
  var U = Game.music.util;

  /* Felt piano: a darker, softer piano for the quiet interior. */
  Game.music.INSTRUMENTS.felt = function (ctx, out, f, t, dur, vel) {
    var g = U.gain(ctx, out, 0);
    var stop = U.ring(g, t, 0.26 * vel, 1.1 * Math.pow(440 / f, 0.35), dur, 0.22);
    var lp = U.lowpass(ctx, g, 1, 0.5);
    lp.frequency.setValueAtTime(Math.min(4200, f * (3 + vel * 3)), t);
    lp.frequency.setTargetAtTime(Math.min(2000, f * 1.8), t + 0.01, 0.3);
    U.osc(ctx, U.wave(ctx, 'felt', [1, 0.42, 0.2, 0.1, 0.05, 0.03]), f, t, stop, lp, -2);
    U.osc(ctx, 'sine', f, t, stop, lp, 3);
    U.noiseHit(ctx, out, t, 'lowpass', Math.min(1600, f * 3), 0.7, 0.04 * vel, 0.012);
  };

  /* ---- Meadow: an outdoor stroll in G, A A' B A'' (32 bars, ~77 s) ---- */
  var MEADOW_A_CHORDS = 'Gadd9:4 D/F#:4 Em7:4 Cmaj7:4 G/B:4 Am7:4 ';
  var MEADOW_A_LEAD =
    'D5:1 G5:0.5 A5 B5:1.5 A5:0.5 | A5:1.5 F#5:0.5 D5:2 | E5:1 G5:0.5 A5 B5:1 D6 | ' +
    'B5:1.5 A5:0.5 G5:1 E5 | D5:1 G5:0.5 A5 B5:1.5 D6:0.5 | E6:1.5 D6:0.5 C6:1 A5 | ';
  /* Written out so the slash chords walk G F# E C B A instead of the
     auto root-fifth landing a C# on D/F#. */
  var MEADOW_A_BASS = 'G2:2 D3 | F#2 A2 | E2 B2 | C3 G2 | B2 D3 | A2 E3 | ';
  var meadowGroove = {
    kick: 'x.......x.......',
    shaker: 'o.x.o.x.o.x.o.x.',
    rim: '....o.......o...'
  };
  var meadow = {
    bpm: 100, swing: 0.14, level: 1,
    reverb: { size: 2.0 }, delay: { beats: 0.75, feedback: 0.25 },
    tracks: {
      lead: { inst: 'flute', vol: 0.5, pan: 0.1, rev: 0.3, dly: 0.15 },
      kal: { inst: 'kalimba', vol: 0.4, pan: 0.3, rev: 0.35, dly: 0.2 },
      gtr: { inst: 'pluck', vol: 0.42, auto: 'arp', pattern: 'broken', rate: 0.5, octave: 3, pan: -0.25, rev: 0.2 },
      str: { inst: 'strings', vol: 0.22, auto: 'pad', octave: 4, attack: 0.5, release: 0.8, rev: 0.4 },
      bass: { inst: 'upright', vol: 0.62, auto: 'bass', style: 'root5', octave: 3, rhythm: 'x.......x.......' },
      drums: { vol: 0.38, rev: 0.1 }
    },
    grooves: { stroll: meadowGroove },
    sections: {
      A: {
        chords: MEADOW_A_CHORDS + 'C:2 D7:2 G:4', drums: 'stroll', str: false,
        lead: MEADOW_A_LEAD + 'G5:1 E5 F#5 A5 | G5:3 r:1',
        bass: MEADOW_A_BASS + 'C3:2 D3 | G2 D3'
      },
      A2: {
        chords: MEADOW_A_CHORDS + 'Cmaj7:4 D7sus4:2 D7:2', drums: 'stroll', str: false,
        fill: { rim: '..........o.o.o.', kick: 'x.......x.x.....' },
        lead: MEADOW_A_LEAD + 'E5:1 G5 B5:1.5 A5:0.5 | A5:2 F#5:1 r:1',
        bass: MEADOW_A_BASS + 'C3:2 G2 | D3 A2',
        kal: 'r:4 | r:2 F#5:0.5 A5 D6:1 | r:4 | r:4 | r:4 | r:4 | r:4 | r:3 D6:0.5 C6'
      },
      B: {
        chords: 'Cmaj7:4 Bm7:4 Em7:4 A7:4 Cmaj7:4 Cm6:4 Am7:4 D7sus4:2 D7:2', drums: 'stroll',
        fill: { shaker: 'x.x.x.x.xxxxxxxx', kick: 'x.......x...x...' },
        lead: 'E5:1.5 D5:0.5 E5:1 G5 | F#5:2 D5 | G5:1.5 F#5:0.5 G5:1 B5 | A5:1 C#6 E6:1.5 C#6:0.5 | ' +
              'E6:1.5 D6:0.5 C6:1 B5 | C6:1.5 A5:0.5 G5:1 Eb5 | E5:1 G5 A5 C6 | C6:1 A5 F#5 A5'
      },
      A3: {
        chords: MEADOW_A_CHORDS + 'C:2 D7:2 G:4', drums: 'stroll',
        lead: MEADOW_A_LEAD + 'G5:1 E5 F#5 A5 | G5:3 r:1',
        bass: MEADOW_A_BASS + 'C3:2 D3 | G2 D3',
        kal: 'r:4 | r:2 F#5:0.5 A5 D6:1 | r:4 | r:4 | r:4 | r:4 | r:4 | r:1 D6:0.5 B5 G5 A5 B5:1'
      }
    },
    form: 'A A2 B A3'
  };

  /* ---- Title: the same motif, brighter and strummed (16 bars, ~36 s) ---- */
  var TITLE_T2_LEAD =
    'E6:1.5 D6:0.5 B5:1 G5 | A5:1.5 B5:0.5 A5:1 F#5 | F#5:1 A5 D6:2 | B5:1.5 A5:0.5 G5:1 E5 | ' +
    'C6:1.5 D6:0.5 E6:1 A5 | F#5:1 A5 C6:1.5 A5:0.5 | B5:2 G5:1 B5 | C6:1 A5 F#5 A5';
  var title = {
    bpm: 108, swing: 0.08, level: 1,
    reverb: { size: 2.2 }, delay: { beats: 0.75, feedback: 0.25 },
    tracks: {
      lead: { inst: 'flute', vol: 0.5, pan: 0.05, rev: 0.3, dly: 0.15 },
      bell: { inst: 'bell', vol: 0.22, pan: 0.25, rev: 0.4 },
      gtr: { inst: 'pluck', vol: 0.32, auto: 'stab', rhythm: 'x...x.x...x.x...', strum: 0.018, octave: 3, pan: -0.25, rev: 0.2, gate: 0.95 },
      str: { inst: 'strings', vol: 0.2, auto: 'pad', octave: 4, attack: 0.4, rev: 0.4 },
      bass: { inst: 'upright', vol: 0.62, auto: 'bass', style: 'root5', octave: 3, rhythm: 'x.......x.......' },
      drums: { vol: 0.4, rev: 0.1 }
    },
    grooves: { walk: { kick: 'x.......x.......', shaker: 'x.o.x.o.x.o.x.o.', snap: '....x.......x...' } },
    sections: {
      T1: {
        chords: 'G:4 Em7:4 Cadd9:4 D7sus4:2 D:2 G:4 Bm7:4 Cmaj7:2 Cm6:2 D7:4', drums: 'walk',
        lead: 'D5:1 G5:0.5 A5 B5:2 | B5:1 G5:0.5 E5 G5:2 | E5:1 G5:0.5 A5 D6:2 | C6:2 A5:1 F#5 | ' +
              'D5:1 G5:0.5 A5 B5:1.5 D6:0.5 | D6:1 B5 F#5 A5 | G5:1 E5 Eb5 G5 | F#5:2 A5:1 C6'
      },
      T2: {
        chords: 'Cmaj7:4 D:4 Bm7:4 Em7:4 Am7:4 D7:4 G:2 Em7:2 Am7:2 D7:2', drums: 'walk',
        fill: { snap: '....x.......x...', tom: '..........o.o.o.' },
        lead: TITLE_T2_LEAD, bell: TITLE_T2_LEAD
      }
    },
    form: 'T1 T2'
  };

  /* ---- Inside: warm, quiet interior in F, A B A' (24 bars, ~72 s) ---- */
  var INSIDE_A_CHORDS = 'Fmaj7:4 Am7:4 Bbmaj7:4 C7sus4:2 C7:2 Dm7:4 Gm7:4 Bbmaj7:2 C7:2 ';
  var INSIDE_A_LEAD =
    'A5:1.5 G5:0.5 F5:1 C5 | E5:1 G5 C6:2 | D6:1.5 C6:0.5 A5:1 F5 | G5:2 E5:1 G5 | ' +
    'F5:1.5 G5:0.5 A5:1 F5 | D6:1.5 C6:0.5 Bb5:1 G5 | F5:1 D5 E5 G5 | ';
  var inside = {
    bpm: 80, swing: 0.1, level: 1,
    reverb: { size: 2.6 }, delay: { beats: 1, feedback: 0.22 },
    tracks: {
      lead: { inst: 'felt', vol: 0.62, pan: 0.05, rev: 0.35, dly: 0.12 },
      keys: { inst: 'epiano', vol: 0.3, auto: 'arp', pattern: 'broken', rate: 0.5, octave: 4, pan: -0.2, rev: 0.3, gate: 0.95 },
      str: { inst: 'strings', vol: 0.24, auto: 'pad', octave: 4, attack: 0.7, release: 1.0, rev: 0.45 },
      cello: { inst: 'strings', vol: 0.2, pan: 0.2, rev: 0.4, attack: 0.3 },
      bass: { inst: 'upright', vol: 0.55, auto: 'bass', style: 'root5', octave: 3, rhythm: 'x.......x.......' },
      drums: { vol: 0.3, rev: 0.15 }
    },
    sections: {
      A: {
        chords: INSIDE_A_CHORDS + 'Fmaj7:4', str: false,
        lead: INSIDE_A_LEAD + 'F5:3 r:1'
      },
      B: {
        chords: 'Dm7:4 Bbmaj7:4 Gm7:4 A7:4 Dm7:4 Gm7:4 Bbmaj7:2 Bbm6:2 C7sus4:2 C7:2',
        drums: { brush: 'o.......o.......' },
        lead: 'r:1 D5:0.5 F5 A5:1 C6 | D6:1.5 C6:0.5 Bb5:1 F5 | G5:1.5 F5:0.5 Bb5:1 D6 | C#6:2 A5:1 E5 | ' +
              'D6:1.5 C6:0.5 A5:1 F5 | Bb5:1 D6 F6:1.5 D6:0.5 | A5:1 D6 Db6 F5 | C6:2 Bb5:1 G5'
      },
      A2: {
        chords: INSIDE_A_CHORDS + 'Fmaj7:4',
        drums: { brush: 'o.......o.......' },
        lead: INSIDE_A_LEAD + 'F5:2 A5:1 C6',
        cello: 'C4:4 | E4:4 | D4:4 | Bb3:4 | A3:4 | Bb3:4 | D4:2 E4:2 | F4:4'
      }
    },
    form: 'A B A2'
  };

  Game.songs = { title: title, meadow: meadow, inside: inside };
})();
