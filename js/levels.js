/* levels.js – pure data tables. No drawing, no state mutation.
 *
 * Everything the designer might want to retune lives here: the meadow
 * layout, the build-stage recipes, the shop catalog, the rooms, the
 * friends and the songbook.
 */
(function () {
  'use strict';
  window.Game = window.Game || {};

  /* ---- Shared woodland palette ----
     Referenced by every painter so a re-tint is a change in one place. */
  Game.PAL = {
    barkDark: '#5a3c22',
    bark: '#6b4a2f',
    barkLight: '#8a6340',
    leafDark: '#3b6b2a',
    leaf: '#4e8f3c',
    leafLight: '#7bc45a',
    cream: '#fff4dc',
    creamDark: '#e8cfa8',
    sky: '#bfe6f2',
    skyDeep: '#8fd0e8',
    peach: '#ff9ec4',
    sun: '#ffd24a',
    ink: '#4a3320',      /* the universal outline colour */
    grass: '#6cb04a',
    grassDark: '#4b8433',
    soil: '#7a5834',
  };

  /* ---- Meadow ----
     One side-view level. Ground is flat; GROUND_Y is where feet land.
     Everything x-positioned here is in world space. */
  Game.MEADOW = {
    width: 2600,
    groundY: 400,
    playerStart: { x: 940, y: 400 },
    shop: { x: 330, doorX: 330, w: 300, h: 220 },
    tree: { x: 2080, groundY: 400 },
    paintPost: { x: 1880 },
    /* Background scenery, painted back-to-front. Type dispatch lives in
       entities.js drawMeadowDecor(). */
    decor: [
      { type: 'hill', x: 200, y: 400, w: 520, h: 120 },
      { type: 'hill', x: 1150, y: 400, w: 700, h: 160 },
      { type: 'hill', x: 2250, y: 400, w: 560, h: 130 },
      { type: 'bgTree', x: 700, y: 400, scale: 0.55 },
      { type: 'bgTree', x: 1010, y: 400, scale: 0.42 },
      { type: 'bgTree', x: 1520, y: 400, scale: 0.6 },
      { type: 'bgTree', x: 1720, y: 400, scale: 0.38 },
      { type: 'bgTree', x: 2400, y: 400, scale: 0.5 },
      { type: 'bush', x: 560, y: 400 },
      { type: 'bush', x: 860, y: 400 },
      { type: 'bush', x: 1300, y: 400 },
      { type: 'bush', x: 1620, y: 400 },
      { type: 'bush', x: 2300, y: 400 },
      { type: 'stump', x: 1120, y: 400 },
      { type: 'stump', x: 1960, y: 400 },
      { type: 'rock', x: 780, y: 400 },
      { type: 'rock', x: 1450, y: 400 },
      { type: 'rock', x: 2200, y: 400 },
      { type: 'flowers', x: 480, y: 400, n: 5 },
      { type: 'flowers', x: 660, y: 400, n: 4 },
      { type: 'flowers', x: 900, y: 400, n: 6 },
      { type: 'flowers', x: 1240, y: 400, n: 5 },
      { type: 'flowers', x: 1400, y: 400, n: 4 },
      { type: 'flowers', x: 1680, y: 400, n: 6 },
      { type: 'flowers', x: 1840, y: 400, n: 4 },
      { type: 'flowers', x: 2250, y: 400, n: 5 },
      { type: 'mushroom', x: 1050, y: 400 },
      { type: 'mushroom', x: 1560, y: 400 },
      { type: 'signpost', x: 720, y: 400 },
    ],
  };

  /* ---- Materials ----
     `icon` selects the painter in entities.js drawMaterialIcon(). */
  Game.MATERIALS = [
    { type: 'plank',     icon: 'plank' },
    { type: 'rope',      icon: 'rope' },
    { type: 'nail',      icon: 'nail' },
    { type: 'beam',      icon: 'beam' },
    { type: 'shingle',   icon: 'shingle' },
    { type: 'door',      icon: 'door' },
    { type: 'window',    icon: 'window' },
    { type: 'glass',     icon: 'glass' },
    { type: 'lantern',   icon: 'lantern' },
    { type: 'flowerBox', icon: 'flowerBox' },
    { type: 'sign',      icon: 'sign' },
    { type: 'bunting',   icon: 'bunting' },
    { type: 'windChime', icon: 'windChime' },
  ];

  /* ---- Build stages ----
   * Every stage costs exactly 5 material units: one full bag, one trip.
   * That is what makes the 5-item limit the pacing mechanism rather than
   * an obstacle.
   *
   *   id       – i18n key is 'stage_<id>'; tree.js paints layer of the same name
   *   needs    – { <materialType>: count }, always summing to 5
   *   unlocks  – friend id that moves in on completion (null for none)
   *   grants   – flag names flipped true on completion
   */
  Game.BUILD_STAGES = [
    { id: 'platform', needs: { plank: 3, rope: 2 },                unlocks: null,    grants: [] },
    { id: 'walls',    needs: { plank: 3, nail: 2 },                unlocks: 'lila',  grants: [] },
    { id: 'roof',     needs: { beam: 2, shingle: 3 },              unlocks: 'kai',   grants: [] },
    { id: 'ladder',   needs: { rope: 3, plank: 2 },                unlocks: 'nori',  grants: [] },
    { id: 'openings', needs: { door: 1, window: 2, glass: 2 },     unlocks: 'poppy', grants: ['canEnter'] },
    { id: 'extras',   needs: { lantern: 1, flowerBox: 1, sign: 1, bunting: 1, windChime: 1 },
                                                                   unlocks: null,    grants: ['canDecorate'] },
  ];

  /* ---- Furniture ----
     24 pieces in 6 categories. The piano is NOT here – it lives in the
     shop's special tab – but drawFurniture() still knows how to paint it. */
  Game.FURNITURE_CATEGORIES = ['sleep', 'seat', 'table', 'light', 'decor', 'fun'];
  Game.FURNITURE_TYPES = [
    { type: 'bed',         cat: 'sleep' },
    { type: 'bunkBed',     cat: 'sleep' },
    { type: 'hammock',     cat: 'sleep' },
    { type: 'cushion',     cat: 'sleep' },
    { type: 'chair',       cat: 'seat' },
    { type: 'stool',       cat: 'seat' },
    { type: 'sofa',        cat: 'seat' },
    { type: 'beanbag',     cat: 'seat' },
    { type: 'table',       cat: 'table' },
    { type: 'coffeeTable', cat: 'table' },
    { type: 'desk',        cat: 'table' },
    { type: 'shelf',       cat: 'table' },
    { type: 'fridge',      cat: 'table' },
    { type: 'lamp',        cat: 'light' },
    { type: 'lantern',     cat: 'light' },
    { type: 'candle',      cat: 'light' },
    { type: 'fireplace',   cat: 'light' },
    { type: 'rug',         cat: 'decor' },
    { type: 'painting',    cat: 'decor' },
    { type: 'mirror',      cat: 'decor' },
    { type: 'plant',       cat: 'decor' },
    { type: 'clock',       cat: 'fun' },
    { type: 'teaSet',      cat: 'fun' },
    { type: 'toybox',      cat: 'fun' },
    { type: 'easel',       cat: 'fun' },
    { type: 'discoBall',   cat: 'fun' },
  ];

  /* Furniture every room starts with, so no room is ever a bare box and it
     is obvious what a furnished room is supposed to look like. Applied once
     per save (see the starterFurniture flag in engine.js) and only to rooms
     that are still empty, so it can never overwrite the player's own work. */
  Game.STARTER_FURNITURE = {
    main: [],
    bed: [
      { type: 'bed', x: 190, y: 330, flip: false },
    ],
    kitchen: [
      { type: 'table', x: 420, y: 336, flip: false },
      { type: 'fridge', x: 680, y: 330, flip: false },
    ],
    music: [
      { type: 'discoBall', x: 400, y: 300, flip: false },
    ],
  };

  /* ---- Rooms ---- */
  Game.ROOMS = [
    { id: 'main',    nameKey: 'roomMain',    wallA: '#f2dcb4', wallB: '#d9b984', floor: '#a9773f', accent: '#7bc45a' },
    { id: 'bed',     nameKey: 'roomBed',     wallA: '#e8d4ea', wallB: '#c9a9cf', floor: '#9a6b4a', accent: '#ff9ec4' },
    { id: 'kitchen', nameKey: 'roomKitchen', wallA: '#d8ecd4', wallB: '#a9cfa4', floor: '#b08a52', accent: '#ffd24a' },
    { id: 'music',   nameKey: 'roomMusic',   wallA: '#dfe4f2', wallB: '#b2bcd9', floor: '#8f6238', accent: '#8fd0e8' },
  ];

  /* ---- Exterior customization ----
     Tabs mirror the character designer so both screens share layout code. */
  Game.EXT_WALL_COLORS = ['#d9a066', '#c98a5e', '#e8cfa8', '#a8c98a', '#e8a0a8', '#9ab8d8'];
  Game.EXT_ROOF_COLORS = ['#c05a48', '#4e8f3c', '#5a7fb0', '#d1892f', '#8a6340', '#b06aa8'];
  Game.EXT_TRIM_COLORS = ['#fff4dc', '#ffd24a', '#7bc45a', '#ff9ec4', '#8fd0e8', '#6b4a2f'];

  Game.EXT_TABS = [
    { id: 'wall',   labelKey: 'extTabWall',   field: 'wallMat',     colorField: 'wallColor', colors: Game.EXT_WALL_COLORS,
      variants: ['plank', 'log', 'shingle', 'stucco'], labelPrefix: 'wall_' },
    { id: 'roof',   labelKey: 'extTabRoof',   field: 'roofStyle',   colorField: 'roofColor', colors: Game.EXT_ROOF_COLORS,
      variants: ['gable', 'round', 'thatch', 'garden'], labelPrefix: 'roof_' },
    { id: 'door',   labelKey: 'extTabDoor',   field: 'door',        colorField: 'trimColor', colors: Game.EXT_TRIM_COLORS,
      variants: ['round', 'arched', 'dutch', 'heart'], labelPrefix: 'door_' },
    { id: 'window', labelKey: 'extTabWindow', field: 'windowStyle', colorField: null, colors: null,
      variants: ['square', 'round', 'diamond', 'bay'], labelPrefix: 'win_' },
    { id: 'decor',  labelKey: 'extTabDecor',  field: null,          colorField: null, colors: null,
      toggles: ['flowerBox', 'lantern', 'sign', 'bunting', 'windChime', 'birdhouse', 'swing'], labelPrefix: 'decor_' },
  ];

  Game.EXT_DEFAULT = {
    wallMat: 'plank', wallColor: '#d9a066',
    roofStyle: 'gable', roofColor: '#c05a48',
    door: 'round', trimColor: '#fff4dc',
    windowStyle: 'square',
    decor: { flowerBox: true, lantern: true, sign: true, bunting: true,
             windChime: true, birdhouse: false, swing: false },
  };

  /* ---- Character designer ----
     `field` names the key written into the character record; `colorField`
     optionally enables a swatch row underneath the variant grid. */
  Game.SKIN_COLORS   = ['#ffddbb', '#f6c9a0', '#e0a878', '#c58a5c', '#9c6b45', '#7a4f31'];
  Game.HAIR_COLORS   = ['#e06088', '#4a3728', '#f5d060', '#4488ff', '#222222', '#b8622f'];
  Game.OUTFIT_COLORS = ['#ff9ec4', '#7bc45a', '#8fd0e8', '#ffd24a', '#b06aa8', '#e8734a'];
  Game.SHOE_COLORS   = ['#c05a48', '#4a3728', '#fff4dc', '#4e8f3c', '#5a7fb0', '#ffd24a'];

  Game.CUSTOM_TABS = [
    { id: 'hair',   labelKey: 'tabHair',   field: 'hairStyle', colorField: 'hair',        colors: Game.HAIR_COLORS,
      variants: ['twinTails', 'longBraids', 'buns', 'bob', 'ponytail'], labelPrefix: 'hair_' },
    { id: 'outfit', labelKey: 'tabOutfit', field: 'outfit',    colorField: 'outfitColor', colors: Game.OUTFIT_COLORS,
      variants: ['frillyDress', 'sailorDress', 'starDress', 'overalls', 'sweater'], labelPrefix: 'outfit_' },
    { id: 'shoes',  labelKey: 'tabShoes',  field: 'shoes',     colorField: 'shoeColor',   colors: Game.SHOE_COLORS,
      variants: ['maryJane', 'sneaker', 'boots'], labelPrefix: 'shoes_' },
    { id: 'hat',    labelKey: 'tabHat',    field: 'hat',       colorField: null, colors: null,
      variants: ['none', 'strawHat', 'beret', 'flowerCrown'], labelPrefix: 'hat_' },
    { id: 'extra',  labelKey: 'tabExtra',  field: 'accessory', colorField: null, colors: null,
      variants: ['none', 'scarf', 'backpack', 'ribbon'], labelPrefix: 'acc_' },
    { id: 'skin',   labelKey: 'tabSkin',   field: null,        colorField: 'skin',        colors: Game.SKIN_COLORS,
      variants: [], labelPrefix: '' },
  ];

  Game.MOMOKO_DEFAULT = {
    skin: '#ffddbb', hair: '#e06088', outfitColor: '#ff9ec4', shoeColor: '#c05a48',
    hairStyle: 'twinTails', outfit: 'frillyDress', shoes: 'maryJane',
    hat: 'none', accessory: 'none',
  };

  /* ---- Friends ----
     One unlocks per build stage 2-5 (see BUILD_STAGES.unlocks), so the
     house filling up is the reward for building it. */
  Game.FRIEND_DEFS = [
    { id: 'lila',  nameKey: 'friend_lila',  homeRoom: 'main',    meadowX: 1180, greetKey: 'greet_lila',
      defaultCust: { skin: '#f6c9a0', hair: '#4a3728', outfitColor: '#7bc45a', shoeColor: '#4a3728',
                     hairStyle: 'longBraids', outfit: 'overalls', shoes: 'boots', hat: 'strawHat', accessory: 'none' } },
    { id: 'kai',   nameKey: 'friend_kai',   homeRoom: 'kitchen', meadowX: 1480, greetKey: 'greet_kai',
      defaultCust: { skin: '#c58a5c', hair: '#222222', outfitColor: '#8fd0e8', shoeColor: '#fff4dc',
                     hairStyle: 'bob', outfit: 'sweater', shoes: 'sneaker', hat: 'none', accessory: 'backpack' } },
    { id: 'nori',  nameKey: 'friend_nori',  homeRoom: 'bed',     meadowX: 1720, greetKey: 'greet_nori',
      defaultCust: { skin: '#e0a878', hair: '#f5d060', outfitColor: '#ffd24a', shoeColor: '#4e8f3c',
                     hairStyle: 'buns', outfit: 'sailorDress', shoes: 'maryJane', hat: 'none', accessory: 'ribbon' } },
    { id: 'poppy', nameKey: 'friend_poppy', homeRoom: 'music',   meadowX: 800,  greetKey: 'greet_poppy',
      defaultCust: { skin: '#9c6b45', hair: '#b8622f', outfitColor: '#b06aa8', shoeColor: '#5a7fb0',
                     hairStyle: 'ponytail', outfit: 'starDress', shoes: 'sneaker', hat: 'beret', accessory: 'scarf' } },
  ];

  /* ---- Songbook ----
     Note names are parsed by piano.js. `beats` is a parallel array; one
     beat is a quarter note. Every melody stays on white keys so Follow
     mode is reachable for a small player. */
  Game.SONGS = [
    {
      id: 'twinkle', titleKey: 'song_twinkle', tempo: 108,
      notes: ['C4','C4','G4','G4','A4','A4','G4','F4','F4','E4','E4','D4','D4','C4',
              'G4','G4','F4','F4','E4','E4','D4','G4','G4','F4','F4','E4','E4','D4',
              'C4','C4','G4','G4','A4','A4','G4','F4','F4','E4','E4','D4','D4','C4'],
      beats: [1,1,1,1,1,1,2, 1,1,1,1,1,1,2,
              1,1,1,1,1,1,2, 1,1,1,1,1,1,2,
              1,1,1,1,1,1,2, 1,1,1,1,1,1,2],
    },
    {
      id: 'mary', titleKey: 'song_mary', tempo: 112,
      notes: ['E4','D4','C4','D4','E4','E4','E4','D4','D4','D4','E4','G4','G4',
              'E4','D4','C4','D4','E4','E4','E4','E4','D4','D4','E4','D4','C4'],
      beats: [1,1,1,1,1,1,2, 1,1,2, 1,1,2,
              1,1,1,1,1,1,1,1,1,1,1,1,2],
    },
    {
      id: 'joy', titleKey: 'song_joy', tempo: 116,
      notes: ['E4','E4','F4','G4','G4','F4','E4','D4','C4','C4','D4','E4','E4','D4','D4',
              'E4','E4','F4','G4','G4','F4','E4','D4','C4','C4','D4','E4','D4','C4'],
      beats: [1,1,1,1,1,1,1,1,1,1,1,1,1.5,0.5,2,
              1,1,1,1,1,1,1,1,1,1,1,1.5,0.5,2],
    },
    {
      /* Sits an octave above concert pitch so the whole melody – including
         the low "ding dang dong" – fits the C4-B5 keyboard. */
      id: 'frere', titleKey: 'song_frere', tempo: 104,
      notes: ['C5','D5','E5','C5','C5','D5','E5','C5',
              'E5','F5','G5','E5','F5','G5',
              'G5','A5','G5','F5','E5','C5','G5','A5','G5','F5','E5','C5',
              'C5','G4','C5','C5','G4','C5'],
      beats: [1,1,1,1,1,1,1,1,
              1,1,2,1,1,2,
              0.5,0.5,0.5,0.5,1,1, 0.5,0.5,0.5,0.5,1,1,
              1,1,2,1,1,2],
    },
    {
      id: 'sakura', titleKey: 'song_sakura', tempo: 84,
      notes: ['A4','A4','B4','A4','A4','B4',
              'A4','B4','C5','B4','A4','B4','A4','F4','E4',
              'F4','E4','F4','A4','B4','A4','A4','B4','A4'],
      beats: [1,1,2,1,1,2,
              1,1,1,1,1,1,1,1,2,
              1,1,1,1,1,2,1,1,2],
    },
  ];
})();
