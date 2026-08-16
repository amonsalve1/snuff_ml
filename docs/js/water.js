// the sea and the sand.
//
// the beach used to be two solid rects with a stripe on each, which reads as
// construction paper. this draws the same two shapes as pixel art instead: the
// water gets a banded depth ramp, drifting shimmer, a sun path when the light
// is low and a foam edge, and the sand gets a wet band under that foam plus a
// sparse grain dither on the dry part.
//
// rules, because this sits under a data site:
//   - everything is fillRect. no gradient objects, no getImageData, no blend.
//   - nothing is allocated in the draw path. the tables are built once at load
//     in unit space, scaled to pixels once per size, and the css colour
//     strings are built once per rig. all three are cached.
//   - a frame is a few hundred solid rects, most of them the sand grain, which
//     a phone eats for breakfast.
//
// the bands are the aesthetic. a smooth gradient would be wrong here, the rest
// of the scene is 1px art and the water should band like the sprites do.
//
// nothing animates on its own. t is seconds and the caller owns the loop, so
// freezing t for reduced motion just gives you a still frame that still reads.

import { PALETTE } from "./jungle-sprites.js?v=18";

const SEA_BANDS = 7;
const EDGE_N = 7; // dither specks per band boundary
const SHIMMER = 96;
const FOAM_SEGS = 48;
const SPEC_ROWS = 14;
const WET_DITHER = 26;
const GRAIN_CAP = 180;
const GRAIN_AREA = 1100; // one speck per this many css px of sand, up to the cap
const K = 0.42; // same key weight the scene already uses on its flat fills
const CACHE_CAP = 8;
const TAU = Math.PI * 2;

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

// sample a list of rgb stops at u 0..1
function stopAt(stops, u) {
  const f = Math.min(0.9999, Math.max(0, u)) * (stops.length - 1);
  const i = f | 0;
  return mix(stops[i], stops[i + 1], f - i);
}

const C_DEEP = hexToRgb(PALETTE.a); // deep lagoon
const C_MID = hexToRgb(PALETTE.A); // lagoon
const C_SHAL = hexToRgb(PALETTE.z); // shallows and foam
const C_SAND = hexToRgb(PALETTE.s);
const C_SANDSH = hexToRgb(PALETTE.S);
const C_BLEACH = hexToRgb(PALETTE.d);
const C_WOOD = hexToRgb(PALETTE.w);
const WHITE = [255, 255, 255];

// horizon first, shore last. the top stop is deeper than the palette's deep
// blue so the far water actually goes away from you.
const SEA_STOPS = [
  mix(C_DEEP, [7, 24, 36], 0.5),
  C_DEEP,
  mix(C_DEEP, C_MID, 0.5),
  C_MID,
  mix(C_MID, C_SHAL, 0.62),
];
const SEA_BASE = [];
for (let i = 0; i < SEA_BANDS; i++) {
  SEA_BASE.push(stopAt(SEA_STOPS, i / (SEA_BANDS - 1)));
}

const SHIM_BASE = [mix(C_SHAL, WHITE, 0.18), mix(C_SHAL, WHITE, 0.62)];
const FOAM_BASE = [mix(C_SHAL, WHITE, 0.42), mix(C_SHAL, WHITE, 0.82)];
// near white on purpose. the sun path takes its colour from the rig tint, so
// a golden hour sun lays a gold path and a torch lays an orange one.
const SPEC_BASE = [
  mix(C_SHAL, [255, 246, 220], 0.5),
  mix(C_SHAL, [255, 248, 226], 0.75),
  [255, 250, 232],
];

const SAND_DRY = mix(C_SAND, C_BLEACH, 0.22);
const GRAIN_BASE = [mix(C_SAND, C_SANDSH, 0.55), mix(C_SAND, C_BLEACH, 0.72)];
// wet sand: darker and a bit richer, then pulled a touch toward the water
const SAND_WET = mix(mix(C_SANDSH, C_WOOD, 0.35), C_MID, 0.1);
// the half dry strip the last wave reached. without this step the wet band is
// a stripe of tape across the beach.
const SAND_DAMP = mix(SAND_WET, SAND_DRY, 0.52);
const SAND_SHEEN = mix(SAND_WET, mix(C_DEEP, [0, 0, 0], 0.25), 0.34);

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

// cheap integer hash, used for the per cycle reshuffle so a dash can pick a new
// row without anyone storing state
function hash2(a, b) {
  let x = Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// ---- unit tables, built once at load ---------------------------------------

// shimmer dashes. u is a fraction of a crossing, v a fraction of sea height,
// spd is crossings per second and is signed so half of them drift left.
const SH_U = new Float32Array(SHIMMER);
const SH_V = new Float32Array(SHIMMER);
const SH_L = new Float32Array(SHIMMER);
const SH_S = new Float32Array(SHIMMER);
const SH_P = new Float32Array(SHIMMER);
const SH_B = new Float32Array(SHIMMER);
(function () {
  const r = rng(4703);
  for (let i = 0; i < SHIMMER; i++) {
    SH_U[i] = r();
    SH_V[i] = Math.pow(r(), 0.55); // crowd the shallows, the horizon stays calm
    SH_L[i] = 0.22 + r() * 0.78;
    SH_S[i] = (0.012 + r() * 0.03) * (r() > 0.5 ? 1 : -1);
    SH_P[i] = r() * TAU;
    SH_B[i] = 0.55 + r() * 1.5; // blink rate, 3 to 11 second cycles
  }
})();

// foam segments, laid along the waterline with gaps so the row is broken
const FM_U = new Float32Array(FOAM_SEGS);
const FM_L = new Float32Array(FOAM_SEGS);
const FM_P = new Float32Array(FOAM_SEGS);
const FM_S = new Float32Array(FOAM_SEGS);
(function () {
  const r = rng(911);
  for (let i = 0; i < FOAM_SEGS; i++) {
    FM_U[i] = (i + r() * 0.7) / FOAM_SEGS;
    FM_L[i] = (0.28 + r() * 0.52) / FOAM_SEGS;
    FM_P[i] = r() * TAU;
    FM_S[i] = 0.3 + r() * 0.6;
  }
})();

// band boundary dither. bucket k is the darker band's colour spilling one or
// two rows down into the lighter band below it.
const ED_U = new Float32Array((SEA_BANDS - 1) * EDGE_N);
const ED_L = new Float32Array(ED_U.length);
const ED_Y = new Uint8Array(ED_U.length);
(function () {
  const r = rng(20260816);
  for (let i = 0; i < ED_U.length; i++) {
    ED_U[i] = r();
    ED_L[i] = 0.004 + r() * 0.012;
    ED_Y[i] = r() > 0.62 ? 1 : 0;
  }
})();

// dither for the two sand steps, wet into damp and damp into dry. y is rows
// below whichever edge it belongs to. the second half of the table is the damp
// edge, which is why it is twice as long.
const WD_U = new Float32Array(WET_DITHER * 2);
const WD_L = new Float32Array(WET_DITHER * 2);
const WD_Y = new Uint8Array(WET_DITHER * 2);
(function () {
  const r = rng(5150);
  for (let i = 0; i < WD_U.length; i++) {
    WD_U[i] = ((i % WET_DITHER) + r()) / WET_DITHER;
    WD_L[i] = 0.005 + r() * 0.018;
    WD_Y[i] = (r() * 3) | 0;
  }
})();

// dry sand grain. bucket 0 is darker than the sand, bucket 1 lighter, and v is
// biased down the beach so the strip nearest the water stays smooth.
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

// ---- caches ----------------------------------------------------------------

// insertion ordered plus a hard cap, same trick pixel.js uses
function put(map, key, value) {
  map.set(key, value);
  while (map.size > CACHE_CAP) map.delete(map.keys().next().value);
}

const seaGeos = new Map();
const sandGeos = new Map();
const palettes = new Map();

// lightFor stamps the daypart on the rig and the daypart fixes every number in
// it, so that is a complete key. a hand rolled rig falls back to a coarse
// signature, quantised so tiny wobbles do not thrash the cache. the two early
// returns are the hot path and deliberately do not build a string, so a frame
// allocates nothing at all.
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

// base * (ambient + colour * k * intensity), the same shape the sprite shader
// resolves to on a flat facing pixel. that is why the sea and the sprites go
// warm together at golden and nearly black together at night.
function paletteFor(light) {
  const key = rigSig(light);
  const hit = palettes.get(key);
  if (hit) return hit;

  const amb = light.ambient;
  const col = light.color;
  const k = K * light.intensity;
  const fr = amb[0] + col[0] * k;
  const fg = amb[1] + col[1] * k;
  const fb = amb[2] + col[2] * k;
  const css = (rgb) => {
    const r = Math.max(0, Math.min(255, Math.round(rgb[0] * fr)));
    const g = Math.max(0, Math.min(255, Math.round(rgb[1] * fg)));
    const b = Math.max(0, Math.min(255, Math.round(rgb[2] * fb)));
    return "rgb(" + r + "," + g + "," + b + ")";
  };

  const pal = {
    sea: SEA_BASE.map(css),
    shimmer: SHIM_BASE.map(css),
    foam: FOAM_BASE.map(css),
    spec: SPEC_BASE.map(css),
    dry: css(SAND_DRY),
    grain: GRAIN_BASE.map(css),
    damp: css(SAND_DAMP),
    wet: css(SAND_WET),
    sheen: css(SAND_SHEEN),
  };
  put(palettes, key, pal);
  return pal;
}

// last size wins without touching the map, so the steady state does not even
// build a key string. the map is there for the resize and the second rect.
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

  // thin bands at the horizon, fat ones in the shallows. that is what sells the
  // distance, an even split just looks like a barcode.
  const rows = new Int16Array(SEA_BANDS + 1);
  for (let i = 0; i <= SEA_BANDS; i++) {
    rows[i] = Math.round(h * Math.pow(i / SEA_BANDS, 1.55));
  }
  rows[SEA_BANDS] = h;

  const edge = new Int16Array(ED_U.length * 3);
  const edgeStart = new Int32Array(SEA_BANDS);
  let e = 0;
  for (let b = 0; b < SEA_BANDS - 1; b++) {
    edgeStart[b] = e;
    for (let i = 0; i < EDGE_N; i++) {
      const s = b * EDGE_N + i;
      edge[e] = Math.round(ED_U[s] * w);
      edge[e + 1] = Math.min(h - 1, rows[b + 1] + ED_Y[s]);
      edge[e + 2] = Math.max(1, Math.round(ED_L[s] * w));
      e += 3;
    }
  }
  edgeStart[SEA_BANDS - 1] = e;

  const shY = new Int16Array(SHIMMER);
  const shLen = new Int16Array(SHIMMER);
  for (let i = 0; i < SHIMMER; i++) {
    const v = SH_V[i];
    shY[i] = Math.min(h - 2, Math.round(v * (h - 3)));
    // a glint at the horizon is one pixel, one in the shallows is a dash
    shLen[i] = Math.max(1, Math.round(SH_L[i] * (1 + v * v * 0.028 * w)));
  }

  const foamX = new Int16Array(FOAM_SEGS);
  const foamLen = new Int16Array(FOAM_SEGS);
  for (let i = 0; i < FOAM_SEGS; i++) {
    foamX[i] = Math.round(FM_U[i] * w);
    foamLen[i] = Math.max(2, Math.round(FM_L[i] * w));
  }

  const specY = new Int16Array(SPEC_ROWS);
  const specHalf = new Int16Array(SPEC_ROWS);
  const specN = new Uint8Array(SPEC_ROWS);
  for (let i = 0; i < SPEC_ROWS; i++) {
    const f = 0.02 + 0.98 * Math.pow(i / (SPEC_ROWS - 1), 1.2);
    specY[i] = Math.min(h - 1, Math.round(f * (h - 1)));
    specHalf[i] = Math.max(2, Math.round((0.012 + f * f * 0.068) * w));
    specN[i] = f < 0.25 ? 1 : f < 0.5 ? 2 : f < 0.74 ? 3 : 4;
  }

  const geo = {
    rows, edge, edgeStart, shY, shLen, foamX, foamLen, specY, specHalf, specN,
    span: w + 48,
    // scratch, reused every frame so the draw path never allocates
    shGate: new Float32Array(SHIMMER),
    fmGate: new Uint8Array(FOAM_SEGS),
  };
  put(seaGeos, key, geo);
  seaW = w;
  seaH = h;
  seaLast = geo;
  return geo;
}

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

  const wetBase = Math.max(3, Math.min(15, Math.round(h * 0.085)));
  const wetSwing = Math.max(1, Math.round(wetBase * 0.3));
  const dampBase = Math.min(h, Math.round(wetBase * 2.6));
  const dryTop = Math.min(h - 1, dampBase + wetSwing + 4);

  const n = Math.min(GRAIN_CAP, Math.max(12, Math.round((w * h) / GRAIN_AREA)));
  let dark = 0;
  for (let i = 0; i < n; i++) if (GR_B[i] === 0) dark++;
  const grainDark = new Int16Array(dark * 4);
  const grainLight = new Int16Array((n - dark) * 4);
  let d = 0;
  let l = 0;
  const dryH = Math.max(1, h - dryTop);
  for (let i = 0; i < n; i++) {
    const x = Math.round(GR_U[i] * w);
    // a 2px speck does not fit in a 1px beach, so shrink it rather than let it
    // hang off the bottom of the rect
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

  const wetX = new Int16Array(WD_U.length);
  const wetLen = new Int16Array(WD_U.length);
  for (let i = 0; i < WD_U.length; i++) {
    wetX[i] = Math.round(WD_U[i] * w);
    wetLen[i] = Math.max(1, Math.round(WD_L[i] * w));
  }

  const foamX = new Int16Array(FOAM_SEGS);
  const foamLen = new Int16Array(FOAM_SEGS);
  for (let i = 0; i < FOAM_SEGS; i++) {
    foamX[i] = Math.round(FM_U[i] * w);
    foamLen[i] = Math.max(2, Math.round(FM_L[i] * w));
  }

  const geo = {
    wetBase, wetSwing, dampBase, grainDark, grainLight, wetX, wetLen,
    foamX, foamLen,
    fmGate: new Uint8Array(FOAM_SEGS),
  };
  put(sandGeos, key, geo);
  sandW = w;
  sandH = h;
  sandLast = geo;
  return geo;
}

// the tide. one slow sine shared by the foam and the wet band so the wash and
// the sand it leaves behind breathe together instead of arguing.
function tideAt(t) {
  return Math.sin(t * 0.21);
}

// how raking the light is, 0 overhead and 1 on the deck. the rig already
// carries this as its shadow stretch, so the sun path and the palm shadows
// agree about where the sun is without me picking a second number.
function lowness(light) {
  const s = Math.abs(light.stretch === undefined ? 1.2 : light.stretch);
  return Math.min(1, Math.max(0, (s - 0.9) / 1.5));
}

/**
 * the water. rect is {x, y, w, h} in css pixels with the horizon at the top and
 * the waterline at the bottom, light is a rig from light-rig.js, t is seconds.
 *
 * the bands and the boundary dither are static, everything else moves. cost is
 * about 170 fillRects on a wide band, near half of that the shimmer.
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
  const geo = seaGeoFor(w, h);
  const pal = paletteFor(light);
  const rows = geo.rows;

  // depth ramp
  for (let b = 0; b < SEA_BANDS; b++) {
    const top = rows[b];
    const hh = rows[b + 1] - top;
    if (hh <= 0) continue;
    ctx.fillStyle = pal.sea[b];
    ctx.fillRect(x0, y0 + top, w, hh);
  }

  // dither across each boundary so the steps read as a ramp and not as tape
  const edge = geo.edge;
  for (let b = 0; b < SEA_BANDS - 1; b++) {
    const end = geo.edgeStart[b + 1];
    if (geo.edgeStart[b] >= end) continue;
    ctx.fillStyle = pal.sea[b];
    for (let i = geo.edgeStart[b]; i < end; i += 3) {
      const len = Math.min(edge[i + 2], w - edge[i]);
      if (len > 0) ctx.fillRect(x0 + edge[i], y0 + edge[i + 1], len, 1);
    }
  }

  // shimmer. gate first into scratch so the sines are paid for once and the
  // two colour passes are two fillStyle writes instead of ninety.
  const gate = geo.shGate;
  for (let i = 0; i < SHIMMER; i++) gate[i] = Math.sin(t * SH_B[i] + SH_P[i]);
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pal.shimmer[pass];
    for (let i = 0; i < SHIMMER; i++) {
      const s = gate[i];
      if (s < 0.15) continue;
      if ((s > 0.72 ? 1 : 0) !== pass) continue;
      // drift, wrapping through a span a little wider than the band so dashes
      // walk on and off the edges instead of popping at x 0
      let u = SH_U[i] + SH_S[i] * t;
      u -= Math.floor(u);
      let x = Math.round(u * geo.span) - 24;
      // new row and new length on every blink, which is the reshuffle
      const cyc = Math.floor((t * SH_B[i] + SH_P[i]) * 0.3183);
      const hop = hash2(i, cyc);
      const y = geo.shY[i] + (hop < 0.34 ? -1 : hop < 0.67 ? 0 : 1);
      if (y < 0 || y >= h) continue;
      let len = Math.max(1, Math.round(geo.shLen[i] * (0.55 + hop * 0.7)));
      // clip to the band rather than painting into whatever is beside it
      if (x < 0) { len += x; x = 0; }
      if (x >= w || len <= 0) continue;
      if (x + len > w) len = w - x;
      ctx.fillRect(x0 + x, y0 + y, len, 1);
    }
  }

  // the sun path. only when the light is raking, always pointing at its x, and
  // widening toward the shore the way real glitter does.
  const low = lowness(light);
  if (low > 0.05) {
    // light.x lives in the same space the rect does, so this is where the sun
    // actually is, not a fraction of the band
    const sx = Math.round(light.x) - x0;
    const rowsUsed = Math.max(3, Math.round(SPEC_ROWS * (0.45 + 0.55 * low)));
    ctx.fillStyle = pal.spec[low > 0.7 ? 2 : low > 0.35 ? 1 : 0];
    for (let i = SPEC_ROWS - rowsUsed; i < SPEC_ROWS; i++) {
      const half = geo.specHalf[i];
      const n = geo.specN[i];
      const y = geo.specY[i];
      const tall = Math.min(i > SPEC_ROWS - 4 ? 2 : 1, h - y);
      for (let k = 0; k < n; k++) {
        const base = n === 1 ? 0 : (k / (n - 1) - 0.5) * 2;
        const wob = Math.sin(t * (0.55 + i * 0.11) + i * 1.7 + k * 2.3);
        const off = Math.round((base * 0.62 + wob * 0.34) * half);
        let len = 2 + Math.round((1 + Math.sin(t * 0.9 + i * 2.1 + k)) * (1 + (i / SPEC_ROWS) * 4));
        let x = sx + off - (len >> 1);
        if (x < 0) { len += x; x = 0; }
        if (x >= w || len <= 0) continue;
        if (x + len > w) len = w - x;
        ctx.fillRect(x0 + x, y0 + y, len, tall);
      }
    }
  }

  // foam, the half that sits on the water. the sand draws the other half from
  // the same table and the same clock, so the two line up into one band.
  const tide = tideAt(t);
  const fg = geo.fmGate;
  for (let i = 0; i < FOAM_SEGS; i++) {
    const s = Math.sin(t * FM_S[i] + FM_P[i]) + tide * 0.55;
    fg[i] = s > 0.95 ? 2 : s > 0.15 ? 1 : 0;
  }
  for (let pass = 1; pass <= 2; pass++) {
    ctx.fillStyle = pal.foam[pass - 1];
    const hh = Math.min(h, pass === 2 ? 2 : 1);
    const yy = y0 + h - hh;
    for (let i = 0; i < FOAM_SEGS; i++) {
      if (fg[i] !== pass) continue;
      const len = Math.min(geo.foamLen[i], w - geo.foamX[i]);
      if (len > 0) ctx.fillRect(x0 + geo.foamX[i], yy, len, hh);
    }
  }
}

/**
 * the beach. rect is {x, y, w, h} in css pixels with the waterline at the top.
 * pass the same light and the same t you gave drawSea.
 *
 * the grain is static and is most of the cost, so a caller that wants this even
 * cheaper can bake drawSand at t 0 into an offscreen and only redraw the top
 * strip. everything that moves lives in the first dozen rows.
 */
export function drawSand(ctx, rect, light, t = 0) {
  // same edge rounding as drawSea, which is what makes the sand's top row land
  // on the sea's bottom row for any fractional rect
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const w = Math.max(1, Math.round(rect.x + rect.w) - x0);
  const h = Math.max(1, Math.round(rect.y + rect.h) - y0);
  const geo = sandGeoFor(w, h);
  const pal = paletteFor(light);
  const tide = tideAt(t);

  // dry sand
  ctx.fillStyle = pal.dry;
  ctx.fillRect(x0, y0, w, h);

  // grain. sparse on purpose, it is there to break the flat, not to be noticed.
  const gd = geo.grainDark;
  ctx.fillStyle = pal.grain[0];
  for (let i = 0; i < gd.length; i += 4) {
    ctx.fillRect(x0 + gd[i], y0 + gd[i + 1], Math.min(gd[i + 2], w - gd[i]), gd[i + 3]);
  }
  const gl = geo.grainLight;
  ctx.fillStyle = pal.grain[1];
  for (let i = 0; i < gl.length; i += 4) {
    ctx.fillRect(x0 + gl[i], y0 + gl[i + 1], Math.min(gl[i + 2], w - gl[i]), gl[i + 3]);
  }

  // the wash, in two steps. the damp strip is how far the last wave got, the
  // wet band is where the water still is, and both breathe on the same tide so
  // the whole waterline creeps up the beach and drains back.
  const swing = Math.round(tide * geo.wetSwing);
  const wx = geo.wetX;
  // clamp to h last, or a beach thinner than the wash paints past its own rect
  const damp = Math.min(h, Math.max(3, geo.dampBase + swing));
  ctx.fillStyle = pal.damp;
  ctx.fillRect(x0, y0, w, damp);
  for (let i = WET_DITHER; i < WD_U.length; i++) {
    const y = damp + WD_Y[i];
    if (y >= h) continue;
    const len = Math.min(geo.wetLen[i], w - wx[i]);
    if (len > 0) ctx.fillRect(x0 + wx[i], y0 + y, len, 1);
  }

  const wet = Math.min(h, Math.max(2, geo.wetBase + swing));
  ctx.fillStyle = pal.wet;
  ctx.fillRect(x0, y0, w, wet);
  // ragged bottom edge, so neither step is a ruled line
  for (let i = 0; i < WET_DITHER; i++) {
    const y = wet + WD_Y[i];
    if (y >= h) continue;
    const len = Math.min(geo.wetLen[i], w - wx[i]);
    if (len > 0) ctx.fillRect(x0 + wx[i], y0 + y, len, 1);
  }
  // the film still lying on the sand right under the water
  ctx.fillStyle = pal.sheen;
  ctx.fillRect(x0, y0, w, Math.max(1, Math.round(wet * 0.34)));

  // foam, the half that runs onto the sand
  const fg = geo.fmGate;
  for (let i = 0; i < FOAM_SEGS; i++) {
    const s = Math.sin(t * FM_S[i] + FM_P[i]) + tide * 0.55;
    fg[i] = s > 0.95 ? 2 : s > 0.15 ? 1 : 0;
  }
  for (let pass = 1; pass <= 2; pass++) {
    ctx.fillStyle = pal.foam[pass - 1];
    const hh = Math.min(h, pass === 2 ? 2 : 1);
    for (let i = 0; i < FOAM_SEGS; i++) {
      if (fg[i] !== pass) continue;
      const len = Math.min(geo.foamLen[i], w - geo.foamX[i]);
      if (len > 0) ctx.fillRect(x0 + geo.foamX[i], y0, len, hh);
    }
  }
}
