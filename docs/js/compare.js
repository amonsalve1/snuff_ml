// compare view: all 50 winner trajectories on one chart, or two seasons side
// by side

import { loadIndex, loadSeason } from "./app.js?v=19";
import { lineChart } from "./charts.js?v=19";

const ERA_COLORS = { old: "var(--gray)", middle: "var(--amber)", new: "var(--flame)" };

export async function renderCompare(el) {
  const index = await loadIndex();

  el.innerHTML = `
    <div class="controls">
      <label><input type="radio" name="cmode" value="winners" checked> all winners</label>
      <label><input type="radio" name="cmode" value="two"> two seasons</label>
    </div>
    <div id="cmp-body"></div>`;

  const body = el.querySelector("#cmp-body");

  const drawWinners = () => {
    body.innerHTML = `
      <h2>every winner's road, all 50 seasons</h2>
      <p class="note">x is season progress so 13 and 16 episode seasons line up.
      the new era flattens: winners stay hidden longer.</p>
      <div class="legend">
        <label><input type="checkbox" data-era="old" checked><span class="sw" style="background:#a89f88"></span>old (s1-20)</label>
        <label><input type="checkbox" data-era="middle" checked><span class="sw" style="background:#b8860b"></span>middle (s21-40)</label>
        <label><input type="checkbox" data-era="new" checked><span class="sw" style="background:#c14e00"></span>new (s41+)</label>
      </div>
      <div id="winners-chart"></div>`;

    const draw = () => {
      const active = new Set(
        [...body.querySelectorAll("input[data-era]:checked")].map((c) => c.dataset.era)
      );
      const N = 21;
      const xs = Array.from({ length: N }, (_, i) => `${Math.round((i / (N - 1)) * 100)}%`);
      const series = index.seasons
        .filter((s) => active.has(s.era))
        .map((s) => {
          // resample to a common progress axis
          const vals = [];
          for (let i = 0; i < N; i++) {
            const idx = Math.round((i / (N - 1)) * (s.winner_probs.length - 1));
            vals.push(s.winner_probs[idx]);
          }
          return {
            name: `s${s.season} ${s.winner}`,
            values: vals,
            color: ERA_COLORS[s.era],
            width: 1.6,
            dim: true,
          };
        });
      lineChart(body.querySelector("#winners-chart"), { xs, series, xLabel: "season progress" });
    };
    for (const c of body.querySelectorAll("input[data-era]")) c.addEventListener("change", draw);
    draw();
  };

  const drawTwo = async () => {
    body.innerHTML = `
      <div class="controls">
        <select id="cmp-a"></select>
        <span class="note">vs</span>
        <select id="cmp-b"></select>
      </div>
      <div class="layout" id="cmp-charts"></div>`;
    const selA = body.querySelector("#cmp-a");
    const selB = body.querySelector("#cmp-b");
    for (const sel of [selA, selB]) {
      for (const s of index.seasons) {
        const o = document.createElement("option");
        o.value = s.season;
        o.textContent = `s${s.season} - ${s.winner} (${s.outcome === "missed" ? "blindsided" : s.outcome})`;
        sel.appendChild(o);
      }
    }
    selA.value = 40;
    selB.value = 41;
    const draw = async () => {
      const wrap = body.querySelector("#cmp-charts");
      wrap.innerHTML = `<div><h3 id="cmp-ta"></h3><div id="cmp-ca"></div></div>
        <div><h3 id="cmp-tb"></h3><div id="cmp-cb"></div></div>`;
      for (const [sel, t, c] of [[selA, "#cmp-ta", "#cmp-ca"], [selB, "#cmp-tb", "#cmp-cb"]]) {
        const data = await loadSeason(sel.value);
        body.querySelector(t).textContent = `season ${data.season} (${data.outcome})`;
        lineChart(body.querySelector(c), {
          xs: data.episodes.map((e) => `ep ${e}`),
          series: data.players.map((p) => ({
            name: p.name,
            values: p.probs,
            color: p.winner ? "var(--flame)" : "var(--gray)",
            width: p.winner ? 2.4 : 1.3,
            dim: !p.winner,
          })),
          yMax: 0.65,
        });
      }
    };
    selA.addEventListener("change", draw);
    selB.addEventListener("change", draw);
    await draw();
  };

  const route = () => {
    const mode = el.querySelector("input[name=cmode]:checked").value;
    if (mode === "winners") drawWinners();
    else drawTwo();
  };
  for (const r of el.querySelectorAll("input[name=cmode]")) r.addEventListener("change", route);
  route();
}
