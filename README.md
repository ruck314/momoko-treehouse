# Momoko and Friends Tree House

A comfy building RPG. At the edge of a meadow stands one very big tree with no
house in it. **Momoko** walks down the path to the Acorn & Plank Trading Post,
where everything is free — but her bag only holds five things at a time. One
bagful at a time, she raises a platform, walls, a roof, a ladder, a door and
windows, then decorates the outside, furnishes four rooms inside, and finally
buys a piano and plays it.

Four friends move in as the house goes up, and you can design every one of them.

## Play

Open `index.html` in any modern browser. Works offline after the first visit (PWA).

## Controls

| Action                 | Keyboard          | Touch          |
|------------------------|-------------------|----------------|
| Walk                   | Arrow Keys / WASD | D-Pad (left)   |
| Shop / Build / Enter   | Space / Z         | DO Button      |
| Pause                  | Escape / P        | Pause Button   |
| Play piano             | `Z X C V B N M` and `Q W E R T Y U` (black keys `S D G H J` / `2 3 5 6 7`) | Tap the keys |
| Piano octave           | `,` and `.`       | − / + buttons  |

The piano is fully polyphonic — hold a chord with several fingers or several
keys, and slide a finger across the keyboard for a glissando.

## Features

- **Pure HTML5 Canvas + JavaScript** — no frameworks, no build tools, no assets
- **PWA** — install to home screen, works offline
- **Touch and desktop equally** — the canvas widens on touch devices so the
  D-pad sits in a side bezel instead of on top of the game
- **Dual language** — English and Japanese
- **All art generated in code** — no image files anywhere
- **A real playable piano** — Web Audio, two octaves, sustain on key-hold,
  plus a five-song songbook with Listen and Follow-along modes
- **Six build stages**, each costing exactly one bagful of materials
- **Exterior designer** — wall material, roof style, door, windows, colours and
  seven decorations
- **Four furnished rooms** — 24 pieces of furniture to buy, carry home and place
- **Five designable characters** — Momoko plus Lila, Kai, Nori and Poppy

## Build stages

Each stage needs exactly five material units, so each one is a single trip to
the shop and back. Leftover materials stay in the pile and count toward the
next stage — nothing is ever wasted.

| Stage | Needs | Moves in |
|-------|-------|----------|
| Platform | 3 plank, 2 rope | — |
| Walls | 3 plank, 2 nails | Lila |
| Roof | 2 beam, 3 shingle | Kai |
| Ladder | 3 rope, 2 plank | Nori |
| Door & Windows | 1 door, 2 window, 2 glass | Poppy |
| Finishing Touches | lantern, flower box, sign, bunting, wind chime | — |

## Tech Stack

- HTML5 Canvas for rendering
- Web Audio API for procedural sound and the piano voice
- Service Worker for offline caching
- `localStorage` for all save state
- Vanilla JavaScript (ES5 compatible)

## Project Structure

```
index.html          — entry point (meta tags, Back-to-Game-Center link)
css/style.css       — layout, rotate-hint, overlay styles
js/i18n.js          — English & Japanese translations
js/audio.js         — Web Audio engine, SFX, music, and the piano voice
js/input.js         — keyboard & touch; raw-pointer and key-capture hooks
js/levels.js        — ALL data: meadow, build stages, shop, rooms, friends, songs
js/entities.js      — characters, meadow scenery, material icons, particles
js/tree.js          — the tree and tree house, painted as independent layers
js/ui.js            — title, designer, shop, exterior, interiors, furniture
js/piano.js         — keyboard geometry, voices, songbook
js/engine.js        — game loop, state machine, camera, delivery, persistence
js/pwa.js           — service worker registration
sw.js               — service worker
manifest.json       — PWA manifest
```

## Save data

All state lives in `localStorage` under the `momoko-treehouse-` prefix:
`customization`, `friends`, `build`, `exterior`, `rooms`, `stock`, `flags`,
`settings`.

**Every game on `ruck314.github.io` shares one localStorage origin.** Keys must
stay namespaced per game — the animal-hotel game kept the space game's
`momoko-space-*` keys when it was forked, and the two now overwrite each
other's customization and quest state. `js/engine.js` routes every read and
write through a single `KEY()` helper so that can't happen here.

## Adding content

- **A material**: add it to `Game.MATERIALS` in `js/levels.js`, add an icon case
  to `drawMaterialIcon()` in `js/entities.js`, and add a `mat_<type>` string to
  `js/i18n.js` (EN + JA).
- **A furniture piece**: add it to `Game.FURNITURE_TYPES` with a category, add a
  case to `drawFurniture()` in `js/ui.js`, and add a `furniture_<type>` string.
- **A build stage**: push an entry onto `Game.BUILD_STAGES` (needs must total 5),
  add a matching layer painter to `LAYERS` in `js/tree.js`, list it in
  `PAINT_ORDER`, and add a `stage_<id>` string.
- **A song**: push `{ id, titleKey, tempo, notes, beats }` onto `Game.SONGS`.
  `notes` and `beats` must be the same length, and every note must fall inside
  C4–B5 so it is reachable on the default keyboard.

## Releasing

Bump all three together, then tag:

1. `Game.VERSION` in `js/engine.js`
2. `CACHE_NAME` in `sw.js`
3. `git tag vX.Y.Z`

If you add a JS file, also add it to `ASSETS[]` in `sw.js` or it won't be
cached for offline play.

## License

MIT License — Copyright (c) 2026 ruck314

Made with love for Momoko.
