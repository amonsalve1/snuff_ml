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

import { bake, drawSprite } from "./pixel.js?v=18";
import { PALETTE, SPRITES, RELIEF } from "./jungle-sprites.js?v=18";
import { lightFor } from "./light-rig.js?v=18";
import { castShadow, shadowAlphaFor } from "./shadow.js?v=18";
import { drawSea, drawSand } from "./water.js?v=18";
import {
  CREATURE_SPRITES, EXTRA_PALETTE, CREATURE_RELIEF, createWildlife,
} from "./wildlife.js?v=18";

const DPR_CAP = 2;
const WORLD_H = 1.55; // world is this many viewports tall
const PAN = 0.30; // sideways travel across a season
const SEA_TOP = 0.08; // fractions of world height
const SAND_Y = 0.34;
const TORCH_Y = 0.60;
// the three torch sprites share their stake pixels, so they share a relief or a
// lit torch and a snuffed one show a seam down the same stake
const TORCH_RELIEF = 0.1;

const ART = Object.assign({}, PALETTE, EXTRA_PALETTE);

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

  const wild = createWildlife({ seed: 4242 });

  const st = {
    part: "midday", progress: 0, scroll: 0, torches: [],
    w: 0, h: 0, worldW: 0, worldH: 0, dpr: 1,
    light: null, still: null, stillKey: "", layout: null,
    last: performance.now(), raf: 0, running: false, glow: null,
  };

  // ---- layout -------------------------------------------------------------

  function buildLayout() {
    const r = rng(20260816);
    const H = st.worldH;
    const sand = H * SAND_Y;
    const props = [];
    for (let i = 0; i < 30; i++) {
      props.push({
        s: r() > 0.5 ? "PALM" : "PALM_ALT",
        x: -0.06 + (i / 29) * 1.14 + (r() - 0.5) * 0.03,
        y: sand + 4 + r() * 14, sc: 1,
      });
    }
    for (let i = 0; i < 11; i++) {
      props.push({
        s: r() > 0.5 ? "PALM_ALT" : "PALM",
        x: -0.04 + (i / 10) * 1.1 + (r() - 0.5) * 0.04,
        y: sand + 46 + r() * 60, sc: 2,
      });
    }
    props.push({ s: "HUT", x: 0.07, y: sand + 58, sc: 2 });
    for (let i = 0; i < 30; i++) {
      const p = r();
      props.push({
        s: p > 0.74 ? "ROCK" : p > 0.52 ? "LOG" : p > 0.26 ? "FERN" : "GRASS",
        x: -0.04 + r() * 1.12,
        y: sand + 96 + r() * Math.max(40, H - sand - 140),
        sc: 2,
      });
    }
    // back to front, so a near shadow lands on top of a far prop
    props.sort((a, b) => a.y - b.y);
    return { sand, seaTop: H * SEA_TOP, props };
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
    drawSand(g, { x: 0, y: L.sand, w: st.worldW, h: st.worldH - L.sand }, light, 0);

    const shadowy = shadowAlphaFor(light) > 0.2;
    for (const p of L.props) {
      const b = baked[p.s];
      if (!b) continue;
      const px = p.x * st.worldW;
      if (shadowy) castShadow(g, b, light, px, p.y, p.sc, p.y + b.h * p.sc);
      drawSprite(g, b, light, px, p.y, p.sc, RELIEF[p.s] ?? 0.6);
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
    drawSea(g, { x: 0, y: L.seaTop, w: st.worldW, h: L.sand - L.seaTop }, st.light, t);
    if (st.still) g.drawImage(st.still, 0, 0, st.worldW, st.worldH);
    drawCreatures(g);
    drawTorches(g, now);
    g.restore();
  }

  function frame(now) {
    if (!st.running) return;
    const dt = Math.min(0.1, (now - st.last) / 1000);
    st.last = now;
    wild.update(dt, {
      w: st.worldW, h: st.worldH,
      sandY: st.layout.sand, waterTop: st.layout.seaTop, part: st.part,
    });
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
  const setTorches = (l) => { st.torches = l || []; if (!st.running) paint(performance.now()); };

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
