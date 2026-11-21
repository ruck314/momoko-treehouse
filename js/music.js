/* music.js – small Web Audio sequencer + synth shared by the Momoko games.

   Songs are plain objects (see SONG FORMAT below) compiled once into a
   flat event list, then streamed with a look-ahead scheduler so timing is
   sample-accurate no matter how the frame loop or timers jitter.  Every
   voice is synthesized; there are no sample files, so the PWA stays tiny
   and works offline.

   Engine version 1.0.0 (Game.music.VERSION); the same file ships in every
   Momoko game, so keep the copies identical.

   API (window.Game.music):
     createPlayer(ctx, dest, opts) -> player
         player.play(song, { transpose, tempoMul, fade, loop, name, onEnd })
         player.stop(fadeSec)          fade out and stop scheduling
         player.current()              name passed to play() or null
         player.setLevel(v, sec)       ramp the player's output level
     voice(ctx, dest, inst, freqOrNote, t, durSec, vel, params)
         one synth note, for SFX / jingles
     drum(ctx, dest, kind, t, vel)     one drum hit
     compile(song, opts) -> { events, beats, warnings }   (throws on errors)
     render(song, seconds, opts) -> Promise<AudioBuffer>  offline, for tests
     freq('C#4'), midi('C#4'), INSTRUMENTS, DRUMS

   SONG FORMAT
     {
       bpm: 96, beatsPerBar: 4, stepsPerBeat: 4, swing: 0..0.33,
       level: 1, reverb: { size: 2.2 }, delay: { beats: 0.75, feedback: 0.3 },
       tracks: {
         lead: { inst: 'flute', vol: 0.5, pan: 0.1, rev: 0.3, dly: 0.2 },
         pad:  { inst: 'pad', vol: 0.3, auto: 'pad', octave: 4 },
         arp:  { inst: 'pluck', auto: 'arp', pattern: 'updown', rate: 0.5,
                 octave: 4, range: 2, gate: 0.8 },
         bass: { inst: 'bass', auto: 'bass', style: 'root5', octave: 2,
                 rhythm: 'x...x...' },
         drums:{ vol: 0.6, rev: 0.1 }          // drum bus (no inst)
       },
       grooves: { basic: { kick: 'x.......x.......', hat: 'x.x.x.x.x.x.x.x.' } },
       sections: {
         A: {
           chords: 'C:4 Am:4 F:4 G:4',      // name:beats, sets section length
           lead: 'E5:1 G5 C6:2 | r:2 B5:1 A5 | ...',
           bass: false,                     // silence an auto track here
           drums: 'basic',                  // groove name or inline object
           fill: { snare: '....x...x.x.xxxx' } // replaces last bar for listed kinds
         }
       },
       form: 'A A B A'
     }
   Note tokens: C4, F#5:0.5, Bb3:2!, r:1 (rest), C4+E4+G4:2 (chord),
   '!' accent, '?' ghost, '|' bar lines are ignored.  A token's duration
   carries over to the next token that omits one.  A part may be an object
   { notes: '...', loop: true } to repeat a short riff across the section.
   Drum steps: X accent, x hit, o ghost, . rest.  Drum kinds: see DRUMS.
   Auto tracks (pad, stab, arp, bass) play chords in every section unless
   that section sets the track to false or gives explicit notes for it.
*/
(function () {
  'use strict';
  window.Game = window.Game || {};

  /* ------------------------------------------------------------------ */
  /* pitch                                                               */
  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function parseMidi(name) {
    var m = /^([A-Ga-g])(#|b)?(-?\d)$/.exec(name);
    if (!m) return null;
    var n = PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 12 * (parseInt(m[3], 10) + 1) + n;
  }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  var QUAL = {
    '': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'maj7': [0, 4, 7, 11],
    'm7': [0, 3, 7, 10], 'm7b5': [0, 3, 6, 10], 'dim': [0, 3, 6], 'dim7': [0, 3, 6, 9],
    'aug': [0, 4, 8], 'sus2': [0, 2, 7], 'sus4': [0, 5, 7], '7sus4': [0, 5, 7, 10],
    'add9': [0, 4, 7, 14], 'madd9': [0, 3, 7, 14], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9],
    '9': [0, 4, 10, 14], 'maj9': [0, 4, 11, 14], 'm9': [0, 3, 10, 14], '69': [0, 4, 9, 14]
  };
  var CHORD_RE = /^([A-G])(#|b)?(maj9|maj7|m7b5|madd9|dim7|7sus4|add9|sus2|sus4|aug|dim|m9|m7|m6|69|m|7|9|6)?(?:\/([A-G])(#|b)?)?$/;

  function parseChord(tok) {
    var m = CHORD_RE.exec(tok);
    if (!m) return null;
    var root = PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    var ivs = QUAL[m[3] || ''];
    var bass = m[4] ? PC[m[4]] + (m[5] === '#' ? 1 : m[5] === 'b' ? -1 : 0) : root;
    return { name: tok, root: (root + 12) % 12, bass: (bass + 12) % 12, ivs: ivs };
  }

  /* Close voicing near `center` that moves least from `prev`. */
  function voiceChord(ch, center, prev, maxVoices) {
    var ivs = ch.ivs.slice();
    if (ivs.length > (maxVoices || 4)) ivs.splice(2, 1);      /* drop the fifth */
    var pcs = ivs.map(function (iv) { return (ch.root + iv) % 12; });
    var best = null, bestCost = 1e9;
    for (var inv = 0; inv < pcs.length; inv++) {
      for (var base = center - 7; base <= center + 5; base++) {
        if ((base % 12 + 12) % 12 !== pcs[inv]) continue;
        var v = [base], cur = base;
        for (var k = 1; k < pcs.length; k++) {
          var pc = pcs[(inv + k) % pcs.length];
          var nx = cur + 1;
          while ((nx % 12 + 12) % 12 !== pc) nx++;
          v.push(nx); cur = nx;
        }
        var cost = 0;
        if (prev) for (var j = 0; j < v.length; j++) cost += Math.abs(v[j] - (prev[j] !== undefined ? prev[j] : prev[prev.length - 1]));
        else cost = Math.abs((v[0] + v[v.length - 1]) / 2 - center) * 2;
        cost += Math.abs((v[0] + v[v.length - 1]) / 2 - center) * 0.5;
        if (cost < bestCost) { bestCost = cost; best = v; }
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* compile                                                             */
  function parseNotes(str, where) {
    var out = [], beat = 0, dur = 1;
    var toks = String(str).split(/\s+/);
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      if (!tk || tk === '|') continue;
      var vel = 0.8;
      if (/!$/.test(tk)) { vel = 1; tk = tk.slice(0, -1); }
      else if (/\?$/.test(tk)) { vel = 0.5; tk = tk.slice(0, -1); }
      var parts = tk.split(':');
      if (parts.length > 2) throw new Error(where + ': bad token "' + toks[i] + '"');
      if (parts.length === 2) {
        dur = parseFloat(parts[1]);
        if (!(dur > 0)) throw new Error(where + ': bad duration in "' + toks[i] + '"');
      }
      var head = parts[0];
      if (head !== 'r' && head !== '-') {
        var names = head.split('+'), mids = [];
        for (var n = 0; n < names.length; n++) {
          var md = parseMidi(names[n]);
          if (md === null) throw new Error(where + ': bad note "' + names[n] + '" in "' + toks[i] + '"');
          mids.push(md);
        }
        out.push({ b: beat, midi: mids.length === 1 ? mids[0] : mids, dur: dur, vel: vel });
      }
      beat += dur;
    }
    return { notes: out, beats: beat };
  }

  function parseChords(str, where) {
    var out = [], beat = 0, dur = 4;
    var toks = String(str).split(/\s+/);
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      if (!tk || tk === '|') continue;
      var parts = tk.split(':');
      if (parts.length === 2) dur = parseFloat(parts[1]);
      if (!(dur > 0)) throw new Error(where + ': bad chord duration "' + tk + '"');
      if (parts[0] !== 'r' && parts[0] !== 'N.C.') {
        var ch = parseChord(parts[0]);
        if (!ch) throw new Error(where + ': bad chord "' + parts[0] + '"');
        out.push({ b: beat, dur: dur, ch: ch });
      }
      beat += dur;
    }
    return { chords: out, beats: beat };
  }

  function swingWarp(b, s) {
    if (!s) return b;
    var whole = Math.floor(b + 1e-9), f = b - whole;
    var mid = 0.5 + s / 2;
    return whole + (f < 0.5 ? f * (mid / 0.5) : mid + (f - 0.5) * ((1 - mid) / 0.5));
  }

  function chordAt(chords, b) {
    for (var i = chords.length - 1; i >= 0; i--) if (chords[i].b <= b + 1e-9) return chords[i];
    return null;
  }

  function rhythmHits(rhythm, spb, start, len) {
    var hits = [], steps = Math.round(len * spb);
    for (var s = 0; s < steps; s++) {
      var c = rhythm[s % rhythm.length];
      if (c === 'x' || c === 'X' || c === 'o') hits.push({ b: start + s / spb, vel: c === 'X' ? 1 : c === 'o' ? 0.5 : 0.8 });
    }
    return hits;
  }

  function autoPart(tr, name, chords, secBeats, spb, beatsPerBar, state, out) {
    var oct = tr.octave !== undefined ? tr.octave : (tr.auto === 'bass' ? 2 : 4);
    var center = 12 * (oct + 1) + 6;
    var gate = tr.gate !== undefined ? tr.gate : 0.9;
    for (var ci = 0; ci < chords.length; ci++) {
      var c = chords[ci], ch = c.ch;
      var nextCh = chords[ci + 1] ? chords[ci + 1].ch : (state.firstChord || ch);
      var v = voiceChord(ch, center, state[name], tr.voices);
      state[name] = v;
      if (tr.auto === 'pad') {
        out.push({ b: c.b, track: name, midi: v, dur: c.dur * (tr.gate !== undefined ? tr.gate : 1), vel: 0.75 });
      } else if (tr.auto === 'stab') {
        var hs = rhythmHits(tr.rhythm || 'x...', spb, c.b, c.dur);
        for (var h = 0; h < hs.length; h++) {
          var nxt = h + 1 < hs.length ? hs[h + 1].b : c.b + c.dur;
          out.push({ b: hs[h].b, track: name, midi: v, dur: Math.max(0.05, (nxt - hs[h].b) * gate), vel: hs[h].vel });
        }
      } else if (tr.auto === 'arp') {
        var tones = [], range = tr.range || 1;
        for (var r = 0; r < range; r++) for (var k = 0; k < v.length; k++) tones.push(v[k] + 12 * r);
        var seq;
        var pat = tr.pattern || 'up';
        if (pat === 'down') seq = tones.slice().reverse();
        else if (pat === 'updown') seq = tones.concat(tones.slice(1, -1).reverse());
        else if (pat === 'alberti') seq = [tones[0], tones[tones.length - 1], tones[1] !== undefined ? tones[1] : tones[0], tones[tones.length - 1]];
        else if (pat === 'broken') seq = [tones[0], tones[2 % tones.length], tones[1 % tones.length], tones[3 % tones.length] || tones[0] + 12];
        else seq = tones;
        var rate = tr.rate || 0.5, n = Math.round(c.dur / rate);
        for (var a = 0; a < n; a++) {
          var idx = (state[name + '#'] || 0) + a;
          out.push({ b: c.b + a * rate, track: name, midi: seq[(pat === 'random' ? (idx * 7 + 3) : idx) % seq.length], dur: rate * gate, vel: a % (beatsPerBar * 2) === 0 ? 0.9 : 0.72 });
        }
        if (tr.continuous) state[name + '#'] = (state[name + '#'] || 0) + n;
      } else if (tr.auto === 'bass') {
        var root = ch.bass, lo = 12 * (oct + 1);
        var rm = lo + root; if (rm - lo > 6) rm -= 12;
        var fifth = rm + 7;
        var hb = rhythmHits(tr.rhythm || 'x...', spb, c.b, c.dur);
        var style = tr.style || 'root';
        for (var q = 0; q < hb.length; q++) {
          var m = rm;
          if (style === 'root5') m = q % 2 ? fifth : rm;
          else if (style === 'oct') m = q % 2 ? rm + 12 : rm;
          else if (style === 'walk') {
            var tonesW = [rm, rm + ch.ivs[1], rm + 7, rm + (ch.ivs[3] || 12)];
            m = tonesW[q % 4];
            if (q === hb.length - 1 && hb.length > 1) {
              var tgt = lo + nextCh.bass; if (tgt - lo > 6) tgt -= 12;
              m = tgt + (tgt > rm ? -1 : 1);                /* chromatic approach */
            }
          }
          var end = q + 1 < hb.length ? hb[q + 1].b : c.b + c.dur;
          out.push({ b: hb[q].b, track: name, midi: m, dur: Math.max(0.05, (end - hb[q].b) * gate), vel: hb[q].vel });
        }
      }
    }
  }

  var RESERVED = { chords: 1, drums: 1, fill: 1, beats: 1 };

  function compile(song, opts) {
    opts = opts || {};
    var spb = song.stepsPerBeat || 4, bpb = song.beatsPerBar || 4;
    var tracks = song.tracks || {}, events = [], warnings = [];
    var form = song.form ? String(song.form).split(/\s+/).filter(Boolean) : Object.keys(song.sections || {});
    var beat = 0, state = {}, cache = {};
    var transpose = opts.transpose || 0;
    if (!form.length) throw new Error('song has no sections');
    Object.keys(tracks).forEach(function (tn) {
      var inst = tracks[tn].inst;
      if (inst && !INSTRUMENTS[inst]) throw new Error('track ' + tn + ': unknown instrument "' + inst + '"');
    });

    for (var fi = 0; fi < form.length; fi++) {
      var sname = form[fi], sec = song.sections[sname];
      if (!sec) throw new Error('form names missing section "' + sname + '"');
      var where = 'section ' + sname;
      var chords = sec.chords ? parseChords(sec.chords, where) : { chords: [], beats: 0 };
      if (!state.firstChord && chords.chords.length) state.firstChord = chords.chords[0].ch;
      var len = sec.beats || chords.beats;
      var parsed = {};
      Object.keys(sec).forEach(function (k) {
        if (!tracks[k] || sec[k] === false || RESERVED[k]) return;
        var spec = sec[k];
        var notes = typeof spec === 'string' ? spec : spec.notes;
        var p = cache[sname + '/' + k] || (cache[sname + '/' + k] = parseNotes(notes, where + '/' + k));
        parsed[k] = { p: p, loop: typeof spec === 'object' && spec.loop };
        if (!len) len = p.beats;
      });
      if (!len) throw new Error(where + ': cannot tell its length (add chords or beats)');
      if (fi === 0 || form[fi - 1] !== sname) {
        if (len % bpb) warnings.push(where + ': ' + len + ' beats is not a whole number of bars');
        Object.keys(parsed).forEach(function (k) {
          var pb = parsed[k].p.beats;
          if (!parsed[k].loop && Math.abs(pb - len) > 1e-6) warnings.push(where + '/' + k + ': part is ' + pb + ' beats, section is ' + len);
          if (parsed[k].loop && (len / pb) % 1) warnings.push(where + '/' + k + ': loop of ' + pb + ' beats does not divide ' + len);
        });
      }

      Object.keys(parsed).forEach(function (k) {
        var p = parsed[k].p, reps = parsed[k].loop ? Math.ceil(len / p.beats) : 1;
        for (var r = 0; r < reps; r++) {
          for (var i = 0; i < p.notes.length; i++) {
            var nb = p.notes[i].b + r * p.beats;
            if (nb >= len - 1e-9) break;
            events.push({ b: beat + nb, track: k, midi: p.notes[i].midi, dur: p.notes[i].dur, vel: p.notes[i].vel });
          }
        }
      });

      Object.keys(tracks).forEach(function (tn) {
        var tr = tracks[tn];
        if (!tr.auto || parsed[tn] || sec[tn] === false || !chords.chords.length) return;
        var local = [];
        autoPart(tr, tn, chords.chords, len, spb, bpb, state, local);
        for (var i = 0; i < local.length; i++) { local[i].b += beat; events.push(local[i]); }
      });

      var groove = typeof sec.drums === 'string' ? (song.grooves || {})[sec.drums] : sec.drums;
      if (typeof sec.drums === 'string' && !groove) throw new Error(where + ': unknown groove "' + sec.drums + '"');
      if (groove) {
        var fill = sec.fill || {};
        var lastBar = len - bpb;
        Object.keys(groove).concat(Object.keys(fill)).forEach(function (kind, ix, arr) {
          if (arr.indexOf(kind) !== ix) return;
          if (!DRUMS[kind]) throw new Error(where + ': unknown drum "' + kind + '"');
          var steps = Math.round(len * spb);
          for (var s = 0; s < steps; s++) {
            var b = s / spb, pat = groove[kind], ss = s;
            if (fill[kind] !== undefined && b >= lastBar - 1e-9) { pat = fill[kind]; ss = s - Math.round(lastBar * spb); }
            if (!pat) continue;
            var c = pat[ss % pat.length];
            if (c === 'x' || c === 'X' || c === 'o') events.push({ b: beat + b, drum: kind, vel: c === 'X' ? 1 : c === 'o' ? 0.45 : 0.8 });
          }
        });
      }
      beat += len;
    }
    var sw = song.swing || 0;
    for (var e = 0; e < events.length; e++) {
      var ev = events[e];
      ev.b = swingWarp(ev.b, sw);
      if (ev.midi !== undefined && transpose && !(tracks[ev.track] && tracks[ev.track].fixedPitch)) {
        ev.midi = Array.isArray(ev.midi) ? ev.midi.map(function (m) { return m + transpose; }) : ev.midi + transpose;
      }
    }
    events.sort(function (a, b) { return a.b - b.b; });
    return { events: events, beats: beat, warnings: warnings };
  }

  /* ------------------------------------------------------------------ */
  /* per-context resources                                               */
  function res(ctx) {
    if (ctx.__momokoMusic) return ctx.__momokoMusic;
    var r = {};
    var len = ctx.sampleRate | 0, nb = ctx.createBuffer(1, len, ctx.sampleRate), d = nb.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    r.noise = nb;
    r.waves = {};
    r.irs = {};
    ctx.__momokoMusic = r;
    return r;
  }
  function wave(ctx, name, harm) {
    var r = res(ctx);
    if (!r.waves[name]) {
      var re = new Float32Array(harm.length + 1), im = new Float32Array(harm.length + 1);
      for (var i = 0; i < harm.length; i++) im[i + 1] = harm[i];
      r.waves[name] = ctx.createPeriodicWave(re, im);
    }
    return r.waves[name];
  }
  function impulse(ctx, size) {
    var r = res(ctx), key = size.toFixed(2);
    if (r.irs[key]) return r.irs[key];
    var sr = ctx.sampleRate, len = Math.floor(sr * size), buf = ctx.createBuffer(2, len, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len, amp = Math.pow(1 - t, 2.6) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
        var k = 0.35 + 0.6 * t;                     /* darker as it decays */
        lp += (Math.random() * 2 - 1 - lp) * (1 - k);
        d[i] = lp * amp * 0.9;
      }
    }
    r.irs[key] = buf;
    return buf;
  }

  /* ------------------------------------------------------------------ */
  /* instruments                                                         */
  function osc(ctx, type, f, t, stop, dest, detune) {
    var o = ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.setValueAtTime(f, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    o.connect(dest);
    o.start(t); o.stop(stop);
    return o;
  }
  function gainNode(ctx, dest, v) {
    var g = ctx.createGain(); g.gain.value = v === undefined ? 1 : v; g.connect(dest); return g;
  }
  /* ADSR on a gain param; returns the stop time. */
  function adsr(g, t, dur, peak, a, d, s, r) {
    var p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setTargetAtTime(peak * s, t + a, Math.max(0.005, d / 3));
    var off = t + Math.max(dur, a + 0.01);
    p.setTargetAtTime(0, off, Math.max(0.005, r / 3));
    return off + r * 1.6 + 0.02;
  }
  /* Percussive: instant attack, exponential ring. */
  function ring(g, t, peak, tau, dur, rel) {
    var p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + 0.003);
    p.setTargetAtTime(0, t + 0.003, tau);
    if (dur !== undefined && rel) { p.setTargetAtTime(0, t + dur, rel); return t + Math.min(tau * 5, dur + rel * 5) + 0.02; }
    return t + tau * 5 + 0.02;
  }
  function vibrato(ctx, o, t, f, rate, cents, delay) {
    var l = ctx.createOscillator(), lg = ctx.createGain();
    l.frequency.value = rate;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * (Math.pow(2, cents / 1200) - 1), t + delay + 0.25);
    l.connect(lg); lg.connect(o.frequency);
    l.start(t);
    return l;
  }
  function lowpass(ctx, dest, f, q) {
    var b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = q || 0.7; b.connect(dest); return b;
  }

  var INSTRUMENTS = {
    /* soft flute / ocarina: sine + 2nd, breathy attack, delayed vibrato */
    flute: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur, 0.3 * vel, 0.05, 0.2, 0.8, 0.12);
      var o = osc(ctx, wave(ctx, 'flute', [1, 0.22, 0.06, 0.02]), f, t, stop, g);
      var v = vibrato(ctx, o, t, f, 5.2, p.vib !== undefined ? p.vib : 14, 0.18); v.stop(stop);
      var ng = gainNode(ctx, g, 0), bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = Math.min(8000, f * 2); bp.Q.value = 1.2; bp.connect(ng);
      ng.gain.setValueAtTime(0.12 * vel, t); ng.gain.setTargetAtTime(0.02 * vel, t + 0.03, 0.05);
      var n = ctx.createBufferSource(); n.buffer = res(ctx).noise; n.loop = true; n.connect(bp);
      n.start(t, Math.random() * 0.5); n.stop(stop);
    },
    /* classic chip square, softened by a low-pass */
    chip: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur * 0.92, 0.16 * vel, 0.004, 0.12, 0.6, 0.05);
      var lp = lowpass(ctx, g, p.cutoff || 3800);
      var o = osc(ctx, p.wave || 'square', f, t, stop, lp);
      if (p.vib) vibrato(ctx, o, t, f, 5.8, p.vib, 0.2).stop(stop);
    },
    /* bright lead: two detuned pulses with filter bite */
    lead: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur, 0.13 * vel, 0.01, 0.15, 0.7, 0.1);
      var lp = lowpass(ctx, g, 1, 1.5);
      var cut = p.cutoff || 3200;
      lp.frequency.setValueAtTime(cut * 1.8, t); lp.frequency.setTargetAtTime(cut, t + 0.01, 0.12);
      var w = wave(ctx, 'pulse25', [0.9, 0.64, 0.3, 0, 0.18, 0.21, 0.13, 0, 0.1, 0.13]);
      var o1 = osc(ctx, w, f, t, stop, lp, -6), o2 = osc(ctx, w, f, t, stop, lp, 6);
      vibrato(ctx, o1, t, f, 5.6, p.vib !== undefined ? p.vib : 12, 0.22).stop(stop);
      vibrato(ctx, o2, t, f, 5.3, p.vib !== undefined ? p.vib : 12, 0.22).stop(stop);
    },
    /* warm analog pad: two detuned saws through a soft low-pass */
    pad: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur, 0.06 * vel, p.attack || 0.35, 0.6, 0.85, p.release || 0.9);
      var lp = lowpass(ctx, g, p.cutoff || 1300, 0.6);
      osc(ctx, 'sawtooth', f, t, stop, lp, -9);
      osc(ctx, 'sawtooth', f, t, stop, lp, 9);
    },
    /* airy glass pad (sine choir), softer than pad */
    choir: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur, 0.09 * vel, p.attack || 0.5, 0.6, 0.9, p.release || 1.2);
      var w = wave(ctx, 'choir', [1, 0.5, 0.32, 0.12, 0.08, 0.03]);
      var o1 = osc(ctx, w, f, t, stop, g, -7), o2 = osc(ctx, w, f, t, stop, g, 7);
      vibrato(ctx, o1, t, f, 4.6, 8, 0.1).stop(stop);
      vibrato(ctx, o2, t, f, 5.1, 8, 0.1).stop(stop);
    },
    /* bowed strings ensemble */
    strings: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur, 0.07 * vel, p.attack || 0.12, 0.3, 0.9, p.release || 0.4);
      var lp = lowpass(ctx, g, p.cutoff || Math.min(5200, f * 6), 0.5);
      var o1 = osc(ctx, 'sawtooth', f, t, stop, lp, -8), o2 = osc(ctx, 'sawtooth', f, t, stop, lp, 7);
      vibrato(ctx, o1, t, f, 5.4, 10, 0.15).stop(stop);
      vibrato(ctx, o2, t, f, 4.9, 10, 0.2).stop(stop);
    },
    /* brass section: filter swell on a saw */
    brass: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur, 0.12 * vel, 0.03, 0.2, 0.75, 0.12);
      var lp = lowpass(ctx, g, 1, 1.1);
      var top = Math.min(6000, f * (p.bright || 6));
      lp.frequency.setValueAtTime(f * 1.2, t);
      lp.frequency.linearRampToValueAtTime(top, t + 0.05);
      lp.frequency.setTargetAtTime(top * 0.6, t + 0.06, 0.2);
      osc(ctx, 'sawtooth', f, t, stop, lp, -4);
      osc(ctx, 'sawtooth', f, t, stop, lp, 5);
    },
    /* FM electric piano (Rhodes-ish tine) */
    epiano: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur, 0.2 * vel, 0.004, 1.4, 0.35, 0.35);
      var c = osc(ctx, 'sine', f, t, stop, g);
      var m = ctx.createOscillator(), mg = ctx.createGain();
      m.frequency.value = f; m.connect(mg); mg.connect(c.frequency);
      mg.gain.setValueAtTime(f * (1.4 + vel * 0.8), t); mg.gain.setTargetAtTime(f * 0.18, t, 0.25);
      m.start(t); m.stop(stop);
      var tg = gainNode(ctx, out, 0);
      ring(tg, t, 0.035 * vel, 0.08);
      osc(ctx, 'sine', f * 7.1, t, t + 0.5, tg);
    },
    /* real-ish piano: additive with hammer + inharmonic decay */
    piano: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var tau = 0.9 * Math.pow(440 / f, 0.35);
      var stop = ring(g, t, 0.22 * vel, tau, dur, 0.12);
      var lp = lowpass(ctx, g, 1, 0.5);
      lp.frequency.setValueAtTime(Math.min(9000, f * (6 + vel * 6)), t);
      lp.frequency.setTargetAtTime(Math.min(4000, f * 3), t + 0.01, 0.4);
      osc(ctx, wave(ctx, 'piano', [1, 0.55, 0.32, 0.22, 0.1, 0.08, 0.04, 0.03]), f, t, stop, lp, -2);
      osc(ctx, 'triangle', f, t, stop, lp, 3);
    },
    /* harp / guitar pluck */
    pluck: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = ring(g, t, 0.24 * vel, p.decay || 0.35, dur, 0.15);
      var lp = lowpass(ctx, g, 1, 1.2);
      lp.frequency.setValueAtTime(Math.min(10000, f * 10), t);
      lp.frequency.setTargetAtTime(f * 1.6, t + 0.002, 0.09);
      osc(ctx, 'sawtooth', f, t, stop, lp);
      osc(ctx, 'triangle', f * 2, t, stop, lp, 4);
    },
    /* music box comb */
    musicbox: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = ring(g, t, 0.2 * vel, p.decay || 0.55);
      osc(ctx, 'sine', f, t, stop, g);
      var h = gainNode(ctx, out, 0); ring(h, t, 0.06 * vel, 0.12);
      osc(ctx, 'sine', f * 3.0, t, t + 0.7, h);
      osc(ctx, 'sine', f * 5.98, t, t + 0.7, h);
    },
    /* glockenspiel / celesta bell */
    bell: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = ring(g, t, 0.16 * vel, p.decay || 0.7);
      osc(ctx, 'sine', f, t, stop, g);
      var h = gainNode(ctx, out, 0); ring(h, t, 0.08 * vel, 0.22);
      osc(ctx, 'sine', f * 2.76, t, t + 1.2, h);
      osc(ctx, 'sine', f * 5.4, t, t + 1.2, h);
    },
    /* wooden mallet */
    marimba: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = ring(g, t, 0.28 * vel, p.decay || 0.22 * Math.pow(440 / f, 0.3));
      osc(ctx, 'sine', f, t, stop, g);
      var h = gainNode(ctx, out, 0); ring(h, t, 0.07 * vel, 0.03);
      osc(ctx, 'sine', f * 4, t, t + 0.25, h);
    },
    /* kalimba thumb piano */
    kalimba: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = ring(g, t, 0.24 * vel, p.decay || 0.42);
      var o = osc(ctx, 'sine', f * 1.01, t, stop, g);
      o.frequency.setTargetAtTime(f, t, 0.01);
      var h = gainNode(ctx, out, 0); ring(h, t, 0.05 * vel, 0.04);
      osc(ctx, 'sine', f * 5.2, t, t + 0.3, h);
      osc(ctx, 'triangle', f * 2, t, t + 0.3, h);
    },
    /* drawbar organ */
    organ: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur, 0.09 * vel, 0.008, 0.1, 0.9, 0.06);
      var o = osc(ctx, wave(ctx, 'organ', [1, 0.8, 0.5, 0.35, 0, 0.25, 0, 0.18]), f, t, stop, g);
      vibrato(ctx, o, t, f, 6.4, p.vib || 6, 0).stop(stop);
    },
    /* soft reed / clarinet: odd harmonics */
    reed: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur, 0.16 * vel, 0.04, 0.2, 0.85, 0.1);
      var lp = lowpass(ctx, g, Math.min(6000, f * 5), 0.7);
      var o = osc(ctx, wave(ctx, 'reed', [1, 0.04, 0.5, 0.03, 0.28, 0.02, 0.14, 0.01, 0.07]), f, t, stop, lp);
      vibrato(ctx, o, t, f, 5, p.vib !== undefined ? p.vib : 10, 0.25).stop(stop);
    },
    /* theremin-like sine with wide slow vibrato (space) */
    theremin: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur, 0.22 * vel, 0.09, 0.3, 0.85, 0.25);
      var o = osc(ctx, wave(ctx, 'ther', [1, 0.12, 0.05]), f * 0.985, t, stop, g);
      o.frequency.setTargetAtTime(f, t, 0.04);
      vibrato(ctx, o, t, f, 6.2, p.vib || 28, 0.12).stop(stop);
    },
    /* round bass that still reads on tablet speakers (added harmonics) */
    bass: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur, 0.3 * vel, 0.006, 0.25, 0.7, 0.07);
      var lp = lowpass(ctx, g, 1, 2);
      lp.frequency.setValueAtTime(Math.min(3000, f * 9), t);
      lp.frequency.setTargetAtTime(f * (p.tone || 3.5), t + 0.005, 0.12);
      osc(ctx, 'triangle', f, t, stop, lp);
      osc(ctx, 'sawtooth', f, t, stop, gainNode(ctx, lp, 0.35), 3);
    },
    /* plucked upright (jazz walk) */
    upright: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = ring(g, t, 0.36 * vel, 0.5, dur, 0.06);
      var lp = lowpass(ctx, g, 1, 1);
      lp.frequency.setValueAtTime(f * 8, t); lp.frequency.setTargetAtTime(f * 2.5, t, 0.06);
      osc(ctx, wave(ctx, 'upr', [1, 0.6, 0.25, 0.15, 0.08]), f, t, stop, lp);
    },
    /* funky synth bass: saw + resonant filter pluck */
    synthbass: function (ctx, out, f, t, dur, vel, p) {
      var g = gainNode(ctx, out, 0);
      var stop = adsr(g, t, dur, 0.2 * vel, 0.004, 0.2, 0.6, 0.05);
      var lp = lowpass(ctx, g, 1, p.q || 6);
      lp.frequency.setValueAtTime(Math.min(4000, f * 14), t);
      lp.frequency.setTargetAtTime(f * 2.2, t + 0.004, 0.07);
      osc(ctx, 'sawtooth', f, t, stop, lp);
      osc(ctx, 'square', f / 2, t, stop, gainNode(ctx, lp, 0.4));
    }
  };

  /* ------------------------------------------------------------------ */
  /* drums                                                               */
  function noiseHit(ctx, out, t, type, freq, q, peak, tau, len, rate) {
    var n = ctx.createBufferSource(); n.buffer = res(ctx).noise; n.playbackRate.value = rate || 1;
    var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    var g = gainNode(ctx, out, 0);
    n.connect(f); f.connect(g);
    ring(g, t, peak, tau);
    n.start(t, Math.random() * 0.8); n.stop(t + (len || tau * 6));
    return g;
  }
  var DRUMS = {
    kick: function (ctx, out, t, v) {
      var g = gainNode(ctx, out, 0); ring(g, t, 0.9 * v, 0.11);
      var o = osc(ctx, 'sine', 160, t, t + 0.6, g);
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
      var o2g = gainNode(ctx, out, 0); ring(o2g, t, 0.25 * v, 0.03);       /* beater, audible on small speakers */
      osc(ctx, 'triangle', 300, t, t + 0.15, o2g).frequency.exponentialRampToValueAtTime(110, t + 0.04);
      noiseHit(ctx, out, t, 'highpass', 3000, 0.7, 0.07 * v, 0.006);
    },
    snare: function (ctx, out, t, v) {
      noiseHit(ctx, out, t, 'bandpass', 2600, 0.6, 0.42 * v, 0.06, 0.4);
      var g = gainNode(ctx, out, 0); ring(g, t, 0.3 * v, 0.04);
      osc(ctx, 'triangle', 200, t, t + 0.2, g).frequency.exponentialRampToValueAtTime(150, t + 0.05);
    },
    hat: function (ctx, out, t, v) { noiseHit(ctx, out, t, 'highpass', 8000, 0.8, 0.2 * v, 0.014, 0.1); },
    ohat: function (ctx, out, t, v) { noiseHit(ctx, out, t, 'highpass', 7500, 0.8, 0.16 * v, 0.09, 0.5); },
    shaker: function (ctx, out, t, v) {
      var g = noiseHit(ctx, out, t, 'bandpass', 6500, 1.4, 0.15 * v, 0.03, 0.15);
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.15 * v, t + 0.018); g.gain.setTargetAtTime(0, t + 0.02, 0.025);
    },
    clap: function (ctx, out, t, v) {
      for (var i = 0; i < 3; i++) noiseHit(ctx, out, t + i * 0.011, 'bandpass', 1500, 1.2, 0.3 * v, 0.008, 0.05);
      noiseHit(ctx, out, t + 0.03, 'bandpass', 1400, 1, 0.25 * v, 0.07, 0.4);
    },
    rim: function (ctx, out, t, v) {
      var g = gainNode(ctx, out, 0); ring(g, t, 0.3 * v, 0.012);
      osc(ctx, 'triangle', 1750, t, t + 0.1, g); osc(ctx, 'square', 820, t, t + 0.1, gainNode(ctx, g, 0.3));
    },
    snap: function (ctx, out, t, v) { noiseHit(ctx, out, t, 'bandpass', 2800, 3, 0.45 * v, 0.018, 0.1); },
    brush: function (ctx, out, t, v) {
      var g = noiseHit(ctx, out, t, 'bandpass', 4200, 0.5, 0.1 * v, 0.07, 0.35);
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.1 * v, t + 0.03); g.gain.setTargetAtTime(0, t + 0.035, 0.06);
    },
    tom: function (ctx, out, t, v) {
      var g = gainNode(ctx, out, 0); ring(g, t, 0.55 * v, 0.12);
      var o = osc(ctx, 'sine', 210, t, t + 0.7, g); o.frequency.exponentialRampToValueAtTime(120, t + 0.2);
      noiseHit(ctx, out, t, 'lowpass', 900, 0.7, 0.08 * v, 0.03);
    },
    block: function (ctx, out, t, v) {
      var g = gainNode(ctx, out, 0); ring(g, t, 0.32 * v, 0.03);
      osc(ctx, 'sine', 950, t, t + 0.2, g); osc(ctx, 'sine', 2480, t, t + 0.2, gainNode(ctx, g, 0.3));
    },
    tri: function (ctx, out, t, v) {
      var g = gainNode(ctx, out, 0); ring(g, t, 0.09 * v, 0.5);
      osc(ctx, 'sine', 2637, t, t + 2.6, g); osc(ctx, 'sine', 6213, t, t + 2.6, gainNode(ctx, g, 0.4));
    },
    crash: function (ctx, out, t, v) {
      noiseHit(ctx, out, t, 'highpass', 4500, 0.5, 0.22 * v, 0.45, 2.4, 0.9);
    }
  };

  /* ------------------------------------------------------------------ */
  /* player                                                              */
  var hasPanner = null;
  function panNode(ctx, dest, pan) {
    if (hasPanner === null) hasPanner = typeof ctx.createStereoPanner === 'function';
    if (!hasPanner || !pan) return gainNode(ctx, dest, 1);
    var p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(dest); return p;
  }

  function buildInstance(ctx, out, song, opts) {
    var inst = { song: song, name: opts.name || null };
    var comp = compile(song, opts);
    if (comp.warnings.length && window.console && opts.warn !== false) console.warn('[music] ' + comp.warnings.join('\n[music] '));
    inst.events = comp.events; inst.beats = comp.beats;
    inst.spb = 60 / ((song.bpm || 100) * (opts.tempoMul || 1));
    inst.loop = opts.loop !== false && song.loop !== false;
    inst.fade = gainNode(ctx, out, 0);
    var mix = gainNode(ctx, inst.fade, song.level !== undefined ? song.level : 1);
    var rv = song.reverb || {};
    inst.conv = ctx.createConvolver();
    inst.conv.buffer = impulse(ctx, rv.size || 2.2);
    inst.revIn = gainNode(ctx, inst.conv, rv.level !== undefined ? rv.level : 1);
    inst.conv.connect(mix);
    var dl = song.delay || {};
    inst.dly = ctx.createDelay(2);
    inst.dly.delayTime.value = Math.min(1.9, (dl.beats || 0.75) * inst.spb);
    var fb = gainNode(ctx, inst.dly, dl.feedback !== undefined ? dl.feedback : 0.32);
    var dlp = lowpass(ctx, fb, dl.tone || 2800, 0.5);
    inst.dly.connect(dlp);
    inst.dly.connect(mix);
    inst.dlyIn = gainNode(ctx, inst.dly, 1);
    inst.tracks = {};
    var tracks = song.tracks || {};
    Object.keys(tracks).forEach(function (tn) {
      var tr = tracks[tn];
      var p = panNode(ctx, mix, tr.pan || 0);
      var tin = gainNode(ctx, p, tr.vol !== undefined ? tr.vol : 0.6);
      if (tr.rev) p.connect(gainNode(ctx, inst.revIn, tr.rev));
      if (tr.dly) p.connect(gainNode(ctx, inst.dlyIn, tr.dly));
      inst.tracks[tn] = { input: tin, def: tr };
    });
    if (!inst.tracks.drums) {
      var dp = gainNode(ctx, mix, 1);
      inst.tracks.drums = { input: gainNode(ctx, dp, 0.6), def: {} };
    }
    inst.idx = 0; inst.loopT = 0;
    return inst;
  }

  function fire(ctx, inst, ev, when) {
    var tr = inst.tracks[ev.drum ? 'drums' : ev.track];
    if (!tr) return;
    var def = tr.def, h = def.human !== undefined ? def.human : 0.005;
    var t = Math.max(ctx.currentTime, when + (h ? (Math.random() - 0.5) * 2 * h : 0));
    var vel = ev.vel * (1 + (Math.random() - 0.5) * 0.12);
    if (ev.drum) { DRUMS[ev.drum](ctx, tr.input, t, vel); return; }
    var fn = INSTRUMENTS[def.inst];
    if (!fn) return;
    var dur = ev.dur * inst.spb;
    var mids = Array.isArray(ev.midi) ? ev.midi : [ev.midi];
    var oct = def.octaveShift ? def.octaveShift * 12 : 0;
    for (var i = 0; i < mids.length; i++) {
      var st = def.strum ? i * def.strum : 0;
      fn(ctx, tr.input, mtof(mids[i] + oct), t + st, dur, vel * (mids.length > 1 ? 0.85 : 1), def);
    }
  }

  /* Schedule every event whose start falls before `until`. */
  function pump(ctx, inst, until) {
    if (!inst.events.length) return false;
    var loopSec = inst.beats * inst.spb;
    while (true) {
      if (inst.idx >= inst.events.length) {
        if (!inst.loop) return false;
        inst.idx = 0; inst.loopT += loopSec;
      }
      var ev = inst.events[inst.idx];
      var when = inst.t0 + inst.loopT + ev.b * inst.spb;
      if (when >= until) return true;
      if (when >= ctx.currentTime - 0.02 || inst.offline) fire(ctx, inst, ev, when);
      inst.idx++;
    }
  }

  function createPlayer(ctx, dest, popts) {
    popts = popts || {};
    /* 0.5 puts a typical full arrangement near -21 dBFS RMS before the
       game's music bus, close to the old chip tunes' loudness. */
    var out = ctx.createGain();
    out.gain.value = popts.level !== undefined ? popts.level : 0.5;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 3;
    comp.attack.value = 0.01; comp.release.value = 0.25;
    out.connect(comp); comp.connect(dest);
    var live = [], timer = null, current = null;

    function tick() {
      var look = (typeof document !== 'undefined' && document.hidden) ? 1.6 : 0.18;
      var now = ctx.currentTime;
      for (var i = live.length - 1; i >= 0; i--) {
        var inst = live[i];
        if (inst.dead) {
          if (now > inst.deadAt) { try { inst.fade.disconnect(); } catch (e) { /* gone */ } live.splice(i, 1); }
          continue;
        }
        /* Timer stalled (backgrounded tab, debugger): skip ahead, don't burst. */
        if (inst.t0 + inst.loopT + (inst.events[inst.idx] ? inst.events[inst.idx].b : inst.beats) * inst.spb < now - 0.25) resync(inst, now + 0.05);
        if (!pump(ctx, inst, now + look) && !inst.loop) {
          var endT = inst.t0 + inst.beats * inst.spb;
          if (now > endT) {
            inst.dead = true; inst.deadAt = now + 3;
            if (inst === current) current = null;
            if (inst.onEnd) inst.onEnd();
          }
        }
      }
      if (!live.length && timer) { clearInterval(timer); timer = null; }
    }
    function resync(inst, at) {
      var loopSec = inst.beats * inst.spb;
      var pos = (at - inst.t0) % loopSec;
      inst.loopT = at - inst.t0 - pos;
      inst.idx = 0;
      while (inst.idx < inst.events.length && inst.events[inst.idx].b * inst.spb < pos) inst.idx++;
    }
    function retire(inst, sec) {
      if (!inst || inst.dead) return;
      var now = ctx.currentTime;
      inst.fade.gain.cancelScheduledValues(now);
      inst.fade.gain.setValueAtTime(inst.fade.gain.value, now);
      inst.fade.gain.linearRampToValueAtTime(0, now + Math.max(0.02, sec));
      inst.dead = true; inst.deadAt = now + sec + 0.4;
    }

    var player = {
      play: function (song, o) {
        o = o || {};
        var fade = o.fade !== undefined ? o.fade : 0.8;
        if (current) retire(current, fade);
        var inst = buildInstance(ctx, out, song, o);
        var now = ctx.currentTime;
        inst.t0 = now + 0.06;
        inst.onEnd = o.onEnd || null;
        inst.fade.gain.setValueAtTime(0, now);
        inst.fade.gain.linearRampToValueAtTime(1, now + Math.max(0.03, o.fadeIn !== undefined ? o.fadeIn : (current ? fade : 0.05)));
        current = inst;
        live.push(inst);
        if (popts.offline) { inst.offline = true; return inst; }
        tick();
        if (!timer) timer = setInterval(tick, 25);
        return inst;
      },
      stop: function (sec) {
        if (current) retire(current, sec !== undefined ? sec : 0.4);
        current = null;
        if (popts.offline) return;
        if (!timer && live.length) timer = setInterval(tick, 25);
      },
      current: function () { return current ? current.name : null; },
      setLevel: function (v, sec) {
        var now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.linearRampToValueAtTime(v, now + (sec || 0.05));
      },
      output: out,
      _live: function () { return live.length; },
      _pumpAll: function (until) { for (var i = 0; i < live.length; i++) pump(ctx, live[i], until); }
    };
    return player;
  }

  /* ------------------------------------------------------------------ */
  function toFreq(x) { return typeof x === 'number' ? x : mtof(parseMidi(x)); }

  function voice(ctx, dest, inst, f, t, dur, vel, params) {
    var fn = INSTRUMENTS[inst];
    if (!fn || !ctx) return;
    fn(ctx, dest, toFreq(f), t === undefined ? ctx.currentTime : t, dur || 0.3, vel === undefined ? 0.8 : vel, params || {});
  }
  function drum(ctx, dest, kind, t, vel) {
    if (!DRUMS[kind] || !ctx) return;
    DRUMS[kind](ctx, dest, t === undefined ? ctx.currentTime : t, vel === undefined ? 0.8 : vel);
  }

  function render(song, seconds, o) {
    o = o || {};
    var sr = o.sampleRate || 44100;
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var ctx = new OAC(2, Math.ceil(sr * seconds), sr);
    var gain = ctx.createGain(); gain.gain.value = o.gain !== undefined ? o.gain : 1; gain.connect(ctx.destination);
    var pl = createPlayer(ctx, gain, { offline: true });
    pl.play(song, { transpose: o.transpose, tempoMul: o.tempoMul, loop: o.loop, fadeIn: 0.01, warn: o.warn });
    pl._pumpAll(seconds);
    return ctx.startRendering();
  }

  window.Game.music = {
    VERSION: '1.0.0',
    createPlayer: createPlayer,
    voice: voice,
    drum: drum,
    compile: compile,
    render: render,
    freq: toFreq,
    midi: parseMidi,
    INSTRUMENTS: INSTRUMENTS,
    DRUMS: DRUMS,
    /* building blocks for game-specific instruments registered from
       songs.js: Game.music.INSTRUMENTS.myInst = function (ctx, out, f, t, dur, vel, p) {...} */
    util: { osc: osc, gain: gainNode, adsr: adsr, ring: ring, vibrato: vibrato, lowpass: lowpass,
            wave: wave, noiseHit: noiseHit, noiseBuffer: function (ctx) { return res(ctx).noise; }, mtof: mtof }
  };
})();
