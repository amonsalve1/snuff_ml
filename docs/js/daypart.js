// six light states, walked by episode position instead of the wall clock.
// a season opens in flat midday light and ends at final tribal in the dark, so
// the whole page dims as the cast gets voted out. the palette lives in css and
// hangs off [data-daypart] on <html>; this module only decides which name to
// write there. keep the mapping in sync with the boot script in index.html.

export const DAYPARTS = ["dawn", "morning", "midday", "golden", "dusk", "night"];

// fixed states for the views that have no single episode to sit at
export const COMPARE_DAYPART = "golden";
export const INSIGHTS_DAYPART = "morning";

// season progress, 0 at the premiere and 1 at final tribal. episode 1 is
// midday, the merge lands in golden, the last couple of episodes go dark.
export function daypartForProgress(p) {
  if (p < 0.4) return "midday";
  if (p < 0.7) return "golden";
  if (p < 0.9) return "dusk";
  return "night";
}

export function daypartForEpisode(index, total) {
  if (!total || total < 2) return "midday";
  const p = Math.max(0, Math.min(1, index / (total - 1)));
  return daypartForProgress(p);
}

// dusk and night flip the whole page to the dark palette
export function themeFor(part) {
  return part === "dusk" || part === "night" ? "night" : "day";
}

export function applyDaypart(part) {
  const root = document.documentElement;
  if (root.dataset.daypart === part) return false;
  root.dataset.daypart = part;
  root.dataset.theme = themeFor(part);
  return true;
}

export function currentDaypart() {
  return document.documentElement.dataset.daypart || "midday";
}

// anything that draws with resolved colours instead of var() can subscribe.
// one observer for the page no matter how many callers, and it only fires when
// the attribute actually changes, which is a few times per scrub.
const listeners = new Set();
let observer;

export function onDaypartChange(fn) {
  listeners.add(fn);
  if (!observer) {
    observer = new MutationObserver(() => {
      for (const l of listeners) l(currentDaypart());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-daypart"],
    });
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size) { observer.disconnect(); observer = undefined; }
  };
}
