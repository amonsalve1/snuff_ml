// the island behind the page.
//
// a pixel beach lit by whatever daypart the scrubber is sitting in, with a
// torch on the sand for every player still in the game. scrubbing pans the
// camera down the beach, so replaying a season is walking along it while the
// light goes from midday to final tribal.
//
// rules this thing lives by, because it sits under a data site:
//   - it is a backdrop. it never draws over text, never blends, never blurs.
//   - the static layers get baked once per (daypart, size) and blitted. only
//     flames, smoke and fireflies are redrawn per frame.
//   - reduced motion freezes it on a single painted frame.
//   - hidden tab cancels the loop outright.

import { bake, drawSprite, shade } from "./pixel.js?v=16";
import { PALETTE, SPRITES, RELIEF } from "./jungle-sprites.js?v=16";
import { lightFor } from "./light-rig.js?v=16";

const DPR_CAP = 2;
const HORIZON = 0.34; // fraction of band height where the sand starts
const PAN = 0.38; // how much of a screen width the camera travels end to end
// the three torch sprites share their stake and rag pixels exactly, so they all
// have to be shaded at the same relief or a lit torch and a snuffed one standing
// side by side show a seam down the same stake
const TORCH_RELIEF = 0.1;

// deterministic layout: same beach every visit, no random reshuffle on reload
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createScene(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  const baked = {};
  for (const name of Object.keys(SPRITES)) baked[name] = bake(SPRITES[name], PALETTE);

  const state = {
    part: "midday",
    progress: 0,
    torches: [],
    w: 0,
    h: 0,
    dpr: 1,
    light: null,
    still: null, // offscreen canvas holding the baked static layers
    stillKey: "",
    layout: null,
    fireflies: [],
    t0: performance.now(),
    raf: 0,
    running: false,
  };

  // ---- layout -------------------------------------------------------------

  function buildLayout(w, h) {
    const r = rng(20260816);
    const sand = h * HORIZON;
    const far = [];
    const mid = [];
    const fore = [];
    // far treeline: small, dense, sits right on the horizon
    for (let i = 0; i < 26; i++) {
      far.push({
        sprite: r() > 0.5 ? "PALM" : "PALM_ALT",
        x: -0.1 + (i / 25) * 1.25 + (r() - 0.5) * 0.03,
        y: sand - 2 - r() * 6,
        scale: 1,
        sway: 0.4 + r() * 0.5,
        par: 0.32,
      });
    }
    for (let i = 0; i < 9; i++) {
      mid.push({
        sprite: r() > 0.5 ? "PALM_ALT" : "PALM",
        x: -0.05 + (i / 8) * 1.15 + (r() - 0.5) * 0.05,
        y: sand + 6 + r() * 10,
        scale: 2,
        sway: 0.7 + r() * 0.7,
        par: 0.62,
      });
    }
    // scatter on the sand
    for (let i = 0; i < 16; i++) {
      const pick = r();
      fore.push({
        sprite: pick > 0.72 ? "ROCK" : pick > 0.5 ? "LOG" : pick > 0.24 ? "FERN" : "GRASS",
        x: -0.05 + r() * 1.2,
        y: sand + 18 + r() * Math.max(12, h - sand - 30),
        scale: 2,
        sway: pick <= 0.5 ? 0.5 : 0,
        par: 1.1,
      });
    }
    const hut = { sprite: "HUT", x: 0.06, y: sand + 12, scale: 2, par: 0.62 };
    return { sand, far, mid, fore, hut };
  }

  function buildFireflies(w, h) {
    const r = rng(77);
    const out = [];
    for (let i = 0; i < 26; i++) {
      out.push({
        x: r(),
        y: 0.4 + r() * 0.5,
        phase: r() * Math.PI * 2,
        speed: 0.15 + r() * 0.3,
        drift: 6 + r() * 14,
      });
    }
    return out;
  }

  // sand and water are flat fills rather than sprites, so they get the light
  // applied by hand: same shape as the shader, ambient plus a diffuse term.
  function tint(hex, light) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    // keep the factor near 1 at noon and genuinely dark at night
    const k = 0.42 * light.intensity;
    const ch = (v, amb, col) => Math.max(0, Math.min(255, Math.round(v * (amb + col * k))));
    return `rgb(${ch(r, light.ambient[0], light.color[0])},${ch(g, light.ambient[1], light.color[1])},${ch(b, light.ambient[2], light.color[2])})`;
  }

  function drawGround(g) {
    const L = state.layout;
    const light = state.light;
    const w = state.w * (1 + PAN);
    // the page background shows through above the horizon and reads as sky, so
    // the scene only paints from the water down
    const seaTop = L.sand - state.h * 0.16;
    g.fillStyle = tint(PALETTE.a, light);
    g.fillRect(0, seaTop, w, L.sand - seaTop);
    g.fillStyle = tint(PALETTE.z, light);
    g.fillRect(0, seaTop, w, 3);
    // a line of surf where the water meets the beach
    g.fillStyle = tint(PALETTE.A, light);
    g.fillRect(0, L.sand - 3, w, 3);
    g.fillStyle = tint(PALETTE.s, light);
    g.fillRect(0, L.sand, w, state.h - L.sand);
    g.fillStyle = tint(PALETTE.S, light);
    g.fillRect(0, L.sand, w, 2);
  }

  // ---- static layers ------------------------------------------------------

  // everything that does not move gets drawn once per (daypart, size) and then
  // blitted. this is what keeps the per frame cost down to the flames.
  function bakeStill() {
    const key = `${state.part}|${state.w}x${state.h}`;
    if (state.stillKey === key && state.still) return;
    const worldPx = state.w * (1 + PAN);
    const c = document.createElement("canvas");
    c.width = Math.ceil(worldPx * state.dpr);
    c.height = Math.ceil(state.h * state.dpr);
    const g = c.getContext("2d");
    g.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    g.imageSmoothingEnabled = false;

    const L = state.layout;
    const light = state.light;
    const put = (item, worldW) => {
      const b = baked[item.sprite];
      if (!b) return;
      drawSprite(g, b, light, item.x * worldW, item.y, item.scale, RELIEF[item.sprite] ?? 0.6);
    };
    const worldW = state.w * (1 + PAN);
    drawGround(g);
    for (const it of L.far) put(it, worldW);
    put(L.hut, worldW);
    for (const it of L.mid) put(it, worldW);
    for (const it of L.fore) put(it, worldW);

    state.still = c;
    state.stillKey = key;
  }

  // the glow, drawn once and then just blitted. building a radial gradient per
  // torch per frame was the only real allocation left in the loop.
  let glowTex = null;
  function glow() {
    if (glowTex) return glowTex;
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, "rgba(255, 186, 92, 1)");
    gr.addColorStop(0.45, "rgba(255, 158, 62, 0.34)");
    gr.addColorStop(1, "rgba(255, 150, 60, 0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    glowTex = c;
    return c;
  }

  // ---- torches ------------------------------------------------------------

  // one torch per player. a lit torch means still in it, and the flame gets
  // taller with win probability, so the tallest fire on the beach is whoever
  // the model likes. a snuffed torch goes dark and smokes.
  function drawTorches(g, now) {
    const list = state.torches;
    if (!list.length) return;
    const worldW = state.w * (1 + PAN);
    const sand = state.layout.sand;
    const y = sand + state.h * 0.44;
    const gap = worldW / (list.length + 1);
    const frame = Math.floor(now / 130) % 2;
    const dark = state.part === "night" ? 2.6 : state.part === "dusk" ? 1.7 : 1;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const x = gap * (i + 1);
      if (p.out) {
        drawSprite(g, baked.TORCH_OUT, state.light, x, y, 2, TORCH_RELIEF);
        // a little smoke that drifts and fades
        const age = ((now / 1000) * 0.6 + i) % 3;
        g.globalAlpha = Math.max(0, 0.28 - age * 0.09);
        g.fillStyle = "#8a7d70";
        for (let s = 0; s < 3; s++) {
          const sy = y - 40 - age * 14 - s * 7;
          const sx = x + Math.sin(age * 2 + s + i) * (4 + s * 2);
          g.fillRect(Math.round(sx), Math.round(sy), 2, 2);
        }
        g.globalAlpha = 1;
        continue;
      }
      const name = frame ? "TORCH_LIT_B" : "TORCH_LIT_A";
      drawSprite(g, baked[name], state.light, x, y, 2, TORCH_RELIEF);
      // the glow: bigger and brighter the more the model likes them. this is
      // the leaderboard, told the way the show tells it.
      const heat = Math.max(0.12, Math.min(1, p.prob * (list.length || 1)));
      const flick = 0.86 + Math.sin(now / 90 + i * 1.7) * 0.14;
      const rad = (14 + heat * 34) * flick * (dark > 1 ? 1.5 : 1);
      g.globalAlpha = Math.min(0.85, 0.30 * dark * flick * (0.4 + heat * 0.6));
      g.drawImage(glow(), x + 8 - rad, y - 34 - rad, rad * 2, rad * 2);
      g.globalAlpha = 1;
    }
  }

  function drawFireflies(g, now) {
    if (state.part !== "night" && state.part !== "dusk") return;
    const worldW = state.w * (1 + PAN);
    g.fillStyle = "#ffd98a";
    for (const f of state.fireflies) {
      const t = now / 1000;
      const a = 0.35 + Math.sin(t * f.speed * 3 + f.phase) * 0.35;
      if (a <= 0.02) continue;
      g.globalAlpha = a;
      const x = f.x * worldW + Math.sin(t * f.speed + f.phase) * f.drift;
      const y = f.y * state.h + Math.cos(t * f.speed * 0.7 + f.phase) * (f.drift * 0.5);
      g.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
    g.globalAlpha = 1;
  }

  // ---- frame --------------------------------------------------------------

  function paint(now) {
    const g = ctx;
    g.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    g.clearRect(0, 0, state.w, state.h);
    g.imageSmoothingEnabled = false;

    // the camera: scrubbing walks you along the beach
    const camX = -state.progress * state.w * PAN;
    g.save();
    g.translate(Math.round(camX), 0);

    if (state.still) {
      g.drawImage(state.still, 0, 0, state.w * (1 + PAN), state.h);
    }
    drawTorches(g, now);
    drawFireflies(g, now);
    g.restore();
  }

  function frame(now) {
    if (!state.running) return;
    paint(now);
    state.raf = requestAnimationFrame(frame);
  }

  // ---- public -------------------------------------------------------------

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    state.dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    state.w = w;
    state.h = h;
    canvas.width = Math.round(w * state.dpr);
    canvas.height = Math.round(h * state.dpr);
    state.layout = buildLayout(w, h);
    state.fireflies = buildFireflies(w, h);
    // the light has to live in the same space the sprites do, or rig.x means
    // one thing for the sun and another for the beach
    state.light = lightFor(state.part, w * (1 + PAN), h);
    state.stillKey = "";
    bakeStill();
    paint(performance.now());
  }

  function setDaypart(part) {
    if (state.part === part) return;
    state.part = part;
    state.light = lightFor(part, state.w * (1 + PAN), state.h);
    bakeStill();
    if (!state.running) paint(performance.now());
  }

  function setProgress(p) {
    state.progress = Math.max(0, Math.min(1, p));
    if (!state.running) paint(performance.now());
  }

  function setTorches(list) {
    state.torches = list || [];
    if (!state.running) paint(performance.now());
  }

  function start() {
    if (reduced.matches) { paint(performance.now()); return; }
    if (state.running) return;
    state.running = true;
    state.raf = requestAnimationFrame(frame);
  }

  function stop() {
    state.running = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  // a hidden tab should cost nothing at all
  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("resize", resize);
  reduced.addEventListener("change", () => { stop(); resize(); start(); });

  resize();

  return {
    setDaypart, setProgress, setTorches, start, stop, resize,
    destroy() {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", resize);
    },
  };
}
