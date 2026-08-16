// cast shadows for the baked sprites.
//
// ported from the tomatoe grove lighter, and it keeps the trick: it does not
// raycast anything. bake() already stored the top of the silhouette for every
// column, so a shadow is that profile sheared onto the ground line. sample ten
// columns, shove each one along the light, fill the fan as one polygon. at
// pixel art scale it is indistinguishable from a real projection and it costs a
// couple of fills instead of a per pixel trace.
//
// the rule this file lives by: nothing allocates. no gradient objects, no point
// arrays, no strings built per call. the sample buffers are module level and
// get overwritten every time, the tone is one constant string and the strength
// rides globalAlpha. safe to call from inside a raf loop.
//
// nothing here animates on its own either, so reduced motion needs no special
// case. a still frame gets the same shadows the moving one would.

const FORESHORTEN = 0.14; // how much of a sideways throw also reads as travel down the plane
const SHADOW_RAMP = 110;
const SAMPLES = 10; // target column count, stride is derived so a wide sprite costs the same
const MAX_PTS = 64; // a narrow sprite falls back to stride 1, so leave headroom
const MAX_STRETCH = 6; // past this the shadow leaves the page and just reads as a bug
const NEAR_CAP = 2.5; // a lamp standing in the scene, how long its longest shadow may get
const MIN_ALPHA = 0.02; // below this nobody can see it, so do not pay for it
const MIN_STRENGTH = 0.02;
const CORE = 0.45; // the stacked polygon is this fraction of the full throw
const A_TIP = 0.55; // alpha weights for the two fan layers
const A_CORE = 0.95;
const A_CONTACT = 0.5;
const A_SEAM = 0.8;
// warm dark. the sand under this thing is warm, and a neutral grey shadow on it
// reads dead. drawn source over rather than multiply, because a caller with a
// transparent overlay has no pixels underneath to multiply against and the
// shadow would just vanish. over a mid tone beach the two look the same.
const TONE = "rgb(34, 26, 30)";

// the sampled fan, held flat and overwritten per call. bx is where the column
// stands, tx is how far the light throws it. keeping them apart is what lets
// the second polygon reuse the same samples at a shorter throw.
const bx = new Float64Array(MAX_PTS);
const tx = new Float64Array(MAX_PTS);

/**
 * how much shadow this rig is worth at all, 0..1.
 *
 * a shadow is the key light going missing, so it only reads as far as the key
 * beats the fill. midday lands near 0.55 and night near 0.33, because the
 * torches are dim and the ambient they sit in is not far below them. exported
 * so a caller can threshold it and skip the whole shadow pass on a daypart
 * where the result would be a rounding error.
 */
export function shadowAlphaFor(light) {
  if (!light) return 0;
  const amb = light.ambient
    ? (light.ambient[0] + light.ambient[1] + light.ambient[2]) / 3
    : 0;
  const key = typeof light.intensity === "number" ? light.intensity : 1;
  const a = key * (1 - amb * 0.9) - 0.18;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

// one fan, at k of the full throw. no allocation, just moveTo and lineTo.
function fillFan(ctx, n, baseL, baseR, groundY, k) {
  ctx.beginPath();
  ctx.moveTo(baseL, groundY);
  for (let i = 0; i < n; i++) {
    const t = tx[i] * k;
    ctx.lineTo(bx[i] + t, groundY + (t < 0 ? -t : t) * FORESHORTEN);
  }
  ctx.lineTo(baseR, groundY);
  ctx.closePath();
  ctx.fill();
}

/**
 * lay a sprite's shadow on the ground line at groundY.
 *
 * x, y, scale place the sprite exactly the way drawSprite does, so the two
 * calls take the same numbers. clarity is optional, 0..1, the same atmospheric
 * fade the sprite got: a prop half dissolved into the haze must not keep a
 * full strength blob under it or the depth cue runs backwards.
 *
 * returns true if it actually drew, so a caller can count what it skipped.
 */
export function castShadow(ctx, sprite, light, x, y, scale, groundY, clarity) {
  if (!ctx || !sprite || !light || !sprite.profile) return false;
  const w = sprite.w;
  if (!(w >= 1)) return false;
  const s = scale > 0 ? scale : 1;
  let c = clarity === undefined ? 1 : clarity;
  // written backwards on purpose so a NaN clarity falls out here too
  if (!(c > 0)) return false;
  // and clamped on top, because every alpha below is a multiple of this. canvas
  // silently ignores a globalAlpha outside 0..1 and keeps the old value, so an
  // over range clarity would not brighten the shadow, it would hand it whatever
  // alpha the caller happened to be holding. usually 1. a black slab.
  if (c > 1) c = 1;

  // cheapest test first: is this daypart worth any shadow at all
  const day = shadowAlphaFor(light) * c;
  if (!(day > MIN_ALPHA)) return false;

  // the ground has to sit below the light or there is nothing to project onto.
  // at night that quietly drops everything standing behind the torch line,
  // which is the right answer: those are backlit, their shadow falls away from
  // the camera and their own body covers it.
  // behind the light the ground fades out over a band rather than snapping off,
  // or the sand gets a hard seam straight across it at night
  const depth = groundY - light.y;
  if (depth < -SHADOW_RAMP) return false;
  const depthFade = Math.min(1, Math.max(0, (depth + SHADOW_RAMP) / (SHADOW_RAMP * 2)));
  if (depthFade <= 0.02) return false;

  const cx = x + (w * s) / 2;
  const dx = cx - light.x; // caster minus light, so positive means throw right

  // which way and how far.
  //
  // light.stretch is the far field ratio for a sun: parallel rays, one number
  // for every caster on the beach, or the palm nearest the frame edge ends up
  // with a shadow six times its neighbour's. a light sitting inside the band is
  // not a sun though, it is a torch, and a torch has to throw every caster
  // outward from itself, to nothing directly underneath. so the authored ratio
  // only survives when the light is above the top of the frame, and otherwise
  // it is demoted to a cap on the length while position picks the side.
  const hasStretch = typeof light.stretch === "number" && Number.isFinite(light.stretch);
  const parallel = hasStretch && light.y <= 0;
  let stretch;
  if (parallel) {
    stretch = light.stretch;
  } else {
    // a light on the deck would divide by nothing, so floor the height
    const z = light.z > 40 ? light.z : 40;
    const near = dx / z;
    const cap = hasStretch
      ? Math.abs(light.stretch) * NEAR_CAP
      : MAX_STRETCH;
    stretch = near < -cap ? -cap : near > cap ? cap : near;
  }
  if (stretch > MAX_STRETCH) stretch = MAX_STRETCH;
  else if (stretch < -MAX_STRETCH) stretch = -MAX_STRETCH;

  // how dark it lands. linear falloff with distance, not inverse square: the
  // inverse square version put a hard gradient of darkness across the beach and
  // half the props lost their shadow entirely. a sun skips the term outright,
  // since parallel rays carry the same energy at both ends of the frame.
  let strength = 0.5;
  if (!parallel) {
    const dz = light.z || 0;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const radius = light.radius > 1 ? light.radius : 1;
    strength = 0.5 - dist / (radius * 3.2);
  }
  // same trick as the clarity test: a NaN anywhere in the light (x, z, radius,
  // intensity, ambient) poisons strength, and a plain <= would wave it through.
  // then all four globalAlpha writes are NaN, canvas drops them, and the contact
  // ellipses land at the caller's alpha as a solid dark blob under the sprite.
  if (!(strength > MIN_STRENGTH)) return false;

  const base = day * strength * depthFade;
  if (!(base > MIN_ALPHA)) return false;

  // sample the silhouette. stride keeps the cost flat as sprites get wider,
  // and ten columns is already more shape than a shadow on sand can show.
  const stride = Math.max(1, Math.floor(w / SAMPLES));
  const prof = sprite.profile;
  let n = 0;
  let firstCol = -1;
  let lastCol = -1;
  for (let col = 0; col < w && n < MAX_PTS; col += stride) {
    const top = prof[col * 2];
    if (top === -1) continue;
    if (firstCol === -1) firstCol = col;
    lastCol = col;
    // how tall this column stands above the ground line, in screen units
    const height = groundY - (y + top * s);
    if (height <= 0) continue; // column starts below the ground, nothing to throw
    bx[n] = x + col * s;
    tx[n] = height * stretch;
    n++;
  }
  if (firstCol === -1) return false;

  // the near edge is the sprite's real footprint, not the full width of a
  // mostly transparent bitmap
  const baseL = x + firstCol * s;
  const baseR = x + (lastCol + stride) * s;

  ctx.save();
  ctx.fillStyle = TONE;

  // the fan, twice. full throw underneath at a low alpha, then the near half
  // over the top of it, so the tip steps down instead of ending flat. two
  // stacked polygons because building a gradient per caster per frame is the
  // thing that actually costs money here, and at this scale the step reads as
  // deliberate posterisation rather than a seam.
  if (n >= 2) {
    ctx.globalAlpha = base * A_TIP;
    fillFan(ctx, n, baseL, baseR, groundY, 1);
    ctx.globalAlpha = base * A_CORE;
    fillFan(ctx, n, baseL, baseR, groundY, CORE);
  }

  // contact patch: the dark seam right where the thing meets the sand. two
  // squashed ellipses standing in for a radial falloff, same reasoning. this is
  // also the entire shadow when the light is straight overhead and the fan
  // collapses onto the ground line, which is exactly what should happen.
  const half = (baseR - baseL) * 0.5;
  const footX = baseL + half;
  const rx = half > 2 ? half : 2;
  const ry = s > 1 ? s * 2.2 : 2.2;
  ctx.globalAlpha = base * A_CONTACT;
  ctx.beginPath();
  ctx.ellipse(footX, groundY + 1, rx, ry * 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = base * A_SEAM;
  ctx.beginPath();
  ctx.ellipse(footX, groundY + 1, rx * 0.6, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  return true;
}
