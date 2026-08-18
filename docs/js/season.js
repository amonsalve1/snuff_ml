// season explorer: trajectory chart, episode scrubber, leaderboard, why panel

import { loadIndex, loadSeason, navigate, scene } from "./app.js?v=19";
import { lineChart } from "./charts.js?v=19";
import { applyDaypart, daypartForEpisode } from "./daypart.js?v=19";

const badgeClass = (o) => (o === "called" ? "called" : o === "top3" ? "top3" : "missed");
const badgeText = (o) =>
  o === "called" ? "called it" : o === "top3" ? "top 3" : o === "edge return" ? "edge case" : "blindsided";
const seasonLabel = (s) =>
  s.name && !/^\d+$/.test(s.name) ? `s${s.season} - ${s.name}` : `season ${s.season}`;

export async function renderSeason(el, seasonNum, episode, playerId) {
  const [index, data] = await Promise.all([loadIndex(), loadSeason(seasonNum)]);
  const eps = data.episodes;
  const ep = Math.max(eps[0], Math.min(episode || eps[eps.length - 1], eps[eps.length - 1]));
  const epIdx = eps.indexOf(ep);
  const meta = index.seasons.find((s) => s.season === data.season);

  el.innerHTML = `
    <div class="controls">
      <select id="season-pick"></select>
      <span class="badge ${badgeClass(data.outcome)}">${badgeText(data.outcome)}</span>
      <span class="note">sole survivor: ${meta.winner}</span>
      <span class="spacer"></span>
      <label class="note"><span id="ep-note">episode</span> <b id="ep-num">${ep}</b> / ${eps[eps.length - 1]}</label>
    </div>
    <input id="scrub" type="range" min="0" max="${eps.length - 1}" step="1" value="${epIdx}" style="width:100%">
    <div class="layout">
      <div>
        <div id="chart"></div>
        <p class="note">drag the slider to replay the season. click a line or a name for the why panel.</p>
        <div class="duel" id="duel" hidden></div>
      </div>
      <div>
        <div class="why" id="why" hidden></div>
        <div class="board" id="board"></div>
      </div>
    </div>`;

  const pick = el.querySelector("#season-pick");
  for (const s of index.seasons) {
    const o = document.createElement("option");
    o.value = s.season;
    o.textContent = seasonLabel(s);
    if (s.season === data.season) o.selected = true;
    pick.appendChild(o);
  }
  pick.addEventListener("change", () => navigate(`#/season/${pick.value}`));

  const series = data.players.map((p) => ({
    name: p.name,
    values: p.probs,
    color: p.winner ? "var(--flame)" : "var(--gray)",
    width: p.winner ? 2.6 : 1.4,
    dim: !p.winner,
  }));

  const state = { ep: epIdx, player: playerId, rival: null };

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
    if (p) {
      state.player = p.id;
      if (state.rival === p.id) state.rival = null;
      drawBoard(); drawWhy();
    }
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
      row.addEventListener("click", () => {
        state.player = p.id;
        if (state.rival === p.id) state.rival = null;
        drawBoard(); drawWhy();
      });
      board.appendChild(row);
    }
    for (const p of out) {
      const row = document.createElement("div");
      row.className = "row out";
      row.innerHTML = `<span class="name">${p.name}</span><span></span><span class="pct">snuffed ep ${p.boot}</span>`;
      board.appendChild(row);
    }
  };

  // torch heat: win odds as a multiple of a typical player still in it. an
  // even split is 1.0x, so it reads the same at 18 players left or 3
  const aliveCount = (i) => data.players.filter((p) => p.probs[i] != null).length;
  const torchHeat = (p, i) => (p.probs[i] == null ? null : p.probs[i] * aliveCount(i));

  const whyCard = (p, sharedMax) => {
    const rows = p.why[state.ep] || [];
    const maxAbs = sharedMax || Math.max(...rows.map(([, v]) => Math.abs(v)), 0.001);
    const heat = torchHeat(p, state.ep);
    const heatHtml = heat == null ? "" :
      `<div class="heat"><span>torch heat</span><b class="${heat >= 1 ? "pos" : "neg"}">${heat.toFixed(1)}x</b></div>`;
    return `<h3>${p.name}, ep ${eps[state.ep]}</h3>` + heatHtml + rows.map(([key, v]) => {
      const label = (index.labels[key] || [key, key])[v > 0 ? 0 : 1];
      const cls = v > 0 ? "up" : "down";
      return `<div class="wrow"><span>${label}</span>
        <span><span class="wbar ${cls}" style="width:${(Math.abs(v) / maxAbs) * 100}%"></span></span></div>`;
    }).join("");
  };

  const rivalPicker = (p) => {
    const others = data.players.filter((o) => o.id !== p.id && o.probs[state.ep] != null);
    if (!others.length) return "";
    return `<label class="hint">head to head: <select class="vs-pick">
        <option value="">pick a rival</option>
        ${others.map((o) => `<option value="${o.id}"${o.id === state.rival ? " selected" : ""}>${o.name}</option>`).join("")}
      </select></label>`;
  };

  const wirePickers = () => {
    for (const vs of el.querySelectorAll(".vs-pick")) {
      vs.addEventListener("change", () => { state.rival = vs.value || null; drawWhy(); });
    }
  };

  const drawWhy = () => {
    const box = el.querySelector("#why");
    const duel = el.querySelector("#duel");
    const p = data.players.find((pl) => pl.id === state.player);
    const r = data.players.find((pl) => pl.id === state.rival);
    if (!p || !p.why[state.ep]) { box.hidden = true; duel.hidden = true; return; }

    // with a rival picked the duel carries both cards, so the solo panel steps aside
    if (r && r.why[state.ep]) {
      box.hidden = true;
      const sharedMax = Math.max(
        ...[...p.why[state.ep], ...r.why[state.ep]].map(([, v]) => Math.abs(v)), 0.001);
      const hp = torchHeat(p, state.ep);
      const hr = torchHeat(r, state.ep);
      let verdict = "";
      if (hp != null && hr != null) {
        const [hi, lo] = hp >= hr ? [p, r] : [r, p];
        const ratio = Math.max(hp, hr) / Math.max(Math.min(hp, hr), 1e-6);
        verdict = ratio < 1.05
          ? `<p class="note">dead even, the model can't split them</p>`
          : `<p class="note">the edit gives ${hi.name} ${ratio.toFixed(1)}x ${lo.name}'s odds</p>`;
      }
      duel.hidden = false;
      duel.innerHTML = verdict
        + `<div class="why">${whyCard(p, sharedMax)}</div>`
        + `<div class="why">${whyCard(r, sharedMax)}</div>`
        + `<div class="duel-foot">${rivalPicker(p)}</div>`;
      wirePickers();
      return;
    }

    duel.hidden = true;
    box.hidden = false;
    box.innerHTML = whyCard(p)
      + `<p class="hint">what the edit says, vs a typical player still in it</p>`
      + rivalPicker(p);
    wirePickers();
  };

  const epNote = () => {
    el.querySelector("#ep-note").textContent =
      state.ep === eps.length - 1 ? "final tribal, episode" : "episode";
  };
  // the light follows the season: flat midday at the premiere, golden around
  // the merge, dark by final tribal
  const lightFor = () => applyDaypart(daypartForEpisode(state.ep, eps.length));

  // the beach gets the cast: a torch each, lit while they are still in it, and
  // the flame sized by win probability. scrubbing walks the camera down it.
  const lightScene = () => {
    if (!scene) return;
    scene.setProgress(eps.length > 1 ? state.ep / (eps.length - 1) : 0);
    scene.setTorches(data.players.map((p) => ({
      name: p.name,
      prob: p.probs[state.ep] ?? 0,
      out: p.probs[state.ep] == null,
    })));
  };

  el.querySelector("#scrub").addEventListener("input", (evt) => {
    state.ep = parseInt(evt.target.value, 10);
    el.querySelector("#ep-num").textContent = eps[state.ep];
    epNote();
    lightFor();
    lightScene();
    draw();
  });
  epNote();
  lightFor();
  lightScene();

  draw();
}
