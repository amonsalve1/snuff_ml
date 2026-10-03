// small motion helpers for the season view. everything here no-ops to the end
// state under prefers-reduced-motion.

export const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const EASE = "cubic-bezier(.22,1,.36,1)";

// the headline leaves upward, then the new one arrives a word at a time.
// highlighted spans keep their colour because only text nodes get split.
const rolling = new WeakMap();
export function rollText(el, html, { stagger = 26, delay = 0 } = {}) {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  const token = {};
  rolling.set(el, token);
  // a hidden tab doesn't advance animations, so never wait on one for content
  if (reduce() || document.hidden || !el.childNodes.length) { el.innerHTML = html; return; }
  const out = el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-0.18em)" }],
    { duration: 170, easing: "ease-in", fill: "forwards" });
  setTimeout(() => {
    if (rolling.get(el) !== token) return;
    el.innerHTML = html;
    out.cancel();
    let k = 0;
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          for (const part of child.textContent.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) { frag.append(part); continue; }
            const w = document.createElement("span");
            w.className = "w";
            w.textContent = part;
            w.animate([{ opacity: 0, transform: "translateY(0.32em)", filter: "blur(5px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
              { duration: 520, delay: delay + Math.min(k++ * stagger, 420), easing: EASE, fill: "backwards" });
            frag.append(w);
          }
          child.replaceWith(frag);
        } else walk(child);
      }
    };
    walk(el);
  }, 170);
}

export function fadeSwap(el, html, { delay = 0 } = {}) {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
  if (reduce()) return;
  el.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay, easing: EASE, fill: "backwards" });
}

// count a number from where it was to where it's going. fmt renders it
const counting = new WeakMap();
export function countTo(el, to, fmt, { dur = 650, from } = {}) {
  const start = from ?? (el.dataset.v ? +el.dataset.v : to);
  el.dataset.v = to;
  if (reduce() || document.hidden || start === to) { counting.set(el, {}); el.textContent = fmt(to); return; }
  const t0 = performance.now(), token = {};
  counting.set(el, token);
  el.textContent = fmt(start);
  const step = (now) => {
    if (counting.get(el) !== token) return;
    const t = Math.min(1, (now - t0) / dur);
    el.textContent = fmt(start + (to - start) * ease(t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// tween a bag of numbers with one clock; cb gets the interpolated bag
export function tween(from, to, cb, dur = 560) {
  if (reduce() || document.hidden) { cb(to, 1); return () => {}; }
  const t0 = performance.now();
  let raf = 0, live = true;
  const step = (now) => {
    if (!live) return;
    const t = Math.min(1, (now - t0) / dur), e = ease(t);
    const cur = {};
    for (const k of Object.keys(to)) cur[k] = from[k] == null ? to[k] : from[k] + (to[k] - from[k]) * e;
    cb(cur, t);
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => { live = false; cancelAnimationFrame(raf); };
}
