// the header shared by the non-season pages: the shore at a fixed time of day,
// nav over it, copy in the sky with the ink chosen from the sky it sits on
import { createStage } from "./stage.js?v=31";

export function band(el, p) {
  const stage = createStage(el, {
    onLight: (l) => { el.classList.toggle("day", l.day); el.classList.toggle("assist", l.contrast < 4.5); },
  });
  stage.setItems([]);
  stage.setLight(p, false);
  return stage;
}

export const nav = (active) => `<div class="top"><b><img src="logo.svg" alt="">snuffml</b><nav>${
  [["Seasons", "index.html"], ["Findings", "findings.html"], ["Players", "players.html"], ["Method", "method.html"]]
    .map(([t, h]) => `<a href="${h}"${t === active ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav></div>`;
