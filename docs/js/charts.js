// hand-rolled svg line chart with a crosshair and tooltip. series format:
// {name, values (null = gone), color, width, dim} on a shared x array.

const NS = "http://www.w3.org/2000/svg";
const W = 720;
const H = 400;
const PAD = { l: 44, r: 14, t: 14, b: 26 };

function el(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function lineChart(container, { xs, series, yMax = null, xLabel = null, onPick = null, splitAt = null }) {
  container.innerHTML = "";
  container.classList.add("chart-wrap");
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });

  const maxVal = yMax || Math.max(0.5, ...series.flatMap((s) => s.values.filter((v) => v != null))) * 1.08;
  const x = (i) => PAD.l + (i / Math.max(1, xs.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - (v / maxVal) * (H - PAD.t - PAD.b);

  // grid + y labels
  for (const v of [0, 0.25, 0.5].filter((v) => v < maxVal)) {
    svg.appendChild(el("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), stroke: "#e6dfc9", "stroke-width": 1 }));
    const t = el("text", { x: PAD.l - 6, y: y(v) + 4, "text-anchor": "end", fill: "#98937f", "font-size": 11 });
    t.textContent = v === 0 ? "0" : `${v * 100}%`;
    svg.appendChild(t);
  }
  if (xLabel) {
    const t = el("text", { x: W - PAD.r, y: H - 6, "text-anchor": "end", fill: "#98937f", "font-size": 11 });
    t.textContent = xLabel;
    svg.appendChild(t);
  }

  const drawSeg = (s, from, to, opacity) => {
    const pts = [];
    for (let i = from; i <= to; i++) {
      if (s.values[i] != null) pts.push(`${x(i)},${y(s.values[i])}`);
    }
    if (pts.length < 2) return null;
    return el("polyline", {
      points: pts.join(" "),
      fill: "none",
      stroke: s.color,
      "stroke-width": s.width || 1.5,
      "stroke-linecap": "round",
      opacity,
      "data-name": s.name,
    });
  };

  const lines = [];
  for (const s of series) {
    const cut = splitAt == null ? xs.length - 1 : Math.min(splitAt, xs.length - 1);
    const solid = drawSeg(s, 0, cut, s.dim ? 0.55 : 1);
    if (solid) { svg.appendChild(solid); lines.push([s, solid]); }
    if (cut < xs.length - 1) {
      const rest = drawSeg(s, cut, xs.length - 1, 0.18);
      if (rest) svg.appendChild(rest);
    }
    // marker at the last point they were alive
    let lastIdx = -1;
    for (let i = 0; i < s.values.length; i++) if (s.values[i] != null) lastIdx = i;
    if (lastIdx >= 0 && lastIdx < xs.length - 1) {
      const m = el("text", { x: x(lastIdx), y: y(s.values[lastIdx]) + 4, "text-anchor": "middle", fill: s.color, "font-size": 10, opacity: 0.8 });
      m.textContent = "x";
      svg.appendChild(m);
    }
  }

  const cross = el("line", { y1: PAD.t, y2: H - PAD.b, stroke: "#6b675c", "stroke-width": 1, opacity: 0 });
  svg.appendChild(cross);

  const hit = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" });
  svg.appendChild(hit);

  const tooltip = document.getElementById("tooltip");
  const toIdx = (evt) => {
    const box = svg.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * W;
    const frac = (px - PAD.l) / (W - PAD.l - PAD.r);
    return Math.max(0, Math.min(xs.length - 1, Math.round(frac * (xs.length - 1))));
  };

  hit.addEventListener("pointermove", (evt) => {
    const i = toIdx(evt);
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("opacity", 0.5);
    // nearest series at this x
    const box = svg.getBoundingClientRect();
    const py = ((evt.clientY - box.top) / box.height) * H;
    let best = null;
    let bestDist = 40;
    for (const s of series) {
      if (s.values[i] == null) continue;
      const d = Math.abs(y(s.values[i]) - py);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    for (const [s, node] of lines) {
      node.setAttribute("stroke", best && s.name === best.name ? "#b8860b" : s.color);
    }
    if (best) {
      tooltip.hidden = false;
      tooltip.textContent = `${best.name} - ${xs[i]}: ${(best.values[i] * 100).toFixed(1)}%`;
      tooltip.style.left = `${evt.clientX + 14}px`;
      tooltip.style.top = `${evt.clientY - 10}px`;
    } else tooltip.hidden = true;
  });
  hit.addEventListener("pointerleave", () => {
    cross.setAttribute("opacity", 0);
    tooltip.hidden = true;
    for (const [s, node] of lines) node.setAttribute("stroke", s.color);
  });
  if (onPick) {
    hit.addEventListener("click", (evt) => {
      const i = toIdx(evt);
      const box = svg.getBoundingClientRect();
      const py = ((evt.clientY - box.top) / box.height) * H;
      let best = null;
      let bestDist = 40;
      for (const s of series) {
        if (s.values[i] == null) continue;
        const d = Math.abs(y(s.values[i]) - py);
        if (d < bestDist) { bestDist = d; best = s; }
      }
      if (best) onPick(best.name, i);
    });
  }

  container.appendChild(svg);
  return svg;
}
