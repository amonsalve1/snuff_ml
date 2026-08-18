// the people at camp. one figure per player still in the game, plus a handful
// of extras so the beach is never deserted at final tribal.
//
// same string art format as jungle-sprites.js and driven exactly like
// wildlife.js, so scene.js can run both off one loop:
//
//   const pal = Object.assign({}, PALETTE, EXTRA_PALETTE, CAMP_PALETTE_EXTRA);
//   for (const n of Object.keys(CAMP_SPRITES)) baked[n] = bake(CAMP_SPRITES[n], pal);
//
// and per frame:
//
//   const live = camp.update(dt, { w, h, sandY, torchY, part, cast });
//   for (let i = 0; i < live.length; i++) {
//     const f = live[i];
//     g.globalAlpha = f.alpha;
//     if (f.flip) { g.save(); g.translate(2 * f.x + f.w, 0); g.scale(-1, 1);
//                   drawSprite(g, baked[f.sprite], light, f.x, f.y, f.scale, f.relief); g.restore(); }
//     else drawSprite(g, baked[f.sprite], light, f.x, f.y, f.scale, f.relief);
//   }
//   g.globalAlpha = 1;
//
// house rules, same as the rest of the backdrop:
//   - the pool is built once and never grows. update() only mutates it, so a
//     frame is arithmetic. no arrays, no objects, no closures, no strings.
//   - every choice comes off a per figure lcg seeded from the scene seed and
//     the player name, so the same season replays the same camp and the same
//     player always looks like themselves. nothing calls Math.random, ever.
//   - reduced motion: update(0, info) once is a valid still. everybody gets
//     placed, nobody moves.
//   - a voted out player leaves the pool the frame their cast entry flips out.
//     the torch snuffing is the transition, the figure does not need to fade.

/**
 * palette chars neither jungle-sprites.js nor wildlife.js has. merge all three
 * over each other, do not replace. the eye, the feet and the fire poking stick
 * come out of the base palette on purpose.
 */
export const CAMP_PALETTE_EXTRA = {
  // digits and punctuation on purpose. every other palette in here is letters
  // and they keep growing as the art does, so camp keeps to a keyspace nobody
  // drawing a plant is ever going to reach for.

  // skin, three complexions, body then its shadow side
  '1': '#dfae86', // light
  '2': '#a4703f',
  '3': '#c08a5a', // mid
  '4': '#8a5636',
  '5': '#8d5a3a', // deep
  '6': '#5d3822',

  // hair
  '7': '#241a14', // black
  '8': '#4a3020', // brown
  '9': '#c9a765', // sun bleached blond
  '0': '#9a958c', // grey

  // shorts, three colourways so a tribe is not in uniform
  '+': '#3f5f7a', // blue
  '-': '#28405a',
  '#': '#8a3a30', // faded red
  '=': '#5e2622',
  '@': '#5e6b3a', // olive
  '%': '#3d4726',
}

// the art below is authored once with marker letters and recoloured into the
// digits above, once, at load. markers: u skin, U skin shadow, N hair, l the
// optional fall of hair down the back, C shorts, B shorts shadow. they are
// letters because letters are what you can read in a wall of art, and none of
// them survives into an exported sprite. o, b and w are real palette chars and
// pass straight through, so the eye, the feet and the fire poking stick shade
// with the rest of the island.
//
// 10 wide, 18 tall, feet on the last row in every pose so swapping frames
// never makes anyone hop.
//
// all of them face right. the caller flips.
const BASE = {
  // standing, weight on the front foot
  IDLE_A: [
    '...NNNN...',
    '..NNNNNN..',
    '..NNNuuu..',
    '..lNuouu..',
    '...luuU...',
    '....uU....',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uUUUUU..',
    '..uCCCCU..',
    '..uCCBBU..',
    '...CCBB...',
    '...uuUU...',
    '...uuUU...',
    '...uuUU...',
    '...bbbb...',
  ],

  // same stance, sunk one pixel. the neck row goes and the shoulders come up,
  // which is the whole weight shift. legs do not move.
  IDLE_B: [
    '..........',
    '...NNNN...',
    '..NNNNNN..',
    '..NNNuuu..',
    '..lNuouu..',
    '...luuU...',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uUUUUU..',
    '..uCCCCU..',
    '..uCCBBU..',
    '...CCBB...',
    '...uuUU...',
    '...uuUU...',
    '...uuUU...',
    '...bbbb...',
  ],

  // talking, near hand up by the shoulder
  TALK_A: [
    '...NNNN...',
    '..NNNNNN..',
    '..NNNuuu..',
    '..lNuouu..',
    '...luuU...',
    '....uU..U.',
    '..uuuuUUU.',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uUUUUU..',
    '..uCCCCU..',
    '..uCCBBU..',
    '...CCBB...',
    '...uuUU...',
    '...uuUU...',
    '...uuUU...',
    '...bbbb...',
  ],

  // talking, same arm swung out flat. only the arm moves between the two.
  TALK_B: [
    '...NNNN...',
    '..NNNNNN..',
    '..NNNuuu..',
    '..lNuouu..',
    '...luuU...',
    '....uU....',
    '..uuuuUU..',
    '..uuuuUUUU',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uUUUUU..',
    '..uCCCCU..',
    '..uCCBBU..',
    '...CCBB...',
    '...uuUU...',
    '...uuUU...',
    '...uuUU...',
    '...bbbb...',
  ],

  // sat on the sand, one leg out front, hand planted behind
  SIT_A: [
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '...NNNN...',
    '..NNNNNN..',
    '..NNNuuu..',
    '..lNuouu..',
    '...luuU...',
    '....uU....',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uUUUUU..',
    '..uCCCCU..',
    '..uCCCCuu.',
    '...BBBuUU.',
    '...bbb.bb.',
  ],

  // same seat, one breath lower
  SIT_B: [
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '...NNNN...',
    '..NNNNNN..',
    '..NNNuuu..',
    '..lNuouu..',
    '...luuU...',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uUUUUU..',
    '..uCCCCU..',
    '..uCCCCuu.',
    '...BBBuUU.',
    '...bbb.bb.',
  ],

  // contact frame, legs open, front arm swung forward
  WALK_A: [
    '..........',
    '...NNNN...',
    '..NNNNNN..',
    '..NNNuuu..',
    '..lNuouu..',
    '...luuU...',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uuuuUUU.',
    '..uuuuUUU.',
    '..uUUUUU..',
    '..uCCCCU..',
    '..uCCBBU..',
    '...CCBB...',
    '...uuUU...',
    '..uu..UU..',
    '.uu....UU.',
    '.bb....bb.',
  ],

  // passing frame, body up a pixel, back foot off the sand
  WALK_B: [
    '...NNNN...',
    '..NNNNNN..',
    '..NNNuuu..',
    '..lNuouu..',
    '...luuU...',
    '....uU....',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uuuuUU..',
    '..uUUUUU..',
    '..uCCCCU..',
    '..uCCBBU..',
    '...CCBB...',
    '...uuUU...',
    '...uuUU...',
    '...uuU....',
    '...bb.....',
  ],

  // the other contact. the lit leg swaps sides, which is what sells the second
  // stride at this size, and the arm swings back.
  WALK_C: [
    '..........',
    '...NNNN...',
    '..NNNNNN..',
    '..NNNuuu..',
    '..lNuouu..',
    '...luuU...',
    '..uuuuUU..',
    '..uuuuUU..',
    '.uuuuuUU..',
    '.uuuuuUU..',
    '..uUUUUU..',
    '..uCCCCU..',
    '..uCCBBU..',
    '...CCBB...',
    '...uuUU...',
    '..UU..uu..',
    '.UU....uu.',
    '.bb....bb.',
  ],

  // crouched over the fire pit, stick angled down into it
  TEND_A: [
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '....NNNN..',
    '...NNNNNN.',
    '...NNNuuu.',
    '...lNuouu.',
    '....luuU..',
    '..uuuuUU..',
    '..uuuuUUw.',
    '..uUUUUU.w',
    '..uCCCCU..',
    '..CCCCUU..',
    '..uuuuUU..',
    '..UuuuUU..',
    '..bbbbbb..',
  ],

  // the poke. arm straightens, the stick goes flat into the coals.
  TEND_B: [
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '....NNNN..',
    '...NNNNNN.',
    '...NNNuuu.',
    '...lNuouu.',
    '....luuU..',
    '..uuuuUU..',
    '..uuuuUUU.',
    '..uUUUUUww',
    '..uCCCCU..',
    '..CCCCUU..',
    '..uuuuUU..',
    '..UuuuUU..',
    '..bbbbbb..',
  ],
}

// one row per look: skin, skin shadow, hair, hair fall, shorts, shorts shadow.
// a '.' for the fall is how the short haired ones lose the pixels down the
// back, so the same art gives long and cropped without a second drawing.
const LOOKS = [
  ['1', '2', '7', '.', '+', '-'], // light, cropped black, blue shorts
  ['3', '4', '9', '9', '#', '='], // mid, long blond, red shorts
  ['5', '6', '7', '7', '@', '%'], // deep, long black, olive shorts
  ['3', '4', '0', '.', '+', '-'], // mid, cropped grey, blue shorts
  ['1', '2', '8', '8', '@', '%'], // light, long brown, olive shorts
];

const POSES = [
  'SURV_IDLE_A', 'SURV_IDLE_B',
  'SURV_TALK_A', 'SURV_TALK_B',
  'SURV_SIT_A', 'SURV_SIT_B',
  'SURV_WALK_A', 'SURV_WALK_B', 'SURV_WALK_C',
  'SURV_TEND_A', 'SURV_TEND_B',
];

const ART = [
  BASE.IDLE_A, BASE.IDLE_B,
  BASE.TALK_A, BASE.TALK_B,
  BASE.SIT_A, BASE.SIT_B,
  BASE.WALK_A, BASE.WALK_B, BASE.WALK_C,
  BASE.TEND_A, BASE.TEND_B,
];

// pose indices, so the state machines never touch a string
const P_IDLE_A = 0;
const P_IDLE_B = 1;
const P_TALK_A = 2;
const P_TALK_B = 3;
const P_SIT_A = 4;
const P_SIT_B = 5;
const P_WALK_A = 6;
const P_WALK_B = 7;
const P_WALK_C = 8;
const P_TEND_A = 9;
const P_TEND_B = 10;

// a person is fairly round. the seated and crouched poses read flatter because
// most of what you see is a back.
const POSE_RELIEF = [0.6, 0.6, 0.6, 0.6, 0.52, 0.52, 0.6, 0.6, 0.6, 0.52, 0.52];

// swap the markers for one look. runs once at load, never in a frame.
function recolour(rows, look) {
  const out = [];
  for (let y = 0; y < rows.length; y++) {
    const src = rows[y];
    let line = '';
    for (let i = 0; i < src.length; i++) {
      const ch = src.charAt(i);
      if (ch === 'u') line += look[0];
      else if (ch === 'U') line += look[1];
      else if (ch === 'N') line += look[2];
      else if (ch === 'l') line += look[3];
      else if (ch === 'C') line += look[4];
      else if (ch === 'B') line += look[5];
      else line += ch;
    }
    out.push(line);
  }
  return out;
}

/**
 * every figure frame, in the house string art format. look 0 keeps the plain
 * names, the rest get a _V suffix. all of them are 10x18 and share their feet
 * row, so a figure can change pose on any frame without moving.
 */
export const CAMP_SPRITES = {};

/** how round each frame is, 0 flat to 1 fully modelled. */
export const CAMP_RELIEF = {};

// NAMES[look][pose] -> sprite name. built once so the loop is two array reads.
const NAMES = [];
for (let v = 0; v < LOOKS.length; v++) {
  const row = [];
  for (let p = 0; p < POSES.length; p++) {
    const name = v === 0 ? POSES[p] : POSES[p] + '_V' + v;
    CAMP_SPRITES[name] = recolour(ART[p], LOOKS[v]);
    CAMP_RELIEF[name] = POSE_RELIEF[p];
    row.push(name);
  }
  NAMES.push(row);
}

const FW = CAMP_SPRITES.SURV_IDLE_A[0].length; // 10
const FH = CAMP_SPRITES.SURV_IDLE_A.length; // 18

// ---- behaviour ------------------------------------------------------------

// states
const S_IDLE = 0;
const S_WALK = 1;
const S_TALK = 2;
const S_SIT = 3;
const S_TEND = 4;

// what the current walk is for. it survives the walk, so a figure sat down or
// crouched at the fire still knows why it is there.
const G_NONE = 0;
const G_MEET = 1;
const G_SIT = 2;
const G_TEND = 3;

// contact, pass, other contact, pass. table lookup, no branch on frame number.
const WALK_CYCLE = [P_WALK_A, P_WALK_B, P_WALK_C, P_WALK_B];

const NO_INFO = {};
const DT_CAP = 0.1; // a backgrounded tab must not teleport anybody
const FADE = 3.2; // alpha per second on arrival
const CHAT_GAP = 14; // sand left between two people talking
const MEET_RANGE = 300; // nobody crosses the whole beach for a chat
const ROAM = 0.18; // how much of the width one wander can cover
const TEND_MAX = 2; // how many can be at the fire pit at once

// same lcg as the scene layout and the wildlife
function lcg(seed) {
  let v = seed >>> 0;
  return function () {
    v = (v * 1664525 + 1013904223) >>> 0;
    return v / 4294967296;
  };
}

// per figure stream, lives on the figure so pulling a number allocates nothing
function rnd(f) {
  f.rs = (f.rs * 1664525 + 1013904223) >>> 0;
  return f.rs / 4294967296;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function num(v, d) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

// fnv1a. a player keeps their look and their luck across every episode, and
// two seasons with the same name in them get the same face.
function hashName(s) {
  let v = 2166136261;
  for (let i = 0; i < s.length; i++) {
    v ^= s.charCodeAt(i);
    v = Math.imul(v, 16777619) >>> 0;
  }
  return v >>> 0;
}

// how far into the dark we are. same curve the wildlife thins out on.
function nightnessFor(part) {
  if (part === 'night') return 1;
  if (part === 'dusk') return 0.55;
  if (part === 'dawn') return 0.25;
  return 0;
}

/**
 * build the camp.
 *
 * opts: { seed, max, ambient }. max is how many cast slots the pool carries,
 * ambient is how many non cast bodies wander regardless.
 *
 * the returned object holds a fixed pool. update(dt, info) walks it and returns
 * the live subset as an array reused every frame, so do not hold on to it past
 * the current frame.
 *
 * info: { w, h, sandY, torchY, part, cast, fireX, fireY }. cast is one entry
 * per player, { name, prob, out }, and a figure exists for every entry that is
 * not out yet. fireX and fireY are optional, there is a fallback pit.
 */
export function createCamp(opts) {
  const o = opts || {};
  const seed = num(o.seed, 20260816);
  const r = lcg(seed);
  const maxCast = Math.max(1, Math.round(num(o.max, 24)));
  const nAmb = Math.max(0, Math.round(num(o.ambient, 4)));

  // one shape for every figure, cast or not, so the pool shares a hidden class
  // and the update loop stays monomorphic
  function figure(slot, isCast) {
    return {
      // what the drawer reads
      sprite: NAMES[0][P_IDLE_A],
      relief: POSE_RELIEF[P_IDLE_A],
      scale: 2,
      x: 0,
      y: 0,
      w: FW * 2,
      h: FH * 2,
      flip: false,
      alpha: 1,
      visible: false,
      // internals below here. the caller has no business reading these.
      slot: slot,
      cast: isCast,
      active: false,
      who: '',
      look: 0,
      pose: P_IDLE_A,
      rs: (r() * 4294967295) >>> 0,
      homeX: r(), // where along the beach this one hangs about, 0..1
      lane0: r(), // and how far down the camp band
      lane: 0,
      laneTo: 0,
      tx: 0,
      st: S_IDLE,
      goal: G_NONE,
      t: 0,
      anim: 0,
      spd: 30,
      want: 0, // seconds until this one goes looking for someone to talk to
      partner: -1,
      fade: 1,
      sw: FW,
      sh: FH,
    };
  }

  const pool = [];
  for (let i = 0; i < maxCast; i++) pool.push(figure(i, true));
  for (let i = 0; i < nAmb; i++) pool.push(figure(maxCast + i, false));

  // the extras are always here. they get their look off the layout stream
  // rather than a name, and they hang back a bit so the cast reads as the
  // subject of the shot.
  for (let i = 0; i < nAmb; i++) {
    const f = pool[maxCast + i];
    f.active = true;
    f.look = (r() * LOOKS.length) | 0;
    f.lane0 = r() * 0.62;
    f.want = 1 + r() * 8;
    f.t = 0.5 + r() * 4;
  }

  // reused every frame. same array object for the life of the scene.
  const live = [];
  for (let i = 0; i < pool.length; i++) live.push(pool[i]);
  live.length = 0;

  // handy for the caller and for tests. mutated in place, never replaced.
  const counts = { live: 0, talking: 0, chats: 0, pairs: 0 };

  let tending = 0;
  let lastW = 0;
  let first = true;

  // scratch for the frame, so nothing below has to take eight arguments
  let W = 800;
  let TOP = 0;
  let SPAN = 100;
  let NIGHT = 0;
  let FIRE_X = 0;
  let FIRE_LANE = 0.62;

  // ---- helpers ------------------------------------------------------------

  function clampX(v, fw) {
    const hi = W - fw - 2;
    if (hi < 2) return (W - fw) * 0.5;
    return v < 2 ? 2 : v > hi ? hi : v;
  }

  function place(f) {
    f.x = clampX(f.homeX * W - f.w * 0.5, f.w);
    f.lane = clamp(f.lane0, 0, 1);
    f.laneTo = f.lane;
    f.tx = f.x;
  }

  function setLook(f, key) {
    f.look = key % LOOKS.length;
    f.scale = f.lane0 > 0.42 ? 2 : 1;
    f.w = f.sw * f.scale;
    f.h = f.sh * f.scale;
    f.spd = (f.scale > 1 ? 26 : 17) + (f.rs % 1000) / 1000 * 14;
  }

  // a cast slot picks up a player. the seed comes off the name so the same
  // player is the same person every episode.
  function bind(f, name) {
    if (f.active) release(f);
    const hv = hashName(name);
    f.who = name;
    f.rs = (hv ^ (seed >>> 0)) >>> 0;
    if (f.rs === 0) f.rs = 1;
    f.homeX = 0.06 + rnd(f) * 0.88;
    f.lane0 = 0.24 + rnd(f) * 0.74;
    setLook(f, hv);
    f.active = true;
    f.st = S_IDLE;
    f.goal = G_NONE;
    f.partner = -1;
    f.pose = P_IDLE_A;
    f.t = 0.4 + rnd(f) * 3.4;
    f.want = 0.4 + rnd(f) * 7;
    f.anim = rnd(f) * 1.9;
    f.fade = first ? 1 : 0.15;
    place(f);
  }

  // voted out, or the cast array moved under us. the slot goes quiet the same
  // frame, no lingering ghost, so the live count always matches the cast.
  function release(f) {
    if (f.partner >= 0) breakPair(f);
    if (f.goal === G_TEND && tending > 0) tending--;
    f.active = false;
    f.visible = false;
    f.partner = -1;
    f.goal = G_NONE;
    f.st = S_IDLE;
    f.who = '';
  }

  function leavePair(f) {
    f.partner = -1;
    f.goal = G_NONE;
    f.st = S_IDLE;
    f.pose = P_IDLE_A;
    f.anim = 0;
    f.t = 0.6 + rnd(f) * 2.4;
    f.want = 4 + rnd(f) * 11; // cool off, nobody talks to the same person twice in a row
  }

  function breakPair(f) {
    const j = f.partner;
    leavePair(f);
    if (j >= 0) {
      const p = pool[j];
      if (p.partner === f.slot) leavePair(p);
    }
  }

  // two people walk at each other and stop a stride apart. the midpoint is
  // where they already are, so a pairing never drags anyone across the beach.
  function pairUp(a, b) {
    const half = (a.w + CHAT_GAP) * 0.5;
    let mx = (a.x + b.x) * 0.5;
    const lo = 2 + half;
    const hi = W - a.w - 2 - half;
    if (hi > lo) mx = clamp(mx, lo, hi);
    const ml = clamp((a.lane + b.lane) * 0.5, 0, 1);
    const leftFirst = a.x <= b.x;
    // clamped for the same reason as the resize above. on a beach too narrow
    // to fit the pair the midpoint maths overshoots, and an unreachable target
    // is a figure that never arrives and never lets go of its partner.
    a.tx = clampX(leftFirst ? mx - half : mx + half, a.w);
    b.tx = clampX(leftFirst ? mx + half : mx - half, b.w);
    a.laneTo = ml;
    b.laneTo = ml;
    a.partner = b.slot;
    b.partner = a.slot;
    a.goal = G_MEET;
    b.goal = G_MEET;
    a.st = S_WALK;
    b.st = S_WALK;
    a.anim = 0;
    b.anim = 0;
    counts.pairs++;
  }

  function freeToChat(f) {
    return f.partner < 0 && (f.st === S_IDLE || (f.st === S_WALK && f.goal === G_NONE));
  }

  // pick somewhere to be. short hops around the patch of beach this one lives
  // on, not a trek across the island, which is what keeps camp looking like a
  // camp and keeps neighbours close enough to ever pair off. home drifts a
  // little each time so nobody wears a rut in the sand.
  function wanderTo(f) {
    f.homeX = clamp(f.homeX + (rnd(f) - 0.5) * 0.06, 0.05, 0.95);
    let tx = (f.homeX + (rnd(f) - 0.5) * ROAM) * W - f.w * 0.5;
    let tl = clamp(f.lane0 + (rnd(f) - 0.5) * 0.4, 0, 1);
    if (NIGHT > 0) {
      // after dark the whole camp leans on the fire
      const pull = NIGHT * 0.62;
      tx += (FIRE_X - f.w * 0.5 - tx) * pull;
      tl += (FIRE_LANE - tl) * pull;
    }
    f.tx = clampX(tx, f.w);
    f.laneTo = clamp(tl, 0, 1);
  }

  // idle ran out. sit, poke the fire, or go somewhere else.
  function decide(f) {
    const p = rnd(f);
    const pTend = (f.cast ? 0.13 : 0.07) + NIGHT * 0.14;
    const pSit = 0.14 + NIGHT * 0.22;
    if (p < pTend && tending < TEND_MAX) {
      tending++;
      f.goal = G_TEND;
      const side = rnd(f) < 0.5 ? -1 : 1;
      f.tx = clampX(FIRE_X + (side < 0 ? -f.w - 5 : 5), f.w);
      f.laneTo = clamp(FIRE_LANE + (rnd(f) - 0.5) * 0.1, 0, 1);
    } else if (p < pTend + pSit) {
      f.goal = G_SIT;
      wanderTo(f);
    } else {
      f.goal = G_NONE;
      wanderTo(f);
    }
    f.st = S_WALK;
    f.anim = 0;
  }

  function arrive(f) {
    if (f.goal === G_MEET) {
      f.st = S_TALK;
      f.t = 0;
      f.anim = 0;
      const p = pool[f.partner];
      f.flip = p.x < f.x;
    } else if (f.goal === G_SIT) {
      f.st = S_SIT;
      f.t = 5 + rnd(f) * 11 + NIGHT * 7;
      f.anim = rnd(f) * 3.2;
    } else if (f.goal === G_TEND) {
      f.st = S_TEND;
      f.t = 7 + rnd(f) * 13;
      f.anim = rnd(f) * 0.9;
      f.flip = FIRE_X < f.x + f.w * 0.5;
    } else {
      f.st = S_IDLE;
      f.t = (1.8 + rnd(f) * 4.4) * (1 + NIGHT * 1.1);
      f.anim = rnd(f) * 1.9;
    }
  }

  // ---- per state ----------------------------------------------------------

  function stepIdle(f, dt) {
    f.anim += dt;
    while (f.anim >= 1.9) f.anim -= 1.9;
    f.pose = f.anim < 0.95 ? P_IDLE_A : P_IDLE_B;
    f.t -= dt;
    if (f.t <= 0) decide(f);
  }

  function stepWalk(f, dt) {
    const dx = f.tx - f.x;
    const dl = f.laneTo - f.lane;
    const dy = dl * SPAN;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const spd = f.spd * (1 - NIGHT * 0.32);
    const reach = spd * dt;
    if (dist <= reach || dist < 0.5) {
      f.x = f.tx;
      f.lane = f.laneTo;
      arrive(f);
      return;
    }
    const k = reach / dist;
    f.x += dx * k;
    f.lane += dl * k;
    if (dx > 0.4) f.flip = false;
    else if (dx < -0.4) f.flip = true;
    f.anim += dt * spd * 0.15;
    while (f.anim >= 4) f.anim -= 4;
    f.pose = WALK_CYCLE[f.anim | 0];
  }

  // the talk only starts once both of them are stood there. before that the
  // one who got there first waits on the spot rather than gesturing at nobody.
  function stepTalk(f, dt) {
    const p = pool[f.partner];
    f.flip = p.x < f.x;
    if (p.st !== S_TALK) {
      f.anim += dt;
      while (f.anim >= 1.9) f.anim -= 1.9;
      f.pose = f.anim < 0.95 ? P_IDLE_A : P_IDLE_B;
      return;
    }
    if (f.t <= 0) {
      f.t = 3.5 + rnd(f) * 7 + NIGHT * 4;
      f.anim = 0;
      if (f.slot < p.slot) counts.chats++;
    }
    f.t -= dt;
    f.anim += dt;
    while (f.anim >= 0.64) f.anim -= 0.64;
    f.pose = f.anim < 0.32 ? P_TALK_A : P_TALK_B;
    if (f.t <= 0) breakPair(f);
  }

  function stepSit(f, dt) {
    f.anim += dt;
    while (f.anim >= 3.2) f.anim -= 3.2;
    f.pose = f.anim < 1.6 ? P_SIT_A : P_SIT_B;
    f.t -= dt;
    if (f.t <= 0) {
      f.goal = G_NONE;
      f.st = S_IDLE;
      f.t = 0.5 + rnd(f) * 2.2;
      f.anim = rnd(f) * 1.9;
    }
  }

  function stepTend(f, dt) {
    f.anim += dt;
    while (f.anim >= 0.9) f.anim -= 0.9;
    f.pose = f.anim < 0.45 ? P_TEND_A : P_TEND_B;
    f.t -= dt;
    if (f.t <= 0) {
      if (tending > 0) tending--;
      f.goal = G_NONE;
      f.st = S_IDLE;
      f.t = 0.5 + rnd(f) * 2.4;
      f.anim = rnd(f) * 1.9;
    }
  }

  // ---- pairing ------------------------------------------------------------

  // one pass. figures whose want timer has run out look for the nearest free
  // body of the same size, which keeps a near figure from pairing with a far
  // one and standing inside them. the inner scan only runs for someone who is
  // actually looking, and a miss buys a couple of seconds of quiet.
  function matchmake(dt) {
    for (let i = 0; i < pool.length; i++) {
      const f = pool[i];
      if (!f.active) continue;
      if (f.partner >= 0) {
        const p = pool[f.partner];
        if (!p.active || p.partner !== f.slot) leavePair(f);
      }
    }
    for (let i = 0; i < pool.length; i++) {
      const f = pool[i];
      if (!f.active || f.partner >= 0 || !freeToChat(f)) continue;
      if (f.want > 0) {
        f.want -= dt;
        continue;
      }
      let best = -1;
      let bestD = MEET_RANGE * MEET_RANGE;
      for (let j = 0; j < pool.length; j++) {
        if (j === i) continue;
        const g = pool[j];
        if (!g.active || g.partner >= 0 || g.scale !== f.scale) continue;
        if (!freeToChat(g)) continue;
        const dx = g.x - f.x;
        const dy = (g.lane - f.lane) * SPAN;
        const dd = dx * dx + dy * dy;
        if (dd < bestD) {
          bestD = dd;
          best = j;
        }
      }
      if (best >= 0) pairUp(f, pool[best]);
      else f.want = 1.5 + rnd(f) * 2.5; // nobody about. ask again in a moment.
    }
  }

  // ---- the loop -----------------------------------------------------------

  function update(dt, info) {
    const ci = info || NO_INFO;
    const w = Math.max(1, num(ci.w, 800));
    const h = Math.max(1, num(ci.h, 600));
    const sandY = clamp(num(ci.sandY, h * 0.34), 0, h);
    const torchY = clamp(num(ci.torchY, sandY + (h - sandY) * 0.4), sandY, h);

    let d = num(dt, 0);
    if (d < 0) d = 0;
    if (d > DT_CAP) d = DT_CAP;

    // the strip of sand camp lives on. starts below the tide line, ends a bit
    // past the torch row so people can walk in front of the torches.
    let top = sandY + (h - sandY) * 0.12;
    let bot = torchY + 44;
    if (bot > h - 2) bot = h - 2;
    if (bot - top < FH * 2 + 8) bot = top + FH * 2 + 8;

    W = w;
    TOP = top;
    SPAN = bot - top;
    NIGHT = nightnessFor(ci.part);
    FIRE_X = clamp(num(ci.fireX, w * 0.22), 0, w);
    const fy = num(ci.fireY, -1);
    FIRE_LANE = fy >= 0 ? clamp((fy - top) / SPAN, 0, 1) : 0.62;

    // resize: keep everybody where they were along the beach instead of piling
    // them up on the left. do it before anything binds, so a figure placed for
    // the new width is not scaled a second time.
    if (!first && w !== lastW && lastW > 0) {
      const k = w / lastW;
      for (let i = 0; i < pool.length; i++) {
        const f = pool[i];
        // clamp on the way through, do not just scale. a figure is only ever
        // as wide as it was, so a target that was flush with the old edge
        // lands outside the new one, and the clamp at the bottom of the frame
        // then pins the walker a couple of pixels short of a target it can
        // never reach. that is a walk cycle playing on the spot for the rest
        // of the scene, and if it was a meet, a partner stood waiting on it.
        f.x = clampX(f.x * k, f.w);
        f.tx = clampX(f.tx * k, f.w);
      }
    }
    lastW = w;

    // one figure per player still in it. slot i belongs to cast[i] for good, so
    // a player keeps their body from first episode to snuff.
    const cast = ci.cast;
    const nc = cast && cast.length ? cast.length : 0;
    for (let i = 0; i < maxCast; i++) {
      const f = pool[i];
      let on = false;
      let nm = '';
      if (i < nc) {
        const e = cast[i];
        if (e && e.out !== true) {
          on = true;
          nm = typeof e.name === 'string' ? e.name : '';
        }
      }
      if (on) {
        if (!f.active || f.who !== nm) bind(f, nm);
      } else if (f.active) {
        release(f);
      }
    }

    if (first) {
      for (let i = 0; i < pool.length; i++) {
        const f = pool[i];
        if (!f.active) continue;
        setLook(f, f.look);
        place(f);
        f.fade = 1;
      }
    }

    matchmake(d);

    let n = 0;
    let talking = 0;
    for (let i = 0; i < pool.length; i++) {
      const f = pool[i];
      if (!f.active) {
        f.visible = false;
        continue;
      }

      if (f.st === S_IDLE) stepIdle(f, d);
      else if (f.st === S_WALK) stepWalk(f, d);
      else if (f.st === S_TALK) stepTalk(f, d);
      else if (f.st === S_SIT) stepSit(f, d);
      else stepTend(f, d);

      if (f.st === S_TALK) talking++;

      // a figure can only ever be inside the band, whatever the walk did
      f.x = clampX(f.x, f.w);
      if (f.lane < 0) f.lane = 0;
      else if (f.lane > 1) f.lane = 1;
      let room = SPAN - f.h;
      if (room < 0) room = 0;
      f.y = TOP + f.lane * room;

      if (f.fade < 1) {
        f.fade += d * FADE;
        if (f.fade > 1) f.fade = 1;
      }
      f.alpha = f.fade;
      f.sprite = NAMES[f.look][f.pose];
      f.relief = POSE_RELIEF[f.pose];
      f.visible = true;
      live[n++] = f;
    }
    live.length = n;
    counts.live = n;
    counts.talking = talking;
    first = false;
    return live;
  }

  return {
    figures: pool,
    live: live,
    counts: counts,
    update: update,
  };
}
