// season explorer: trajectory chart, episode scrubber, leaderboard, why panel

import { loadIndex, loadSeason, navigate } from "./app.js";
import { lineChart } from "./charts.js";

const badgeClass = (o) => (o === "called" ? "called" : o === "top3" ? "top3" : "missed");

export async function renderSeason(el, seasonNum, episode, playerId) {
  const [index, data] = await Promise.all([loadIndex(), loadSeason(seasonNum)]);
  const eps = data.episodes;
  const ep = Math.max(eps[0], Math.min(episode || eps[eps.length - 1], eps[eps.length - 1]));
  const epIdx = eps.indexOf(ep);
  const meta = index.seasons.find((s) => s.season === data.season);

  el.innerHTML = `
    <div class="controls">
      <select id="season-pick"></select>
      <span class="badge ${badgeClass(data.outcome)}">${data.outcome}</span>
      <span class="note">winner: ${meta.winner}</span>
      <span class="spacer"></span>
      <label class="note">episode <b id="ep-num">${ep}</b> / ${eps[eps.length - 1]}</label>
    </div>
    <input id="scrub" type="range" min="0" max="${eps.length - 1}" step="1" value="${epIdx}" style="width:100%">
    <div class="layout">
      <div>
        <div id="chart"></div>
        <p class="note">drag the slider to replay the season. click a line or a name for the why panel.</p>
      </div>
      <div>
        <div class="board" id="board"></div>
        <div class="why" id="why" hidden></div>
      </div>
    </div>`;

  const pick = el.querySelector("#season-pick");
  for (const s of index.seasons) {
    const o = document.createElement("option");
    o.value = s.season;
    o.textContent = `season ${s.season} (${s.era})`;
    if (s.season === data.season) o.selected = true;
    pick.appendChild(o);
  }
  pick.addEventListener("change", () => navigate(`#/season/${pick.value}`));

  const series = data.players.map((p) => ({
    name: p.name,
    values: p.probs,
    color: p.winner ? "#00b386" : "#4d4b42",
    width: p.winner ? 2.6 : 1.4,
    dim: !p.winner,
  }));

  const state = { ep: epIdx, player: playerId };

  const draw = () => {
    lineChart(el.querySelector("#chart"), {
      xs: eps.map((e) => `ep ${e}`),
      series,
      splitAt: state.ep,
      xLabel: "episode",
      onPick: (name) => selectByName(name),
    });
    drawBoard();
    drawWhy();
  };

  const selectByName = (name) => {
    const p = data.players.find((pl) => pl.name === name);
    if (p) { state.player = p.id; drawBoard(); drawWhy(); }
  };

  const drawBoard = () => {
    const board = el.querySelector("#board");
    const alive = data.players
      .filter((p) => p.probs[state.ep] != null)
      .sort((a, b) => b.probs[state.ep] - a.probs[state.ep]);
    const out = data.players
      .filter((p) => p.probs[state.ep] == null)
      .sort((a, b) => (b.boot || 99) - (a.boot || 99));
    const maxP = alive.length ? alive[0].probs[state.ep] : 1;
    board.innerHTML = "";
    for (const p of alive) {
      const row = document.createElement("div");
      row.className = `row${p.winner ? " winner" : ""}${p.id === state.player ? " selected" : ""}`;
      row.innerHTML = `<span class="name">${p.name}</span>
        <span><span class="bar" style="width:${(p.probs[state.ep] / maxP) * 100}%"></span></span>
        <span class="pct">${(p.probs[state.ep] * 100).toFixed(1)}%</span>`;
      row.addEventListener("click", () => { state.player = p.id; drawBoard(); drawWhy(); });
      board.appendChild(row);
    }
    for (const p of out) {
      const row = document.createElement("div");
      row.className = "row out";
      row.innerHTML = `<span class="name">${p.name}</span><span></span><span class="pct">out ep ${p.boot}</span>`;
      board.appendChild(row);
    }
  };

  const drawWhy = () => {
    const box = el.querySelector("#why");
    const p = data.players.find((pl) => pl.id === state.player);
    if (!p || !p.why[state.ep]) { box.hidden = true; return; }
    const rows = p.why[state.ep];
    const maxAbs = Math.max(...rows.map(([, v]) => Math.abs(v)), 0.001);
    box.hidden = false;
    box.innerHTML = `<h3>why ${p.name}, ep ${eps[state.ep]}</h3>` + rows.map(([key, v]) => {
      const label = (index.labels[key] || [key, key])[v > 0 ? 0 : 1];
      const cls = v > 0 ? "up" : "down";
      return `<div class="wrow"><span>${label}</span>
        <span><span class="wbar ${cls}" style="width:${(Math.abs(v) / maxAbs) * 100}%"></span></span></div>`;
    }).join("") + `<p class="hint">signed pushes on the model's score vs a typical alive player</p>`;
  };

  el.querySelector("#scrub").addEventListener("input", (evt) => {
    state.ep = parseInt(evt.target.value, 10);
    el.querySelector("#ep-num").textContent = eps[state.ep];
    draw();
  });

  draw();
}
