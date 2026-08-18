// the island the whole page sits in.
//
// a fixed canvas behind everything holding a world taller than the viewport:
// open water at the top, then the shoreline, then the beach the cast lives on,
// then jungle floor at the bottom. scrolling walks the camera down through it,
// and the episode scrubber sets the light and pans it sideways, so reading the
// page and replaying a season end up being the same movement.
//
// the rules it lives by, because a data site is riding on top:
//   - the static half of the world is baked once per (daypart, size) and the
//     visible window is one drawimage. only water, wildlife and fire redraw.
//   - it never draws over content. the page surfaces are opaque, canvas behind.
//   - reduced motion paints one still frame and stops.
//   - hidden tab cancels the loop.

import { bake, drawSprite } from "./pixel.js?v=24";
import { PALETTE, SPRITES, RELIEF, TINTS } from "./jungle-sprites.js?v=24";
import { lightFor } from "./light-rig.js?v=24";
import { castShadow, shadowAlphaFor } from "./shadow.js?v=24";
import { drawSea, drawSand } from "./water.js?v=24";
import {
  CREATURE_SPRITES, EXTRA_PALETTE, CREATURE_RELIEF, createWildlife,
} from "./wildlife.js?v=24";
import {
  CAMP_SPRITES, CAMP_PALETTE_EXTRA, CAMP_RELIEF, createCamp,
} from "./camp.js?v=24";

const DPR_CAP = 2;
const WORLD_H = 1.55; // world is this many viewports tall
const PAN = 0.30; // sideways travel across a season
const SEA_TOP = 0.08; // fractions of world height
const SAND_Y = 0.34;
const TORCH_Y = 0.60;
// the three torch sprites share their stake pixels, so they share a relief or a
// lit torch and a snuffed one show a seam down the same stake
const TORCH_RELIEF = 0.1;

const ART = Object.assign({}, PALETTE, EXTRA_PALETTE, CAMP_PALETTE_EXTRA);
// three foliage only recolours. baked once at load, picked per prop off the
// layout seed, so a treeline stops being one bitmap stamped thirty times.
const TINT_ART = {
  DRY: Object.assign({}, ART, TINTS.DRY),
  DEEP: Object.assign({}, ART, TINTS.DEEP),
  LIME: Object.assign({}, ART, TINTS.LIME),
};
const TINT_NAMES = ["", "DRY", "DEEP", "LIME"];

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function createScene(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  const baked = {};
  for (const n of Object.keys(SPRITES)) baked[n] = bake(SPRITES[n], ART);
  for (const n of Object.keys(CREATURE_SPRITES)) baked[n] = bake(CREATURE_SPRITES[n], ART);
  for (const n of Object.keys(CAMP_SPRITES)) baked[n] = bake(CAMP_SPRITES[n], ART);
  // only the leafy things get tinted; wood and thatch stay put so the island
  // still reads as one place
  for (const t of ["DRY", "DEEP", "LIME"]) {
    for (const n of ["PALM", "PALM_ALT", "PALM_TALL", "PALM_BENT", "FAN_PALM",
                     "BANANA", "BAMBOO", "FERN_BIG", "FERN_SMALL", "VINE"]) {
      if (SPRITES[n]) baked[n + t] = bake(SPRITES[n], TINT_ART[t]);
    }
  }

  const wild = createWildlife({ seed: 4242 });
  const camp = createCamp({ seed: 1717 });

  const st = {
    part: "midday", progress: 0, scroll: 0, torches: [],
    w: 0, h: 0, worldW: 0, worldH: 0, dpr: 1,
    light: null, still: null, stillKey: "", layout: null,
    last: performance.now(), raf: 0, running: false, glow: null,
    // reused every frame so painting allocates nothing
    seaRect: { x: 0, y: 0, w: 0, h: 0 },
    sandRect: { x: 0, y: 0, w: 0, h: 0 },
    litLights: [],
  };

  // ---- layout -------------------------------------------------------------

  function buildLayout() {
    const r = rng(20260816);
    const H = st.worldH;
    const sand = H * SAND_Y;
    const props = [];
    // pick returns a name plus a tint suffix, so the same matrix reads as a
    // different plant depending on where it stands
    const tint = (name, bias) => {
      const t = TINT_NAMES[Math.min(3, (r() * 4 + (bias || 0)) | 0)];
      return baked[name + t] ? name + t : name;
    };
    const put = (s2, x, y, sc) => props.push({ s: s2, x, y, sc, fl: r() > 0.5 });

    // the far treeline, deliberately mixed so no two neighbours match
    const FAR = ["PALM", "PALM_ALT", "PALM_TALL", "PALM_BENT", "FAN_PALM", "BANANA"];
    for (let i = 0; i < 44; i++) {
      put(tint(FAR[(r() * FAR.length) | 0], 1), -0.06 + (i / 43) * 1.14 + (r() - 0.5) * 0.02,
          sand + 2 + r() * 16, 1);
    }
    // bamboo and vines break the skyline up
    for (let i = 0; i < 10; i++) {
      put(tint(r() > 0.5 ? "BAMBOO" : "VINE", 2), -0.02 + r() * 1.08, sand + r() * 12, 1);
    }
    // the row you walk past
    const MID = ["PALM_TALL", "PALM_BENT", "PALM_ALT", "FAN_PALM", "BANANA", "PALM"];
    for (let i = 0; i < 14; i++) {
      put(tint(MID[(r() * MID.length) | 0]), -0.04 + (i / 13) * 1.1 + (r() - 0.5) * 0.04,
          sand + 40 + r() * 66, 2);
    }
    // camp itself
    put("SHELTER_BIG", 0.05, sand + 74, 2);
    put("HUT", 0.80, sand + 66, 2);
    put("FIRE_PIT", 0.42, sand + 128, 2);
    put("POT", 0.47, sand + 124, 2);
    put("DRY_RACK", 0.60, sand + 118, 2);
    put("CANOE", 0.20, sand + 150, 2);
    put("FLAG", 0.33, sand + 96, 2);
    put("JUG", 0.10, sand + 132, 2);
    // scatter across the whole beach rather than a thin band
    const SCAT = ["ROCK_BIG", "ROCK_SMALL", "LOG", "DRIFTWOOD", "FERN_BIG", "FERN_SMALL",
                  "GRASS", "FLOWERS", "COCONUTS", "SHELL", "ROCK", "FERN"];
    for (let i = 0; i < 78; i++) {
      const n = SCAT[(r() * SCAT.length) | 0];
      put(/FERN|GRASS/.test(n) ? tint(n) : n, -0.04 + r() * 1.12,
          sand + 92 + r() * Math.max(50, H - sand - 130), 2);
    }
    // the near layer: big, dark, cropped by the frame edges. this is what makes
    // it feel like standing in it instead of looking at it
    const fore = [];
    const NEAR = ["FERN_BIG", "BANANA", "FAN_PALM", "VINE"];
    for (let i = 0; i < 7; i++) {
      const edge = i % 2 ? 0.90 + r() * 0.14 : -0.06 + r() * 0.12;
      fore.push({ s: tint(NEAR[(r() * NEAR.length) | 0], 2), x: edge,
                  y: H - 30 - r() * 120, sc: 4, fl: r() > 0.5 });
    }
    props.sort((a, b) => a.y - b.y);
    return { sand, seaTop: H * SEA_TOP, props, fore };
  }

  // tinted names are the base name plus a suffix, so strip it to find relief
  function reliefOf(name) {
    if (RELIEF[name] != null) return RELIEF[name];
    for (const t of ["DRY", "DEEP", "LIME"]) {
      if (name.endsWith(t)) {
        const base = name.slice(0, -t.length);
        if (RELIEF[base] != null) return RELIEF[base];
      }
    }
    return CAMP_RELIEF[name] ?? CREATURE_RELIEF[name] ?? 0.6;
  }

  // mirror about the sprite's own box and still pass the real screen position,
  // or every flipped thing gets lit as if it stood in the top left corner
  function drawFlipped(g, b, light, x, y, sc, rel, flip) {
    if (!flip) { drawSprite(g, b, light, x, y, sc, rel); return; }
    g.save();
    g.translate(2 * x + b.w * sc, 0);
    g.scale(-1, 1);
    drawSprite(g, b, light, x, y, sc, rel);
    g.restore();
  }

  // ---- the static world ---------------------------------------------------

  function bakeStill() {
    const key = `${st.part}|${Math.round(st.worldW)}x${Math.round(st.worldH)}`;
    if (st.stillKey === key && st.still) return;
    const c = st.still || document.createElement("canvas");
    c.width = Math.ceil(st.worldW * st.dpr);
    c.height = Math.ceil(st.worldH * st.dpr);
    const g = c.getContext("2d");
    g.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    g.clearRect(0, 0, st.worldW, st.worldH);
    g.imageSmoothingEnabled = false;

    const L = st.layout, light = st.light;
    // no sand here any more: it runs up and drains every frame, so it is drawn
    // live underneath this layer. the still is just props and their shadows on
    // a clear canvas.
    const shadowy = shadowAlphaFor(light) > 0.2;
    for (const p of L.props) {
      const b = baked[p.s];
      if (!b) continue;
      const px = p.x * st.worldW;
      if (shadowy) castShadow(g, b, light, px, p.y, p.sc, p.y + b.h * p.sc);
      drawFlipped(g, b, light, px, p.y, p.sc, reliefOf(p.s), p.fl);
    }
    st.still = c;
    st.stillKey = key;
  }

  // ---- fire ---------------------------------------------------------------

  function glowTex() {
    if (st.glow) return st.glow;
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, "rgba(255, 190, 100, 1)");
    gr.addColorStop(0.42, "rgba(255, 158, 62, 0.32)");
    gr.addColorStop(1, "rgba(255, 150, 60, 0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    st.glow = c;
    return c;
  }

  // flat [x, strength, ...] for water.js to reflect. refilled in place; never
  // rebuilt, so a frame still allocates nothing.
  function litLights() {
    const out = st.litLights;
    out.length = 0;
    const list = st.torches;
    if (!list.length) return out;
    const gap = st.worldW / (list.length + 1);
    for (let i = 0; i < list.length; i++) {
      if (list[i].out) continue;
      const heat = Math.max(0.12, Math.min(1, list[i].prob * list.length));
      out.push(gap * (i + 1) + 8, 0.35 + heat * 0.65);
    }
    return out;
  }

  // one torch per player: lit while they are in it, flame sized by win
  // probability, dark and smoking once snuffed. this is the leaderboard, told
  // the way the show tells it.
  function drawTorches(g, now) {
    const list = st.torches;
    if (!list.length) return;
    const y = st.worldH * TORCH_Y;
    const gap = st.worldW / (list.length + 1);
    const frame = Math.floor(now / 130) % 2;
    const dark = st.part === "night" ? 2.6 : st.part === "dusk" ? 1.7 : 1;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const x = gap * (i + 1);
      if (p.out) {
        drawSprite(g, baked.TORCH_OUT, st.light, x, y, 2, TORCH_RELIEF);
        const age = ((now / 1000) * 0.6 + i) % 3;
        g.globalAlpha = Math.max(0, 0.26 - age * 0.085);
        g.fillStyle = "#8a7d70";
        for (let s = 0; s < 3; s++) {
          g.fillRect(Math.round(x + Math.sin(age * 2 + s + i) * (4 + s * 2)),
                     Math.round(y - 40 - age * 14 - s * 7), 2, 2);
        }
        g.globalAlpha = 1;
        continue;
      }
      const name = frame ? "TORCH_LIT_B" : "TORCH_LIT_A";
      drawSprite(g, baked[name], st.light, x, y, 2, TORCH_RELIEF);
      const heat = Math.max(0.12, Math.min(1, p.prob * (list.length || 1)));
      const flick = 0.86 + Math.sin(now / 90 + i * 1.7) * 0.14;
      const rad = (16 + heat * 36) * flick * (dark > 1 ? 1.5 : 1);
      g.globalAlpha = Math.min(0.85, 0.28 * dark * flick * (0.4 + heat * 0.6));
      g.drawImage(glowTex(), x + 8 - rad, y - 34 - rad, rad * 2, rad * 2);
      g.globalAlpha = 1;
    }
  }

  function drawCamp(g) {
    const live = camp.live;
    if (!live || !live.length) return;
    for (let i = 0; i < live.length; i++) {
      const f = live[i];
      if (f.visible === false) continue;
      const b = baked[f.sprite];
      if (!b) continue;
      g.globalAlpha = f.alpha == null ? 1 : f.alpha;
      drawFlipped(g, b, st.light, f.x, f.y, f.scale, reliefOf(f.sprite), f.flip);
      g.globalAlpha = 1;
    }
  }

  function drawCreatures(g) {
    const live = wild.live;
    if (!live || !live.length) return;
    for (let i = 0; i < live.length; i++) {
      const c = live[i];
      if (c.visible === false) continue;
      const b = baked[c.sprite];
      if (!b) continue;
      const rel = c.relief != null ? c.relief : (CREATURE_RELIEF[c.sprite] ?? 0.4);
      g.globalAlpha = c.alpha == null ? 1 : c.alpha;
      if (c.flip) {
        g.save();
        g.translate(2 * c.x + c.w, 0);
        g.scale(-1, 1);
        drawSprite(g, b, st.light, c.x, c.y, c.scale, rel);
        g.restore();
      } else {
        drawSprite(g, b, st.light, c.x, c.y, c.scale, rel);
      }
      g.globalAlpha = 1;
    }
  }

  // ---- frame --------------------------------------------------------------

  // reused every frame, so driving the camp allocates nothing
  const _info = { w: 0, h: 0, sandY: 0, torchY: 0, part: "midday", cast: [] };
  function campInfo() {
    _info.w = st.worldW;
    _info.h = st.worldH;
    _info.sandY = st.layout.sand;
    _info.torchY = st.worldH * TORCH_Y;
    _info.part = st.part;
    _info.cast = st.torches;
    return _info;
  }

  function paint(now) {
    const g = ctx;
    const t = now / 1000;
    g.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    g.clearRect(0, 0, st.w, st.h);
    g.imageSmoothingEnabled = false;

    // scroll walks the camera down the world, the scrubber pans it sideways
    const camY = st.scroll * Math.max(0, st.worldH - st.h);
    const camX = st.progress * Math.max(0, st.worldW - st.w);
    g.save();
    g.translate(-Math.round(camX), -Math.round(camY));

    const L = st.layout;
    const sea = st.seaRect, sand = st.sandRect;
    sea.x = 0; sea.y = L.seaTop; sea.w = st.worldW; sea.h = L.sand - L.seaTop;
    sand.x = 0; sand.y = L.sand; sand.w = st.worldW; sand.h = st.worldH - L.sand;
    drawSea(g, sea, st.light, t);
    // the fires get reflected in the wet sand, which is the whole reason the
    // torch line reads as fire after dark
    drawSand(g, sand, st.light, t, litLights());
    if (st.still) g.drawImage(st.still, 0, 0, st.worldW, st.worldH);
    drawCreatures(g);
    drawCamp(g);
    drawTorches(g, now);
    // the near layer sits in front of the lot, cropped by the frame edges
    for (const f of L.fore) {
      const b = baked[f.s];
      if (b) drawFlipped(g, b, st.light, f.x * st.worldW, f.y, f.sc, reliefOf(f.s), f.fl);
    }
    g.restore();
  }

  function frame(now) {
    if (!st.running) return;
    const dt = Math.min(0.1, (now - st.last) / 1000);
    st.last = now;
    const info = campInfo();
    wild.update(dt, {
      w: st.worldW, h: st.worldH,
      sandY: st.layout.sand, waterTop: st.layout.seaTop, part: st.part,
    });
    camp.update(dt, info);
    paint(now);
    st.raf = requestAnimationFrame(frame);
  }

  // ---- public -------------------------------------------------------------

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    st.dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    st.w = w; st.h = h;
    st.worldW = Math.round(w * (1 + PAN));
    st.worldH = Math.round(h * WORLD_H);
    canvas.width = Math.round(w * st.dpr);
    canvas.height = Math.round(h * st.dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    st.layout = buildLayout();
    st.light = lightFor(st.part, st.worldW, st.worldH);
    st.stillKey = "";
    bakeStill();
    wild.update(0, {
      w: st.worldW, h: st.worldH,
      sandY: st.layout.sand, waterTop: st.layout.seaTop, part: st.part,
    });
    camp.update(0, campInfo());
    paint(performance.now());
  }

  function setDaypart(part) {
    if (st.part === part) return;
    st.part = part;
    st.light = lightFor(part, st.worldW, st.worldH);
    bakeStill();
    if (!st.running) paint(performance.now());
  }

  const setProgress = (p) => { st.progress = Math.max(0, Math.min(1, p)); if (!st.running) paint(performance.now()); };
  const setScroll = (p) => { st.scroll = Math.max(0, Math.min(1, p)); if (!st.running) paint(performance.now()); };
  const setTorches = (l) => { st.torches = l || []; camp.update(0, campInfo()); if (!st.running) paint(performance.now()); };

  function start() {
    if (reduced.matches) { paint(performance.now()); return; }
    if (st.running) return;
    st.running = true;
    st.last = performance.now();
    st.raf = requestAnimationFrame(frame);
  }
  function stop() {
    st.running = false;
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = 0;
  }

  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    setScroll(max > 0 ? window.scrollY / max : 0);
  };
  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", resize);
  reduced.addEventListener("change", () => { stop(); resize(); start(); });

  resize();
  onScroll();

  return {
    setDaypart, setProgress, setScroll, setTorches, start, stop, resize,
    destroy() {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resize);
    },
  };
}
