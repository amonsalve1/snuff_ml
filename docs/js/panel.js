import { countTo, reduce } from "./motion.js?v=32";

// the lower half of the season view: a stat strip, the model's track record
// at this level, and a waterfall from a typical player's odds to this one's.
// the factors are field-relative and calibrator-scaled, so they multiply out
// to the number at the top instead of decorating it.

export const GROUPS = {
  airtime: ["conf_ep", "conf_time_ep", "conf_cum", "conf_share_ep", "conf_share_cum", "conf_z_cum", "conf_trend",
    "premiere_share", "new_era_x_share_cum", "female_x_share_cum", "zero_any", "zero_any_x_new", "inv_count", "late_clustering"],
  "edit tone": ["cp_share", "cpx_count", "ott_count", "utr_share", "tone_flips", "tone_consistency", "visibility_mean",
    "visibility_z", "index_resid_cum", "orig_tribe_over"],
  game: ["votes_against_cum", "vote_acc_cum", "vfb_cum", "imm_early_cum", "imm_late_cum", "imm_early_x_old", "adv_events_cum"],
  "early flag": ["early_flag", "early_flag_x_new"],
  baseline: ["is_female", "edgic_available", "has_time"],
};
const groupOf = (k) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(k)) || "other";

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const ord = (k) => { const t = k % 100; return k + (t > 10 && t < 14 ? "th" : ["th", "st", "nd", "rd"][k % 10] || "th"); };
const mult = (v) => `×${Math.exp(v) >= 10 ? Math.exp(v).toFixed(0) : Math.exp(v).toFixed(2)}`;
const N_LABEL = ["6 or fewer", "7 to 9", "10 to 13", "14 or more"];
const H_LABEL = ["under 0.5×", "0.5 to 0.8×", "0.8 to 1.25×", "1.25 to 2×", "2 to 3×", "over 3×"];

// docs/data/track.json keeps counts per season so this page can leave its
// own season out of its own track record
function track(tr, season, heat, n) {
  const nb = tr.alive_bins.findIndex((b, j) => j > 0 && n <= b) - 1;
  const hb = tr.heat_bins.findIndex((b, j) => j > 0 && heat < b) - 1;
  const c = { won: 0, of: 0, inv: 0 };
  for (const [s, cells] of Object.entries(tr.seasons)) {
    if (+s === season) continue;
    for (const [a, h, won, of, inv] of cells) if (a === nb && h === hb) { c.won += won; c.of += of; c.inv += inv; }
  }
  c.even = c.inv / Math.max(1, c.of);
  if (c.of < 20) return "";
  const rate = c.won / c.of;
  // fixed 0-60% axis so the bar means the same thing every episode and can slide
  const X = (v) => Math.min(100, (v / 0.6) * 100);
  return `<div class="record">
    <p><b>Track record.</b> Out of sample, players the model rated about here (${H_LABEL[hb]} an even split,
    ${N_LABEL[nb]} left) went on to win <b>${c.won} of ${c.of}</b> times.</p>
    <div class="trbar" role="img" aria-label="won ${pct(rate)}, an even split is ${pct(c.even)}">
      <i class="fill" style="width:${X(rate)}%"></i><i class="even" style="left:${X(c.even)}%"></i>
    </div>
    <div class="trkey"><span><i class="k-fill"></i>won <b class="tr-rate">${pct(rate)}</b></span>
      <span><i class="k-even"></i>even split <b class="tr-even">${pct(c.even)}</b></span></div>
  </div>`;
}

// last frame's bar positions, keyed by factor, so the next frame can slide
// from them. only within one player: switching players is a fresh read.
let last = { id: null, bars: new Map(), p: null, rank: null, dv: null, even: null, bar: null };
const EASE = "cubic-bezier(.22,1,.36,1)";

export function renderPanel(el, { s, i, sel, labels, track: tr, ranked, animate = false }) {
  const eps = s.episodes, alive = ranked(s, i), n = alive.length;
  const out = sel.probs[i] == null;
  let wi = i; while (wi > 0 && sel.probs[wi] == null) wi--;
  const p = sel.probs[wi], q = wi > 0 ? sel.probs[wi - 1] : null;
  const al = ranked(s, wi), rank = al.indexOf(sel) + 1, nAt = al.length;
  // straight from the export: top rows, whatever they leave out, and the total
  const rec = sel.why[wi] && { rows: sel.why[wi], rest: sel.why_rest[wi], resid: 0, total: sel.why_total[wi] };
  const name = sel.name;

  const dv = q == null ? null : (p - q) * 100;
  const delta = q == null ? `<b>new</b><span>first episode</span>`
    : `<b class="${dv >= 0 ? "up" : "dn"}"><span class="arrow">${dv >= 0 ? "▲" : "▼"}</span> <span class="dnum">${Math.abs(dv).toFixed(1)}</span><small> pts</small></b><span>since ep ${eps[wi - 1]}</span>`;
  const strip = `<div class="stats">
      <div class="big"><b>${pct(p)}</b><span>to win${out ? `, as of ep ${eps[wi]}` : ""}</span></div>
      <div><b class="roll"><span class="rank">${ord(rank)}</span></b><span>of ${nAt} still in</span></div>
      <div>${delta}</div>
      <div><b class="evenv">${pct(1 / nAt)}</b><span>an even split</span></div>
    </div>`;

  let body = "";
  if (rec) {
    // waterfall in log space: start at a typical player, end at this one
    const top = rec.rows.slice(0, 5);
    const other = rec.rows.slice(5).reduce((a, [, v]) => a + v, 0) + rec.rest + rec.resid;
    const steps = [...top.map(([k, v]) => ({ k, v, label: (labels[k] || [k, k])[v > 0 ? 0 : 1].replace(/\bthem\b/, name).replace(/\btheir\b/, `${name}'s`), g: groupOf(k) })),
      { k: "_other", v: other, label: "all other factors", g: "" }];
    const typical = p / Math.exp(rec.total);
    let cum = 0;
    const pts = [0];
    for (const st of steps) { st.a = cum; cum += st.v; st.b = cum; pts.push(cum); }
    const lo = Math.min(...pts), hi = Math.max(...pts), pad = (hi - lo) * 0.08 || 0.5;
    const X = (v) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100;
    const row = (cls, label, chip, bar, val, k) => `<div class="wf ${cls}" data-k="${k}"><span class="lab">${label}${chip}</span><span class="trk">${bar}</span><span class="val">${val}</span></div>`;
    // the sentence is about the edit, so the baseline prior never headlines it
    const edit = steps.filter((x) => x.k !== "_other" && x.g !== "baseline");
    const ups = edit.filter((x) => x.v > 0).slice(0, 2), dns = edit.filter((x) => x.v < 0).slice(0, 2);
    body = `
      <h3>Why ${pct(p)}, factor by factor</h3>
      <p class="read">${ups.length ? `Working for ${name}: <em>${ups.map((x) => x.label).join("</em> and <em>")}</em>. ` : ""}${dns.length ? `Against: <em class="neg">${dns.map((x) => x.label).join("</em> and <em class=neg>")}</em>.` : ""}</p>
      <div class="wfall">
        ${row("start", "a typical player still in", "", `<i class="tick" style="left:${X(0)}%"></i>`, pct(typical), "_start")}
        ${steps.map((st) => row(`${st.v >= 0 ? "pos" : "neg"}${st.g === "baseline" ? " base" : ""}`, st.label, st.g ? `<small>${st.g}</small>` : "",
          `<i class="seg" style="left:${X(Math.min(st.a, st.b))}%;width:${Math.max(0.6, X(Math.max(st.a, st.b)) - X(Math.min(st.a, st.b)))}%"></i><i class="join" style="left:${X(st.b)}%"></i>`,
          mult(st.v), st.k)).join("")}
        ${row("end", name, "", `<i class="tick" style="left:${X(rec.total)}%"></i>`, `<b class="endv">${pct(p)}</b>`, "_end")}
      </div>
      <p class="foot">Each factor is measured against everyone still in, so anything they all share cancels out.
      Multiply the column and you get from a typical player's odds to ${name}'s.</p>`;
  } else body = `<p class="read">No edit data for ${name} at this point.</p>`;

  el.innerHTML = `<h2>The edit on ${name}</h2>
    ${out ? `<p class="sub">Voted out in episode ${sel.boot}. This is the last read the model had.</p>` : ""}
    ${strip}${track(tr, s.season, p * nAt, nAt)}${body}`;

  const same = animate && !reduce() && last.id === sel.id;
  const bars = new Map();
  el.querySelectorAll(".wf").forEach((r, n) => {
    const k = r.dataset.k;
    const parts = [...r.querySelectorAll(".seg,.tick,.join")].map((b) => ({ b, left: b.style.left, width: b.style.width }));
    bars.set(k, parts);
    if (!same) return;
    const prev = last.bars.get(k);
    if (prev && prev.length === parts.length) {
      parts.forEach(({ b, left, width }, j) => {
        const f = { left: prev[j].left }, to = { left };
        if (width) { f.width = prev[j].width; to.width = width; }
        b.animate([f, to], { duration: 560, easing: "cubic-bezier(.22,1,.36,1)" });
      });
    } else {
      // a factor that wasn't in the top rows last episode slides in
      r.animate([{ opacity: 0, transform: "translateX(-6px)" }, { opacity: 1, transform: "none" }],
        { duration: 420, delay: 60 + n * 30, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
    }
  });
  // rank rolls like an odometer: up when it improves, down when it slips
  const rk = el.querySelector(".rank");
  if (same && rk && last.rank != null && last.rank !== rank) {
    const dir = rank < last.rank ? 1 : -1;
    const old = document.createElement("span");
    old.className = "rank old"; old.textContent = ord(last.rank);
    rk.parentElement.append(old);
    old.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${-dir * 100}%)`, opacity: 0 }], { duration: 420, easing: EASE, fill: "forwards" })
      .onfinish = () => old.remove();
    rk.animate([{ transform: `translateY(${dir * 100}%)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: EASE });
  }
  const dn = el.querySelector(".dnum");
  if (dn && dv != null) countTo(dn, Math.abs(dv), (v) => v.toFixed(1), { from: same && last.dv != null ? Math.abs(last.dv) : Math.abs(dv) });
  if (same && dn && last.dv != null && Math.sign(last.dv) !== Math.sign(dv))
    el.querySelector(".arrow").animate([{ transform: "rotate(180deg) scale(.6)", opacity: 0.3 }, { transform: "none", opacity: 1 }], { duration: 380, easing: EASE });
  const ev = el.querySelector(".evenv");
  if (ev) countTo(ev, 1 / nAt, pct, { from: same && last.even != null ? last.even : 1 / nAt });
  // the track record bar slides from where it was
  const fill = el.querySelector(".trbar .fill"), evn = el.querySelector(".trbar .even");
  const bar = fill ? { w: fill.style.width, l: evn.style.left } : null;
  if (same && bar && last.bar) {
    fill.animate([{ width: last.bar.w }, { width: bar.w }], { duration: 600, easing: EASE });
    evn.animate([{ left: last.bar.l }, { left: bar.l }], { duration: 600, easing: EASE });
  }
  const big = el.querySelector(".stats .big b");
  if (big && p != null) countTo(big, p, pct, { from: same ? last.p : p });
  const endv = el.querySelector(".endv");
  if (endv && p != null) countTo(endv, p, pct, { from: same ? last.p : p });
  last = { id: sel.id, bars, p, rank, dv, even: 1 / nAt, bar };
}

// rank path for the chart column: one cell per episode. the cell colour runs
// from sand to flame by rank, and the digit takes whichever ink reads better
// on that exact colour, so the middle of the ramp never goes grey-on-salmon
const SAND = [233, 225, 208], FLAME = [168, 56, 10];
const lumOf = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const PAPER = [245, 239, 227];
// later episodes are faded by mixing toward the page, not with opacity, so the
// ink can still be chosen against the colour that's actually on screen
function cellInk(h, later = false) {
  let bg = SAND.map((v, k) => Math.round(v + (FLAME[k] - v) * h));
  if (later) bg = bg.map((v, k) => Math.round(v + (PAPER[k] - v) * 0.6));
  const L = lumOf(bg), dark = contrast(L, lumOf([46, 40, 32])), light = contrast(L, 1);
  return { bg: `rgb(${bg})`, ink: dark >= light ? "#2e2820" : "#fff" };
}

export function rankPath(el, { s, i, sel, ranked, onEpisode = () => {} }) {
  const cells = s.episodes.map((e, j) => {
    if (sel.probs[j] == null) return `<button type="button" class="gone" data-i="${j}" aria-label="episode ${e}: ${sel.name} is out">·</button>`;
    const al = ranked(s, j), r = al.indexOf(sel) + 1;
    const heat = Math.max(0, 1 - (r - 1) / Math.max(1, al.length - 1));
    const c = cellInk(heat, j > i);
    return `<button type="button" data-i="${j}" class="${j === i ? "now" : ""} ${j > i ? "later" : ""}" style="background:${c.bg};color:${c.ink}"
      aria-label="episode ${e}: ${ord(r)} of ${al.length}"${j === i ? ' aria-current="step"' : ""}>${r}</button>`;
  }).join("");
  el.innerHTML = `<div class="rp-h"><b>${sel.name}'s rank, episode by episode</b><span>1 is the model's pick · click to jump</span></div><div class="rp">${cells}</div>`;
  el.querySelector(".rp").style.gridTemplateColumns = `repeat(${s.episodes.length}, 1fr)`;
  el.querySelector(".rp").onclick = (ev) => { const b = ev.target.closest("button"); if (b) onEpisode(+b.dataset.i); };
}
