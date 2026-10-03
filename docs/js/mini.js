// small multiples: one season, a couple of named lines, on the same log
// odds-vs-even axis the season view uses, so shapes compare across pages.
// the grey band is the middle 80% of whoever was still in, for context.
import { heat, alive } from "./common.js?v=32";

const NS = "http://www.w3.org/2000/svg";
const mk = (t, a, p) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); if (p) p.appendChild(n); return n; };

export function mini(s, lines, { w = 320, h = 150, mark = null, label = "" } = {}) {
  const n = s.episodes.length, P = { l: 30, r: 46, t: 12, b: 18 };
  const x = (j) => P.l + (j / Math.max(1, n - 1)) * (w - P.l - P.r);
  const L0 = Math.log2(0.125), L1 = Math.log2(5);
  const y = (v) => h - P.b - ((Math.log2(Math.max(0.125, Math.min(5, v))) - L0) / (L1 - L0)) * (h - P.t - P.b);
  const svg = mk("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", role: "img", "aria-label": label });
  const top = [], bot = [];
  for (let j = 0; j < n; j++) {
    const hs = alive(s, j).map((p) => heat(s, p, j)).sort((a, b) => a - b);
    const q = (f) => hs[Math.min(hs.length - 1, Math.floor(f * (hs.length - 1)))];
    top.push(`${x(j)},${y(q(0.9))}`); bot.unshift(`${x(j)},${y(q(0.1))}`);
  }
  mk("polygon", { points: [...top, ...bot].join(" "), fill: "#e9e0cd" }, svg);
  mk("line", { x1: P.l, x2: w - P.r, y1: y(1), y2: y(1), stroke: "#1d1a16", "stroke-width": 1, opacity: 0.45 }, svg);
  mk("text", { x: P.l - 4, y: y(1) + 3.5, "text-anchor": "end", "font-size": 9.5, "font-family": "DM Mono", fill: "#6b6457" }, svg).textContent = "even";
  for (const [j, t] of [[0, "ep 1"], [n - 1, `ep ${s.episodes[n - 1]}`]])
    mk("text", { x: x(j), y: h - 4, "text-anchor": j ? "end" : "start", "font-size": 9.5, "font-family": "DM Mono", fill: "#6b6457" }, svg).textContent = t;
  if (mark != null) mk("line", { x1: x(mark), x2: x(mark), y1: P.t, y2: h - P.b, stroke: "#1d1a16", "stroke-dasharray": "2 3", opacity: 0.45 }, svg);
  for (const L of lines) {
    let cur = [], spans = 0, lastJ = -1;
    const flush = () => { if (cur.length > 1) mk("polyline", { points: cur.join(" "), fill: "none", stroke: L.color, "stroke-width": L.width || 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg); else if (cur.length === 1) mk("circle", { cx: cur[0].split(",")[0], cy: cur[0].split(",")[1], r: 2, fill: L.color }, svg); if (cur.length) spans++; cur = []; };
    for (let j = 0; j < n; j++) { const v = heat(s, L.p, j); if (v == null) flush(); else { cur.push(`${x(j)},${y(v)}`); lastJ = j; } }
    flush();
    if (lastJ < 0) continue;
    const ex = x(lastJ), ey = y(heat(s, L.p, lastJ));
    if (L.p.winner) { mk("circle", { cx: ex, cy: ey, r: 4, fill: L.color, stroke: "#fbf7ee", "stroke-width": 1.5 }, svg); mk("text", { x: ex + 7, y: ey + 3.5, "font-size": 10, "font-family": "DM Mono", "font-weight": 600, fill: L.color }, svg).textContent = "won"; }
    else if (L.p.boot) mk("text", { x: ex, y: ey + 3.5, "text-anchor": "middle", "font-size": 10, "font-family": "DM Mono", fill: L.color }, svg).textContent = "✕";
    // a run with a hole in it came back from the edge or redemption
    if (spans > 1) mk("text", { x: x(n - 1), y: P.t + 2, "text-anchor": "end", "font-size": 9.5, "font-family": "DM Mono", fill: L.color }, svg).textContent = "out, then back";
    if (L.peak != null) {
      const px = x(L.peak), py = y(heat(s, L.p, L.peak));
      mk("circle", { cx: px, cy: py, r: 3.5, fill: "#fbf7ee", stroke: L.color, "stroke-width": 1.8 }, svg);
      mk("text", { x: px, y: py - 7, "text-anchor": "middle", "font-size": 10, "font-family": "DM Mono", "font-weight": 600, fill: L.color }, svg).textContent = L.peakText;
    }
  }
  return svg;
}
