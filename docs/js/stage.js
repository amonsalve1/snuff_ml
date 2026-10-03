// tribal council seen from the shore. the light runs from midday at the
// premiere to night at final tribal, driven by season progress, not the clock.
// everything renders at art resolution into a small canvas and is scaled up
// with smoothing off, so a full relight is cheap enough to animate.
import { PALETTE as P, SPRITES } from "./jungle-sprites.js?v=32";

const S = 4;
const ROWS = 172, HORIZON = 82, SHORE = 112, BASE = 160;
const STAKE = 22, HEAD = 5, FLAME_MAX = 42;
const HEAD_ART = ["vVvVv", "vVVVv", "bvVvb", "bvvvb", ".bwb."];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const dith = (x, y, f) => BAYER[(y & 3) * 4 + (x & 3)] < f * 16;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };

// four lights. colours are hex here and parsed once below.
const MIDDAY = {
  sky: ["#4f9fd3", "#5aa7d6", "#66afda", "#73b7de", "#82bfe1", "#93c8e3", "#a8d2e4", "#c3dde2"],
  sea: ["#2b7ea6", "#3189b0", "#3b97b9", "#4ba6c1"], sand: ["#e8d29b", "#e3ca90", "#ddc286", "#d5b97c", "#c9ac70", "#b89c63"],
  sil: "#3f6e55", path: "#fff8de", glint: "#bfe6f0", foam: "#e9f6f8", foamEdge: "#ffffff", halo: "#fff4c8",
  stars: 0, dark: 0, moon: 0, sun: { x: 0.66, y: 16, r: 6 }, sunCore: "#fff7dc", sunRim: "#ffe9a8",
};
const GOLDEN = {
  sky: ["#6e9bcb", "#7ea5cc", "#93aec8", "#adb3bd", "#cbb2a0", "#e6ad80", "#f2b46a", "#f7c46c"],
  sea: ["#2c5c84", "#3c6889", "#5b7787", "#87877c"], sand: ["#e6ba80", "#ddae73", "#d1a168", "#c5955e", "#b48756", "#9f774b"],
  sil: "#3b3b3e", path: "#ffd27e", glint: "#e9bf86", foam: "#f4e2c6", foamEdge: "#fff2dc", halo: "#ffd98a",
  stars: 0, dark: 0.3, moon: 0, sun: { x: 0.8, y: 60, r: 8 }, sunCore: "#ffe2a0", sunRim: "#ffb85c",
};
const DUSK = {
  sky: ["#1d2350", "#292b5d", "#3b3166", "#54386b", "#77406b", "#a04b63", "#cc6356", "#e78150"],
  sea: ["#1d2951", "#283058", "#43385a", "#684358"], sand: ["#7b5c5e", "#6e5459", "#624b54", "#57444e", "#493b46", "#362d3b"],
  sil: "#19132e", path: "#f39a64", glint: "#7c5c7c", foam: "#c9a9b9", foamEdge: "#e8c8d0", halo: "#ff9a5a",
  stars: 0.45, dark: 0.75, moon: 0.25, sun: { x: 0.85, y: HORIZON + 3, r: 9 }, sunCore: "#ffb070", sunRim: "#ff7a40",
};
const NIGHT = {
  sky: ["#0a0e24", "#0f1532", "#151d42", "#1c2652", "#263060", "#33386b", "#463f72", "#5d4672"],
  sea: ["#121b38", "#162243", "#1b2a4e", "#213258"], sand: ["#41435b", "#48465e", "#4c475f", "#46405a", "#3a344c", "#2a2438"],
  sil: "#090d20", path: "#efe4c0", glint: "#2f4672", foam: "#6d7fa3", foamEdge: "#9fb0cf", halo: "#3a4580",
  stars: 1, dark: 1, moon: 1, sun: { x: 0.9, y: HORIZON + 30, r: 9 }, sunCore: "#ffb070", sunRim: "#ff7a40",
};
const parse = (k) => ({ ...k, sky: k.sky.map(rgb), sea: k.sea.map(rgb), sand: k.sand.map(rgb), sil: rgb(k.sil), path: rgb(k.path),
  glint: rgb(k.glint), foam: rgb(k.foam), foamEdge: rgb(k.foamEdge), halo: rgb(k.halo), sunCore: rgb(k.sunCore), sunRim: rgb(k.sunRim) });
// same thresholds as js/daypart.js: midday until 0.4, golden to 0.7, dusk to 0.9
const KEYS = [[0, MIDDAY], [0.32, MIDDAY], [0.55, GOLDEN], [0.8, DUSK], [0.97, NIGHT], [1, NIGHT]].map(([at, k]) => [at, parse(k)]);

function lightAt(p) {
  let j = 0;
  while (j < KEYS.length - 2 && p > KEYS[j + 1][0]) j++;
  const [a0, A] = KEYS[j], [a1, B] = KEYS[j + 1];
  let t = a1 > a0 ? Math.max(0, Math.min(1, (p - a0) / (a1 - a0))) : 0;
  t = t * t * (3 - 2 * t);
  const m = (x, y) => mix(x, y, t), n = (x, y) => x + (y - x) * t;
  return {
    sky: A.sky.map((c, i) => m(c, B.sky[i])), sea: A.sea.map((c, i) => m(c, B.sea[i])), sand: A.sand.map((c, i) => m(c, B.sand[i])),
    sil: m(A.sil, B.sil), path: m(A.path, B.path), glint: m(A.glint, B.glint), foam: m(A.foam, B.foam), foamEdge: m(A.foamEdge, B.foamEdge),
    halo: m(A.halo, B.halo), sunCore: m(A.sunCore, B.sunCore), sunRim: m(A.sunRim, B.sunRim),
    stars: n(A.stars, B.stars), dark: n(A.dark, B.dark), moon: n(A.moon, B.moon),
    sun: { x: n(A.sun.x, B.sun.x), y: n(A.sun.y, B.sun.y), r: n(A.sun.r, B.sun.r) },
  };
}

const band = (list, t, x, y) => {
  const f = Math.max(0, Math.min(list.length - 1.001, t * (list.length - 1)));
  const i = Math.floor(f);
  return dith(x, y, f - i) ? list[i + 1] : list[i];
};
export const flameRows = (heat) => {
  const t = (Math.log2(Math.max(0.125, Math.min(4, heat))) + 3) / 5;
  return Math.round(3 + Math.pow(t, 1.25) * (FLAME_MAX - 3));
};

export function createStage(host, { fps = 8, onLight = () => {} } = {}) {
  host.classList.add("stage");
  const cv = document.createElement("canvas");
  cv.setAttribute("aria-hidden", "true");
  host.prepend(cv);
  const g = cv.getContext("2d");
  const art = document.createElement("canvas");
  const a = art.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, C = 0, dpr = 1, xs = [], items = [], L = lightAt(0), img = null, bakedKey = "";
  let pNow = 0, pFrom = 0, pTo = 0, tStart = 0, tDur = 0;
  // torches ease between episodes: flames grow and shrink, a snuffed one
  // gutters out before the smoke starts, a relit one catches from nothing
  let iStart = 0, iDur = 0;
  const ITEM_MS = 950;

  const put = (x, y, c, al = 1) => { a.globalAlpha = al; a.fillStyle = css(c); a.fillRect(x, y, 1, 1); };

  function bakeStatic() {
    const key = `${C}|${pNow.toFixed(3)}`;
    if (key === bakedKey) return;
    bakedKey = key;
    img = a.createImageData(C, ROWS);
    const buf = new Uint32Array(img.data.buffer);
    const set = (x, y, c) => { if (x >= 0 && x < C && y >= 0 && y < ROWS) buf[y * C + x] = 0xff000000 | ((c[2] | 0) << 16) | ((c[1] | 0) << 8) | (c[0] | 0); };
    const get = (x, y) => { const v = buf[y * C + x]; return [v & 255, (v >> 8) & 255, (v >> 16) & 255]; };
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < C; x++) {
      let c;
      if (y < HORIZON) c = band(L.sky, Math.pow(y / HORIZON, 1.4), x, y);
      else if (y < SHORE) c = band(L.sea, (y - HORIZON) / (SHORE - HORIZON), x, y);
      else {
        c = band(L.sand, (y - SHORE) / (ROWS - SHORE), x, y);
        const n = hash(x, y);
        if (n > 0.985) c = mix(c, [255, 255, 255], 0.12); else if (n < 0.012) c = mix(c, [0, 0, 0], 0.18);
        if (y < SHORE + 4 && dith(x, y, 0.5 - (y - SHORE) * 0.12)) c = mix(c, L.sea[3], 0.55);
      }
      set(x, y, c);
    }
    // sun: a disc that sinks behind the horizon, with a dithered halo
    const sx = Math.round(C * L.sun.x), sy = Math.round(L.sun.y), sr = L.sun.r;
    for (let y = sy - sr * 4; y <= sy + sr * 4; y++) for (let x = sx - sr * 4; x <= sx + sr * 4; x++) {
      if (y < 0 || y >= HORIZON || x < 0 || x >= C) continue;
      const d = Math.hypot(x - sx, y - sy);
      if (d <= sr) set(x, y, d > sr - 1.2 ? L.sunRim : L.sunCore);
      else if (d < sr * 4 && dith(x, y, (1 - d / (sr * 4)) * 0.8)) set(x, y, mix(get(x, y), L.halo, 0.35));
    }
    // moon fades in from dusk
    if (L.moon > 0.02) {
      const mx = Math.round(C * 0.78), my = 22, mr = 7;
      for (let y = my - 22; y <= my + 22; y++) for (let x = mx - 26; x <= mx + 26; x++) {
        if (x < 0 || x >= C || y < 0) continue;
        const d = Math.hypot(x - mx, y - my);
        if (d <= mr) set(x, y, mix(get(x, y), rgb((x - mx) + (y - my) > 4 ? "#d9cfae" : "#f3ecd2"), L.moon));
        else if (d < 22 && dith(x, y, (1 - d / 22) * 0.55 * L.moon)) set(x, y, mix(get(x, y), rgb("#3a4580"), 0.8 * L.moon));
      }
    }
    // far island, palms cut from the island's own sprites
    const hump = (cx, w, h) => { for (let x = cx - w; x <= cx + w; x++) { const k = 1 - ((x - cx) / w) ** 2; for (let y = HORIZON - Math.round(h * k); y <= HORIZON; y++) set(x, y, L.sil); } };
    const palm = (name, x0, y0) => { const rows = SPRITES[name]; for (let r = 0; r < rows.length; r += 2) for (let c = 0; c < rows[0].length; c += 2) if (rows[r][c] !== ".") set(x0 + c / 2, y0 + r / 2, L.sil); };
    hump(Math.round(C * 0.16), Math.round(C * 0.14), 5);
    palm("PALM_TALL", Math.round(C * 0.09), HORIZON - 30); palm("PALM", Math.round(C * 0.17), HORIZON - 24); palm("PALM", Math.round(C * 0.23), HORIZON - 21);
    hump(Math.round(C * 0.93), Math.round(C * 0.09), 3); palm("PALM_TALL", Math.round(C * 0.9), HORIZON - 29);
    // headline sits around row 30: tell the page which ink reads on it
    // pick the ink with the best worst case over every sky row the copy covers
    const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const inks = { day: lum(rgb("#13203a")), night: lum(rgb("#f4ead8")) };
    let worstDay = 99, worstNight = 99;
    for (let y = 3; y <= 46; y++) for (const f of [0, 0.5, 0.999]) {
      const t = Math.pow(y / HORIZON, 1.4) * (L.sky.length - 1);
      const c = L.sky[Math.min(L.sky.length - 1, Math.floor(t) + (f > t % 1 ? 0 : 1))];
      worstDay = Math.min(worstDay, cr(lum(c), inks.day)); worstNight = Math.min(worstNight, cr(lum(c), inks.night));
    }
    const sample = band(L.sky, Math.pow(32 / HORIZON, 1.4), 0, 0);
    const sandLow = L.sand[L.sand.length - 1];
    onLight({ day: worstDay >= worstNight, contrast: Math.max(worstDay, worstNight), sky: css(sample), sand: css(sandLow), sandDark: css(mix(sandLow, [0, 0, 0], 0.18)), groundDay: lum(sandLow) > 0.2 });
  }

  const size = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = host.clientWidth; C = Math.ceil(W / S);
    cv.style.width = W + "px"; cv.style.height = ROWS * S + "px";
    cv.width = Math.round(W * dpr); cv.height = Math.round(ROWS * S * dpr);
    art.width = C; art.height = ROWS;
    layout(); bakedKey = "";
  };
  const layout = () => {
    const span = C * 0.88, left = (C - span) / 2;
    xs = items.map((_, k) => Math.round(left + span * (k + 0.5) / Math.max(1, items.length)));
  };

  function water(frame) {
    const sunUp = L.sun.y < HORIZON - 1;
    const cx = Math.round(C * (sunUp ? L.sun.x : 0.78));
    const k = sunUp ? 1 : L.moon;
    if (k < 0.05) return;
    for (let y = HORIZON + 1; y < SHORE; y++) {
      const t = (y - HORIZON) / (SHORE - HORIZON), half = 2 + t * 9;
      for (let x = Math.round(cx - half); x <= cx + half; x++)
        if (hash(x * 7 + frame, y) > 0.55 + t * 0.15) put(x, y, L.path, (0.85 - t * 0.4) * k);
    }
    for (let y = HORIZON + 1; y < SHORE; y++) if ((y + frame) % 3 === 0) {
      const t = (y - HORIZON) / (SHORE - HORIZON);
      for (let i = 0; i < 6; i++) { const gx = Math.floor(hash(i, y) * C + frame * (0.6 + t)) % C; put(gx, y, L.glint); put(gx + 1, y, L.glint); }
    }
  }
  function foam(frame) {
    for (let x = 0; x < C; x++) {
      const reach = Math.round(1.5 + Math.sin(x * 0.09 + frame * 0.35) * 1.5 + Math.sin(x * 0.023 - frame * 0.2) * 1.2);
      for (let y = SHORE - 1; y < SHORE + reach; y++) {
        const edge = y === SHORE + reach - 1;
        if (edge || dith(x, y, 0.35)) put(x, y, edge ? L.foamEdge : L.foam, edge ? 0.85 : 0.6);
      }
    }
  }
  function stars(frame) {
    if (L.stars < 0.02) return;
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(hash(i, 1) * C), y = Math.floor(Math.pow(hash(i, 2), 1.6) * (HORIZON - 30));
      const tw = hash(i, Math.floor(frame / 3)) > 0.85 ? 0.35 : 1;
      put(x, y, rgb(hash(i, 3) > 0.7 ? "#9fb3e0" : "#f4ead8"), (0.35 + hash(i, 4) * 0.5) * tw * L.stars);
    }
  }

  const LIT = ["#5a4a5c", "#7a5a56", "#9a6a50", "#b9804f"].map(rgb);
  function drawn(it, now) {
    const t = iDur ? Math.min(1, (now - iStart) / iDur) : 1;
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const lerpLog = (a, b, f) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * f);
    if (t >= 1 || it.from === undefined) return { ...it, k: 1 };
    if (!it.out && it.from != null) return { ...it, heat: lerpLog(it.from, it.heat, e), k: 1 };
    if (it.out && it.from != null) {
      // gutter: shrink to nothing over most of the move, then smoke
      const f = Math.min(1, t / 0.8);
      return f < 1 ? { ...it, out: false, heat: it.from, k: 1 - f * f } : { ...it, k: 1 };
    }
    if (!it.out && it.from == null) return { ...it, k: e };
    return { ...it, k: 1 };
  }

  function torch(cx, it, frame, k) {
    const headY = BASE - STAKE - HEAD;
    const H = it.out ? 0 : Math.round(flameRows(it.heat) * (it.k ?? 1));
    if (!it.out && H < 1) { /* fully guttered this frame: just the charred head */ }
    if (!it.out && L.dark > 0.05) {
      const rx = 9 + H * 1.0, ry = 3 + H * 0.24;
      for (let y = Math.round(BASE - ry); y <= BASE + ry; y++) for (let x = Math.round(cx - rx); x <= cx + rx; x++) {
        const d = Math.hypot((x - cx) / rx, (y - BASE) / ry);
        if (d >= 1) continue;
        const f = (1 - d) * (1 - d) * 4.6 * (0.6 + (H / FLAME_MAX) * 0.5);
        const i = Math.floor(f), lv = Math.min(LIT.length - 1, dith(x, y, f - i) ? i : i - 1);
        if (lv >= 0) put(x, y, LIT[lv], L.dark);
      }
      const fy = headY - 1, gr = Math.round(H * 0.5 + 4), gcY = fy - H * 0.38;
      for (let y = Math.round(gcY - gr); y <= gcY + gr; y++) for (let x = cx - gr; x <= cx + gr; x++) {
        const d = Math.hypot(x - cx, (y - gcY) * 1.15) / gr;
        if (d < 1 && dith(x, y, (1 - d) * (1 - d) * (it.sel ? 0.9 : 0.6))) put(x, y, rgb("#ff9a4a"), (0.07 + (1 - d) * 0.1) * L.dark);
      }
    }
    // shadow: long and to the right in daylight, a short smudge at night
    const sh = Math.round(2 + (1 - L.dark) * 7);
    for (let x = 0; x <= sh; x++) put(cx + x, BASE, [20, 14, 18], 0.35 * (1 - x / (sh + 1)));
    for (let y = BASE - STAKE; y < BASE; y++) {
      const node = (BASE - y) % 7 === 0;
      put(cx - 1, y, rgb(node ? P.v : P.w)); put(cx, y, rgb(node ? P.V : P.W)); put(cx + 1, y, rgb(node ? P.w : P.b));
    }
    HEAD_ART.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== ".") put(cx - 2 + c, headY + r, rgb(it.out ? (ch === "V" ? P.w : P.b) : P[ch])); }));
    if (it.out) {
      for (let c = -1; c <= 1; c++) put(cx + c, headY - 1, rgb(P.b));
      for (let i = 0; i < 5; i++) put(cx + Math.round(Math.sin((frame + i * 2 + k) * 0.9) * 1.2), headY - 3 - i * 2 - (frame % 2), rgb("#8a8fa8"), 0.5 - i * 0.09);
      return;
    }
    const maxW = 1.6 + H * 0.15, fy = headY - 1;
    for (let r = 0; r < H; r++) {
      const u = r / Math.max(1, H - 1);
      const prof = u < 0.28 ? 0.72 + u : Math.pow((1 - u) / 0.72, 0.85);
      const w = Math.max(0.5, maxW * prof + (hash(k * 31 + frame, r) - 0.5) * 0.9 * u);
      const sway = Math.sin(frame * 0.8 + k * 1.7 + u * 2.6) * u * u * 2.2;
      for (let x = Math.floor(-w); x <= Math.ceil(w); x++) {
        const e = Math.abs(x - sway * 0.5) / w;
        if (e > 1) continue;
        let c = P.f;
        if (e < 0.75 && u < 0.85) c = P.F;
        if (e < 0.5 && u < 0.62) c = P.y;
        if (e < 0.28 && u < 0.4) c = P.c;
        if (r === 0 && e > 0.6) c = P.e;
        put(cx + Math.round(x + sway), fy - r, rgb(c));
      }
    }
    if (hash(k, frame) > 0.72) put(cx + Math.round((hash(frame, k) - 0.5) * 4), fy - H - 1 - Math.round(hash(k + 9, frame) * 3), rgb(P.y), 0.9);
  }

  function paint(now) {
    const frame = reduce ? 0 : Math.floor(now / (1000 / fps));
    if (tDur) {
      const t = Math.min(1, (now - tStart) / tDur);
      pNow = pFrom + (pTo - pFrom) * (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
      if (t >= 1) tDur = 0;
    }
    L = lightAt(pNow);
    bakeStatic();
    a.putImageData(img, 0, 0);
    stars(frame); water(frame); foam(frame);
    items.forEach((it, k) => torch(xs[k], drawn(it, now), frame, k));
    if (iDur && now - iStart >= iDur) iDur = 0;
    a.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(art, 0, 0, C, ROWS, 0, 0, cv.width, cv.height);
  }

  let raf = 0, last = -1;
  const loop = (now) => {
    const f = Math.floor(now / (1000 / fps));
    if (f !== last || tDur || iDur) { last = f; paint(now); }
    raf = requestAnimationFrame(loop);
  };
  const ro = new ResizeObserver(() => { size(); paint(performance.now()); });
  ro.observe(host);
  size();
  raf = requestAnimationFrame(loop);

  return {
    setItems(list, animate = false) {
      const prev = new Map(items.map((it) => [it.name, it.out ? null : it.heat]));
      items = list.map((it) => ({ ...it, from: animate && prev.has(it.name) ? prev.get(it.name) : undefined }));
      if (animate && !reduce) { iStart = performance.now(); iDur = ITEM_MS; }
      layout(); paint(performance.now());
    },
    setLight(p, animate = true) {
      if (!animate || reduce) { pNow = pTo = p; tDur = 0; paint(performance.now()); return; }
      pFrom = pNow; pTo = p; tStart = performance.now(); tDur = 1100;
    },
    xs: () => xs.map((x) => x * S),
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
  };
}
