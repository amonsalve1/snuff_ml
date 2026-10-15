import { place, whyLabel, tribeInk } from "./common.js?v=50";
import { countTo, reduce } from "./motion.js?v=50";

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

// why this player's odds differ from a typical player's: one centre line,
// what raises their chances grows right, what lowers them grows left. lengths
// are log odds, so doubling and halving are the same length; labels say it in
// plain percent. shared with the method page so both read the same
export function factorChart({ rows, rest = 0, total, p, name, labels, k = 5 }) {
  const top = rows.slice(0, k);
  const other = rows.slice(k).reduce((a, [, v]) => a + v, 0) + rest;
  const factors = top.map(([key, v, lvl]) => ({ k: key, v, label: whyLabel(labels, [key, v, lvl], name), g: groupOf(key) }));
  const typical = p / Math.exp(total);
  const steps = [...factors.filter((x) => x.v > 0).sort((x, y) => y.v - x.v), ...factors.filter((x) => x.v <= 0).sort((x, y) => x.v - y.v),
    { k: "_other", v: other, label: "everything else, combined", g: "" }];
  const span = Math.max(...steps.map((x) => Math.abs(x.v)), 0.05);
  // the longest bar takes 32% of the track either side, leaving room for its number at the tip
  const W = (v) => (Math.abs(v) / span) * 32;
  const effect = (v) => { const m = Math.exp(v); if (Math.abs(m - 1) < 0.005) return "about even"; return m >= 2 ? `${m.toFixed(m >= 10 ? 0 : 1)}× the odds` : `${m >= 1 ? "+" : "−"}${Math.round(Math.abs(m - 1) * 100)}%`; };
  const row = (st) => {
    const w = Math.max(0.6, W(st.v)), up = st.v >= 0;
    const tip = up ? `left:calc(${50 + w}% + 6px)` : `right:calc(${50 + w}% + 6px)`;
    return `<div class="wf ${up ? "pos" : "neg"}${st.g === "baseline" ? " base" : ""}${st.k === "_other" ? " rest" : ""}" data-k="${st.k}">
    <span class="lab">${st.label}</span>
    <span class="trk"><i class="mid"></i><i class="seg" style="left:${up ? 50 : 50 - w}%;width:${w}%"></i><b class="tip" style="${tip}">${effect(st.v)}</b></span></div>`;
  };
  const html = `<div class="wfall">
      <div class="wf-axis"><span></span><span class="trk"><b class="l">← lowers chances</b><b class="r">raises chances →</b></span></div>
      ${steps.map(row).join("")}</div>
    <div class="wf-sum"><span>a typical player still in <b>${pct(typical)}</b></span><span class="to">→</span><span>${name} <b class="endv">${pct(p)}</b></span></div>`;
  return { html, typical, factors };
}

export function renderPanel(el, { s, i, sel, labels, track: tr, ranked, animate = false }) {
  const eps = s.episodes, alive = ranked(s, i), n = alive.length;
  const out = sel.probs[i] == null;
  let wi = i; while (wi > 0 && sel.probs[wi] == null) wi--;
  const p = sel.probs[wi], q = wi > 0 ? sel.probs[wi - 1] : null;
  const al = ranked(s, wi), rank = place(s, wi, sel), nAt = al.length;
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
    const { html: chart, typical, factors } = factorChart({ rows: rec.rows, rest: rec.rest + rec.resid, total: rec.total, p, name, labels });
    // the sentence is about the edit, so the baseline prior never headlines it
    const edit = factors.filter((x) => x.g !== "baseline");
    const ups = edit.filter((x) => x.v > 0).slice(0, 2), dns = edit.filter((x) => x.v < 0).slice(0, 2);
    body = `
      <h3>Why ${pct(p)}, factor by factor</h3>
      <p class="read">${ups.length ? `Working for ${name}: <em>${ups.map((x) => x.label).join("</em> and <em>")}</em>. ` : ""}${dns.length ? `Against: <em class="neg">${dns.map((x) => x.label).join("</em> and <em class=neg>")}</em>.` : ""}</p>
      ${chart}
      <p class="foot">Each bar compares ${name} with everyone still in, so anything they all share cancels out.
      Put every factor together and a typical player's ${pct(typical)} becomes ${name}'s ${pct(p)}.</p>`;
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
    const al = ranked(s, j), r = place(s, j, sel);
    const heat = Math.max(0, 1 - (r - 1) / Math.max(1, al.length - 1));
    const c = cellInk(heat, j > i);
    return `<button type="button" data-i="${j}" class="${j === i ? "now" : ""} ${j > i ? "later" : ""}" style="background:${c.bg};color:${c.ink}"
      aria-label="episode ${e}: ${ord(r)} of ${al.length}"${j === i ? ' aria-current="step"' : ""}>${r}</button>`;
  }).join("");
  el.innerHTML = `<div class="rp-h"><b>${sel.name}'s rank, episode by episode</b><span>1 is the model's pick · click to jump</span></div><div class="rp">${cells}</div>`;
  el.querySelector(".rp").style.gridTemplateColumns = `repeat(${s.episodes.length}, 1fr)`;
  el.querySelector(".rp").onclick = (ev) => { const b = ev.target.closest("button"); if (b) onEpisode(+b.dataset.i); };
}

// everyone still in, best odds first. rows are kept per player and slid into
// their new place, so stepping an episode shows who passed whom
let boardRows = null, boardFor = null, boardView = "all", boardAt = null;
export function board(el, { s, i, sel, ranked, onPick = () => {} }) {
  const e = s.episodes[i], al = ranked(s, i);
  // last week's order without last week's boot, so their exit doesn't read as everyone moving up
  const before = i > 0 ? ranked(s, i - 1).filter((p) => p.boot !== s.episodes[i - 1]) : null;
  if (boardFor !== s) {
    el.innerHTML = `<div class="rp-h"><b id="bd-h"></b><span class="bd-modes" role="group" aria-label="how to rank">
      <button type="button" data-v="all">Everyone</button><button type="button" data-v="tribe">By tribe</button></span></div>
      <div class="bd-key"></div><ol class="bd"></ol><div class="bt"></div><p class="bd-hint">click a name to follow them</p>`;
    el.querySelector(".bd-modes").onclick = (ev) => {
      const b = ev.target.closest("button");
      if (b) { boardView = b.dataset.v; board(el, { s, i: boardAt.i, sel: boardAt.sel, ranked, onPick }); }
    };
    boardRows = new Map(s.players.map((p) => {
      const li = document.createElement("li");
      li.innerHTML = `<button type="button"><span class="r"></span><span class="nm"><i class="td"></i>${p.name}</span><span class="bar"><i></i></span><span class="pc"></span><span class="mv"></span></button>`;
      li.querySelector("button").onclick = () => onPick(p);
      return [p, li];
    }));
    boardFor = s;
  }
  boardAt = { i, sel };
  // tribe dots, from survivoR's colours; a key for the tribes in play this episode
  // two dots: the tribe they started on, then the one they're on now if a swap
  // or the merge moved them, so who crossed over reads at a glance
  const tribes = s.tribes || [], tribeOf = (p) => tribes[p.tribe?.[i]];
  const startOf = (p) => tribes[p.tribe?.slice(0, i + 1).find((x) => x != null)];
  const inPlay = tribes.filter((t) => al.some((p) => tribeOf(p) === t || startOf(p) === t));
  // one dot each until the first swap; the second appears once anyone has moved
  const twoDots = al.some((p) => startOf(p) && tribeOf(p) !== startOf(p));
  el.querySelector(".bd-key").innerHTML = inPlay.map((t) => `<span><i class="td" style="background:${tribeInk(t.colour)}"></i>${t.name}</span>`).join("")
    + (twoDots ? `<span class="how">left half: starting tribe · right half: tribe now</span>` : "");
  el.querySelector(".bd").classList.toggle("two", twoDots);
  // by tribe: one column per tribe still split up, ranked inside it. gone at the merge
  const now = [...new Set(al.map(tribeOf))];
  const split = now.filter(Boolean).length >= 2;
  const view = split ? boardView : "all";
  el.querySelector(".bd-modes").hidden = !split;
  for (const b of el.querySelectorAll(".bd-modes button")) b.setAttribute("aria-pressed", String(b.dataset.v === view));
  el.querySelector("#bd-h").textContent = view === "tribe" ? `Rank within each tribe after episode ${e}, % to win` : `Everyone's rank after episode ${e}`;
  el.querySelector(".bd-key").hidden = view === "tribe";
  el.querySelector(".bd").hidden = view === "tribe";
  const bt = el.querySelector(".bt");
  bt.hidden = view !== "tribe";
  if (view === "tribe") {
    const cols = tribes.filter((t) => now.includes(t)).concat(now.includes(undefined) ? [undefined] : []);
    bt.style.gridTemplateColumns = `repeat(${cols.length}, minmax(0, 1fr))`;
    bt.innerHTML = cols.map((t) => {
      const mem = al.filter((p) => tribeOf(p) === t);
      return `<section><h4>${t ? `<i class="td" style="background:${tribeInk(t.colour)}"></i>${t.name}` : "no tribe"}<span>${mem.length}</span></h4><ol>${mem.map((p) => {
        const r = 1 + mem.filter((q) => q.probs[i] > p.probs[i]).length;
        return `<li class="${p === sel ? "sel" : ""} ${p.boot === e ? "out" : ""}"><button type="button" data-id="${p.id}"
          aria-label="${ord(r)} on ${t ? t.name : "no tribe"}, ${p.name}, ${(p.probs[i] * 100).toFixed(1)}%${p.boot === e ? ", out tonight" : ""}"><span class="r">${r}</span><span class="nm">${p.name}</span><span class="pc">${(p.probs[i] * 100).toFixed(1)}</span></button></li>`;
      }).join("")}</ol></section>`;
    }).join("");
    bt.onclick = (ev) => { const b = ev.target.closest("button"); if (b) onPick(s.players.find((p) => p.id === b.dataset.id)); };
    return;
  }
  const ol = el.querySelector(".bd"), top = al.length ? al[0].probs[i] : 1;
  const was = new Map([...boardRows].map(([p, li]) => [p, li.isConnected ? li.getBoundingClientRect().top : null]));
  ol.replaceChildren(...al.map((p) => boardRows.get(p)));
  al.forEach((p) => {
    const li = boardRows.get(p), r = place(s, i, p);
    const moved = before && before.includes(p) ? 1 + before.filter((q) => q.probs[i - 1] > p.probs[i - 1]).length - r : 0;
    const tied = al.some((q) => q !== p && q.probs[i] === p.probs[i]);
    li.className = `${p === sel ? "sel" : ""} ${p.boot === e ? "out" : ""}`;
    // one dot: whole until the first swap, then split, starting tribe on the
    // left and tribe now on the right. a later swap or the merge repaints the
    // right half; a tribe survivoR hasn't coloured yet leaves it empty, never
    // the starting colour, which would read as "never moved"
    const t = tribeOf(p), t0 = startOf(p) || t, dot = li.querySelector(".td");
    const swapped = t0 && t && t0 !== t;
    const L = t0 ? tribeInk(t0.colour) : "transparent", R = t ? tribeInk(t.colour) : twoDots && t0 ? "transparent" : L;
    dot.style.background = twoDots ? `linear-gradient(90deg, ${L} 50%, ${R} 50%)` : L;
    dot.style.boxShadow = t0 ? "" : "none";
    dot.title = swapped ? `started on ${t0.name}, now ${t.name}` : t ? t.name : t0 ? `started on ${t0.name}, tribe now not known` : "";
    li.querySelector(".r").textContent = r;
    li.querySelector(".bar i").style.width = `${(p.probs[i] / top) * 100}%`;
    li.querySelector(".pc").textContent = `${(p.probs[i] * 100).toFixed(1)}%`;
    const mv = li.querySelector(".mv");
    mv.className = `mv ${p.boot === e ? "" : moved > 0 ? "up" : moved < 0 ? "down" : ""}`;
    mv.textContent = p.boot === e ? "out" : moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : "–";
    li.querySelector("button").setAttribute("aria-label", `${tied ? "tied " : ""}${ord(r)}, ${p.name}${swapped ? ` (started on ${t0.name}, now ${t.name})` : t ? ` (${t.name})` : ""}, ${(p.probs[i] * 100).toFixed(1)}%${p.boot === e ? ", out tonight" : moved ? `, ${moved > 0 ? "up" : "down"} ${Math.abs(moved)}` : ""}`);
    li.querySelector("button").setAttribute("aria-pressed", String(p === sel));
    const y = was.get(p);
    if (y != null && !reduce() && !document.hidden) {
      const dy = y - li.getBoundingClientRect().top;
      if (dy) li.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" });
    }
  });
}
