// the sea and the sand.
//
// v2. the old one banded the water with seven full width rects whose edges were
// dead straight and never moved, sprinkled ninety six uncorrelated blinking
// dashes over it and called that a surface. it read as construction paper with
// glitter glued on. this is the same idea done properly:
//
//   - every band boundary is a travelling wave, three sines with different
//     wavelength, speed and direction, amplitude growing toward the shore
//     because deep water is calm and shallows steepen. the boundary is walked
//     as horizontal RUNS, one fillRect per y step, so cost scales with how much
//     the line moves and not with how wide the rect is.
//   - an ordered bayer 4x4 zone at each boundary ramps coverage 0 -> 50 -> 100
//     so seven steps read as one gradient without a gradient object.
//   - the band colour index rides the long swell, which is palette cycling:
//     light crosses the water while no geometry changes at all.
//   - breaking waves are a fixed pool of 24 crests. one is born when the swell
//     crosses a threshold at the break depth, then runs shoreward, thins, dies,
//     and the slot gets reused. nothing is ever allocated.
//   - the waterline itself runs up the sand and drains back, and the wet sand it
//     leaves behind dries out over about ten seconds.
//   - caustics in the shallows are two crossed sine fields thresholded to their
//     bright cell edges. reflections are the sun path riding the wave rows, a
//     smeared dark treeline in the shallows, and optional warm point lights
//     (the torches) laid on the wet sand at night.
//
// rules, because this sits under a data site:
//   - everything is fillRect. no gradient objects, no getimagedata, no blend,
//     no drawimage.
//   - nothing is allocated in the draw path. unit tables are built once at load,
//     scaled to pixels once per size, css strings built once per rig, and every
//     per frame scratch buffer lives in the size cache. twenty thousand frames
//     retain 32kb, which is noise.
//   - measured, not guessed. every fillRect counted, six dayparts, 200 values of
//     t each. a 1400x300 frame is 673 to 929 rects of sea and 237 to 304 of
//     sand, worst frame 1205 for the pair. 375x200 is 625 to 869 and 120 to 189,
//     worst frame 1023. the sea is nearly width independent on purpose: run cost
//     is the total vertical travel of the boundaries, and the dither, caustic
//     and glint cell counts are fixed across the width, so a desktop costs about
//     what a phone costs. 3000x600 worst frame is 1198 and 3840x900 is 1193, so
//     a 4k panel costs what a phone costs. that also means the worst frame sits
//     right on the 1200 budget with no headroom, and anything new has to buy its
//     rects off something else. the split at 1400x300 midday is 373 bands, 285
//     dither, 90 caustics, 45 treeline, 33 glints, 30 crests, 9 to 13 sun path
//     depending on how low the sun is, and on the sand 110 grain, 67 bands, 39
//     dither, 33 lip, 10 wash.
//
// t is seconds and the caller owns the loop. the crest pool and the drying sand
// are the only state, they advance by the delta between calls and ignore a
// repeated t, so calling twice with the same t paints the same pixels and a
// frozen t for reduced motion holds a still that already has crests in it (the
// pool is warmed up at load).
//
// ONE THING CHANGED FOR THE CALLER: drawSand animates now, because the run up is
// on the sand and not on the water. it can no longer be baked into a still at
// t 0. bake the props on their own over a cleared canvas and call drawSand per
// frame between drawSea and the still, or bake the beach and redraw only the top
// strip yourself. it is about 200 rects, most of them the static grain.
// drawSand also takes an optional flat [x, strength, ...] list of point lights
// for the torch reflections after dark. see its own comment.

import { PALETTE } from "./jungle-sprites.js?v=30";

const TAU = Math.PI * 2;
const SEA_BANDS = 7;
const NB = SEA_BANDS - 1; // interior boundaries, the ones that move
const RAMP_S = 5; // colour slots per band. cycling walks one slot either way, so
const RAMP_H = RAMP_S >> 1; // a step is a fifth of a band: light moving, not a new band
const RAMP_N = SEA_BANDS * RAMP_S;
const CACHE_CAP = 8;
// water and sand are flat surfaces facing straight up, so n.l is just the sun's
// elevation and the key weight is the same wrap the sprite shader applies to a
// flat pixel. a fixed weight here rendered the ground at ~60% of the props
// standing on it, and could not tell noon from dawn.
const NIGHT_DZ = 0.42; // the torch line is low and close, so treat it as raking

const LUT = 2048;
const LUT_M = LUT - 1;

const CRESTS = 24; // the pool
const SPAWN_N = 10; // places along the break line that can throw one
const FOAM_SEGS = 32;
const TREE_N = 9;
const CAUS_ROWS = 13;
const GRAIN_CAP = 110;
const GRAIN_AREA = 2100;

// ---- colour, all of this runs at load or on a cache miss -------------------

function hexToRgb(hex) {
  const n = parseInt(hex.charAt(0) === "#" ? hex.slice(1) : hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function stopAt(stops, u) {
  const f = Math.min(0.9999, Math.max(0, u)) * (stops.length - 1);
  const i = f | 0;
  return mix(stops[i], stops[i + 1], f - i);
}

const C_DEEP = hexToRgb(PALETTE.a);
const C_MID = hexToRgb(PALETTE.A);
const C_SHAL = hexToRgb(PALETTE.z);
const C_SAND = hexToRgb(PALETTE.s);
const C_SANDSH = hexToRgb(PALETTE.S);
const C_BLEACH = hexToRgb(PALETTE.d);
const C_WOOD = hexToRgb(PALETTE.w);
const C_TREE = hexToRgb(PALETTE.G);
const WHITE = [255, 255, 255];

// aerial perspective, fixed. the old ramp made the horizon DARKER than the deep
// water, which is backwards: distance scatters light in, so the far water lifts
// in value and loses saturation toward the sky. the ramp is not monotonic any
// more, it is pale at the horizon, darkest a band or two down where the water is
// actually deep, then climbs again into the shallows.
const HAZE = [158, 176, 186];
const SEA_STOPS = [
  mix(C_DEEP, HAZE, 0.55),
  mix(C_DEEP, HAZE, 0.24),
  C_DEEP,
  mix(C_DEEP, C_MID, 0.45),
  mix(C_MID, C_SHAL, 0.16),
  mix(C_MID, C_SHAL, 0.68),
  // the last stop has a little sand in it. shallow water is bright because you
  // are looking at the bottom through it, not because the water is paler.
  mix(mix(C_SHAL, WHITE, 0.16), C_SAND, 0.12),
];

// band b sits on b*RAMP_S+RAMP_H and the cycling term nudges it one slot either
// way. a whole band step would read as the band changing colour, a fifth of one
// reads as light travelling over the water, which is the point.
const SEA_RAMP = [];
for (let i = 0; i < RAMP_N; i++) {
  SEA_RAMP.push(stopAt(SEA_STOPS, i / (RAMP_N - 1)));
}
const RAMP_MID = [0, 0, 0];
for (let i = 0; i < RAMP_N; i++) {
  RAMP_MID[0] += SEA_RAMP[i][0] / RAMP_N;
  RAMP_MID[1] += SEA_RAMP[i][1] / RAMP_N;
  RAMP_MID[2] += SEA_RAMP[i][2] / RAMP_N;
}

const SAND_DRY = mix(C_SAND, C_BLEACH, 0.22);
const GRAIN_BASE = [mix(C_SAND, C_SANDSH, 0.55), mix(C_SAND, C_BLEACH, 0.72)];
const SAND_WET = mix(mix(C_SANDSH, C_WOOD, 0.28), C_MID, 0.2);
const SAND_DAMP = mix(SAND_WET, SAND_DRY, 0.52);
const SAND_MID = mix(SAND_WET, SAND_DRY, 0.5);
// the sheet of water actually running up the beach is water, not wet sand
const SWASH = mix(mix(C_SHAL, WHITE, 0.22), SAND_WET, 0.34);
const SWASH_FILM = mix(SWASH, mix(C_SHAL, WHITE, 0.3), 0.5);
const TREE_DARK = mix(C_TREE, [0, 0, 0], 0.25);

// ---- deterministic noise ---------------------------------------------------

// same lcg the scene lays its palms out with, so the beach is the same beach
// every visit
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// cheap integer hash. the crest pool picks its numbers out of this so a spawn
// costs no state and no allocation.
function hash2(a, b) {
  let x = Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// ---- sine table ------------------------------------------------------------

// every wave in here is phase stepped through this table. one table read beats
// Math.sin by a mile and it never drifts the way an incremental rotation does.
const SIN = new Float32Array(LUT);
for (let i = 0; i < LUT; i++) SIN[i] = Math.sin((i / LUT) * TAU);

// turns in, -1..1 out
function sinT(turns) {
  return SIN[((turns * LUT) | 0) & LUT_M];
}

// bring a phase in lut units into [0, LUT) so the column walk can stay positive
// and use a plain truncate
function normPh(p) {
  p -= Math.floor(p / LUT) * LUT;
  return p;
}

// ---- the swell -------------------------------------------------------------

// three components, cycles across the width, turns per second, start phase.
// speeds are mixed sign so the short chop crosses the long swell instead of
// riding it, which is what stops the whole surface looking like one sheet.
const W_CYC = new Float32Array([1.7, 3.6, 6.7]);
const W_SPD = new Float32Array([0.115, -0.17, 0.265]);
const W_PH = new Float32Array([0.13, 0.61, 0.42]);

// relative weights, deep to shallow. deep water is long and lazy, the shallows
// carry more of the short chop.
const W_DEEP = new Float32Array([0.72, 0.22, 0.06]);
const W_SHAL = new Float32Array([0.46, 0.32, 0.22]);

// per boundary: weight mix, amplitude fraction, time scale, phase offset
const B_AMP = new Float32Array(NB * 3);
const B_F = new Float32Array(NB);
const B_TSC = new Float32Array(NB);
const B_PH = new Float32Array(NB);
(function () {
  for (let b = 0; b < NB; b++) {
    const u = (b + 1) / NB;
    // amplitude grows toward the shore, but never all the way to nothing: a
    // boundary with less than about a px of travel is a ruled line again.
    B_F[b] = 0.18 + 0.82 * Math.pow(u, 1.4);
    B_TSC[b] = 0.72 + 0.5 * u;
    B_PH[b] = b * 0.37;
    for (let k = 0; k < 3; k++) {
      B_AMP[b * 3 + k] = W_DEEP[k] + (W_SHAL[k] - W_DEEP[k]) * u;
    }
  }
})();

// the shallow flavour of the same field, for anything that needs one number
// instead of a whole row: crest births, the run up, the treeline jitter.
function swell(xu, t) {
  return (
    W_SHAL[0] * sinT(W_CYC[0] * xu + W_SPD[0] * t + W_PH[0]) +
    W_SHAL[1] * sinT(W_CYC[1] * xu + W_SPD[1] * t + W_PH[1]) +
    W_SHAL[2] * sinT(W_CYC[2] * xu + W_SPD[2] * t + W_PH[2])
  );
}

// palette cycling. the slot offset rides the LONG component of the band's own
// boundary, a quarter turn behind it, so the lighter water sits on the face of
// the swell and the tone edges land where the surface is steepest. a free
// running term instead of this one tiles the sea into vertical panels, which is
// what it looked like the first time.
const MOD_OFF = 0.26; // turns behind the swell
const MOD_THR = 0.72; // high, so the base slot still owns half the water

// ---- ordered dither --------------------------------------------------------

// bayer 4x4. cells are a few px wide so a run of "on" cells is one rect, which
// is the only way a full width dither fits the budget.
const BAYER = new Uint8Array([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

// ---- unit tables, built once at load ---------------------------------------

// foam segments, used for the broken lip on the sand and the leftover wash
const FM_U = new Float32Array(FOAM_SEGS);
const FM_L = new Float32Array(FOAM_SEGS);
const FM_P = new Float32Array(FOAM_SEGS);
const FM_S = new Float32Array(FOAM_SEGS);
(function () {
  const r = rng(911);
  for (let i = 0; i < FOAM_SEGS; i++) {
    FM_U[i] = (i + r() * 0.7) / FOAM_SEGS;
    FM_L[i] = (0.3 + r() * 0.6) / FOAM_SEGS;
    FM_P[i] = r() * TAU;
    FM_S[i] = 0.35 + r() * 0.7;
  }
})();

// treeline reflection streaks
const TR_U = new Float32Array(TREE_N);
const TR_W = new Float32Array(TREE_N);
const TR_V = new Float32Array(TREE_N);
const TR_G = new Float32Array(TREE_N);
(function () {
  const r = rng(6631);
  for (let i = 0; i < TREE_N; i++) {
    TR_U[i] = (i + r() * 1.7) / TREE_N;
    TR_W[i] = 0.0012 + r() * 0.0022;
    TR_V[i] = 0.74 + r() * 0.13; // how far out from the shore it reaches
    TR_G[i] = r();
  }
})();

// dry sand grain
const GR_U = new Float32Array(GRAIN_CAP);
const GR_V = new Float32Array(GRAIN_CAP);
const GR_W = new Uint8Array(GRAIN_CAP);
const GR_H = new Uint8Array(GRAIN_CAP);
const GR_B = new Uint8Array(GRAIN_CAP);
(function () {
  const r = rng(31337);
  for (let i = 0; i < GRAIN_CAP; i++) {
    GR_U[i] = r();
    GR_V[i] = Math.pow(r(), 0.8);
    GR_W[i] = 1 + ((r() * 3) | 0);
    GR_H[i] = r() > 0.78 ? 2 : 1;
    GR_B[i] = r() > 0.46 ? 1 : 0;
  }
})();

// where along the break line a wave can start to curl
const SPAWN_U = new Float32Array(SPAWN_N);
(function () {
  const r = rng(1717);
  for (let i = 0; i < SPAWN_N; i++) SPAWN_U[i] = (i + 0.15 + r() * 0.7) / SPAWN_N;
})();

// ---- the crest pool --------------------------------------------------------
//
// fixed size, allocated once, never grown. a dead slot is just CR_ON 0 and the
// next birth walks the array for the first one it finds.

const CR_ON = new Uint8Array(CRESTS);
const CR_X = new Float32Array(CRESTS); // centre, fraction of width
const CR_W = new Float32Array(CRESTS); // width, fraction of width
const CR_V = new Float32Array(CRESTS); // depth, fraction of sea height
const CR_SPD = new Float32Array(CRESTS);
const CR_AGE = new Float32Array(CRESTS);
const CR_LIFE = new Float32Array(CRESTS);
const CR_STR = new Float32Array(CRESTS);
const CD = new Float32Array(SPAWN_N); // per spawn point cooldown
let spawnSeq = 0;

const BREAK_V = 0.5; // the depth waves start to break at
const BREAK_THR = 0.34; // swell has to push past this to curl

function freeSlot() {
  for (let i = 0; i < CRESTS; i++) if (CR_ON[i] === 0) return i;
  return -1;
}

function birth(at, xu, str) {
  const s = freeSlot();
  if (s < 0) return false;
  const r1 = hash2(spawnSeq, at);
  const r2 = hash2(at, spawnSeq + 77);
  const r3 = hash2(spawnSeq + 5, at * 3 + 1);
  spawnSeq = (spawnSeq + 1) & 0xffff;
  CR_ON[s] = 1;
  CR_X[s] = xu + (r1 - 0.5) * 0.05;
  CR_W[s] = 0.09 + r2 * 0.14 + str * 0.06;
  CR_V[s] = BREAK_V + r3 * 0.07;
  CR_LIFE[s] = 3.2 + r1 * 2.6;
  CR_SPD[s] = (1.03 - CR_V[s]) / CR_LIFE[s] * (0.85 + r2 * 0.4);
  CR_AGE[s] = 0;
  CR_STR[s] = 0.4 + str * 0.6;
  return true;
}

// ---- run up ----------------------------------------------------------------

const WASH_RATE = 0.14; // about a seven second cycle
const TIDE_RATE = 0.021; // and a slow one under it
const DRY_RATE = 0.085; // how fast the sand the wave left dries back

function ease(u) {
  return u * u * (3 - 2 * u);
}

// 0 at the bottom of the backwash, 1 at the top of the run up. the surge is
// fast and the drain is slow, which is the whole character of a wave landing.
function washAt(t) {
  const p = t * WASH_RATE + 0.18;
  const f = p - Math.floor(p);
  const surge = f < 0.3 ? ease(f / 0.3) : 1 - ease((f - 0.3) / 0.7);
  const tide = sinT(t * TIDE_RATE + 0.07);
  return Math.min(1, Math.max(0, 0.18 + 0.72 * surge + 0.14 * tide));
}

// ---- the sim ---------------------------------------------------------------
//
// the only mutable state in the file. it advances by the delta between calls,
// ignores a repeated t so drawSea and drawSand can both hand it the same clock,
// and clamps the step so a hidden tab does not fast forward the ocean.

let simT = 0;
let reachU = 0.45; // wettest point the wave got to lately, 0..1 of the run up

function step(dt) {
  for (let i = 0; i < SPAWN_N; i++) {
    CD[i] -= dt;
    if (CD[i] > 0) continue;
    const xu = SPAWN_U[i];
    const s = swell(xu, simT);
    if (s < BREAK_THR) continue;
    const str = Math.min(1, (s - BREAK_THR) / (1 - BREAK_THR));
    if (!birth(i, xu, str)) {
      CD[i] = 0.5;
      continue;
    }
    CD[i] = 1.1 + hash2(i, spawnSeq) * 1.9;
  }
  for (let i = 0; i < CRESTS; i++) {
    if (CR_ON[i] === 0) continue;
    CR_AGE[i] += dt;
    if (CR_AGE[i] >= CR_LIFE[i] || CR_V[i] > 1.04) {
      CR_ON[i] = 0;
      continue;
    }
    // the shore end of a band is fatter, so constant unit speed already reads
    // as the wave picking up. a little extra makes it land.
    CR_V[i] += CR_SPD[i] * dt * (0.75 + 0.5 * CR_V[i]);
    CR_X[i] += swell(CR_X[i], simT) * 0.0035 * dt;
  }
  const d = washAt(simT);
  if (d > reachU) reachU = d;
  else reachU = Math.max(0, reachU - DRY_RATE * dt);
}

function simTo(t) {
  if (t === simT) return;
  if (t < simT) {
    simT = t;
    return;
  }
  let dt = t - simT;
  simT = t;
  if (dt > 0.25) dt = 0.25;
  step(dt);
}

// warm the pool up at load so the very first frame, and a frozen t under
// reduced motion, already have waves in the water instead of flat glass.
(function () {
  for (let i = 0; i < 900; i++) {
    simT += 1 / 30;
    step(1 / 30);
  }
  simT = 0;
})();

// ---- caches ----------------------------------------------------------------

function put(map, key, value) {
  map.set(key, value);
  while (map.size > CACHE_CAP) map.delete(map.keys().next().value);
}

const seaGeos = new Map();
const sandGeos = new Map();
const palettes = new Map();

// lightFor stamps the daypart on the rig and the daypart fixes every number in
// it, so that is a complete key. a hand rolled rig falls back to a coarse
// signature. the two early returns are the hot path and build no string, so a
// frame allocates nothing at all.
function rigSig(light) {
  if (light.key) return light.key;
  if (light.part) return light.part;
  const c = light.color;
  const a = light.ambient;
  return (
    Math.round(c[0] * 63) + "," + Math.round(c[1] * 63) + "," + Math.round(c[2] * 63) + ";" +
    Math.round(a[0] * 63) + "," + Math.round(a[1] * 63) + "," + Math.round(a[2] * 63) + ";" +
    Math.round(light.intensity * 63)
  );
}

// how much daylight there is, 0 at night and 1 at noon. read off the ambient
// because that is the term that does not care where the sun is pointing.
function daynessOf(light) {
  const a = light.ambient;
  const l = 0.3 * a[0] + 0.59 * a[1] + 0.11 * a[2];
  return Math.min(1, Math.max(0, (l - 0.1) / 0.16));
}

// how raking the light is. the rigs are directional now and carry a normalised
// dir, so elevation is right there in dir[2] and this can be honest about it.
// the old version read |stretch| through a window that saturated at 0.9..2.4,
// which pinned dawn, golden and dusk all to 1 and gave morning a flat 0. night
// has no dir and falls back to the stretch.
function lowness(light) {
  const d = light.dir;
  if (d) return Math.min(1, Math.max(0.04, (1 - d[2]) / 0.95));
  const s = Math.abs(light.stretch === undefined ? 1.2 : light.stretch);
  return Math.min(1, Math.max(0, (s - 0.6) / 2.2));
}

const MOON = [0.42, 0.5, 0.6]; // what a highlight collapses to with no sun on it

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function paletteFor(light) {
  const key = rigSig(light);
  const hit = palettes.get(key);
  if (hit) return hit;

  const amb = light.ambient;
  const col = light.color;
  const day = daynessOf(light);
  const dark = 1 - day;
  // a positional rig is the torch line, which is on the sand. it does not light
  // the whole lagoon, so the water only gets a fraction of its key.
  const reach = light.dir ? 1 : 0.42;
  const landReach = light.dir ? 1 : 0.52;
  const dz = light.dir ? light.dir[2] : NIGHT_DZ;
  const k = (dz * 0.92 + 0.08) * light.intensity;
  const low = lowness(light);
  // the body of the water mirrors the SKY, and away from the sun a low sky is
  // not the colour of the sun. without this the golden and dusk rigs multiply a
  // cyan sea by a warm key and land on pond green. the highlights below keep the
  // sun's hue, which is the split that makes a low sun read at all.
  const COOL = 0.7;
  const cmix = low * day * 0.6;
  const cr0 = col[0] + (COOL - col[0]) * cmix;
  const cg0 = col[1] + (0.82 - col[1]) * cmix;
  const cb0 = col[2] + (1 - col[2]) * cmix;
  // the cool add is the sky. without it the night sea multiplies down to a flat
  // brown smear under the torch colour and the seven bands land inside four
  // values of each other.
  const sr = amb[0] + cr0 * k * reach + dark * 0.05;
  const sg = amb[1] + cg0 * k * reach + dark * 0.1;
  const sb = amb[2] + cb0 * k * reach + dark * 0.17;
  const lr = amb[0] + col[0] * k * landReach + dark * 0.02;
  const lg = amb[1] + col[1] * k * landReach + dark * 0.035;
  const lb = amb[2] + col[2] * k * landReach + dark * 0.06;

  // widen the ramp in the dark, but only downward. this is contrast about the
  // ramp's own mean, in base space, so daylight is untouched, night gets a
  // spread you can actually see band edges in, and the shallows stop reading as
  // pale fog after sunset: with no sun on them you cannot see the bottom, so
  // they are not the brightest thing in the water any more.
  const boost = 1 + 0.42 * dark;
  const lift = 1 - 0.34 * dark;
  const sandBoost = 1 + 0.2 * dark;
  const sky = 24 * low * (0.3 + 0.7 * day);
  const skyR = col[0] * sky;
  const skyG = col[1] * sky;
  const skyB = col[2] * sky;

  const spread = (v, m) => m + (v - m) * (v < m ? boost : lift);
  const seaCss = (rgb) =>
    "rgb(" +
    clamp255(spread(rgb[0], RAMP_MID[0]) * sr + skyR) + "," +
    clamp255(spread(rgb[1], RAMP_MID[1]) * sg + skyG) + "," +
    clamp255(spread(rgb[2], RAMP_MID[2]) * sb + skyB) + ")";

  const landCss = (rgb) =>
    "rgb(" +
    clamp255((SAND_MID[0] + (rgb[0] - SAND_MID[0]) * sandBoost) * lr) + "," +
    clamp255((SAND_MID[1] + (rgb[1] - SAND_MID[1]) * sandBoost) * lg) + "," +
    clamp255((SAND_MID[2] + (rgb[2] - SAND_MID[2]) * sandBoost) * lb) + ")";

  // highlights are EXEMPT from the body multiply. foam is not water with the
  // day's tint on it, it is a lot of air catching whatever light there is, so
  // it keeps its value and only takes the light's hue. the old file multiplied
  // it like everything else and midday foam resolved to a grey teal.
  const m = Math.max(col[0], Math.max(col[1], col[2])) || 1;
  const cr = col[0] / m;
  const cg = col[1] / m;
  const cb = col[2] / m;
  const hb = 0.42 + 0.58 * day; // how much light there is to catch
  const cool = Math.pow(dark, 2.2); // and how much of it is not the sun

  const hlCss = (rgb, whiteAmt, bright) => {
    const r0 = rgb[0] + (255 - rgb[0]) * whiteAmt;
    const g0 = rgb[1] + (255 - rgb[1]) * whiteAmt;
    const b0 = rgb[2] + (255 - rgb[2]) * whiteAmt;
    const wr = r0 * cr * hb * bright;
    const wg = g0 * cg * hb * bright;
    const wb = b0 * cb * hb * bright;
    return (
      "rgb(" +
      clamp255(wr + (r0 * MOON[0] * bright - wr) * cool) + "," +
      clamp255(wg + (g0 * MOON[1] * bright - wg) * cool) + "," +
      clamp255(wb + (b0 * MOON[2] * bright - wb) * cool) + ")"
    );
  };

  const sea = [];
  for (let i = 0; i < RAMP_N; i++) sea.push(seaCss(SEA_RAMP[i]));

  const pal = {
    day,
    sea,
    // wash, whitewater, crest lip
    foam: [
      hlCss(C_SHAL, 0.55, 0.86),
      hlCss(C_SHAL, 0.78, 0.95),
      hlCss(C_SHAL, 0.94, 1),
    ],
    // glints on the wave faces
    shim: [hlCss(C_SHAL, 0.42, 0.78), hlCss(C_SHAL, 0.68, 0.92)],
    // the sun path
    spec: [hlCss(C_SHAL, 0.62, 0.92), hlCss(C_SHAL, 0.84, 1), hlCss(C_SHAL, 0.96, 1.08)],
    caus: [hlCss(C_SHAL, 0.4, 0.8), hlCss(C_SHAL, 0.7, 0.96)],
    refl: [
      seaCss(mix(SEA_RAMP[RAMP_N - 7], TREE_DARK, 0.3)),
      seaCss(mix(SEA_RAMP[RAMP_N - 3], TREE_DARK, 0.4)),
    ],
    dry: landCss(SAND_DRY),
    grain: [landCss(GRAIN_BASE[0]), landCss(GRAIN_BASE[1])],
    damp: landCss(SAND_DAMP),
    wet: landCss(SAND_WET),
    swash: seaCss(SWASH),
    film: seaCss(SWASH_FILM),
    // torch on wet sand. this is the light itself, not a surface, so it does
    // not get tinted by the rig at all.
    torch: ["rgb(78,42,15)", "rgb(150,86,30)"],
  };
  put(palettes, key, pal);
  return pal;
}

// ---- sea geometry ----------------------------------------------------------

// last size wins without touching the map, so the steady state does not even
// build a key string
let seaW = -1;
let seaH = -1;
let seaLast = null;

function seaGeoFor(w, h) {
  if (w === seaW && h === seaH) return seaLast;
  const key = w + "x" + h;
  const hit = seaGeos.get(key);
  if (hit) {
    seaW = w;
    seaH = h;
    seaLast = hit;
    return hit;
  }

  // sample the boundaries every bstep px on a wide rect. two px steps are
  // invisible at 1400 and they halve both the sine work and the run count.
  const bstep = Math.max(1, Math.round(w / 700));
  const bn = Math.max(2, Math.ceil(w / bstep));

  // thin bands at the horizon, fat ones in the shallows. an even split looks
  // like a barcode.
  const rows = new Int16Array(SEA_BANDS + 1);
  for (let i = 0; i <= SEA_BANDS; i++) {
    rows[i] = Math.round(h * Math.pow(i / SEA_BANDS, 1.55));
  }
  rows[SEA_BANDS] = h;

  const ampMax = Math.min(7, Math.max(1.8, h * 0.028));
  const amp = new Float32Array(NB * 3);
  const base = new Int16Array(NB);
  for (let b = 0; b < NB; b++) {
    base[b] = rows[b + 1];
    for (let k = 0; k < 3; k++) {
      amp[b * 3 + k] = ampMax * B_F[b] * B_AMP[b * 3 + k];
    }
  }

  // lut units of phase per sample column
  const phi = new Float32Array(3);
  for (let k = 0; k < 3; k++) phi[k] = (W_CYC[k] * bstep / w) * LUT;

  // dither cells. a fixed count across the width keeps the rect cost flat from
  // a phone to a desktop, which is the only reason a full width ordered dither
  // is affordable at all.
  const cellW = Math.max(3, Math.round(w / 52));
  const cellN = Math.max(2, Math.ceil(w / cellW));
  const cellS = new Int16Array(cellN);
  for (let i = 0; i < cellN; i++) {
    cellS[i] = Math.min(bn - 1, ((i * cellW + (cellW >> 1)) / bstep) | 0);
  }
  // the horizon band is fifteen px tall and its colour step is tiny, so one row
  // either side is plenty. everything below it gets the full four row ramp.
  const zone = new Uint8Array(NB);
  for (let b = 0; b < NB; b++) zone[b] = b === 0 ? 1 : 2;

  // caustic rows, crowded toward the shore
  const causY = new Int16Array(CAUS_ROWS);
  const causV = new Float32Array(CAUS_ROWS);
  for (let i = 0; i < CAUS_ROWS; i++) {
    const f = Math.pow(i / (CAUS_ROWS - 1), 1.25);
    const y = Math.min(h - 1, Math.max(0, h - 2 - Math.round(f * h * 0.34)));
    causY[i] = y;
    causV[i] = y / Math.max(1, h);
  }

  const trX = new Int16Array(TREE_N);
  const trW = new Int16Array(TREE_N);
  for (let i = 0; i < TREE_N; i++) {
    trX[i] = Math.round(TR_U[i] * w);
    trW[i] = Math.max(1, Math.min(3, Math.round(TR_W[i] * w)));
  }

  const geo = {
    w, h, bstep, bn, rows, base, amp, phi,
    cellW, cellN, cellS, zone, causY, causV, trX, trW,
    ampMax,
    // scratch, reused every frame so the draw path never allocates
    bnd: new Int16Array(NB * bn),
    cellY: new Int16Array(cellN),
  };
  put(seaGeos, key, geo);
  seaW = w;
  seaH = h;
  seaLast = geo;
  return geo;
}

// walk every boundary once and leave its rounded row per sample column in the
// scratch. everything downstream reads this instead of evaluating sines again.
function buildBounds(geo, t) {
  const bnd = geo.bnd;
  const bn = geo.bn;
  const h = geo.h;
  const amp = geo.amp;
  const phi = geo.phi;
  for (let b = 0; b < NB; b++) {
    const off = b * bn;
    const ts = B_TSC[b];
    const bp = B_PH[b];
    const a0 = amp[b * 3];
    const a1 = amp[b * 3 + 1];
    const a2 = amp[b * 3 + 2];
    let p0 = normPh((W_SPD[0] * t * ts + W_PH[0] + bp) * LUT);
    let p1 = normPh((W_SPD[1] * t * ts + W_PH[1] + bp * 1.7) * LUT);
    let p2 = normPh((W_SPD[2] * t * ts + W_PH[2] + bp * 2.3) * LUT);
    const s0 = phi[0];
    const s1 = phi[1];
    const s2 = phi[2];
    const bs = geo.base[b];
    for (let i = 0; i < bn; i++) {
      const v =
        bs + a0 * SIN[(p0 | 0) & LUT_M] + a1 * SIN[(p1 | 0) & LUT_M] + a2 * SIN[(p2 | 0) & LUT_M];
      p0 += s0;
      p1 += s1;
      p2 += s2;
      let y = (v + 0.5) | 0;
      if (y < 1) y = 1;
      else if (y > h - 1) y = h - 1;
      bnd[off + i] = y;
    }
  }
}

// ---- sand geometry ---------------------------------------------------------

let sandW = -1;
let sandH = -1;
let sandLast = null;

function sandGeoFor(w, h) {
  if (w === sandW && h === sandH) return sandLast;
  const key = w + "x" + h;
  const hit = sandGeos.get(key);
  if (hit) {
    sandW = w;
    sandH = h;
    sandLast = hit;
    return hit;
  }

  const sstep = Math.max(1, Math.round(w / 520));
  const sn = Math.max(2, Math.ceil(w / sstep));

  const swashPx = Math.max(4, Math.min(44, Math.round(h * 0.26)));
  const wetPx = Math.max(2, Math.min(18, Math.round(h * 0.1)));
  const dampPx = Math.max(2, Math.min(16, Math.round(h * 0.09)));
  const eAmp = Math.max(1, Math.min(5, h * 0.03));

  // the sand line is lazier than the sea, two components and fewer cycles, so
  // the waterline is a long curve and not a saw
  const sphi = new Float32Array(2);
  sphi[0] = (1.7 * sstep / w) * LUT;
  sphi[1] = (3.9 * sstep / w) * LUT;

  const n = Math.min(GRAIN_CAP, Math.max(12, Math.round((w * h) / GRAIN_AREA)));
  let dark = 0;
  for (let i = 0; i < n; i++) if (GR_B[i] === 0) dark++;
  const grainDark = new Int16Array(dark * 4);
  const grainLight = new Int16Array((n - dark) * 4);
  let d = 0;
  let l = 0;
  const dryTop = Math.min(h - 1, swashPx + wetPx + dampPx + 2);
  const dryH = Math.max(1, h - dryTop);
  for (let i = 0; i < n; i++) {
    const x = Math.round(GR_U[i] * w);
    const gh = Math.min(GR_H[i], h);
    const y = Math.max(0, Math.min(h - gh, dryTop + Math.round(GR_V[i] * dryH)));
    const arr = GR_B[i] === 0 ? grainDark : grainLight;
    const p = GR_B[i] === 0 ? d : l;
    arr[p] = x;
    arr[p + 1] = y;
    arr[p + 2] = GR_W[i];
    arr[p + 3] = gh;
    if (GR_B[i] === 0) d += 4;
    else l += 4;
  }

  const cellW = Math.max(3, Math.round(w / 52));
  const cellN = Math.max(2, Math.ceil(w / cellW));
  const cellS = new Int16Array(cellN);
  for (let i = 0; i < cellN; i++) {
    cellS[i] = Math.min(sn - 1, ((i * cellW + (cellW >> 1)) / sstep) | 0);
  }

  const fmX = new Int16Array(FOAM_SEGS);
  const fmL = new Int16Array(FOAM_SEGS);
  for (let i = 0; i < FOAM_SEGS; i++) {
    fmX[i] = Math.round(FM_U[i] * w);
    fmL[i] = Math.max(2, Math.round(FM_L[i] * w));
  }

  const geo = {
    w, h, sstep, sn, sphi, swashPx, wetPx, dampPx, eAmp,
    grainDark, grainLight, cellW, cellN, cellS, fmX, fmL,
    wob: new Int16Array(sn),
  };
  put(sandGeos, key, geo);
  sandW = w;
  sandH = h;
  sandLast = geo;
  return geo;
}

// the waterline wobble, same idea as the sea boundaries but only two components
function buildWob(geo, t) {
  const wob = geo.wob;
  const sn = geo.sn;
  const a0 = geo.eAmp * 0.66;
  const a1 = geo.eAmp * 0.34;
  let p0 = normPh((0.09 * t + 0.21) * LUT);
  let p1 = normPh((-0.15 * t + 0.66) * LUT);
  const s0 = geo.sphi[0];
  const s1 = geo.sphi[1];
  for (let i = 0; i < sn; i++) {
    const v = a0 * SIN[(p0 | 0) & LUT_M] + a1 * SIN[(p1 | 0) & LUT_M];
    p0 += s0;
    p1 += s1;
    wob[i] = v < 0 ? -(-v + 0.5) | 0 : (v + 0.5) | 0;
  }
}

/**
 * the water. rect is {x, y, w, h} in css pixels with the horizon at the top and
 * the waterline at the bottom, light is a rig from light-rig.js, t is seconds.
 *
 * pass the same t to drawSand or the two halves of the waterline will argue.
 */
export function drawSea(ctx, rect, light, t = 0) {
  // round the edges, not the size. rounding w and h on their own drops or
  // doubles a row whenever the rect lands on a half pixel, which on the scene's
  // own 0.34 / 0.16 split happens on about a quarter of all viewport heights and
  // leaves a hairline of page background across the waterline.
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const w = Math.max(1, Math.round(rect.x + rect.w) - x0);
  const h = Math.max(1, Math.round(rect.y + rect.h) - y0);
  simTo(t);
  const geo = seaGeoFor(w, h);
  const pal = paletteFor(light);
  const day = pal.day;
  const bn = geo.bn;
  const bstep = geo.bstep;
  const bnd = geo.bnd;

  buildBounds(geo, t);

  // ---- the depth ramp, walked as runs ------------------------------------
  //
  // one rect per y step of the pair of boundaries that bound the band, plus a
  // break wherever the cycling term moves the colour slot. on a straight
  // boundary that is one rect for the whole band, which is what the old file
  // cost, and the rest is what the motion actually costs.
  let styleI = -1;
  for (let b = 0; b < SEA_BANDS; b++) {
    const topOff = (b - 1) * bn;
    const botOff = b * bn;
    const flatTop = b === 0;
    const flatBot = b === SEA_BANDS - 1;
    const mb = b < NB ? b : NB - 1;
    let pm = normPh((W_SPD[0] * t * B_TSC[mb] + W_PH[0] + B_PH[mb] + MOD_OFF) * LUT);
    const ms = geo.phi[0];
    const ciBase = b * RAMP_S + RAMP_H;
    let runI = 0;
    let cTop = -1;
    let cBot = -1;
    let cCi = -1;
    for (let i = 0; i <= bn; i++) {
      let top = 0;
      let bot = 0;
      let ci = 0;
      if (i < bn) {
        top = flatTop ? 0 : bnd[topOff + i];
        bot = flatBot ? h : bnd[botOff + i];
        const mv = SIN[(pm | 0) & LUT_M];
        pm += ms;
        ci = ciBase + (mv > MOD_THR ? 1 : mv < -MOD_THR ? -1 : 0);
      }
      if (i === bn || top !== cTop || bot !== cBot || ci !== cCi) {
        if (cCi >= 0 && i > runI && cBot > cTop) {
          const px = runI * bstep;
          let pw = (i - runI) * bstep;
          if (px + pw > w) pw = w - px;
          if (pw > 0) {
            if (styleI !== cCi) {
              ctx.fillStyle = pal.sea[cCi];
              styleI = cCi;
            }
            ctx.fillRect(x0 + px, y0 + cTop, pw, cBot - cTop);
          }
        }
        runI = i;
        cTop = top;
        cBot = bot;
        cCi = ci;
      }
    }
  }

  // ---- ordered dither across every boundary -------------------------------
  //
  // bayer 4x4 in a zone that follows the wavy boundary. coverage ramps 0 -> 50
  // -> 100 through the zone, cells are cellW wide and runs of lit cells merge,
  // so the whole thing is bounded by the cell count and not by the width.
  const cellN = geo.cellN;
  const cellW = geo.cellW;
  const cellS = geo.cellS;
  const cellY = geo.cellY;
  for (let bi = 0; bi < NB; bi++) {
    const z = geo.zone[bi];
    if (z === 0) continue;
    const off = bi * bn;
    for (let i = 0; i < cellN; i++) cellY[i] = bnd[off + cellS[i]];
    const upper = pal.sea[bi * RAMP_S + RAMP_H];
    const lower = pal.sea[(bi + 1) * RAMP_S + RAMP_H];
    const span = z * 2;
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? lower : upper;
      styleI = -1;
      for (let j = pass * z; j < pass * z + z; j++) {
        const dy = j - z;
        const f = (j + 0.5) / span;
        const cov = pass === 0 ? f : 1 - f;
        const thr = cov * 16;
        let rs = -1;
        let ry = 0;
        for (let i = 0; i < cellN; i++) {
          const y = cellY[i] + dy;
          const on =
            y >= 0 && y < h && BAYER[((y & 3) << 2) | (i & 3)] < thr;
          if (on && rs < 0) {
            rs = i;
            ry = y;
          } else if (rs >= 0 && (!on || y !== ry)) {
            const px = rs * cellW;
            let pw = (i - rs) * cellW;
            if (px + pw > w) pw = w - px;
            if (pw > 0) ctx.fillRect(x0 + px, y0 + ry, pw, 1);
            rs = on ? i : -1;
            ry = y;
          }
        }
        if (rs >= 0) {
          const px = rs * cellW;
          let pw = (cellN - rs) * cellW;
          if (px + pw > w) pw = w - px;
          if (pw > 0) ctx.fillRect(x0 + px, y0 + ry, pw, 1);
        }
      }
    }
  }

  // ---- caustics ------------------------------------------------------------
  //
  // two crossed sine fields, kept only where their sum is near its peak, which
  // is the bright edge of the cell and not the cell. needs sun, so it fades out
  // with the light and is gone at night.
  if (day > 0.3) {
    const causY = geo.causY;
    const causV = geo.causV;
    const ccw = Math.max(2, cellW >> 1);
    const ccn = Math.ceil(w / ccw);
    const ca = (6.2 * ccw / w) * LUT;
    const cb = (9.4 * ccw / w) * LUT;
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pal.caus[pass];
      for (let r = 0; r < CAUS_ROWS; r++) {
        const y = causY[r];
        if (y < 1 || y >= h) continue;
        const v = causV[r];
        // shore rows get the tighter net and the lower bar
        const thr = (pass === 0 ? 1.31 : 1.64) + (1 - v) * 0.4;
        let pa = normPh((4.1 * v + 0.11 * t) * LUT);
        let pb = normPh((-6.3 * v - 0.155 * t + 0.4) * LUT);
        let rs = -1;
        for (let i = 0; i < ccn; i++) {
          const f = SIN[(pa | 0) & LUT_M] + SIN[(pb | 0) & LUT_M];
          pa += ca;
          pb += cb;
          const on = f > thr;
          if (on && rs < 0) rs = i;
          else if (!on && rs >= 0) {
            const px = rs * ccw;
            let pw = (i - rs) * ccw;
            if (px + pw > w) pw = w - px;
            if (pw > 0) ctx.fillRect(x0 + px, y0 + y, pw, 1);
            rs = -1;
          }
        }
        if (rs >= 0) {
          const px = rs * ccw;
          let pw = (ccn - rs) * ccw;
          if (px + pw > w) pw = w - px;
          if (pw > 0) ctx.fillRect(x0 + px, y0 + y, pw, 1);
        }
      }
    }
  }

  // ---- treeline reflection -------------------------------------------------
  //
  // broken dark verticals in the shallows, x jittering with the swell so they
  // crawl the way a reflection on moving water does
  if (day > 0.22) {
    const trX = geo.trX;
    const trW = geo.trW;
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pal.refl[pass];
      for (let i = 0; i < TREE_N; i++) {
        if ((i & 1) !== pass) continue;
        let y = Math.round(TR_V[i] * h);
        let seg = 0;
        while (y < h && seg < 5) {
          const hh = 4 + (((TR_G[i] * 11 + seg * 5) | 0) % 5);
          // resampled per segment, or the column walks a straight diagonal and
          // reads as rain instead of a reflection
          const jit = swell(TR_U[i] + seg * 0.017, t * 0.9 + i * 0.13);
          const jx = Math.round(jit * 2.2);
          let x = trX[i] + jx;
          let ww = trW[i];
          if (x < 0) {
            ww += x;
            x = 0;
          }
          if (x + ww > w) ww = w - x;
          const hh2 = Math.min(hh, h - y);
          if (ww > 0 && hh2 > 0) ctx.fillRect(x0 + x, y0 + y, ww, hh2);
          y += hh + (seg & 1);
          seg++;
        }
      }
    }
  }

  // ---- glints on the wave faces -------------------------------------------
  //
  // the old shimmer was ninety six dashes blinking on their own clocks at fixed
  // rows. these are read straight off the boundary rows that were just built:
  // wherever the surface tilts toward the light hard enough, it catches. they
  // travel because the boundary travels, so the whole surface moves together.
  const low = lowness(light);
  const gstep = Math.max(1, Math.round(bn / 64));
  const glintDens = 0.14 + 0.3 * day;
  const sunLeft = light.dir ? light.dir[0] < 0 : false;
  const sgn = sunLeft ? -1 : 1;
  const gcyc = (t * 0.7) | 0;
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pal.shim[pass];
    for (let bi = 1; bi < NB; bi++) {
      const off = bi * bn;
      // far water is smoother and further away, so it catches less and in
      // shorter pieces. this is the depth cue the old uniform dash field threw
      // away.
      const near = bi / (NB - 1);
      const dens = glintDens * (0.3 + 0.7 * near);
      for (let i = gstep; i < bn - gstep; i += gstep) {
        const slope = (bnd[off + i + gstep] - bnd[off + i - gstep]) * sgn;
        if (slope < 1) continue;
        const hv = hash2(bi * 131 + i, gcyc);
        if (hv > dens) continue;
        if ((slope > 1 ? 1 : 0) !== pass) continue;
        const y = bnd[off + i] - 1 - ((hv * 14) | 0) % (2 + bi);
        if (y < 0 || y >= h) continue;
        let x = i * bstep;
        let len = 1 + ((hv * (2 + near * 12)) | 0);
        if (x + len > w) len = w - x;
        if (len > 0) ctx.fillRect(x0 + x, y0 + y, len, 1);
      }
    }
  }

  // ---- the sun path --------------------------------------------------------
  //
  // sits ON the surface: the dashes land on the boundary rows, so the path
  // bends with the swell instead of floating over it. it points at the rig's
  // own x, so dawn lays it on the left and dusk on the right.
  const sx = Math.round(light.x) - x0;
  // only a sun lays a path. without the dir check the night rig drew a grey
  // daylight path straight down the middle, agreeing with the torches
  if (light.dir && sx > -w && sx < w * 2) {
    const reach = 0.16 + 0.84 * low;
    for (let bi = 1; bi < NB; bi++) {
      const off = bi * bn;
      const depth = bi / (NB - 1);
      // the path fans out toward the viewer the way real glitter does
      const half = Math.round((0.02 + depth * depth * 0.24) * w * (0.5 + reach));
      if (half < 1 || sx + half < 0 || sx - half > w) continue;
      const ci = depth > 0.7 ? 2 : depth > 0.4 ? 1 : 0;
      ctx.fillStyle = pal.spec[ci];
      const lo = Math.max(gstep, Math.min(bn - gstep - 1, ((sx - half) / bstep) | 0));
      const hi = Math.max(gstep, Math.min(bn - gstep - 1, ((sx + half) / bstep) | 0));
      for (let i = lo; i <= hi; i += gstep) {
        const slope = (bnd[off + i + gstep] - bnd[off + i - gstep]) * sgn;
        if (slope < 0) continue;
        const d = Math.abs(i * bstep - sx) / half;
        const hv = hash2(bi * 977 + i, gcyc + 3);
        if (hv > (1 - d * d) * (0.35 + 0.55 * low)) continue;
        const y = bnd[off + i] - (depth > 0.6 ? 1 : 0);
        if (y < 0 || y >= h) continue;
        let x = i * bstep;
        let len = 2 + ((hv * 10 * (1 + depth * 3)) | 0);
        if (x + len > w) len = w - x;
        const tall = depth > 0.75 ? 2 : 1;
        if (len > 0 && y + tall <= h) ctx.fillRect(x0 + x, y0 + y, len, tall);
      }
    }
  }

  // ---- breaking waves ------------------------------------------------------
  //
  // the pool. a live crest is a bright leading line with a couple of gaps in it
  // and a shorter, dimmer whitewater smear trailing behind, both thinning as it
  // runs out of energy.
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 0 ? pal.foam[0] : pal.foam[2];
    for (let c = 0; c < CRESTS; c++) {
      if (CR_ON[c] === 0) continue;
      const life = CR_AGE[c] / CR_LIFE[c];
      const fade = 1 - life * life;
      const y = Math.round(CR_V[c] * h);
      if (y < 1 || y >= h) continue;
      const cx = Math.round(CR_X[c] * w);
      const half = Math.max(2, Math.round(CR_W[c] * w * 0.5 * (0.55 + 0.45 * fade)));
      if (pass === 1) {
        // leading line, broken into three so it does not read as a ruler
        const tall = CR_V[c] > 0.8 && fade > 0.4 && CR_STR[c] > 0.55 ? 2 : 1;
        for (let s = 0; s < 3; s++) {
          const g = hash2(c * 17 + s, (CR_LIFE[c] * 100) | 0);
          const segW = Math.max(1, ((half * 2) / 3.15) | 0);
          let x = cx - half + ((s * half * 2) / 3) | 0;
          x += ((g - 0.5) * segW * 0.5) | 0;
          let ww = segW;
          if (x < 0) {
            ww += x;
            x = 0;
          }
          if (x + ww > w) ww = w - x;
          if (ww > 0 && y + tall <= h) ctx.fillRect(x0 + x, y0 + y, ww, tall);
        }
      } else {
        // whitewater behind it, seaward, thinning as the crest gets away
        const rows = fade > 0.5 ? (CR_STR[c] > 0.62 ? 3 : 2) : 1;
        for (let s = 1; s <= rows; s++) {
          const yy = y - s;
          if (yy < 0) continue;
          const shrink = 1 - s * 0.22;
          const g = hash2(c * 29 + s, (CR_W[c] * 1000) | 0);
          let ww = Math.max(1, ((half * 2 * shrink * (0.5 + g * 0.5)) | 0));
          let x = cx - (ww >> 1) + (((g - 0.5) * half) | 0);
          if (x < 0) {
            ww += x;
            x = 0;
          }
          if (x + ww > w) ww = w - x;
          if (ww > 0) ctx.fillRect(x0 + x, y0 + yy, ww, 1);
        }
      }
    }
  }
}

/**
 * the beach. rect is {x, y, w, h} in css pixels with the waterline at the top.
 * pass the same light and the same t you gave drawSea.
 *
 * lights is OPTIONAL and is how the torches get reflected on the wet sand after
 * dark. it is a flat array like [x0, s0, x1, s1, ...] read two at a time:
 *
 *   x - horizontal position in the SAME px space as rect.x, ie world px
 *   s - strength 0..1, use 0 for a slot that is off so the caller can keep one
 *       preallocated array for the whole session and never build a new one
 *
 * anything falsy is fine and means no point lights. reflections only appear
 * when the rig is dark, so passing torches at midday costs one compare.
 *
 * a Float32Array works as well as a plain array, and the list can be longer
 * than the number of live torches as long as the dead ones carry strength 0.
 *
 * this function ANIMATES now: the waterline runs up the sand and drains back,
 * and the sand it wet dries out behind it. a caller that used to bake it at
 * t 0 has to call it per frame (see the notes at the top of the file).
 */
export function drawSand(ctx, rect, light, t = 0, lights = null) {
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const w = Math.max(1, Math.round(rect.x + rect.w) - x0);
  const h = Math.max(1, Math.round(rect.y + rect.h) - y0);
  simTo(t);
  const geo = sandGeoFor(w, h);
  const pal = paletteFor(light);
  const sn = geo.sn;
  const sstep = geo.sstep;
  const wob = geo.wob;

  buildWob(geo, t);

  // dry sand
  ctx.fillStyle = pal.dry;
  ctx.fillRect(x0, y0, w, h);

  // grain. sparse on purpose, it is there to break the flat, not to be noticed.
  const gd = geo.grainDark;
  ctx.fillStyle = pal.grain[0];
  for (let i = 0; i < gd.length; i += 4) {
    const gw = Math.min(gd[i + 2], w - gd[i]);
    if (gw > 0) ctx.fillRect(x0 + gd[i], y0 + gd[i + 1], gw, gd[i + 3]);
  }
  const gl = geo.grainLight;
  ctx.fillStyle = pal.grain[1];
  for (let i = 0; i < gl.length; i += 4) {
    const gw = Math.min(gl[i + 2], w - gl[i]);
    if (gw > 0) ctx.fillRect(x0 + gl[i], y0 + gl[i + 1], gw, gl[i + 3]);
  }

  // where the water is right now, and how far up it got recently. the gap
  // between the two is sand that is still wet and drying, which is the thing
  // that makes a beach look like a beach and not like a rug.
  const d = washAt(t);
  const rch = Math.max(d, reachU);
  const swashY = Math.round(d * geo.swashPx);
  const wetY = Math.round(rch * geo.swashPx) + geo.wetPx;
  const dampY = wetY + geo.dampPx;

  // three stacked regions, each a wobbling edge walked as runs
  for (let band = 0; band < 3; band++) {
    ctx.fillStyle = band === 0 ? pal.damp : band === 1 ? pal.wet : pal.swash;
    const baseY = band === 0 ? dampY : band === 1 ? wetY : swashY;
    if (baseY <= 0) continue;
    let runI = 0;
    let cy = -1;
    for (let i = 0; i <= sn; i++) {
      let y = -1;
      if (i < sn) {
        const wv = wob[i];
        const dy = band === 0 ? wv >> 1 : band === 1 ? wv - (wv >> 2) : wv;
        y = baseY + dy;
        if (y < 0) y = 0;
        else if (y > h) y = h;
      }
      if (i === sn || y !== cy) {
        if (cy > 0 && i > runI) {
          const px = runI * sstep;
          let pw = (i - runI) * sstep;
          if (px + pw > w) pw = w - px;
          if (pw > 0) ctx.fillRect(x0 + px, y0, pw, cy);
        }
        runI = i;
        cy = y;
      }
    }
  }

  // the film still lying on the sand right under the water, and the foam lip
  // riding on the front of it
  const filmY = Math.round((swashY - geo.eAmp) * 0.45);
  if (filmY >= 1) {
    ctx.fillStyle = pal.film;
    ctx.fillRect(x0, y0, w, Math.min(filmY, h));
  }

  // the lip. broken by the swell so it is a line of surf and not a hem.
  const lipGate = 0.02;
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 0 ? pal.foam[1] : pal.foam[2];
    const dyv = pass === 0 ? -1 : 0;
    let runI = -1;
    let cy = -1;
    for (let i = 0; i <= sn; i++) {
      let y = -1;
      let on = false;
      if (i < sn) {
        const xu = (i * sstep) / w;
        on =
          swell(xu, t * 1.1 + 0.3) > lipGate - pass * 0.3 &&
          sinT(xu * 6.3 + t * 0.37) > -0.3 &&
          sinT(xu * 17.7 - t * 0.62 + 0.4) > -0.55;
        y = swashY + wob[i] + dyv;
        if (y < 0 || y >= h) on = false;
      }
      if (runI >= 0 && (!on || y !== cy || i === sn)) {
        const px = runI * sstep;
        let pw = (i - runI) * sstep;
        if (px + pw > w) pw = w - px;
        if (pw > 0) ctx.fillRect(x0 + px, y0 + cy, pw, 1);
        runI = on ? i : -1;
        cy = y;
      } else if (on && runI < 0) {
        runI = i;
        cy = y;
      }
    }
  }

  // leftover wash on the wet sand behind the lip, drying in place
  if (wetY > swashY + 1) {
    ctx.fillStyle = pal.foam[0];
    const fmX = geo.fmX;
    const fmL = geo.fmL;
    const span = wetY - swashY;
    for (let i = 0; i < FOAM_SEGS; i++) {
      const g = sinT(t * FM_S[i] * 0.16 + FM_P[i]);
      if (g < 0.55) continue;
      const y = swashY + 1 + ((FM_U[i] * 7.3 % 1) * span) | 0;
      if (y < 0 || y >= h) continue;
      const len = Math.min(fmL[i], w - fmX[i]);
      if (len > 0) ctx.fillRect(x0 + fmX[i], y0 + y, len, 1);
    }
  }

  // ---- point lights on the wet sand ---------------------------------------
  //
  // the torches. a wet beach is a mirror, so each one lays a broken warm column
  // down the wash, jittering on the same wobble as the waterline.
  if (lights && pal.day < 0.55 && wetY > 2) {
    const dim = 1 - pal.day / 0.55;
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pal.torch[pass];
      for (let li = 0; li + 1 < lights.length; li += 2) {
        const s = lights[li + 1] * dim;
        if (!(s > 0.06)) continue;
        // the bright core only shows up under a torch that is actually burning
        if (pass === 1 && s < 0.4) continue;
        const lx = Math.round(lights[li]) - x0;
        if (lx < -40 || lx > w + 40) continue;
        const segs = pass === 0 ? 4 : 2;
        const si = Math.max(0, Math.min(sn - 1, (lx / sstep) | 0));
        // only the film right at the water mirrors. a strong torch reaches a
        // little further up the wet sand than a guttering one.
        // a short smear, near the water. a column as long as the wet band reads
        // as a fence post stuck in the beach, which is exactly what it looked
        // like the first time.
        const span = Math.max(3, Math.min(wetY, 5 + ((13 * s) | 0)));
        const stepY = Math.max(2, (span / segs) | 0);
        for (let j = 0; j < segs; j++) {
          const yy = j * stepY;
          if (yy >= h || yy >= span) break;
          // it wanders on the same wobble as the waterline and comes apart as it
          // gets away from the flame
          const jx = ((wob[si] * (1 + j)) >> 2) + (((hash2(li, j) - 0.5) * (2 + j)) | 0);
          const ww = pass === 0 ? (j < 2 ? 2 : 1) : 1;
          let x = lx + jx - (ww >> 1);
          let cw = ww;
          if (x < 0) {
            cw += x;
            x = 0;
          }
          if (x + cw > w) cw = w - x;
          const hh = Math.min(Math.max(1, stepY - 2 - (j & 1)), h - yy, span - yy);
          if (cw > 0 && hh > 0) ctx.fillRect(x0 + x, y0 + yy, cw, hh);
        }
      }
    }
  }

  // ---- the damp edge, ordered dither --------------------------------------
  //
  // same bayer zone the sea uses on its bands, so wet sand does not end on a
  // ruled line
  const cellN = geo.cellN;
  const cellW = geo.cellW;
  const cellS = geo.cellS;
  ctx.fillStyle = pal.damp;
  for (let j = 0; j < 2; j++) {
    const cov = j === 0 ? 0.62 : 0.28;
    const thr = cov * 16;
    let rs = -1;
    let ry = 0;
    for (let i = 0; i < cellN; i++) {
      const wv = wob[cellS[i]];
      const y = dampY + (wv >> 1) + j;
      const on = y >= 0 && y < h && BAYER[((y & 3) << 2) | (i & 3)] < thr;
      if (on && rs < 0) {
        rs = i;
        ry = y;
      } else if (rs >= 0 && (!on || y !== ry)) {
        const px = rs * cellW;
        let pw = (i - rs) * cellW;
        if (px + pw > w) pw = w - px;
        if (pw > 0) ctx.fillRect(x0 + px, y0 + ry, pw, 1);
        rs = on ? i : -1;
        ry = y;
      }
    }
    if (rs >= 0) {
      const px = rs * cellW;
      let pw = (cellN - rs) * cellW;
      if (px + pw > w) pw = w - px;
      if (pw > 0) ctx.fillRect(x0 + px, y0 + ry, pw, 1);
    }
  }
}
