// boot, hash routing and a small fetch cache shared by the views

import { renderSeason } from "./season.js";
import { renderCompare } from "./compare.js";
import { renderInsights } from "./insights.js";

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
    if (view === "compare") await renderCompare(el);
    else if (view === "insights") await renderInsights(el);
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
  const s = idx.seasons;
  const called = s.filter((x) => x.outcome === "called").length;
  const top3 = s.filter((x) => x.outcome === "called" || x.outcome === "top3").length;
  const newEra = s.filter((x) => x.era === "new");
  const newTop3 = newEra.filter((x) => x.outcome === "called" || x.outcome === "top3").length;
  const tile = (big, label) => `<div class="tile"><b>${big}</b><span>${label}</span></div>`;
  el.innerHTML =
    tile(s.length, "seasons replayed episode by episode") +
    tile(Math.round((called / s.length) * 100) + "%", "winners called at the finale") +
    tile(Math.round((top3 / s.length) * 100) + "%", "winners in the model's top three") +
    tile(`${newTop3} of ${newEra.length}`, "new era winners in the top three");
  el.hidden = false;
}

window.addEventListener("hashchange", render);
render();
heroStats();
