// the things living on the island. crabs on the sand, gulls in the sky, fish in
// the shallows, lizards in the scrub.
//
// same string art format as jungle-sprites.js, so the caller bakes these once at
// load with the two palettes merged:
//
//   const pal = Object.assign({}, PALETTE, EXTRA_PALETTE);
//   for (const n of Object.keys(CREATURE_SPRITES)) baked[n] = bake(CREATURE_SPRITES[n], pal);
//
// and per frame it is just:
//
//   const live = wild.update(dt, { w, h, sandY, waterTop, part });
//   for (let i = 0; i < live.length; i++) {
//     const c = live[i];
//     g.globalAlpha = c.alpha;
//     // mirror in place about the sprite box, then hand drawSprite the real
//     // screen x and y. pass 0,0 instead and every flipped creature gets lit as
//     // if it were sitting in the top left corner of the canvas.
//     if (c.flip) { g.save(); g.translate(2 * c.x + c.w, 0); g.scale(-1, 1);
//                   drawSprite(g, baked[c.sprite], light, c.x, c.y, c.scale, c.relief); g.restore(); }
//     else drawSprite(g, baked[c.sprite], light, c.x, c.y, c.scale, c.relief);
//   }
//   g.globalAlpha = 1;
//
// house rules this thing lives by, same as the rest of the backdrop:
//   - the pool is allocated once at construction. update() only mutates it, so a
//     frame is arithmetic and nothing else. no arrays, no objects, no closures.
//   - every wobble comes off a per creature lcg seeded from the scene seed, so
//     the same visit gets the same beach. nothing calls Math.random, ever.
//   - reduced motion: call update(0, info) once and the frame is a valid still.
//     everything gets placed, nothing moves.
//   - after sunset the beach empties out. gulls stop, crabs go sparse, lizards
//     turn in. that is the daypart doing the work, not a separate switch.

/**
 * palette chars jungle-sprites.js does not have. merge over PALETTE, do not
 * replace it, the lizard is drawn in the same greens as the ferns on purpose.
 */
export const EXTRA_PALETTE = {
  // crab shell, cool red through to the pale claw edge
  q: '#8e3a1c', // shell shadow, leg joints
  p: '#c2532c', // shell body
  P: '#e0834a', // claw edge, sun on the back

  // gull, near white with a grey underwing
  L: '#7f8b96', // wingtip and the shaded underside
  i: '#bcc6ce', // grey
  I: '#eef1f3', // white

  // fish, read as a silhouette under the surface
  t: '#123a52', // dark body
}

/**
 * every creature frame. same rules as the jungle art: equal length rows inside
 * a sprite, '.' is a hole, all frames of one creature share their dimensions so
 * swapping frames does not make the thing jump.
 *
 * all four face right. the caller flips.
 */
export const CREATURE_SPRITES = {
  // 9x6. scuttle, right legs out.
  CRAB_A: [
    '.P.....P.',
    'PpP...PpP',
    '.qpppppq.',
    'qppopoppq',
    '.qpppppq.',
    'q.q...q.q',
  ],

  // 9x6. scuttle, legs gathered under the shell and the claws dropped.
  CRAB_B: [
    '.........',
    'PpP...PpP',
    '.qpppppq.',
    'qppopoppq',
    '.qpppppq.',
    '.q.q.q.q.',
  ],

  // 9x6. the pause. claws up, feet planted, nothing moving.
  CRAB_C: [
    'PP.....PP',
    'PpP...PpP',
    '.qpppppq.',
    'qppopoppq',
    '.qpppppq.',
    'q.q...q.q',
  ],

  // 11x7. wings up. the body line sits on row 3 in all three frames so only the
  // wing travels.
  GULL_A: [
    '..LL.......',
    '...iI......',
    '....II.....',
    '.iiIIIIIoF.',
    '..LiIIIIL..',
    '...........',
    '...........',
  ],

  // 11x7. wings down.
  GULL_B: [
    '...........',
    '...........',
    '...........',
    '.iiIIIIIoF.',
    '..LiIIIIL..',
    '....Li.....',
    '...LL......',
  ],

  // 11x7. the glide. wings held, barely a kink in them.
  GULL_C: [
    '...........',
    '...........',
    '..LIII.....',
    '.iiIIIIIoF.',
    '..LiIIIIL..',
    '...........',
    '...........',
  ],

  // 7x4. under the surface, just a smudge going past.
  FISH_A: [
    '.......',
    '.ttaat.',
    '..ttt..',
    '.......',
  ],

  // 7x4. breaking the surface, wet gleam on the back.
  FISH_B: [
    't...z..',
    'ttzaaa.',
    'ttaaaat',
    't......',
  ],

  // 7x4. going back down, tail up, nose under.
  FISH_C: [
    't..z...',
    'tta....',
    '.taaa..',
    '..taaat',
  ],

  // 10x5. mid dart, legs spread.
  LIZARD_A: [
    '.....khh..',
    '..ghhhhhh.',
    'Gggghhhhho',
    '.Ggghhhhg.',
    '..G....G..',
  ],

  // 10x5. mid dart, legs gathered.
  LIZARD_B: [
    '.....khh..',
    '..ghhhhhh.',
    'Gggghhhhho',
    '.Ggghhhhg.',
    '....G.G...',
  ],

  // 10x5. frozen. head lifted, watching.
  LIZARD_C: [
    '......khh.',
    '..ghhhhhho',
    'Ggghhhhhg.',
    '.Gghhhhg..',
    '..G...G...',
  ],
}

/**
 * how round each one is, 0 flat to 1 fully modelled. the fish is a silhouette
 * in water and wants almost none of it, the crab shell wants most of it.
 */
export const CREATURE_RELIEF = {
  CRAB_A: 0.7,
  CRAB_B: 0.7,
  CRAB_C: 0.7,
  GULL_A: 0.4,
  GULL_B: 0.4,
  GULL_C: 0.4,
  FISH_A: 0.2,
  FISH_B: 0.25,
  FISH_C: 0.25,
  LIZARD_A: 0.6,
  LIZARD_B: 0.6,
  LIZARD_C: 0.6,
}

// frame names as consts so the state machines assign a reference and never
// build a string in the loop
const CRAB_A = 'CRAB_A';
const CRAB_B = 'CRAB_B';
const CRAB_C = 'CRAB_C';
const GULL_A = 'GULL_A';
const GULL_B = 'GULL_B';
const GULL_C = 'GULL_C';
const FISH_A = 'FISH_A';
const FISH_B = 'FISH_B';
const FISH_C = 'FISH_C';
const LIZARD_A = 'LIZARD_A';
const LIZARD_B = 'LIZARD_B';
const LIZARD_C = 'LIZARD_C';

const TAU = Math.PI * 2;
const NO_INFO = {}; // so a caller that forgets ctxInfo gets defaults, not a throw
const DT_CAP = 0.1; // a backgrounded tab must not teleport the island
const FADE = 1.8; // alpha per second when something is leaving or arriving
const GULL_FADE = 0.55; // a gull leaves slower, it is flying off rather than hiding

// unscaled sprite size per kind, read off the art so the two never drift apart
const SW = {
  crab: CREATURE_SPRITES.CRAB_A[0].length,
  gull: CREATURE_SPRITES.GULL_A[0].length,
  fish: CREATURE_SPRITES.FISH_A[0].length,
  lizard: CREATURE_SPRITES.LIZARD_A[0].length,
};
const SH = {
  crab: CREATURE_SPRITES.CRAB_A.length,
  gull: CREATURE_SPRITES.GULL_A.length,
  fish: CREATURE_SPRITES.FISH_A.length,
  lizard: CREATURE_SPRITES.LIZARD_A.length,
};

// how hard the dark thins each kind out. multiplied by nightness and compared
// against the creature's own rank, so the same individuals drop out every time.
// gulls are 1, which means at full night not one of them passes.
const NIGHT_PULL = { crab: 0.78, gull: 1, fish: 0.55, lizard: 0.95 };

// same lcg the scene layout uses. deterministic, cheap, good enough for bugs.
function lcg(seed) {
  let v = seed >>> 0;
  return function () {
    v = (v * 1664525 + 1013904223) >>> 0;
    return v / 4294967296;
  };
}

// per creature stream. lives on the creature so pulling a number allocates
// nothing and every creature keeps its own thread of luck.
function rnd(c) {
  c.rs = (c.rs * 1664525 + 1013904223) >>> 0;
  return c.rs / 4294967296;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function num(v, d) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

// how far into the dark we are. dawn is only half awake, dusk is thinning out,
// night is closed.
function nightnessFor(part) {
  if (part === 'night') return 1;
  if (part === 'dusk') return 0.55;
  if (part === 'dawn') return 0.25;
  return 0;
}

/**
 * build the wildlife.
 *
 * opts: { seed, crabs, gulls, fish, lizards }. counts default to a beach that
 * reads as inhabited without turning into a zoo.
 *
 * the returned object holds a fixed pool. update(dt, ctxInfo) walks it and
 * returns the live subset as an array that is reused every frame, so do not
 * hold on to it past the current frame.
 */
export function createWildlife(opts) {
  const o = opts || {};
  const seed = num(o.seed, 20260816);
  const r = lcg(seed);

  const nCrab = Math.max(0, Math.round(num(o.crabs, 5)));
  const nGull = Math.max(0, Math.round(num(o.gulls, 4)));
  const nFish = Math.max(0, Math.round(num(o.fish, 5)));
  const nLizard = Math.max(0, Math.round(num(o.lizards, 4)));

  // one shape for every creature no matter the kind, so the whole pool shares a
  // hidden class and the update loop stays monomorphic
  function creature(kind, idx) {
    const c = {
      kind: kind,
      sprite: CRAB_C,
      relief: 0.6,
      scale: 2,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      flip: false,
      alpha: 1,
      visible: false,
      // internals below here. the caller has no business reading these.
      rs: (r() * 4294967295) >>> 0,
      xn: r(), // where along the world it starts, 0..1
      lane: 0, // 0..1 down its habitat band
      lane0: 0, // the lane it belongs to, wander is relative to this
      laneTo: 0,
      amp: 0, // gull arc height in lane units
      arc: 0,
      arcRate: 0,
      st: 0, // state index, means something different per kind
      t: 0, // state timer
      tw: 0, // twitch timer
      twOn: 0,
      dir: 1,
      spd: 0,
      anim: 0,
      sf: 0, // state fade, the fish surfacing
      nf: 1, // night fade
      wake: 0, // how long after the light comes back before this one shows up
      rank: r(), // where this one sits in the queue to go home at dusk
      sw: SW[kind],
      sh: SH[kind],
      idx: idx,
    };
    c.lane0 = r();
    c.lane = c.lane0;
    c.laneTo = c.lane0;
    c.dir = r() < 0.5 ? -1 : 1;
    return c;
  }

  const creatures = [];
  for (let i = 0; i < nCrab; i++) creatures.push(creature('crab', i));
  for (let i = 0; i < nGull; i++) creatures.push(creature('gull', i));
  for (let i = 0; i < nFish; i++) creatures.push(creature('fish', i));
  for (let i = 0; i < nLizard; i++) creatures.push(creature('lizard', i));

  // opening poses. a still frame has to look settled, not mid nothing.
  for (let i = 0; i < creatures.length; i++) {
    const c = creatures[i];
    if (c.kind === 'crab') {
      c.scale = c.lane0 > 0.45 ? 2 : 1;
      c.sprite = CRAB_C;
      c.st = 0;
      c.t = 0.4 + rnd(c) * 2.2;
      c.spd = 24 + rnd(c) * 22;
    } else if (c.kind === 'gull') {
      c.scale = c.lane0 < 0.5 ? 2 : 1;
      c.sprite = GULL_C;
      c.st = 0;
      c.arc = rnd(c) * TAU;
      c.arcRate = 0.18 + rnd(c) * 0.24;
      c.amp = 0.1 + rnd(c) * 0.18;
      c.spd = 24 + rnd(c) * 30;
      c.lane0 = clamp(c.lane0, c.amp + 0.02, 1 - c.amp - 0.02);
    } else if (c.kind === 'fish') {
      c.scale = c.lane0 > 0.5 ? 2 : 1;
      // stagger the first showing so they do not all pop at once, and start one
      // of them already up so a reduced motion still has a fish in it
      if (c.idx === 0) {
        c.sprite = FISH_B;
        c.st = 2;
        c.sf = 1;
        c.t = 0.6;
        c.lane = clamp(c.lane0 - 0.14, 0, 1);
      } else {
        c.sprite = FISH_A;
        c.st = 0;
        c.t = 0.8 + c.idx * 2.1 + rnd(c) * 3;
      }
      c.spd = 7 + rnd(c) * 9;
    } else {
      c.scale = 2;
      c.sprite = LIZARD_C;
      c.st = 0;
      c.t = 0.5 + rnd(c) * 3.5;
      c.tw = 0.4 + rnd(c) * 2;
      c.spd = 90 + rnd(c) * 70;
    }
    c.w = c.sw * c.scale;
    c.h = c.sh * c.scale;
    c.relief = CREATURE_RELIEF[c.sprite];
  }

  // reused every frame. same array object for the life of the scene.
  const live = [];
  for (let i = 0; i < creatures.length; i++) live.push(creatures[i]);
  live.length = 0;

  // scratch for the habitat band, per instance so two scenes cannot tread on
  // each other
  const band = { top: 0, bottom: 0 };
  let lastW = 0;
  let first = true;

  // where each kind is allowed to be. top and bottom bracket the whole sprite
  // box, not just its origin.
  function habitat(kind, w, h, sandY, waterTop, drawH) {
    let top;
    let bot;
    if (kind === 'gull') {
      top = h * 0.02;
      bot = waterTop - 8;
    } else if (kind === 'fish') {
      top = waterTop + 3;
      bot = sandY - 4;
    } else if (kind === 'crab') {
      const deep = h - sandY;
      top = sandY + deep * 0.06;
      bot = sandY + deep * 0.5;
    } else {
      const deep = h - sandY;
      top = sandY + deep * 0.42;
      bot = sandY + deep * 0.94;
    }
    // a squashed viewport can hand us a band thinner than the creature. give it
    // room rather than let it hang out the bottom.
    if (bot - top < drawH) bot = top + drawH;
    band.top = top;
    band.bottom = bot;
  }

  function settleY(c) {
    let span = band.bottom - band.top - c.h;
    if (span < 0) span = 0;
    c.y = band.top + clamp(c.lane, 0, 1) * span;
  }

  // ---- per kind behaviour -------------------------------------------------

  // scuttle, stop, scuttle. the pause is longer than the run, which is what
  // makes it read as a crab and not a wind up toy.
  function stepCrab(c, dt, w) {
    if (c.t <= 0) {
      if (c.st === 1) {
        c.st = 0;
        c.t = 0.7 + rnd(c) * 1.9;
      } else {
        c.st = 1;
        c.t = 0.3 + rnd(c) * 0.7;
        if (rnd(c) < 0.38) c.dir = -c.dir;
        c.spd = 24 + rnd(c) * 22;
        c.laneTo = clamp(c.lane0 + (rnd(c) - 0.5) * 0.34, 0, 1);
      }
    }
    c.t -= dt;
    if (c.st === 1) {
      c.x += c.dir * c.spd * dt;
      c.anim += dt * 11;
      while (c.anim >= 2) c.anim -= 2;
      c.sprite = c.anim < 1 ? CRAB_A : CRAB_B;
      const k = dt * 1.4;
      c.lane += (c.laneTo - c.lane) * (k > 1 ? 1 : k);
    } else {
      c.sprite = CRAB_C;
    }
    const lo = -c.w * 0.35;
    const hi = w - c.w * 0.65;
    if (c.x < lo) {
      c.x = lo;
      c.dir = 1;
    } else if (c.x > hi) {
      c.x = hi;
      c.dir = -1;
    }
    c.flip = c.dir < 0;
  }

  // long shallow arc across the sky. beats on the way up, glides on the way
  // down, which is the only thing that makes a two frame bird look like a bird.
  function stepGull(c, dt, w, allowed) {
    if (c.st === 1) {
      // sat out. the wait only counts down while there is any point coming
      // back, otherwise a long night would end in four gulls launching on the
      // same frame. each one picks its pass back up where it left off.
      if (allowed) {
        c.t -= dt;
        if (c.t <= 0) launchGull(c, w);
      }
      return;
    }
    // once the light goes it stops working the arc, levels out and makes for
    // the edge. birds go in for the night, they do not vanish in mid air.
    if (!allowed) {
      c.amp *= 1 - Math.min(1, dt * 0.9);
      c.spd += (62 - c.spd) * Math.min(1, dt * 0.6);
    }
    c.x += c.dir * c.spd * dt;
    c.arc += dt * c.arcRate;
    while (c.arc > TAU) c.arc -= TAU;
    c.lane = clamp(c.lane0 + Math.sin(c.arc) * c.amp, 0, 1);
    // cos < 0 means the lane is shrinking, so it is climbing
    if (Math.cos(c.arc) < 0) {
      c.anim += dt * 5.5;
      while (c.anim >= 2) c.anim -= 2;
      c.sprite = c.anim < 1 ? GULL_A : GULL_B;
    } else {
      c.sprite = GULL_C;
    }
    c.flip = c.dir < 0;
    if (c.x > w + 6 || c.x + c.w < -6) {
      c.st = 1;
      c.t = 4 + rnd(c) * 14;
      c.x = c.dir > 0 ? w + 6 : -c.w - 6;
    }
  }

  function launchGull(c, w) {
    c.dir = rnd(c) < 0.5 ? -1 : 1;
    c.lane0 = 0.08 + rnd(c) * 0.8;
    c.amp = 0.08 + rnd(c) * 0.2;
    c.lane0 = clamp(c.lane0, c.amp + 0.02, 1 - c.amp - 0.02);
    c.arc = rnd(c) * TAU;
    c.arcRate = 0.18 + rnd(c) * 0.24;
    c.spd = 24 + rnd(c) * 30;
    c.scale = c.lane0 < 0.5 ? 2 : 1;
    c.w = c.sw * c.scale;
    c.h = c.sh * c.scale;
    // seed the lane off the arc phase, not off lane0. otherwise the first
    // stepGull snaps it by up to amp. it is still off canvas when that happens
    // so nothing shows today, but it is one multiply to make it honest.
    c.lane = clamp(c.lane0 + Math.sin(c.arc) * c.amp, 0, 1);
    c.st = 0;
    c.x = c.dir > 0 ? -c.w - 4 : w + 4;
    c.sprite = GULL_C;
  }

  // drifts along under the water doing nothing visible, comes up for about a
  // second, gone again. the wait is most of its life.
  function stepFish(c, dt, w, night, allowed) {
    c.x += c.dir * c.spd * dt;
    // only wrap while it is down and unseen. wrapping a surfaced one threw it
    // the whole width of the canvas in a single frame, which reads as a glitch.
    // off the edge it just keeps drifting, it is back under within a second.
    if (c.st === 0) {
      if (c.x > w + c.w) c.x = -c.w;
      else if (c.x < -c.w * 2) c.x = w + c.w * 0.5;
    }

    // same as the gulls: the wait between showings only runs while coming up is
    // on the cards. once it is dark the clock stops instead of banking up.
    if (c.st !== 0 || allowed) c.t -= dt;

    if (c.st === 0) {
      c.sprite = FISH_A;
      c.sf -= dt * FADE;
      if (c.sf < 0) c.sf = 0;
      c.lane += (c.lane0 - c.lane) * Math.min(1, dt * 2);
      if (c.t <= 0 && allowed) {
        c.st = 1;
        c.t = 0.28;
        c.dir = rnd(c) < 0.5 ? -1 : 1;
        c.laneTo = clamp(c.lane0 - 0.14 - rnd(c) * 0.1, 0, 1);
      }
    } else if (c.st === 1) {
      c.sprite = c.sf > 0.55 ? FISH_B : FISH_A;
      c.sf += dt * FADE * 1.6;
      if (c.sf > 1) c.sf = 1;
      c.lane += (c.laneTo - c.lane) * Math.min(1, dt * 4);
      if (c.t <= 0) {
        c.st = 2;
        c.t = 0.45 + rnd(c) * 0.9;
      }
    } else if (c.st === 2) {
      c.sprite = FISH_B;
      c.sf = 1;
      if (c.t <= 0) {
        c.st = 3;
        c.t = 0.5;
      }
    } else {
      c.sprite = FISH_C;
      c.sf -= dt * FADE;
      c.lane += (c.lane0 - c.lane) * Math.min(1, dt * 3);
      if (c.sf <= 0) {
        c.sf = 0;
        c.st = 0;
        // longer between showings once the light goes
        c.t = (2.5 + rnd(c) * 6) * (1 + night * 1.6);
      }
    }
    c.flip = c.dir < 0;
  }

  // dart, freeze, sit there for ages, dart. the freeze is the whole character,
  // so it gets a small head twitch to stop it looking like a dropped frame.
  function stepLizard(c, dt, w) {
    if (c.t <= 0) {
      if (c.st === 1) {
        c.st = 0;
        c.t = 1.2 + rnd(c) * 4;
        c.tw = 0.4 + rnd(c) * 2.2;
      } else {
        c.st = 1;
        c.t = 0.16 + rnd(c) * 0.34;
        if (rnd(c) < 0.5) c.dir = -c.dir;
        c.spd = 90 + rnd(c) * 70;
        c.laneTo = clamp(c.lane0 + (rnd(c) - 0.5) * 0.38, 0, 1);
      }
    }
    c.t -= dt;
    if (c.st === 1) {
      c.x += c.dir * c.spd * dt;
      c.anim += dt * 16;
      while (c.anim >= 2) c.anim -= 2;
      c.sprite = c.anim < 1 ? LIZARD_A : LIZARD_B;
      c.lane += (c.laneTo - c.lane) * Math.min(1, dt * 3);
    } else {
      c.tw -= dt;
      if (c.tw <= 0) {
        c.tw = 0.6 + rnd(c) * 2.6;
        c.twOn = 0.14;
      }
      if (c.twOn > 0) {
        c.twOn -= dt;
        c.sprite = LIZARD_A;
      } else {
        c.sprite = LIZARD_C;
      }
    }
    const lo = -c.w * 0.3;
    const hi = w - c.w * 0.7;
    if (c.x < lo) {
      c.x = lo;
      c.dir = 1;
    } else if (c.x > hi) {
      c.x = hi;
      c.dir = -1;
    }
    c.flip = c.dir < 0;
  }

  // ---- the loop -----------------------------------------------------------

  function update(dt, info) {
    const ci = info || NO_INFO;
    const w = Math.max(1, num(ci.w, 800));
    const h = Math.max(1, num(ci.h, 600));
    const sandY = clamp(num(ci.sandY, h * 0.34), 0, h);
    const waterTop = clamp(num(ci.waterTop, sandY - h * 0.16), 0, sandY);
    const night = nightnessFor(ci.part);

    let d = num(dt, 0);
    if (d < 0) d = 0;
    if (d > DT_CAP) d = DT_CAP;

    // resize: keep everyone where they were along the beach instead of piling
    // them up at the left edge
    if (first) {
      for (let i = 0; i < creatures.length; i++) {
        const c = creatures[i];
        c.x = c.xn * w - c.w * 0.5;
      }
      lastW = w;
    } else if (w !== lastW) {
      const k = w / lastW;
      for (let i = 0; i < creatures.length; i++) creatures[i].x *= k;
      lastW = w;
    }

    let n = 0;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      const allowed = c.rank >= night * NIGHT_PULL[c.kind];

      if (c.kind === 'crab') stepCrab(c, d, w);
      else if (c.kind === 'gull') stepGull(c, d, w, allowed);
      else if (c.kind === 'fish') stepFish(c, d, w, night, allowed);
      else stepLizard(c, d, w);

      // fade in or out of the daypart. the first frame snaps so a still is
      // never caught halfway.
      if (first) {
        c.nf = allowed ? 1 : 0;
        c.wake = 0;
      } else if (!allowed) {
        // on the way out, and arming the trickle back while we are at it. every
        // creature waits its own beat, otherwise dawn is one frame of the whole
        // beach reappearing at once.
        // a gull holds its alpha until it has actually parked off screen.
        // stepGull already levels it out and points it at the edge, but a 1.8s
        // fade beats a 62px/s exit every time and stranded it mid sky.
        const rate = c.kind === 'gull' ? GULL_FADE : FADE;
        const leaving = c.kind !== 'gull' || c.st === 1;
        if (leaving && c.nf > 0) c.nf = Math.max(0, c.nf - d * rate);
        c.wake = 0.4 + c.rank * 3.4;
      } else if (c.nf < 1) {
        if (c.wake > 0) c.wake -= d;
        else c.nf = Math.min(1, c.nf + d * FADE);
      }

      habitat(c.kind, w, h, sandY, waterTop, c.h);
      settleY(c);

      c.relief = CREATURE_RELIEF[c.sprite];
      c.alpha = c.kind === 'fish' ? c.nf * c.sf : c.nf;
      // a gull waiting its turn offscreen is not drawn at all
      c.visible = c.alpha > 0.02 && !(c.kind === 'gull' && c.st === 1);
      if (c.visible) live[n++] = c;
    }
    live.length = n;
    first = false;
    return live;
  }

  return {
    creatures: creatures,
    live: live,
    update: update,
  };
}
