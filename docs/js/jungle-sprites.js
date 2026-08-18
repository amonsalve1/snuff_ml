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

  // new growth and dry stalk, brighter than the greens above
  K: '#a3d16a', // brightest leaf, bamboo and banana catching the sun
  u: '#c3cf74', // pale straw green, bamboo stalk body

  // flowers
  M: '#b8325f', // petal shadow
  N: '#ef6f9b', // petal

  // cloth, for the flag
  C: '#8f2f2c', // deep fold
  D: '#c4503c', // cloth
  E: '#e88a63', // sun on the cloth

  // fired clay, pot and jug
  T: '#5e2f21', // clay shadow
  U: '#8a4a2e', // clay
  Q: '#b57446', // clay lit side

  // fish hung to dry, gone brown
  H: '#7d5a4e', // shaded flank
  J: '#a8836b', // flank
  X: '#d6b492', // lit flank

  // shell
  Y: '#f6ead9', // pale rib
  Z: '#d8b6a5', // shell shadow
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

  // 30x52. the big one. crown of eight fronds, trunk leaning left
  // the whole way down with old frond scars ringing it.
  PALM_TALL: [
    '.............jkkj.............',
    '......kjh....jhhg....hjk......',
    '....kjjhhg...jhhg...kjhhg.....',
    '..kjjhhggg...jhgg..kjhhggg....',
    '.kjjhhgg.....jhgg..jhhgggg....',
    'kjjhhgg......jhgg.kjhhgg......',
    '.jhhgg...kj..jhgg.jhhgg...kj..',
    '..hhgg..kjjh.jhgg.jhhg...kjhh.',
    'kj.hgg.jjhhhgjhggjhhgg..jhhhgk',
    '.jhggg.jhhhhggjhgjhhgg.jhhhggg',
    '..ghhggjhhhhhgghhgghhgghhhhgg.',
    '...ghgg.gGhhhhgghhgghhgg.hhgg.',
    'kj..ghg..gGhhhgghhgghhg..hgg..',
    '.jhggG....gGhhgghhgghgG.hgG...',
    '..gGG......gGhhgghhggG.hgG....',
    '...G........gGhhgghgG.hgG.....',
    '.............gGhhgghgGG.......',
    '............GGgWwbGgG.........',
    '...............Wwb............',
    '...............Wwb............',
    '...............Wwb............',
    '..............vvw.............',
    '..............Wwb.............',
    '..............Wwb.............',
    '..............Wwb.............',
    '..............vvw.............',
    '.............Wwb..............',
    '.............Wwb..............',
    '.............Wwb..............',
    '.............vvw..............',
    '............Wwb...............',
    '............Wwb...............',
    '............Wwb...............',
    '............vvvw..............',
    '............WWwb..............',
    '...........WWwb...............',
    '...........WWwb...............',
    '...........vvvw...............',
    '...........WWwb...............',
    '...........WWwb...............',
    '..........WWwb................',
    '..........vvvvw...............',
    '..........WWwwb...............',
    '..........WWwwb...............',
    '.........WWwwb................',
    '.........vvvvw................',
    '.........WWwwb................',
    '.........WWwwbb...............',
    '.........WWwwbb...............',
    '........vvvvvw................',
    '........WWwwbb................',
    '........WWwwbb................',
  ],

  // 34x34. leans hard out over the water, root at the bottom right
  // and the crown almost at the far edge. reads as a different tree.
  PALM_BENT: [
    '........jkkj......................',
    '..kjh...jhhg...hjk................',
    '.kjjhg..jhhg..kjhhg...............',
    'kjjhhgg.jhgg.kjhhggg..............',
    '.jhhgg..jhgg.jhhggg...............',
    '..hhgg.kjhgg.jhhg..kj.............',
    'kjhhg.jjhhggjhhgg.kjh.............',
    '.jhggjjhhhggjhhgg.jhh.............',
    '..ghggjhhhhgghhgghhgg.............',
    '...ghgghhhhgghhgghhgg.............',
    'kj..gGgGhhhgghhgghhgG.............',
    '.jhgG..gGghhgghhgghgG.............',
    '..gG....gGghhgghhggG..............',
    '.........GGghhgghgG...............',
    '...........Wwwb...................',
    '............Wwwb..................',
    '............Wwwb..................',
    '.............Wwwb.................',
    '..............vvvw................',
    '...............Wwwb...............',
    '................Wwwb..............',
    '.................Wwwb.............',
    '..................Wwwb............',
    '...................Wwwb...........',
    '....................vvvw..........',
    '.....................Wwwb.........',
    '......................WWwwb.......',
    '.......................WWwwb......',
    '........................WWwwb.....',
    '.........................WWwwb....',
    '..........................vvvw....',
    '..........................WWwwbb..',
    '..........................WWwwbb..',
    '.........................WWwwwbbb.',
  ],

  // 22x24. palmetto. leaflets off one fused heart, tips notched apart,
  // squat trunk. good filler where a tall palm would be too much.
  FAN_PALM: [
    '..........j.j.........',
    '........kjj.jjh.......',
    '....kkk.kjj.jjh.hhh...',
    '....kkk.kjj.jjh.hhh...',
    '..k.kkkk.hh.hh.hhhh.h.',
    '.kkk.kjj.hhghh.ggh.hhh',
    'kkkkk.jjhhhghhGgg.hhhh',
    '..kkjjhjjghghgggGgghh.',
    '...jjjhjjghghgggGggg..',
    '....hjjhjhhghhgGggG...',
    '...jjhjjhhhghhGggGg...',
    '.....hhghGGGGGGGG.....',
    '......hhhggGggGG......',
    '........gggGgg........',
    '..........Wwwb........',
    '..........Wwwb........',
    '.........vvvw.........',
    '..........Wwwb........',
    '..........Wwwb........',
    '........vvvw..........',
    '.........Wwwb.........',
    '.........Wwwb.........',
    '........vvvw..........',
    '........WWwwb.........',
  ],

  // 20x26. four broad paddles with real gaps between them, a fat
  // pseudostem and a hand of green fruit tucked under the crown.
  BANANA: [
    '..kjghhg....jhggG...',
    '..kjhhhg...jhhgggG..',
    '..kjjghhg..jhhgggG..',
    '...kjhhhg..jhgggG...',
    '...kjghhg..jhgggG...',
    '....kjhhhgjhhgggjggG',
    'kghg.kjghgjhgggjhggG',
    'kjhhgkjhhgjhggjhgggG',
    '.kjghgkghgjhgjhgggG.',
    '..kjhhgjhhgjgjhggG..',
    '...kjghgghgjjhggG...',
    '....kjhhghgjjggG....',
    '.....kjghggjggG.....',
    '.......jhhggG.......',
    '.......jhhggG.......',
    '.......khhjgKKu.....',
    '.......jhhgKuKuh....',
    '.......jhhguKuhh....',
    '.......jhhgguuhh....',
    '.......jhhggG.......',
    '.......khhjgg.......',
    '.......jhhggG.......',
    '.......jhhggG.......',
    '.......jhhggG.......',
    '......jjhhgggG......',
    '......ghhggggG......',
  ],

  // 12x40. clump of three stalks, node bands every few rows and a
  // few leaf sprigs. pale enough to read against dark jungle.
  BAMBOO: [
    '.....Kuh....',
    '.....Kuh....',
    '...kjKuh....',
    '..kjhKuh....',
    '.Kuh.Kuh....',
    '.Kuh.hhhjk..',
    '.Kuh.Kuhhjk.',
    '.Kuh.Kuh....',
    '.Kuh.Kuh.Kuh',
    'kjhh.Kuh.Kuh',
    'jhgh.Kuh.Kuh',
    '.Kukjhhh.Kuh',
    '.Kuh.Kuhjhkh',
    '.Kuh.Kuh.hgh',
    '.Kuh.Kuh.Kuh',
    '.Kuh.Kuh.Kuh',
    '.Kuh.Kuh.hhh',
    'kjhh.hhh.Kuh',
    '.jhg.Kuh.Kuh',
    '.Kuh.Kuh.Kuh',
    '.Kuh.Kuh.Kuh',
    '.Kuh.Kuhjhkh',
    '.Kuh.Kuh.Kuh',
    '.Kuh.hhh.Kuh',
    '.hhh.Kuh.Kuh',
    'kjhh.Kuh.hhh',
    '.Kuh.Kuh.Kuh',
    '.Kuh.Kuh.Kuh',
    '.Kuh.Kuhjhgh',
    '.Kuh.hhh.Kuh',
    'Kuh..Kuh.Kuh',
    'hhhkjKuh.Kuh',
    'Kuh..Kuh.Kuh',
    'Kuh..Kuh.Kuh',
    'Kuh..Kuh.hhh',
    'Kuh..hhh.Kuh',
    'Kuh..Kuh.Kuh',
    'Kuh..Kuh.Kuh',
    'hhh..Kuh.Kuh',
    'Kuh..Kuh.Kuh',
  ],

  // 8x30. hangs. stem wanders, leaf pairs alternate sides. drop a
  // couple of these off the treeline and the canopy gets depth.
  VINE: [
    '...wb...',
    'kjhwb...',
    '.hg.wb..',
    '....wb..',
    '....wb..',
    '...wbjhg',
    '...wbhg.',
    '...wb...',
    '....wb..',
    '.kjhwb..',
    '..hg.wb.',
    '.....wb.',
    '....wb..',
    '....wbjh',
    '...wb.hg',
    '...wb...',
    '...wb...',
    '.kjhwb..',
    '..hgwb..',
    '.....wb.',
    '.....wb.',
    '.....wbj',
    '....wb.h',
    '....wb..',
    '....wb..',
    'kjhwb...',
    '.hgwb...',
    '....wb..',
    '..kjwb..',
    '..jhgb..',
  ],

  // 20x14. five fronds out of one clump, twice the existing FERN.
  FERN_BIG: [
    '.....k...k....k.....',
    '....kj..kj...jk.....',
    '..k.jh..jh...hj..k..',
    '.kj.jhg.jhg.jhg.jk..',
    'kjh.jhg.jhg.jhg.hjk.',
    'jhg.jhgjjhggjhg.jhgk',
    'jhggjhggjhhggjhggjhg',
    '.hggjhhggjhggjhhggh.',
    '..ggghhggjhggghhgg..',
    '...gGghhgghhgghgG...',
    '....gGghhgghhggG....',
    '.....gGghhgghgG.....',
    '......gGghhghG......',
    '.......GgggGG.......',
  ],

  // 10x7. the runt. for filling gaps between bigger things.
  FERN_SMALL: [
    '...k..k...',
    '.k.jk.jk..',
    'kj.jh.jhk.',
    '.jhjhgjhg.',
    '..ghhghgg.',
    '...gGhgG..',
    '....GgG...',
  ],

  // 9x6. two heads and a bud. the only hot pink on the island.
  FLOWERS: [
    '..N...N..',
    '.NyM.NyM.',
    '..h.N.h..',
    '.jh.y.hj.',
    'jhg.h.ghj',
    '..gGgGg..',
  ],

  // 22x8. bleached and forked, paler and longer than LOG.
  DRIFTWOOD: [
    '......dvv.............',
    '..dvvvvvWWd...........',
    '.dWWWWWWWWWWdvv.......',
    'dWWdvWWWWWWWWWWWWdv...',
    'wWvdvwwwwwwwwwWWWWWWWd',
    'wWvvwwwbwwwwwwwwwwWWWw',
    '.wwbb.bbbbwwwwwwwwwwbb',
    '..bb.....bbbbbbbbbbb..',
  ],

  // 10x6. three nuts, two behind and one in front.
  COCONUTS: [
    '.WW....WW.',
    'WWwb..WWwb',
    'Www.WW.wwb',
    '.wbWWwbwbb',
    '...Wwwb...',
    '....wbb...',
  ],

  // 6x4. ribbed fan. tiny, bright, good for scattering on wet sand.
  SHELL: [
    '..YY..',
    '.YZYZ.',
    'YZYZYZ',
    '.ZZZZ.',
  ],

  // 18x12. boulder. lit hard on the top left, deep shade bottom right.
  ROCK_BIG: [
    '.....nnnnn........',
    '...nnnnnnnnRR.....',
    '..nnnnnnnnRRRRr...',
    '.nnnnnnnRRRRRRrr..',
    'nnnnnnRRRRRRRRrrr.',
    'nnnnnRRRRRRRRRrrrr',
    'nnnnRRRRRRRRRrrrrr',
    'nnnRRRRRRRRrrrrrrr',
    '.nRRRRRRRRrrrrrrr.',
    '.RRRRRRRRrrrrrrrr.',
    '..RRRRrrrrrrrrrr..',
    '....rrrrrrrrrr....',
  ],

  // 7x5. pebble.
  ROCK_SMALL: [
    '..nnn..',
    '.nnnRR.',
    'nnnRRrr',
    '.RRRrrr',
    '..rrrr.',
  ],

  // 16x9. ring of stones round a bed of embers. no flame in here,
  // the scene draws that itself so it can animate.
  FIRE_PIT: [
    '....nRr..nRr....',
    '.nRr........nRr.',
    'nRr..eeeeee..nRr',
    'nRr.eefFFfee.nRr',
    'nRr.efFyyFfe.nRr',
    'nRr.eefFFfee.nRr',
    '.nRr.eeeeee.nRr.',
    '..nRr..ee..nRr..',
    '...rrr....rrr...',
  ],

  // 10x9. clay pot on a three stick tripod, soot round the base.
  POT: [
    '.QQUUUUTT.',
    '..QUUUUT..',
    '.QUUUUUTT.',
    'QUUUUUUTTT',
    'QUUUUUTTTT',
    '.QUUUUTTT.',
    '..eTTTTe..',
    '.Ww.Ww.wb.',
    'Ww..Ww..wb',
  ],

  // 7x9. water jug with a cord band round the belly.
  JUG: [
    '..QUT..',
    '..QUT..',
    '.QUUUT.',
    'QUUUUTT',
    'QUvVUTT',
    'QUUUUTT',
    '.QUUUTT',
    '..QUTT.',
    '..TTT..',
  ],

  // 26x16. two leaning uprights, a crossbar and three fish hung to dry.
  DRY_RACK: [
    '..Wwb................Wwb..',
    '.WWwbWWWWWWWWWWWWWWWWWwbW.',
    '.wWwbwwwwwwwwwwwwwwwwWwbb.',
    '..Wwb.v.....v.....v..Wwb..',
    '..WwbXJH...XJH...XJH.Wwb..',
    '..WwbXJJH..XJJH..XJJHWwb..',
    '.Wwb.XJJH..XJJH..XJJH.Wwb.',
    '.Wwb.XJJH..XJJH..XJJH.Wwb.',
    '.Wwb.XJJH..XJJH..XJJH.Wwb.',
    '.Wwb..XJH...XJH...XJH.Wwb.',
    '.Wwb..JH....JH....JH..Wwb.',
    '.Wwb...H.....H.....H..Wwb.',
    'Wwb....................Wwb',
    'Wwb....................Wwb',
    'Wwb....................Wwb',
    'WWwb..................Wwbb',
  ],

  // 34x10. dugout. upswept ends, hollowed dark inside, one thwart.
  CANOE: [
    '.dW............................Wd.',
    '.dWW..........................WWd.',
    'dWWWdddVdddVdddVdddVdddVdddVddWWWd',
    'WwwWooooooooooooooooooooooooooWwww',
    'wwbWoooooooooooWWwwoooooooooooWwwb',
    '.wwbboooooooooooooooooooooooobbww.',
    '.wWWWWWWWWWWWWWWWWWWWWWWWWWWWWWw..',
    '.wwWwwwbwwwwwwbwwwwwwbwwwwwwbwww..',
    '..wwbwwwwwwwwwwwwwwwwwwwwwwwwbw...',
    '....bbbbbbbbbbbbbbbbbbbbbbbbbb....',
  ],

  // 14x20. cloth on a pole, tied off in three places. camp marker.
  FLAG: [
    '..ddd.........',
    '..Wwb.........',
    '..WwvEEEEDCCC.',
    '..WwbEDDCDDCCC',
    '..WwbEDDDCDCC.',
    '..WwbEDDDDCCCC',
    '..WwvEDDCDDCC.',
    '..WwbEDDDCCC..',
    '..WwbEDDDDCCC.',
    '..WwbEDDCDCC..',
    '..WwvEDDDCC...',
    '..WwbEDDCC....',
    '..Wwb.........',
    '..Wwb.........',
    '..Wwb.........',
    '..Wwb.........',
    '..Wwb.........',
    '..Wwb.........',
    '..Wwb.........',
    '..Wwb.........',
  ],

  // 44x26. the big lean to. wider and taller than HUT, thatch lit on
  // the left slope and in shade on the right, woven back wall, sleeping
  // platform inside and a spare pole leaning on the far post.
  SHELTER_BIG: [
    '...................VdVvww...................',
    '..................VdVVvvvw..................',
    '................dVVdVdvvvvvw................',
    '..............dVVVddVVVvvvvvvw..............',
    '.............VVddVVVddvvVvvvvvv.............',
    '...........VddVVVddVVVvvvvVvvvvvv...........',
    '.........ddVVVddVVVddVvVvvvvVvvvvvv.........',
    '.......dVVVddVVVddVVVdvvvVvvvvVvvvvvv.......',
    '......VVddVVVddVVVddVVVvvvvVvvvvVvvwvv......',
    '....VddVVVddVVVddVVVddvvVvvvvVvvvvVvvwvv....',
    '..ddVVVddVVVddVVVddVVVvvvvVvvvvVvvvvVvvwvv..',
    'dVVVddVVVddVVVddVVVddVvVvvvvVvvvvVvvvvVvvwvv',
    'WwwWWwwWWwwWWwwWWwwWWwwWWwwWWwwWWwwWWwwWWwwW',
    '.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.',
    '....Wwb..............................Wwb....',
    '....Wwb..oGoGoGoGoGoGoGoGoGoGoGoGoG..Wwb....',
    '....Wwb..GoGoGoGoGoGoGoGoGoGoGoGoGo..Wwb....',
    '....Wwb..oGoGoGoGoGoGoGoGoGoGoGoGoG..Wwb....',
    '....Wwb..GoGoGoGoGoGoGoGoGoGoGoGoGo..Wwb....',
    '....Wwb..oGoGoGoGoGoGoGoGoGoGoGoGoG..Wwb....',
    '....Wwb..GoGoGoGoGoGoGoGoGoGoGoGoGo..Wwb.v..',
    '....Wwb..dVVVVVVVVVVVVVVVVVVVVVVVVv..Wwb.v..',
    '....Wwb..WWWWWWWWWWWWWWWWWWWWWWWWWw..Wwb..v.',
    '....Wwb..wbbbbbbbbbbbbbbbbbbbbbbbbb..Wwb..w.',
    '....Wwb....Ww..................Ww....Wwb....',
    '...WWwwb............................WWwwb...',
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

  // the rest of the island
  PALM_TALL: 0.85,
  PALM_BENT: 0.85,
  FAN_PALM: 0.7,
  BANANA: 0.6,
  BAMBOO: 0.75,
  VINE: 0.3,
  FERN_BIG: 0.35,
  FERN_SMALL: 0.3,
  FLOWERS: 0.2,
  DRIFTWOOD: 0.8,
  COCONUTS: 0.95,
  SHELL: 0.5,
  ROCK_BIG: 0.9,
  ROCK_SMALL: 0.9,
  FIRE_PIT: 0.65,
  POT: 0.9,
  JUG: 0.9,
  DRY_RACK: 0.45,
  CANOE: 0.8,
  FLAG: 0.25,
  SHELTER_BIG: 0.55,
}

/**
 * foliage only palette swaps. merge one over the palette before you bake and
 * you get the same palm in a different green:
 *
 *   const dry = Object.assign({}, PALETTE, TINTS.DRY)
 *   baked.PALM_DRY = bake(SPRITES.PALM, dry)
 *
 * only the leaf letters move. wood, sand and thatch stay put on purpose, so a
 * treeline of mixed tints still reads as one island. bake these once at load,
 * never per frame, and vary which one each prop gets off the layout seed.
 */
export const TINTS = {
  // sun bleached, further up the beach. yellower and flatter
  DRY: {
    G: '#283d1f', g: '#3d5c28', h: '#587a33', j: '#7a9b3c',
    k: '#a6bf52', K: '#c2d165', u: '#d2cf70',
  },
  // back of the treeline, cooler and further from the light
  DEEP: {
    G: '#17321f', g: '#27512f', h: '#356b3c', j: '#4a8749',
    k: '#6ea75d', K: '#8bb96b', u: '#a9bd72',
  },
  // young growth by the water, brighter the whole way up
  LIME: {
    G: '#24462a', g: '#376a38', h: '#4c8c44', j: '#6cae4e',
    k: '#98d165', K: '#b6e07a', u: '#d4e087',
  },
}
