// pixel sprite baker and lighter.
//
// two stages. bake() turns a character matrix into flat typed arrays once, at
// load: albedo, a height field, normals, ao, and a per column silhouette.
// shade() resolves those against a light into a small offscreen canvas, and
// memoises the result on a quantised light direction so the steady state is a
// map lookup plus one drawImage. that is the whole trick, everything else here
// is arithmetic that only ever runs on a cache miss.
//
// nothing in here animates on its own. the scene that owns the raf loop is the
// thing that has to check prefers-reduced-motion and stop calling us.

const BUMP = 2.4; // soft bump. pixel art is high frequency and goes foily above this
const AO_R = 2;
const AO_MAX = (AO_R * 2 + 1) * (AO_R * 2 + 1) - 1; // 24 neighbours in a 5x5
const DIRS = 16; // compass buckets for the lit cache
const BANDS = 5; // distance buckets
const BAKE_CAP = 256;
const LIT_CAP = 400; // the source had no eviction. a long tab should not grow forever

const bakes = new Map();
const lit = new Map();
let nextId = 1;
let blank = null; // 1x1 fallback for a degenerate sprite, made on demand

// insertion ordered map plus a hard cap, so the oldest entry falls out first
function put(map, key, value, cap) {
  map.set(key, value);
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

function surface(w, h) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// order independent fingerprint of a palette, so two colour variants of the
// same art do not collide in the bake cache
function paletteSig(palette) {
  const keys = Object.keys(palette).sort();
  let s = "";
  for (let i = 0; i < keys.length; i++) s += keys[i] + palette[keys[i]];
  return s;
}

function hexToRgb(hex) {
  let s = hex.charAt(0) === "#" ? hex.slice(1) : hex;
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * bake a matrix of characters into g buffer arrays.
 *
 * matrix is an array of strings, one char per pixel. '.' and ' ' are holes,
 * anything else indexes palette, which maps char to '#rrggbb'. a char with no
 * palette entry is treated as a hole, so bad art goes see through, not bang.
 *
 * memoised on the art plus the palette, but the key is the joined matrix, so a
 * hit still costs a full string build (a few us on a 40 row sprite). bake once
 * at load and hold the result, do not call this from the raf loop.
 *
 * the returned arrays are the real product. shade() reads them straight, which
 * is the point: getImageData on a canvas is a gpu to cpu readback and doing
 * three of those per cache miss is what blows the frame budget.
 */
export function bake(matrix, palette) {
  const cacheKey = matrix.join("\n") + "~" + paletteSig(palette);
  const hit = bakes.get(cacheKey);
  if (hit) return hit;

  const h = matrix.length;
  let w = 0;
  for (let y = 0; y < h; y++) if (matrix[y].length > w) w = matrix[y].length;

  const albedo = new Uint8ClampedArray(w * h * 4);
  // height doubles as the depth field: 0 outside, 0.55 to 1 inside by luma
  const height = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const row = matrix[y];
    for (let x = 0; x < w; x++) {
      const ch = x < row.length ? row.charAt(x) : ".";
      if (ch === "." || ch === " ") continue;
      const hex = palette[ch];
      if (!hex) continue;
      const rgb = hexToRgb(hex);
      const i = (y * w + x) * 4;
      albedo[i] = rgb[0];
      albedo[i + 1] = rgb[1];
      albedo[i + 2] = rgb[2];
      albedo[i + 3] = 255;
      const luma = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
      height[y * w + x] = 0.55 + 0.45 * luma;
    }
  }

  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : height[y * w + x]);

  // normals: sobel over the height field, xyz as floats.
  // the art supplies its own relief, dark pixels read as deeper.
  const normal = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (height[p] === 0) continue; // stays 0,0,0, never sampled
      const gx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const gy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));

      const nx = gx * BUMP;
      const ny = gy * BUMP;
      const nz = 1; // bias toward the viewer before normalising, so len is never 0
      const len = Math.hypot(nx, ny, nz);
      normal[p * 3] = nx / len;
      normal[p * 3 + 1] = ny / len;
      normal[p * 3 + 2] = nz / len;
    }
  }

  // ao: how enclosed each pixel is by its neighbours. crevices go dark, edges
  // catch the light. a fully surrounded pixel floors at 0.45.
  const ao = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (height[p] === 0) continue;
      let filled = 0;
      for (let dy = -AO_R; dy <= AO_R; dy++) {
        for (let dx = -AO_R; dx <= AO_R; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (at(x + dx, y + dy) > 0) filled++;
        }
      }
      const occ = filled / AO_MAX;
      ao[p] = 1 - 0.55 * occ * occ;
    }
  }

  // per column top and bottom row, -1 when the column is empty. shadow casters
  // raycast against this instead of a bounding box.
  const profile = new Int16Array(w * 2).fill(-1);
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (height[y * w + x] > 0) {
        if (profile[x * 2] === -1) profile[x * 2] = y;
        profile[x * 2 + 1] = y;
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }

  const out = {
    id: nextId++,
    w,
    h,
    albedo,
    height,
    normal,
    ao,
    profile,
    anchor: count
      ? { x: sumX / count / w, y: sumY / count / h }
      : { x: 0.5, y: 0.5 },
  };
  put(bakes, cacheKey, out, BAKE_CAP);
  return out;
}

// which of 16 compass points, how far out of 5 bands, and is the light high or
// raking. 160 possible looks per sprite, and a moving light only crosses a
// boundary every few frames.
function quantise(dx, dy, dz, dist, radius) {
  const a = Math.atan2(dy, dx);
  const dir = Math.round(((a + Math.PI) / (Math.PI * 2)) * DIRS) % DIRS;
  const t = Math.min(1, dist / (radius * 1.6));
  const band = Math.min(BANDS - 1, Math.round(t * (BANDS - 1)));
  const pitch = dz > 0.55 ? 1 : 0;
  return dir * BANDS * 2 + band * 2 + pitch;
}

// direction and distance are in the key but colour is not, so name the rig.
// set light.key when you change colour, ambient or intensity, otherwise we
// derive a coarse signature so a recoloured light cannot serve stale pixels.
//
// z and radius are in here too. quantise() only sees z as a single high/raking
// bit and radius as one of 5 distance bands, but both move the actual maths:
// z swings n dot l and radius swings the falloff. without them a rig that only
// changed height or reach would silently get served the old rig's pixels.
function rigKey(light) {
  if (light.key) return light.key;
  const c = light.color;
  const a = light.ambient;
  return (
    Math.round(c[0] * 63) + "," + Math.round(c[1] * 63) + "," + Math.round(c[2] * 63) + ";" +
    Math.round(a[0] * 63) + "," + Math.round(a[1] * 63) + "," + Math.round(a[2] * 63) + ";" +
    Math.round(light.intensity * 63) + ";" +
    Math.round(light.z / 8) + ";" + Math.round(light.radius / 64)
  );
}

/**
 * light a baked sprite and return an offscreen canvas.
 *
 * light is {x, y, z, radius, color:[r,g,b] 0..1, ambient:[r,g,b] 0..1,
 * intensity} in the same space as sx/sy/scale. relief is 0..1: 0 keeps the
 * art's own shading and just sits it in the scene light, 1 lets the engine
 * sculpt from the derived normals. hand drawn faces want a little, chunky
 * shapes want all of it.
 *
 * sx, sy and scale place the sprite so the light vector can be taken from its
 * centre. leave them off and the sprite sits at the origin at 1:1.
 */
export function shade(sprite, light, relief = 1, sx = 0, sy = 0, scale = 1) {
  // one light vector for the whole sprite. the error across 30px is invisible
  // and it turns a per pixel normalise into a per sprite one.
  const cx = sx + (sprite.w * scale) / 2;
  const cy = sy + (sprite.h * scale) / 2;
  let dx = light.x - cx;
  let dy = light.y - cy;
  const dist = Math.hypot(dx, dy) || 1;
  let dz = light.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;

  const key =
    sprite.id + "|" + rigKey(light) + "|" + relief + "#" +
    quantise(dx, dy, dz, dist, light.radius);
  const hit = lit.get(key);
  if (hit) return hit;

  // createImageData throws IndexSizeError on a zero dimension, which would take
  // the whole backdrop down over one empty sprite. hand back a 1x1 hole.
  if (sprite.w < 1 || sprite.h < 1) {
    if (!blank) {
      blank = surface(1, 1);
      blank.getContext("2d");
    }
    return blank;
  }

  const canvas = surface(sprite.w, sprite.h);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(sprite.w, sprite.h);

  // one falloff for the whole sprite, same reasoning as the light vector
  const atten = light.intensity / (1 + (dist * dist) / (light.radius * light.radius));
  const lr = light.color[0];
  const lg = light.color[1];
  const lb = light.color[2];
  const ar = light.ambient[0];
  const ag = light.ambient[1];
  const ab = light.ambient[2];

  // the rim runs opposite the light, which is what sells the depth
  const rx = -dx;
  const ry = -dy;

  const A = sprite.albedo;
  const N = sprite.normal;
  const O = sprite.ao;
  const D = img.data;
  const total = sprite.w * sprite.h;

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const alpha = A[i + 3];
    if (alpha === 0) {
      D[i + 3] = 0;
      continue;
    }
    const j = p * 3;
    const nx = N[j];
    const ny = N[j + 1];
    const nz = N[j + 2];

    let diff = nx * dx + ny * dy + nz * dz;
    if (diff < 0) diff = 0;
    // a little wrap round the terminator so the dark side is not flat black.
    // only a little, above 0.1 or so the whole scene reads flat.
    diff = diff * 0.92 + 0.08;
    // then fade toward a constant key by relief
    diff = 0.74 * (1 - relief) + relief * diff;

    let rim = relief <= 0 ? 0 : (nx * rx + ny * ry) * relief;
    rim = rim > 0 ? rim * rim * rim : 0;

    const occ = O[p];
    const kd = diff * atten;
    const kr = rim * 0.42 * atten;

    // ao occludes the fill, never the key. a crevice is shielded from sky
    // light, direct sun lands on it anyway. diffuse and rim both ride the
    // pixel's own albedo, so a black pixel stays black instead of glowing.
    D[i] = Math.min(255, A[i] * (ar * occ + lr * kd + lr * kr));
    D[i + 1] = Math.min(255, A[i + 1] * (ag * occ + lg * kd + lg * kr));
    D[i + 2] = Math.min(255, A[i + 2] * (ab * occ + lb * kd + lb * kr));
    D[i + 3] = alpha;
  }

  ctx.putImageData(img, 0, 0);
  put(lit, key, canvas, LIT_CAP);
  return canvas;
}

/**
 * shade (or hit the cache) and blit. integer positions and no smoothing, so the
 * pixels stay square instead of turning to mush on a fractional offset.
 */
export function drawSprite(ctx, sprite, light, x, y, scale = 1, relief = 1) {
  const canvas = shade(sprite, light, relief, x, y, scale);
  ctx.imageSmoothingEnabled = false;
  const dw = Math.max(1, Math.round(sprite.w * scale));
  const dh = Math.max(1, Math.round(sprite.h * scale));
  ctx.drawImage(canvas, Math.round(x), Math.round(y), dw, dh);
  return canvas;
}
