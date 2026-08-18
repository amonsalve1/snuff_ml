// insights view: the findings as tables, rows deep-link into seasons

import { loadIndex, loadInsights, navigate } from "./app.js?v=24";

const pct = (v) => `${(v * 100).toFixed(1)}%`;

export async function renderInsights(el) {
  const [index, ins] = await Promise.all([loadIndex(), loadInsights()]);
  const winnerOf = (n) => index.seasons.find((s) => s.season === n).winner;

  const flagRows = ins.early_flag_curse.map((r) => `
    <tr class="link" data-season="${r.season}">
      <td>s${r.season}</td><td>${r.holder}</td>
      <td>${r.won ? "won" : `out ep ${r.out}`}</td>
      <td>${winnerOf(r.season)}</td>
    </tr>`).join("");

  const eraRows = ["old", "middle", "new"].map((era) => {
    const d = ins.era_difficulty[era] || {};
    return `<tr><td>${era}</td><td class="num">${d.called || 0}</td>
      <td class="num">${d.top3 || 0}</td>
      <td class="num">${(d.missed || 0) + (d["edge return"] || 0)}</td></tr>`;
  }).join("");

  const immRows = ["old", "middle", "new"].map((era) => {
    const d = ins.immunity[era];
    return `<tr><td>${era}</td>
      <td class="num">${d.winner_late} vs ${d.other_late}</td>
      <td class="num">${d.winner_early} vs ${d.other_early}</td></tr>`;
  }).join("");

  const decoyRows = ins.decoys.map((r) => `
    <tr class="link" data-season="${r.season}">
      <td>s${r.season}</td><td>${r.name}</td>
      <td class="num">${pct(r.peak)}</td><td class="num">${pct(r.final)}</td>
      <td>${winnerOf(r.season)}</td>
    </tr>`).join("");

  const underRows = ins.underdogs.map((r) => `
    <tr class="link" data-season="${r.season}">
      <td>s${r.season}</td><td>${r.name}</td><td class="num">${pct(r.peak)}</td>
    </tr>`).join("");

  const zc = ins.zero_conf_winners;

  el.innerHTML = `
    <h2>the episode-4 death flag</h2>
    <p class="note">whoever leads cumulative confessional share through episode 4
    of a new era season has never won. the editors crown an early frontrunner
    to dethrone them around the merge.</p>
    <table><tr><th>season</th><th>flag holder</th><th>fate</th><th>actual winner</th></tr>${flagRows}</table>

    <h2>the zero-confessional rule</h2>
    <p class="note">share of winners who ever had an episode with zero
    confessionals: old era ${pct(zc.old)}, middle ${pct(zc.middle)}, new era
    ${pct(zc.new)}. in the new era a silent episode is close to fatal.</p>

    <h2>immunity timing</h2>
    <p class="note">mean immunity wins at the finale, winners vs everyone else.
    late-merge wins point at the winner in every era. early-merge wins were a
    threat signal in the old era.</p>
    <table><tr><th>era</th><th>late merge (w vs others)</th><th>early merge (w vs others)</th></tr>${immRows}</table>

    <h2>era scoreboard</h2>
    <p class="note">how the model's finale pick went, out-of-sample.</p>
    <table><tr><th>era</th><th>called</th><th>top 3</th><th>missed</th></tr>${eraRows}</table>

    <h2>the biggest decoys</h2>
    <p class="note">highest peak win probability without winning. the edit
    built them up; the season went elsewhere.</p>
    <table><tr><th>season</th><th>player</th><th>peak</th><th>at finale</th><th>actual winner</th></tr>${decoyRows}</table>

    <h2>the most hidden winners</h2>
    <p class="note">winners by lowest peak probability - the edits that kept
    the secret best.</p>
    <table><tr><th>season</th><th>winner</th><th>peak prob</th></tr>${underRows}</table>`;

  for (const row of el.querySelectorAll("tr.link")) {
    row.addEventListener("click", () => navigate(`#/season/${row.dataset.season}`));
  }
}
