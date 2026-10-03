// what the hero says about an episode. every beat that applies scores itself,
// the strongest one takes the headline, and the deck may only add facts the
// headline didn't already state. phrasing rotates by episode so playing a
// season through doesn't read the same line twice in a row.

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const ORD_WORDS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const word = (n) => WORDS[n] ?? String(n);
const cap = (x) => x[0].toUpperCase() + x.slice(1);
const ord = (k) => { const t = k % 100; return k + (t > 10 && t < 14 ? "th" : ["th", "st", "nd", "rd"][k % 10] || "th"); };
// whole numbers once they're big enough to read that way
const pc = (v) => (v >= 0.095 ? `${Math.round(v * 100)}%` : `${(v * 100).toFixed(1)}%`);
// "odds" is plural, so are the verbs
const growth = (x) => x >= 4 ? "more than quadruple" : x >= 3.5 ? "nearly quadruple" : x >= 2.9 ? "triple"
  : x >= 2.5 ? "nearly triple" : x >= 1.9 ? "double" : "jump by half";
const fall = (x) => x <= 0.3 ? "collapse" : x <= 0.45 ? "more than halve" : x <= 0.55 ? "halve" : "slide";
// 2.04 reads as "about twice", 0.13 as "a fraction of"
const times = (x) => x >= 2.8 ? `about ${word(Math.round(x))} times` : x >= 1.8 ? "about twice"
  : x >= 1.15 ? `${x.toFixed(1)} times` : x >= 0.85 ? "right at" : x >= 0.4 ? `${x.toFixed(1)} times` : "a fraction of";
const and = (xs) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

// a beat can't take the headline two episodes running, so the season is
// played forward from the premiere to know what the reader just saw
export function story(args) {
  let last = null, out = null;
  for (let j = 0; j <= args.i; j++) { out = frame({ ...args, i: j }, last); last = out.beat.id; }
  return out;
}

function frame({ s, i, sel, ranked, live = false, of = null, season = `Survivor ${s.season}` }, last) {
  const eps = s.episodes, n = eps.length, e = eps[i];
  // the newest episode of an airing season is just the latest one, not the end
  const fin = i === n - 1 && !live;
  const al = ranked(s, i), N = al.length, rank = (p, j = i) => ranked(s, j).indexOf(p) + 1;
  const lead = al[0];
  const prevLead = i > 0 ? ranked(s, i - 1)[0] : null;
  let streak = 1; for (let j = i - 1; j >= 0 && ranked(s, j)[0] === lead; j--) streak++;
  const ledFor = (p) => eps.slice(0, i).filter((_, j) => ranked(s, j)[0] === p).length;
  const going = al.filter((p) => p.boot === e);
  const win = s.players.find((p) => p.winner);
  const p = sel.probs[i], q = i > 0 ? sel.probs[i - 1] : null;
  const v = (k) => (i + k) % 2;           // rotate phrasings
  const S = (x) => `<span>${x.name}</span>`;
  const kicker = fin ? `${season} · Final tribal`
    : `${season} · Episode ${e} of ${of || n}${live && i === n - 1 ? " · latest aired" : going.length ? " · Tribal council" : ""}`;

  const beats = [];
  const add = (id, score, about, h, deck) => beats.push({ id, score: id === last ? score - 30 : score, about, h, deck });

  if (fin && win) {
    const wr = rank(win), outside = eps.filter((_, j) => win.probs[j] != null && rank(win, j) > 3).length;
    add("finale", 100, [win, lead], lead === win ? `The model called it. ${S(win)} wins.` : `${lead.name} was the model's last pick. ${S(win)} won from ${ord(wr)}.`,
      `${win.name} spent ${word(outside)} of ${word(n)} episodes outside the model's top three.`);
  }
  if (going.includes(sel) && !fin) {
    add("selOut", 95, [sel], v(0) ? `${S(sel)} goes home tonight.` : `Tribal snuffs ${S(sel)}.`,
      `The model had ${sel.name} ${ord(rank(sel))} of ${N}, at ${pc(p)}.`);
  }
  if (going.includes(lead) && lead !== sel && !fin) {
    add("leadOut", 90, [lead], v(1) ? `The favorite goes home: ${S(lead)}.` : `Tribal snuffs the front-runner, ${S(lead)}.`,
      `${lead.name} came in as the model's pick at ${pc(lead.probs[i])}${streak > 1 ? `, the top torch for ${word(streak)} straight episodes` : ""}.`);
  }
  if (i === 0) {
    add("premiere", 85, [lead], `${cap(word(N))} torches lit, and the model already has a favorite: ${S(lead)}.`,
      `${lead.name} opens at ${pc(lead.probs[0])}, ${times(lead.probs[0] * N)} an even split.`);
  }
  if (p != null && q != null && p / q >= 1.5) {
    const r0 = rank(sel, i - 1), r1 = rank(sel);
    add("selUp", 75, [sel], [`The model starts to believe ${S(sel)}.`, `${S(sel)}'s torch catches.`][v(0)],
      `${sel.name}'s odds ${growth(p / q)}, ${pc(q)} to ${pc(p)}${r1 < r0 ? `, ${ord(r0)} to ${ord(r1)}` : ""}.`);
  }
  if (p != null && q != null && p / q <= 0.65) {
    add("selDown", 74, [sel], [`The edit goes quiet on ${S(sel)}.`, `The model cools on ${S(sel)}.`][v(0)],
      `${sel.name}'s odds ${fall(p / q)}, ${pc(q)} to ${pc(p)}.`);
  }
  for (const g of going) {
    const r = rank(g);
    if (g !== lead && g !== sel && r <= 3 && !fin) {
      const led = ledFor(g);
      add("topOut", 70, [g], `Tribal takes the model's No. ${r}: ${S(g)}.`,
        `${g.name} had ${pc(g.probs[i])}${led >= 2 ? ` and had led for ${word(led)} episodes this season` : ""}.`);
    }
  }
  if (prevLead && lead !== prevLead && !going.includes(lead) && prevLead.probs[i] != null) {
    const pl = ledFor(prevLead);
    add("newLead", 62, [lead, prevLead], v(1) ? `${S(lead)} takes the top torch.` : `A new favorite: ${S(lead)}.`,
      `${lead.name} moves to ${pc(lead.probs[i])}, past ${prevLead.name}${pl >= 2 ? `, who had led for ${word(pl)} episodes` : ""}.`);
  }
  const buried = (j) => win && win.probs[j] != null && rank(win, j) > Math.ceil(ranked(s, j).length / 2);
  if (win && win === sel && p != null && buried(i) && !fin) {
    let run = 0; for (let j = i - 1; j >= 0 && buried(j); j--) run++;
    const r = rank(win);
    add("buried", 58, [win], [`The eventual winner is ${ord(r)} of ${N}.`, `The model can't see ${S(win)} yet.`,
      `${S(win)} is still in the dark.`][run % 3],
      [`${win.name} sits at ${pc(p)}, ${times(p * N)} an even split. The edit hasn't found the winner.`,
        `${cap(word(i + 1))} episodes in, the eventual winner has yet to crack the top half.`,
        `${win.name} at ${pc(p)}, ${ord(r)} of ${N}. Nobody is telling this story yet.`][run % 3]);
  }
  // the first time a player gets into the model's top three
  if (p != null && rank(sel) <= 3 && i > 0 && !fin && eps.slice(0, i).every((_, j) => sel.probs[j] == null || rank(sel, j) > 3)) {
    add("top3", 68, [sel], `${S(sel)} breaks into the model's top three.`,
      `${sel.name} climbs to ${ord(rank(sel))} at ${pc(p)}${q != null ? `, up from ${pc(q)}` : ""}.`);
  }
  // last episode's favorite went home, so somebody inherits the torch
  if (prevLead && lead !== prevLead && prevLead.boot === eps[i - 1]) {
    add("inherit", 60, [lead, prevLead], `With ${prevLead.name} gone, ${S(lead)} inherits the top torch.`,
      `${lead.name} picks up the lead at ${pc(lead.probs[i])}.`);
  }
  const worst = going.filter((g) => rank(g) >= N - 1).sort((a, b) => rank(b) - rank(a))[0];
  if (worst && !fin) {
    add("edge", 55, [worst], v(0) ? `The edit saw ${S(worst)} coming.` : `No surprise to the model: ${S(worst)} goes.`,
      `${worst.name} went into tribal ${ord(rank(worst))} of ${N}, at ${pc(worst.probs[i])}.`);
  }
  if (streak >= 2 && !fin) {
    add("hold", 30, [lead], v(0) ? `${S(lead)} leads for a ${ORD_WORDS[streak] || ord(streak)} straight episode.` : `Still ${S(lead)}'s game to lose, says the model.`,
      `${lead.name} is at ${pc(lead.probs[i])}${al[1] ? `, ${al[1].name} next at ${pc(al[1].probs[i])}` : ""}.`);
  }
  add("default", 10, [lead], `${S(lead)} leads at ${pc(lead.probs[i])}.`, "");

  beats.sort((a, b) => b.score - a.score);
  const top = beats[0];

  // the deck: the beat's own line, then one fact the headline didn't cover
  const extra = [];
  const covered = new Set(top.about);
  const left = going.filter((g) => !covered.has(g));
  if (left.length && !fin) {
    extra.push(left.length === 1 ? `${left[0].name} goes home tonight, ${ord(rank(left[0]))} of ${N} going in.`
      : `${and(left.map((g) => g.name))} go home tonight.`);
  }
  if (!covered.has(sel) && p != null && !going.includes(sel)) {
    const r = ord(rank(sel));
    extra.push(q == null ? `${sel.name} opens ${r}, at ${pc(p)}.`
      : Math.abs(p - q) < 0.01 ? `${sel.name} holds ${r} at ${pc(p)}.`
      : `${sel.name} ${p > q ? "rises" : "drops"} to ${pc(p)}, ${r}.`);
  }
  if (!covered.has(lead) && !going.includes(lead)) extra.push(`${lead.name} leads at ${pc(lead.probs[i])}.`);
  const deck = [top.deck, extra[0]].filter(Boolean).join(" ");
  return { kicker, h: top.h, deck, beat: top };
}
