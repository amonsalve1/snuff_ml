// boot, hash routing and a small fetch cache shared by the views

import { renderSeason } from "./season.js?v=30";
import { renderCompare } from "./compare.js?v=30";
import { renderInsights } from "./insights.js?v=30";
import { applyDaypart, COMPARE_DAYPART, INSIGHTS_DAYPART, onDaypartChange, currentDaypart } from "./daypart.js?v=30";
import { createScene } from "./scene.js?v=30";

// the island behind the page. it follows the daypart on its own, and the season
// view hands it the cast so the torches mean something.
export let scene = null;
try {
  const canvas = document.getElementById("scene");
  if (canvas) {
    scene = createScene(canvas);
    scene.setDaypart(currentDaypart());
    onDaypartChange((p) => scene.setDaypart(p));
    scene.start();
  }
} catch (err) {
  // a backdrop is never worth breaking the site over
  console.warn("scene off:", err.message);
}

const cache = new Map();

export async function getJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path);
}

export const loadIndex = () => getJSON("data/index.json");
export const loadSeason = (n) => getJSON(`data/seasons/s${String(n).padStart(2, "0")}.json`);
export const loadInsights = () => getJSON("data/insights.json");

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

async function render() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const view = parts[0] || "season";
  for (const s of document.querySelectorAll("main > section")) s.hidden = true;
  for (const a of document.querySelectorAll("nav a")) {
    a.classList.toggle("active", a.dataset.view === view);
  }
  const el = document.getElementById(`view-${view}`) || document.getElementById("view-season");
  el.hidden = false;
  try {
    // the two views with no single episode to sit at get a fixed light
    // the beach belongs to the season view; the other two get an empty one
    if (view !== "season" && scene) { scene.setTorches([]); scene.setProgress(0); }
    if (view === "compare") { applyDaypart(COMPARE_DAYPART); await renderCompare(el); }
    else if (view === "insights") { applyDaypart(INSIGHTS_DAYPART); await renderInsights(el); }
    else {
      const season = parseInt(parts[1], 10) || 50;
      const episode = parseInt(parts[2], 10) || null;
      const player = parts[3] || null;
      await renderSeason(el, season, episode, player);
    }
  } catch (err) {
    el.innerHTML = `<p class="note">something broke loading this view: ${err.message}</p>`;
  }
}

async function heroStats() {
  const el = document.getElementById("hero-stats");
  if (!el) return;
  const idx = await loadIndex();
  // a season still airing has no outcome yet, so it stays out of every hit rate
  // and gets a tile of its own instead
  const live = (x) => x.live === true || x.outcome === "airing";
  const s = idx.seasons.filter((x) => !live(x));
  const airing = idx.seasons.find(live) || null;
  const called = s.filter((x) => x.outcome === "called").length;
  const top3 = s.filter((x) => x.outcome === "called" || x.outcome === "top3").length;
  const newEra = s.filter((x) => x.era === "new");
  const newTop3 = newEra.filter((x) => x.outcome === "called" || x.outcome === "top3").length;
  const tile = (big, label) => `<div class="tile"><b>${big}</b><span>${label}</span></div>`;
  const liveTile = airing
    ? `<a class="tile live" href="#/season/${airing.season}"><b>s${airing.season}</b><span>airing now - episode ${airing.episodes}${airing.leader ? `, model likes ${airing.leader}` : ""}</span></a>`
    : "";
  el.classList.toggle("has-live", !!liveTile);
  el.innerHTML =
    liveTile +
    tile(s.length, "seasons replayed episode by episode") +
    tile(Math.round((called / s.length) * 100) + "%", "winners called at the finale") +
    tile(Math.round((top3 / s.length) * 100) + "%", "winners in the model's top three") +
    tile(`${newTop3} of ${newEra.length}`, "new era winners in the top three");
  el.hidden = false;
}

window.addEventListener("hashchange", render);
render();
heroStats();
