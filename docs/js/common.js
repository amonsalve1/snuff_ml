// data loading and the season chart, shared by every page
// one fetch per file. a failed request is dropped from the cache so the next
// call can retry, instead of the rejection being served forever
const cache = new Map();
export function getJSON(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    }).catch((e) => { cache.delete(url); throw e; }));
  }
  return cache.get(url);
}
export const loadIndex = () => getJSON("data/index.json");
export const loadSeason = (n) => getJSON(`data/seasons/s${String(n).padStart(2, "0")}.json`);
export const loadTrack = () => getJSON("data/track.json");
export async function loadAll() {
  const idx = await loadIndex();
  return Promise.all(idx.seasons.map((x) => loadSeason(x.season)));
}
export async function load(season) {
  const [index, s] = await Promise.all([loadIndex(), loadSeason(season)]);
  return { labels: index.labels, s, index, meta: index.seasons.find((x) => x.season === s.season) || {} };
}
export const slug = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const ordinal = (k) => { const t = k % 100; return k + (t > 10 && t < 14 ? "th" : ["th", "st", "nd", "rd"][k % 10] || "th"); };

export const alive = (s, i) => s.players.filter((p) => p.probs[i] != null);
export const heat = (s, p, i) => (p.probs[i] == null ? null : p.probs[i] * alive(s, i).length);
export const ranked = (s, i) => alive(s, i).sort((a, b) => b.probs[i] - a.probs[i]);


const NS = "http://www.w3.org/2000/svg";
const mk = (t, a, parent) => {
  const n = document.createElementNS(NS, t);
  for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};


// the season chart as a persistent object, so moving between episodes glides:
// the past is revealed by a clip that slides, the now line, dots and end
// labels tween, and roles (picked, leading, won) restyle in place.
// every player has a line; "focus" shows only the three a reader can predict,
// "everyone" shows the whole cast but still only names those three. anyone
// else is named on hover, and clicking a line makes them the pick.
let chartSeq = 0;
export function seasonChart(host, s, sel, o, tweenFn, { mode = "focus", onPick = () => {}, slots } = {}) {
  host.innerHTML = "";
  const W = o.w, H = o.h, P = { l: 44, r: o.padR || 150, t: 16, b: 30 };
  const id = `c${++chartSeq}`;
  const n = s.episodes.length;
  // a season still airing is drawn across the length it will run, not the
  // length it has run, so two episodes don't stretch edge to edge
  const SL = Math.max(n, slots || n);
  const x = (j) => P.l + (j / Math.max(1, SL - 1)) * (W - P.l - P.r);
  const L0 = Math.log2(0.125), L1 = Math.log2(5);
  const y = (h) => H - P.b - ((Math.log2(Math.max(0.125, Math.min(5, h))) - L0) / (L1 - L0)) * (H - P.t - P.b);
  const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", class: "chart", role: "img" });
  const title = mk("title", {}, svg);
  svg.insertAdjacentHTML("beforeend", `<defs><clipPath id="${id}"><rect x="0" y="0" width="${P.l}" height="${H}"/></clipPath></defs>`);
  const clipRect = svg.querySelector(`#${id} rect`);

  for (const g of [0.25, 0.5, 1, 2, 4]) {
    mk("line", { x1: P.l, x2: W - P.r, y1: y(g), y2: y(g), stroke: g === 1 ? o.even : o.grid, "stroke-width": g === 1 ? 1.5 : 1, "stroke-dasharray": g === 1 ? "" : "2 4" }, svg);
    const t = mk("text", { x: P.l - 8, y: y(g) + 4, "text-anchor": "end", fill: o.axis, "font-size": 11, "font-family": o.mono, "font-weight": g === 1 ? 600 : 400 }, svg);
    t.textContent = g === 1 ? "even" : `${g}x`;
  }
  const ticks = Array.from({ length: SL }, (_, j) => {
    const t = mk("text", { x: x(j), y: H - 10, "text-anchor": "middle", fill: o.axis, "font-size": 11, "font-family": o.mono, opacity: j < n ? 1 : 0.35 }, svg);
    t.textContent = j < n ? s.episodes[j] : s.episodes[n - 1] + (j - n + 1);
    return t;
  });
  const top = [], bot = [];
  for (let j = 0; j < n; j++) {
    const hs = alive(s, j).map((p) => heat(s, p, j)).sort((a, b) => a - b);
    const q = (f) => hs[Math.min(hs.length - 1, Math.floor(f * (hs.length - 1)))];
    top.push([x(j), y(q(0.9))]); bot.unshift([x(j), y(q(0.1))]);
  }
  mk("polygon", { points: [...top, ...bot].map((p) => p.join(",")).join(" "), fill: o.pack, "clip-path": `url(#${id})` }, svg);

  const spans = (p) => {
    const out = []; let cur = [];
    for (let j = 0; j < n; j++) {
      const h = heat(s, p, j);
      if (h == null) { if (cur.length) out.push(cur); cur = []; continue; }
      cur.push([x(j), y(h)]);
    }
    if (cur.length) out.push(cur);
    return out.map((c) => c.map((pt) => pt.join(",")).join(" "));
  };
  const lastAlive = (p) => { let k = -1; p.probs.forEach((v, j) => { if (v != null) k = j; }); return k; };
  const linesG = mk("g", {}, svg);
  const lines = s.players.map((p) => {
    const g = mk("g", { class: "who" }, linesG);
    const ghost = spans(p).map((pts) => mk("polyline", { points: pts, fill: "none", "stroke-width": 1.2, "stroke-linejoin": "round" }, g));
    const solid = spans(p).map((pts) => mk("polyline", { points: pts, fill: "none", "stroke-linejoin": "round", "stroke-linecap": "round", "clip-path": `url(#${id})` }, g));
    const la = lastAlive(p);
    const gone = p.boot && la < n - 1 ? mk("text", { x: x(la), y: y(heat(s, p, la)) + 4, "text-anchor": "middle", "font-size": 10, "font-family": o.mono }, g) : null;
    if (gone) gone.textContent = "✕";
    // a fat invisible twin is what the pointer actually hits
    const hit = spans(p).map((pts) => mk("polyline", { points: pts, fill: "none", stroke: "transparent", "stroke-width": 11, "pointer-events": "stroke", style: "cursor:pointer" }, g));
    return { p, g, ghost, solid, gone, hit, la };
  });
  const now = mk("line", { y1: P.t, y2: H - P.b, stroke: o.ink, "stroke-width": 1, opacity: 0.35, "pointer-events": "none" }, svg);
  const marks = lines.map((L) => ({
    L,
    // a hairline from the dot to its name, so a label parked at the right edge
    // mid-season still points at the line it belongs to
    lead: mk("polyline", { fill: "none", "stroke-width": 1, "stroke-dasharray": "1 3", opacity: 0, "pointer-events": "none" }, svg),
    dot: mk("circle", { r: 4.5, stroke: o.bg, "stroke-width": 2, opacity: 0, "pointer-events": "none" }, svg),
    label: mk("text", { "font-size": 12.5, "font-family": o.mono, "font-weight": 600, opacity: 0, "pointer-events": "none" }, svg),
  }));
  // the hover tag: a name on a little plate, placed at the nearest episode
  const tag = mk("g", { opacity: 0, "pointer-events": "none" }, svg);
  const tagBg = mk("rect", { rx: 3, fill: o.ink }, tag);
  const tagTx = mk("text", { "font-size": 11.5, "font-family": o.mono, fill: o.bg, "font-weight": 600 }, tag);
  host.appendChild(svg);

  let cur = null, stop = () => {}, i0 = 0, hover = null;
  const roleOf = (i) => {
    const lead = ranked(s, i)[0], win = s.players.find((p) => p.winner);
    return (p) => p === sel ? { color: o.pick, w: 3, op: 1, tag: "", z: 3 }
      : p === lead ? { color: o.ink, w: 1.8, op: 1, tag: " · leads", z: 2 }
      : p === win ? { color: o.won, w: 1.8, op: 1, tag: " · won", z: 2 }
      : { color: o.axis, w: 1.1, op: mode === "all" ? 0.42 : 0, tag: null, z: 0 };
  };
  function style(i) {
    const role = roleOf(i);
    for (const L of lines) {
      const r = role(L.p), hot = hover === L.p;
      const op = hot ? 1 : hover && r.z === 0 ? r.op * 0.5 : r.op;
      for (const el of L.ghost) { el.setAttribute("stroke", hot ? o.ink : r.color); el.setAttribute("opacity", op * 0.3); }
      for (const el of L.solid) { el.setAttribute("stroke", hot ? o.ink : r.color); el.setAttribute("stroke-width", hot ? Math.max(2.2, r.w) : r.w); el.setAttribute("opacity", op); }
      if (L.gone) { L.gone.setAttribute("fill", hot ? o.ink : r.color); L.gone.setAttribute("opacity", L.la <= i ? op : 0); }
      for (const el of L.hit) el.setAttribute("pointer-events", op > 0 ? "stroke" : "none");
    }
    // stacking: hidden lines at the bottom, then the cast, then the three
    // named lines, then whoever is under the pointer
    [...lines].sort((a, b) => (hover === a.p) - (hover === b.p) || role(a.p).z - role(b.p).z).forEach((L) => linesG.appendChild(L.g));
  }
  function target(i) {
    const role = roleOf(i), t = { clip: x(i) + 1, now: x(i) };
    const labels = [];
    marks.forEach((m, k) => {
      const h = heat(s, m.L.p, i), r = role(m.L.p);
      t[`dx${k}`] = x(i); t[`dy${k}`] = h == null ? (cur ? cur[`dy${k}`] : y(1)) : y(h);
      t[`do${k}`] = h == null || r.tag == null ? 0 : 1;
      if (h != null && r.tag != null) labels.push({ k, y: y(h) });
    });
    labels.sort((a, b) => a.y - b.y);
    for (let q = 1; q < labels.length; q++) if (labels[q].y - labels[q - 1].y < 15) labels[q].y = labels[q - 1].y + 15;
    const over = labels.length ? labels[labels.length - 1].y - (H - P.b) : 0;
    for (const lb of labels) t[`ly${lb.k}`] = lb.y - Math.max(0, over);
    marks.forEach((_, k) => { if (t[`ly${k}`] == null) t[`ly${k}`] = cur ? cur[`ly${k}`] : t[`dy${k}`]; });
    return t;
  }
  function apply(v) {
    clipRect.setAttribute("width", Math.max(P.l, v.clip));
    now.setAttribute("x1", v.now); now.setAttribute("x2", v.now);
    marks.forEach((m, k) => {
      m.dot.setAttribute("cx", v[`dx${k}`]); m.dot.setAttribute("cy", v[`dy${k}`]); m.dot.setAttribute("opacity", v[`do${k}`]);
      m.label.setAttribute("x", W - P.r + 6); m.label.setAttribute("y", v[`ly${k}`] + 4); m.label.setAttribute("opacity", v[`do${k}`]);
      const gap = W - P.r + 2 - v[`dx${k}`];
      m.lead.setAttribute("points", `${v[`dx${k}`] + 6},${v[`dy${k}`]} ${W - P.r + 2},${v[`ly${k}`]}`);
      m.lead.setAttribute("opacity", gap > 14 ? v[`do${k}`] * 0.7 : 0);
    });
  }
  function showTag(L, evt) {
    const box = svg.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * W;
    let j = Math.round(((px - P.l) / (W - P.l - P.r)) * (n - 1));
    j = Math.max(0, Math.min(n - 1, j));
    // snap to the nearest episode they were actually alive for
    let best = null;
    for (let d = 0; d < n && best == null; d++) for (const c of [j - d, j + d]) if (c >= 0 && c < n && L.p.probs[c] != null) { best = c; break; }
    if (best == null) return;
    const h = heat(s, L.p, best);
    tagTx.textContent = `${L.p.name} · ep ${s.episodes[best]} · ${h.toFixed(1)}x`;
    const tw = tagTx.getComputedTextLength() + 12;
    let tx = x(best) - tw / 2; tx = Math.max(2, Math.min(W - tw - 2, tx));
    let ty = y(h) - 26; if (ty < 2) ty = y(h) + 10;
    tagBg.setAttribute("x", tx); tagBg.setAttribute("y", ty); tagBg.setAttribute("width", tw); tagBg.setAttribute("height", 19);
    tagTx.setAttribute("x", tx + 6); tagTx.setAttribute("y", ty + 13.5);
    tag.setAttribute("opacity", 1);
  }
  for (const L of lines) {
    for (const el of L.hit) {
      el.addEventListener("pointerenter", (e) => { hover = L.p; style(i0); showTag(L, e); });
      el.addEventListener("pointermove", (e) => showTag(L, e));
      el.addEventListener("pointerleave", () => { hover = null; tag.setAttribute("opacity", 0); style(i0); });
      el.addEventListener("click", () => onPick(L.p));
    }
  }
  return {
    set(i, animate = true) {
      i0 = i;
      const role = roleOf(i);
      ticks.forEach((t, j) => { t.setAttribute("fill", j === i ? o.ink : o.axis); t.setAttribute("font-weight", j === i ? 700 : 400); });
      style(i);
      for (const m of marks) {
        const r = role(m.L.p);
        m.dot.setAttribute("fill", r.color); m.label.setAttribute("fill", r.color); m.lead.setAttribute("stroke", r.color);
        const h = heat(s, m.L.p, i);
        if (h != null && r.tag != null) m.label.textContent = `${m.L.p.name} ${h.toFixed(1)}x${r.tag}`;
      }
      const lead = ranked(s, i)[0];
      title.textContent = `${sel.name} at episode ${s.episodes[i]}: ${heat(s, sel, i) == null ? "out" : `${heat(s, sel, i).toFixed(1)} times an even split`}. ${lead.name} leads.`;
      const to = target(i);
      stop();
      if (!animate || !cur) { cur = to; apply(to); return; }
      const from = cur;
      stop = tweenFn(from, to, (v) => { cur = v; apply(v); }, 620);
    },
    setMode(m) { mode = m; style(i0); },
  };
}
