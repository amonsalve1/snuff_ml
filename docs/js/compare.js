// compare view: every winner trajectory on one chart, or two seasons side
// by side

import { loadIndex, loadSeason } from "./app.js?v=29";
import { lineChart } from "./charts.js?v=29";

const ERA_COLORS = { old: "var(--gray)", middle: "var(--amber)", new: "var(--flame)" };

// a season still on the air has winner null, so nothing here may print s.winner
// for it. the line it draws is its current front runner, which is what
// index.json parks in winner_probs.
const isLive = (s) => !!(s && (s.live === true || s.outcome === "airing"));
const seasonPick = (s) => (isLive(s) ? s.leader || "?" : s.winner);

export async function renderCompare(el) {
  const index = await loadIndex();
  const finished = index.seasons.filter((s) => !isLive(s));
  const anyLive = index.seasons.some(isLive);

  el.innerHTML = `
    <div class="controls">
      <label><input type="radio" name="cmode" value="winners" checked> all winners</label>
      <label><input type="radio" name="cmode" value="two"> two seasons</label>
    </div>
    <div id="cmp-body"></div>`;

  const body = el.querySelector("#cmp-body");

  const drawWinners = () => {
    body.innerHTML = `
      <h2>every winner's road, all ${finished.length} seasons</h2>
      <p class="note">x is season progress so 13 and 16 episode seasons line up.
      the new era flattens: winners stay hidden longer.${anyLive
        ? " the season still airing rides along as its current front runner, not a winner."
        : ""}</p>
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
          // resample to a common progress axis. a live season only covers the
          // fraction it has aired: stretching one episode across the whole
          // width would draw a flat line pretending the season is over.
          const aired = s.winner_probs.length;
          const full = isLive(s) ? Math.max(aired, s.expected_episodes || aired) : aired;
          const reach = Math.max(1, Math.round((aired / full) * (N - 1)));
          const vals = [];
          for (let i = 0; i < N; i++) {
            if (i > reach) { vals.push(null); continue; }
            const idx = aired < 2 ? 0 : Math.round((i / reach) * (aired - 1));
            vals.push(s.winner_probs[Math.min(idx, aired - 1)]);
          }
          return {
            name: isLive(s) ? `s${s.season} ${seasonPick(s)} so far` : `s${s.season} ${s.winner}`,
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
        o.textContent = isLive(s)
          ? `s${s.season} - airing now`
          : `s${s.season} - ${s.winner} (${s.outcome === "missed" ? "blindsided" : s.outcome})`;
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
