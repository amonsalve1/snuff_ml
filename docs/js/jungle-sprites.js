// pixel art for the survivor island backdrop. pure data, no logic.
// same house format as the farm sprites: arrays of equal length strings,
// one char per pixel, '.' is transparent, every other char indexes PALETTE.
//
// keep rows the same length inside a sprite or the blitter walks off the edge.

/**
 * warm island palette. single char keys, one hex each.
 * the sand and water tones are here for the ground and lagoon the scene
 * fills itself, so a few of them never show up in the sprites below.
 */
export const PALETTE = {
  // foliage, dark to light
  G: '#1e3b26', // deepest shade under the crown
  g: '#2f5c33', // frond shadow
  h: '#417a3d', // mid leaf
  j: '#5c9b45', // lit leaf
  k: '#84bf5a', // sun on the top edge

  // wood, trunks, thatch
  b: '#3a2418', // dark bark, the shadow side of everything wooden
  w: '#5c3a22', // trunk body
  W: '#7d5330', // trunk lit side
  v: '#a3773f', // dry frond / thatch
  V: '#c9a05c', // pale thatch

  // sand
  s: '#c9a76b', // sand
  S: '#a9854f', // sand shadow
  d: '#e7d3a1', // bleached sand, also sun on thatch and cut wood

  // rock
  r: '#4a4a4a', // rock shadow
  R: '#6e6b64', // rock body
  n: '#918d83', // rock lit side

  // flame, cold end to hot core
  e: '#7a2a0c', // ember / char
  f: '#e0521a', // flame orange
  F: '#f79c2a', // flame amber
  y: '#ffd24a', // flame yellow
  c: '#fff3cf', // flame core

  // water
  a: '#1c4f6b', // deep lagoon
  A: '#2f7fa0', // lagoon
  z: '#6fc0d1', // shallows and foam

  // odds
  m: '#6a6a6a', // smoke
  o: '#221a12', // ink, used for the dark inside of the hut
}

/**
 * the sprites. lit from the upper left already, so they read fine
 * before the lighting pass touches them.
 */
export const SPRITES = {
  // 26x40. tall palm, crown leaning right, trunk curving back to the left.
  PALM: [
    '.........jkkh.............',
    '...kjh...jhhg...kjjh......',
    '..kjjhg..jhhg..kjjhhg.....',
    '.kjjhhg..jhgg.jjhhggg.....',
    '..jjhhgg.jhgg.jhhggg......',
    '...jhhgghjhhggjh.hhgg.....',
    'kj..jhhggjhhhhggghg..jh...',
    '.jhhgg.hhhhhhggghhggg.jhg.',
    '..ghhgggGhhhggGgghggg.hgG.',
    '..ghG.gGhhhggGhgg.ghgG....',
    '.ghG...gGhhggGhgG..ghG....',
    'ghG.....gGhhggGg....ghG...',
    'G.......gGggggG......Ggh..',
    '.........GGWwbGG......G...',
    '...........Wwb............',
    '...........Wwb............',
    '...........vvw............',
    '..........Wwb.............',
    '..........Wwb.............',
    '..........vvw.............',
    '..........Wwb.............',
    '.........Wwb..............',
    '.........vvw..............',
    '.........Wwb..............',
    '.........Wwb..............',
    '........vvvw..............',
    '........WWwb..............',
    '........WWwb..............',
    '........vvvw..............',
    '.......WWwb...............',
    '.......WWwb...............',
    '.......vvvw...............',
    '.......WWwb...............',
    '.......WWwb...............',
    '......WWwwb...............',
    '......vvvww...............',
    '......WWwwb...............',
    '......WWwwb...............',
    '.....WWwwwbb..............',
    '....WWwwwwbbb.............',
  ],

  // 24x36. shorter and fatter, droops harder, leans the other way.
  // put this next to PALM so a treeline does not look tiled.
  PALM_ALT: [
    '........jkkj............',
    '.....kjh.jhhg.hjk.......',
    '...kjjhg.jhhg.jhhgk.....',
    '..kjjhhgjhhhgjhhggk.....',
    '.kjjhhggjhhhgjhhggjhk...',
    'kjhhgg.hhhhhgghhgg.jhgk.',
    '.ghhgggGhhhhggGghgg.jhgk',
    '..ghgG.gGhhhggGgg.ghggGk',
    '..ghG..gGhhhgGg...ghggG.',
    '.ghG....gGhhgGg....ghgG.',
    'ghG......gGhgGg.....ghG.',
    'G........gGhgG.......gG.',
    '.........GWwbG.......G..',
    '..........Wwb...........',
    '..........vvw...........',
    '..........Wwb...........',
    '...........Wwb..........',
    '...........Wwb..........',
    '...........vvw..........',
    '...........Wwb..........',
    '............Wwb.........',
    '............vvw.........',
    '............Wwb.........',
    '............WWwb........',
    '.............vvvw.......',
    '.............WWwb.......',
    '.............WWwb.......',
    '.............vvvw.......',
    '..............WWwb......',
    '..............WWwb......',
    '..............WWwwb.....',
    '..............vvvww.....',
    '..............WWwwb.....',
    '..............WWwwb.....',
    '.............WWwwwbb....',
    '............WWwwwwbbb...',
  ],

  // 14x10. low bush, fronds fanning out of one clump.
  FERN: [
    '..k....k...k..',
    '.kj...kj..jk..',
    '.jh..jjh.jhj..',
    'jhg.jhhg.jhgj.',
    'jhgjjhhgjjhggj',
    '.hggjhhggjhggG',
    '..gGghhgghgGG.',
    '...gGghhggGG..',
    '....GgghgGG...',
    '.....GGgGG....',
  ],

  // 9x20. survivor torch. rows 8 and down are the rag head and the stake and
  // are byte for byte identical across all three torch sprites, so only the
  // flame moves when you cross fade A and B.
  TORCH_LIT_A: [
    '....y....',
    '...yFy...',
    '..yFcFy..',
    '..yFcFy..',
    '.fFcccFy.',
    '.fFccFff.',
    '..ffFff..',
    '..efFfe..',
    '..vVvVv..',
    '..vVVVv..',
    '..bvVvb..',
    '..bvvvb..',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...wbb...',
  ],

  // 9x20. same torch, flame licking left.
  TORCH_LIT_B: [
    '...y.....',
    '..yFy....',
    '..yFcy...',
    '.yFccFy..',
    '.fFcccfy.',
    '.ffFccFf.',
    '..fFffe..',
    '..efFfe..',
    '..vVvVv..',
    '..vVVVv..',
    '..bvVvb..',
    '..bvvvb..',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...wbb...',
  ],

  // 9x20. snuffed. charred top and a thread of smoke.
  TORCH_OUT: [
    '.........',
    '.........',
    '.....m...',
    '....m....',
    '....m....',
    '...m.....',
    '.........',
    '...bbb...',
    '..vVvVv..',
    '..vVVVv..',
    '..bvVvb..',
    '..bvvvb..',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...Wwb...',
    '...wbb...',
  ],

  // 11x7. round boulder, light on the top left.
  ROCK: [
    '...nnnn....',
    '..nnnnnRR..',
    '.nnnnnRRRr.',
    'nnnnnRRRRrr',
    'nnnRRRRrrrr',
    '.RRRRrrrrr.',
    '..rrrrrrr..',
  ],

  // 16x6. driftwood log, cut end and rings on the left.
  LOG: [
    '.wWWWWWWWWWWWw..',
    'wWWdvWWWWWWWWWw.',
    'wWvdvwwwwwwwwwWw',
    'wWvvvwwwwwwwwwww',
    'wWWwwwwwwwwwwwbw',
    '.wwbbbbbbbbbbbb.',
  ],

  // 30x20. lean to shelter, palm thatch over four poles, a bench inside.
  HUT: [
    '..............dd..............',
    '............vdVVdv............',
    '..........vvVVvvVVvv..........',
    '........vvVVvvVVvvVVvv........',
    '......vVVvvVVvvVVvvVVvVv......',
    '....vvVVvvVVvvVVvvVVvvVVvv....',
    '..vVvvVVvvVVvvVVvvVVvvVVvvVv..',
    'vvVVvvVVvvVVvvVVvvVVvvVVvvVVvv',
    'wWwwWWwwWWwwWWwwWWwwWWwwWWwwWw',
    '.bbbbbbbbbbbbbbbbbbbbbbbbbbbb.',
    '...Ww....................Ww...',
    '...Ww....................Ww...',
    '...Ww....GoGoGoGoGoGo....Ww...',
    '...Ww....oGoGoGoGoGoG....Ww...',
    '...Ww....GoGoGoGoGoGo....Ww...',
    '...Ww....oGoGoGoGoGoG....Ww...',
    '...Ww....................Ww...',
    '...Ww....wWWWWWWWWw......Ww...',
    '...Ww....wwwwwwwwww......Ww...',
    '..WWww....w......w......WWww..',
  ],

  // 8x5. little tuft to break up bare sand.
  GRASS: [
    '...k....',
    '.k.j.k..',
    'kj.jh.jk',
    '.jhjhgjh',
    '..gGgGg.',
  ],
}

/**
 * how round each sprite is, 0 flat to 1 fully modelled. the lighting engine
 * multiplies its shading term by this, so flat stuff stays flat.
 * the torches sit low on purpose: the flame is baked art and must not get
 * darkened by a light that is nowhere near it.
 */
export const RELIEF = {
  PALM: 0.85,
  PALM_ALT: 0.85,
  FERN: 0.35,
  TORCH_LIT_A: 0.1,
  TORCH_LIT_B: 0.1,
  TORCH_OUT: 0.3,
  ROCK: 0.9,
  LOG: 0.8,
  HUT: 0.55,
  GRASS: 0.15,
}
