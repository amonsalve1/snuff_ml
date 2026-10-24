"""Exports the loso predictions to json for the docs/ site.

Reads reports/retrospective/preds_blend.parquet and
models/blend_through_s50.joblib, writes docs/data/index.json,
docs/data/seasons/sNN.json and docs/data/insights.json. Run
`snuffml study --loso` and `snuffml train` first.

The parquet only covers finished seasons. A season that's still on the air
isn't in it at all, so it gets scored separately with the trained-through
model and exported through the same builders, flagged "live".
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from snuffml import config
from snuffml.data import survivor2py
from snuffml.models.sklearn_baseline import (  # noqa: F401
    EraBlendModel,
    WinnerModel,
    model_path,
)

# feature -> (phrase when pushing up, phrase when pushing down)
# what's true of the player, (above the field, below it). the direction a
# factor pushes is the bar's job, never the label's: leading the early
# confessionals reads the same whether it helps or hurts that season.
FEATURE_LABELS: dict[str, tuple[str, str]] = {
    "conf_ep": ("a big confessional episode", "a quiet episode"),
    "conf_time_ep": ("lots of screen time this episode", "little screen time this episode"),
    "has_time": ("timing data this season", "no timing data this season"),
    "conf_cum": ("more confessionals than most", "fewer confessionals than most"),
    "conf_share_ep": ("a big share of this episode", "a small share of this episode"),
    "conf_share_cum": ("a big share of the season's confessionals", "a small share of the season's confessionals"),
    "conf_z_cum": ("airtime well above the cast's", "airtime below the cast's"),
    "index_resid_cum": ("more airtime than their game explains", "less airtime than their game explains"),
    "premiere_share": ("a strong premiere", "a quiet premiere"),
    "late_clustering": ("airtime building late", "airtime fading late"),
    "conf_trend": ("confessionals rising", "confessionals falling"),
    "is_female": ("a woman (winning women get quieter edits)", "a man (winning men get louder edits)"),
    "zero_any": ("went an episode with no confessionals", "never went an episode without a confessional"),
    "orig_tribe_over": ("their starting tribe got the airtime", "their starting tribe got little airtime"),
    "early_flag": ("led the confessionals early", "didn't lead the confessionals early"),
    "vfb_cum": ("votes with the majority more than most", "votes with the majority less than most"),
    "vote_acc_cum": ("an accurate voter", "often on the wrong side of the vote"),
    "votes_against_cum": ("more votes against them than most", "fewer votes against them than most"),
    # survivoR's advantage_movement rows: found, received, gave and played all count one each
    "adv_events_cum": ("more advantage moves (finds, gifts, plays) than most", "fewer advantage moves than most"),
    "imm_early_cum": ("won immunity early after the merge", "no early post-merge immunity"),
    "imm_late_cum": ("won immunity late in the game", "no late immunity wins"),
    "edgic_available": ("edgic coverage", "no edgic coverage"),
    "cp_share": ("often edited as complex", "rarely edited as complex"),
    "cpx_count": ("more big complex episodes than most", "fewer big complex episodes than most"),
    "ott_count": ("more over-the-top episodes than most", "fewer over-the-top episodes than most"),
    "inv_count": ("more invisible episodes than most", "fewer invisible episodes than most"),
    "utr_share": ("often under the radar", "rarely under the radar"),
    "tone_consistency": ("a consistently positive tone", "a mixed or negative tone"),
    "tone_flips": ("a tone that keeps flipping", "a steady tone"),
    "visibility_mean": ("highly visible", "rarely visible"),
    "visibility_z": ("more visible than the cast", "less visible than the cast"),
}

# era and gender interactions are the same fact as their base feature, so a
# row showed twice with clashing labels ("led early" and "didn't lead early").
# they're folded into the base: one row, the summed push, labelled by the base.
FOLDED = {
    "early_flag_x_new": "early_flag",
    "zero_any_x_new": "zero_any",
    "imm_early_x_old": "imm_early_cum",
    "new_era_x_share_cum": "conf_share_cum",
    "female_x_share_cum": "is_female",
}


def strip_prefix(name: str) -> str:
    for p in ("num__", "cat__"):
        if name.startswith(p):
            return name[len(p):]
    return name


def logit_contributions(model: WinnerModel, rows: pd.DataFrame) -> pd.DataFrame:
    pre = model.pipeline.named_steps["pre"]
    clf = model.pipeline.named_steps["clf"]
    x = pre.transform(rows[model.feature_cols])
    if hasattr(x, "toarray"):
        x = x.toarray()
    names = [strip_prefix(n) for n in pre.get_feature_names_out()]
    # the platt calibrator rescales the logit before it becomes a probability.
    # without its slope the bars overstate the odds they explain, about 2x for
    # the pooled model and 4x for the new era one
    slope = float(model.calibrator.coef_[0][0]) if model.calibrator is not None else 1.0
    return pd.DataFrame(x * clf.coef_[0] * slope, columns=names, index=rows.index)


def blend_contributions(blend: EraBlendModel, rows: pd.DataFrame) -> pd.DataFrame:
    # sqrt(p_pooled * p_era) averages the two log probabilities, so where the
    # era model applies each model counts half, a feature only one of them has
    # included
    contrib = logit_contributions(blend.pooled, rows)
    for era, m in blend.era_models.items():
        mask = rows["era"] == era
        if mask.any():
            era_c = logit_contributions(m, rows[mask])
            cols = contrib.columns.union(era_c.columns)
            contrib = contrib.reindex(columns=cols, fill_value=0.0)
            era_c = era_c.reindex(columns=cols, fill_value=0.0)
            contrib.loc[mask, cols] = (contrib.loc[mask, cols] + era_c) / 2
    return contrib


def relative_to_field(contrib: pd.DataFrame, rows: pd.DataFrame) -> pd.DataFrame:
    """Each feature's push minus the average push on everyone alive that episode.

    Probabilities are normalised within an episode, so only differences between
    players move them. Measured this way anything the whole field shares
    (the era, edgic coverage existing at all) cancels, and the row sums to the
    player's log odds against a typical player still in it. rows must be
    indexed the same way contrib is.
    """
    keys = rows.loc[contrib.index, ["season", "episode"]]
    contrib = contrib[[c for c in contrib.columns if not c.startswith("era_")]]
    return contrib - contrib.groupby([keys["season"], keys["episode"]]).transform("mean")


def fold(rel: pd.DataFrame) -> pd.DataFrame:
    """Sum each interaction into its base feature. Logits add, so the total is unchanged."""
    return rel.T.groupby(lambda c: FOLDED.get(c, c)).sum().T


def field_levels(rows: pd.DataFrame, cols) -> pd.DataFrame:
    """+1 where the player's raw value is above the average of everyone alive
    that episode, -1 below, 0 level. This picks the label, so it describes the
    player, not which way the model leans."""
    have = [c for c in cols if c in rows.columns]
    x = rows[have].astype(float)
    dev = x - x.groupby([rows["season"], rows["episode"]]).transform("mean")
    return np.sign(dev.where(dev.abs() > 1e-9, 0.0)).reindex(columns=list(cols), fill_value=0.0)


def log_odds_vs_field(rows: pd.DataFrame) -> pd.Series:
    """log(p / geometric mean of p) over everyone alive that episode."""
    lp = np.log(rows["win_prob"].clip(lower=1e-9))
    return lp - lp.groupby([rows["season"], rows["episode"]]).transform("mean")


def loso_contributions(preds: pd.DataFrame) -> pd.DataFrame:
    """Contributions from the same held-out model that made each prediction.

    The site shows loso probabilities, so explaining them with the final
    model would have the bars disagreeing with the number above them. One
    refit per season, same as the study.
    """
    from snuffml.features import build as build_mod
    from snuffml.models.sklearn_baseline import train_blend, training_frame

    rows = training_frame(build_mod.load_features())
    out = []
    for season in sorted(preds["season"].unique()):
        held = preds[preds["season"] == season]
        model = train_blend(rows[rows["season"] != season])
        out.append(blend_contributions(model, held))
        print(f"  loso contributions s{season}", flush=True)
    return pd.concat(out).reindex(preds.index)


def season_is_live(season_rows: pd.DataFrame) -> bool:
    """Is this season still airing?

    Two winnerless-looking things have to stay apart. s38 has a winner in the
    panel who is just missing from the final snapshot (chris came back from
    the edge after going out in ep 3) - that season is over. A season still on
    the air has no winner anywhere. A finished season also has finalists, so
    made_ftc catches the case where the winner flag never got filled in but
    the finale did happen.
    """
    if season_rows["is_winner"].any():
        return False
    return not season_rows["made_ftc"].any()


def frozen_model_path() -> Path:
    meta = json.loads((config.PROJECT_ROOT / "forward" / "FROZEN.json").read_text())
    path = config.PROJECT_ROOT / meta["model"]
    import hashlib

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != meta["sha256"]:
        raise SystemExit(f"{path.name} doesn't match forward/FROZEN.json, refusing to predict the airing season")
    return path


def predict_airing(preds: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Score the season that's on the air right now.

    The loso parquet is the study over finished seasons, so an airing season
    is simply absent from it. Anything in the panel the study never saw and
    nobody has won yet gets the trained-through blend, which was fit through
    the last finished season - so these predictions are out of sample too,
    nothing leaks.

    Returns (rows with win_prob, logit contributions keyed by _row). Both are
    empty when nothing is airing.
    """
    from snuffml.features import build as build_mod

    panel = build_mod.load_features()
    done = {int(s) for s in preds["season"].unique()}
    airing = []
    for s, g in panel.groupby("season"):
        if int(s) in done or not season_is_live(g):
            continue
        if not (g["conf_ep"].sum() > 0):
            continue  # mirror placeholder with no edit data, nothing to predict from
        airing.append(int(s))
    if not airing:
        return pd.DataFrame(), pd.DataFrame()

    # the airing season is the forward test, so it always comes from the frozen
    # model in forward/, checked against its recorded hash, never a refit
    model = EraBlendModel.load(frozen_model_path())
    rows = model.predict(panel[panel["season"].isin(airing)])
    rows = rows.sort_values(["season", "castaway_id", "episode"]).reset_index(drop=True)
    # _row has to stay unique once these get concatenated onto preds
    rows["_row"] = rows.index + len(preds)
    contrib = blend_contributions(model, rows)
    contrib.index = rows["_row"]
    for s in airing:
        g = rows[rows["season"] == s]
        print(f"  live s{s}: {g['episode'].nunique()} eps, {len(g)} alive rows", flush=True)
    return rows, contrib


def top_k_why(contrib_row: pd.Series, k: int = 6, level: pd.Series | None = None) -> list[list]:
    """The k biggest pushes either way, biggest first, as [feature, push,
    level]: level is +1 above the field, -1 below, and picks the label."""
    row = contrib_row[[c for c in contrib_row.index if not c.startswith("era_")]]
    row = row[row.abs() > 1e-4]
    row = row.reindex(row.abs().sort_values(ascending=False).index).head(k)
    lv = (lambda key: int(level.get(key, 0))) if level is not None else (lambda key: 0)
    return [[key, round(float(v), 3), lv(key)] for key, v in row.items()]


def top_pick(rows: pd.DataFrame) -> pd.Series:
    """Highest win_prob, name as the tiebreak - same order build_season sorts by."""
    return rows.sort_values(["win_prob", "castaway"], ascending=[False, True]).iloc[0]


def season_outcome(season_preds: pd.DataFrame) -> str:
    if season_is_live(season_preds):
        return "airing"
    last = season_preds[season_preds["episode"] == season_preds["episode"].max()]
    last = last.sort_values("win_prob", ascending=False).reset_index(drop=True)
    if not last["is_winner"].any():
        return "edge return"  # s38, chris won from the edge
    rank = last.index[last["is_winner"]][0] + 1
    if rank == 1:
        return "called"
    if rank <= 3:
        return "top3"
    return "missed"


def season_names() -> dict[int, str]:
    ss = survivor2py.load_table("season_summary", fetch=False)
    out = {}
    for r in ss.dropna(subset=["season"]).itertuples():
        name = str(getattr(r, "season_name", "") or "")
        out[int(r.season)] = name.replace("Survivor: ", "").replace("Survivor ", "")
    return out


def expected_episode_count(preds: pd.DataFrame, era: str) -> int:
    """typical length of a finished season in this era, for pacing a live one"""
    lens = (
        preds[preds["season"].map(lambda x: config.era_of(int(x))) == era]
        .groupby("season")["episode"]
        .max()
    )
    return int(lens.median()) if len(lens) else 13


def live_bet(g: pd.DataFrame) -> dict | None:
    """the model's boldest live call: the biggest edit it is betting against.

    whoever owns the most confessional share right now, and where the model
    actually ranks them. in the new era the episode one share leader is 0 for
    10, so when the loudest edit sits near the bottom that is the model putting
    real money down, and it is checkable in public as the season plays out.
    """
    last = g[g["episode"] == g["episode"].max()]
    if last.empty or "conf_share_cum" not in last:
        return None
    ranked = last.sort_values("win_prob", ascending=False).reset_index(drop=True)
    loud = last.loc[last["conf_share_cum"].idxmax()]
    rank = int(ranked.index[ranked["castaway_id"] == loud["castaway_id"]][0]) + 1
    # only worth saying when the loudest edit is in the bottom half
    if rank <= len(ranked) / 2:
        return None
    return {
        "name": str(loud["castaway"]),
        "share": round(float(loud["conf_share_cum"]) * 100, 1),
        "rank": rank,
        "of": len(ranked),
        "prob": round(float(loud["win_prob"]) * 100, 1),
    }


def live_notes(season: int, eps: list[int]) -> dict:
    """who just went home, and which episodes are hand entered.

    a live season's newest episode still shows the person voted out in it,
    exactly the way a finished season does, so the board needs to say so out
    loud. and anything sourced from data/manual/live is provisional: it is a
    fan tally typed in ahead of survivoR, so the site has to admit that.
    """
    out = {}
    try:
        vh = survivor2py.load_table("vote_history", fetch=False)
        v = vh[(vh["season"] == season) & (vh["episode"] == max(eps))]
        # a double tribal sends two people home in one episode, so it's a list
        gone = [str(x) for x in v["voted_out"].dropna().unique()]
        if gone:
            out["just_out"] = gone
    except Exception:
        pass
    manual = survivor2py.manual_live_dir() / "confessionals.csv"
    if manual.exists():
        try:
            m = pd.read_csv(manual)
            prov = sorted({int(e) for e in m.loc[m["season"] == season, "episode"].dropna()})
            if prov:
                out["provisional_episodes"] = prov
        except Exception:
            pass
    return out


def build_index(preds: pd.DataFrame, names: dict[int, str]) -> dict:
    seasons = []
    for s, g in preds.groupby("season"):
        eps = sorted(g["episode"].unique())
        live = season_is_live(g)
        if live:
            # nobody has won yet, so the line the compare view draws is the
            # current top pick's instead. same field so the site needs no
            # special case to plot it
            tracked = g[g["castaway_id"] == top_pick(g[g["episode"] == eps[-1]])["castaway_id"]]
        else:
            tracked = g[g["is_winner"]]
        wname = str(tracked["castaway"].iloc[0]) if len(tracked) else "?"
        wprobs = []
        for e in eps:
            we = tracked[tracked["episode"] == e]
            wprobs.append(round(float(we["win_prob"].iloc[0]), 5) if len(we) else None)
        entry = {
            "season": int(s),
            "name": names.get(int(s), ""),
            "era": config.era_of(int(s)),
            "episodes": len(eps),
            "winner": None if live else wname,
            "outcome": season_outcome(g),
        }
        if live:
            entry["live"] = True
            entry["leader"] = wname
            # the real length, not the aired count. without it the light arc
            # and the compare axis both read the latest aired episode as the
            # finale, so episode 2 would come out pitch dark
            entry["expected_episodes"] = expected_episode_count(
                preds, config.era_of(int(s))
            )
            bet = live_bet(g)
            if bet:
                entry["bet"] = bet
            entry.update(live_notes(int(s), eps))
        entry["winner_probs"] = wprobs
        seasons.append(entry)
    labels = {k: list(v) for k, v in FEATURE_LABELS.items()}
    return {"labels": labels, "seasons": seasons}


_TRIBES = None


def tribes_at() -> tuple[dict, dict]:
    """The tribe each castaway ended each episode on (the last stage of the
    game in that episode, so a mid-episode swap shows), and each season's
    tribe colours from survivoR. A merged tribe without a colour gets none."""
    global _TRIBES
    if _TRIBES is None:
        try:
            bm = survivor2py.load_table("boot_mapping", fetch=False).dropna(subset=["episode", "sog_id", "tribe"])
            last = bm.sort_values("sog_id").groupby(["season", "episode", "castaway_id"])["tribe"].last()
        except FileNotFoundError:  # no cache (the tests): no tribes
            last = pd.Series(dtype=object)
        try:
            cols = survivor2py.load_table("tribe_colours", fetch=False).dropna(subset=["tribe", "tribe_colour"])
        except FileNotFoundError:  # an older cache: no colours, so no dots
            cols = pd.DataFrame(columns=["season", "tribe", "tribe_colour"])
        colour = {(int(r.season), r.tribe): r.tribe_colour for r in cols.itertuples()}
        _TRIBES = ({(int(k[0]), int(k[1]), str(k[2])): t for k, t in last.items()}, colour)
    return _TRIBES


def build_season(preds: pd.DataFrame, contrib: pd.DataFrame, season: int, levels: pd.DataFrame | None = None) -> dict:
    g = preds[preds["season"] == season]
    eps = sorted(g["episode"].unique())
    live = season_is_live(g)
    # in a live season the newest episode is also the last one in the data, so
    # whoever went home in it would read as still in. the vote history knows.
    just_out = live_notes(season, [int(e) for e in eps]).get("just_out", []) if live else []
    players = []
    on, colour = tribes_at()
    tribes = sorted({t for (ss, _, _), t in on.items() if ss == season and (season, t) in colour})
    for cid, p in g.groupby("castaway_id"):
        p = p.sort_values("episode")
        by_ep = p.set_index("episode")
        boot = int(p["episode"].max())
        probs, whys, rest, total = [], [], [], []
        for e in eps:
            if e in by_ep.index:
                r = by_ep.loc[e, "_row"]
                probs.append(round(float(by_ep.loc[e, "win_prob"]), 5))
                top = top_k_why(contrib.loc[r], level=levels.loc[r] if levels is not None else None)
                whys.append(top)
                # what the shown rows leave out, so the panel always adds up
                # to the total: the smaller features plus whatever the linear
                # read misses at the top of the sigmoid
                tot = float(by_ep.loc[e, "_vs_field"])
                total.append(round(tot, 3))
                rest.append(round(tot - sum(v for _, v, _ in top), 3))
            else:
                probs.append(None)
                whys.append(None)
                rest.append(None)
                total.append(None)
        name = str(p["castaway"].iloc[0])
        tribe = [tribes.index(on[(season, int(e), str(cid))]) if e in by_ep.index
                 and on.get((season, int(e), str(cid))) in tribes else None for e in eps]
        players.append(
            {
                "id": str(cid),
                "name": name,
                "winner": bool(p["is_winner"].any()),
                # several people can go home inside a finale episode, so being
                # alive at its start doesn't mean reaching final tribal
                "ftc": bool(p["made_ftc"].any()) if "made_ftc" in p else None,
                "boot": boot if name in just_out else None if boot == max(eps) else boot,
                "probs": probs,
                "why": whys,
                "why_rest": rest,
                "why_total": total,
                "tribe": tribe,
            }
        )
    players.sort(key=lambda pl: (-(pl["probs"][-1] or 0), pl["name"]))
    out = {
        "season": season,
        "era": config.era_of(season),
        "episodes": [int(e) for e in eps],
        "outcome": season_outcome(g),
    }
    if season_is_live(g):
        out["live"] = True
    out["tribes"] = [{"name": t, "colour": colour[(season, t)]} for t in tribes]
    out["players"] = players
    return out


def build_insights(preds: pd.DataFrame) -> dict:
    last = preds[preds["episode"] == preds.groupby("season")["episode"].transform("max")]
    winners_last = last[last["is_winner"]]

    flag = []
    for s in sorted(preds[preds["season"] >= 41]["season"].unique()):
        # the flag freezes at episode 4, so only trust rows from there on
        g = preds[(preds["season"] == s) & (preds["episode"] >= 4) & (preds["early_flag"] == 1)]
        if not len(g):
            continue
        holder = g[g["castaway_id"] == g.iloc[0]["castaway_id"]]
        flag.append(
            {
                "season": int(s),
                "holder": str(holder["castaway"].iloc[0]),
                "won": bool(holder["is_winner"].any()),
                "out": int(holder["episode"].max()),
            }
        )

    zero = (
        winners_last.assign(era=lambda d: d["season"].map(lambda x: config.era_of(int(x))))
        .groupby("era")["zero_any"]
        .mean()
        .round(3)
        .to_dict()
    )

    imm = {}
    for era in ["old", "middle", "new"]:
        sub = last[last["season"].map(lambda x: config.era_of(int(x))) == era]
        w = sub[sub["is_winner"]]
        o = sub[~sub["is_winner"]]
        imm[era] = {
            "winner_late": round(float(w["imm_late_cum"].mean()), 2),
            "other_late": round(float(o["imm_late_cum"].mean()), 2),
            "winner_early": round(float(w["imm_early_cum"].mean()), 2),
            "other_early": round(float(o["imm_early_cum"].mean()), 2),
        }

    era_score: dict[str, dict[str, int]] = {}
    for s, g in preds.groupby("season"):
        era = config.era_of(int(s))
        era_score.setdefault(era, {"called": 0, "top3": 0, "missed": 0, "edge return": 0})
        era_score[era][season_outcome(g)] += 1

    peaks = preds.groupby(["season", "castaway_id"]).agg(
        name=("castaway", "first"),
        peak=("win_prob", "max"),
        won=("is_winner", "any"),
        out=("episode", "max"),
        final=("win_prob", "last"),
    ).reset_index()
    decoys = (
        peaks[(~peaks["won"]) & (peaks["peak"] >= 0.35)]
        .sort_values("peak", ascending=False)
        .head(15)
    )
    underdogs = peaks[peaks["won"]].sort_values("peak").head(10)

    def rows(d: pd.DataFrame) -> list[dict]:
        return [
            {
                "season": int(r.season),
                "name": str(r.name),
                "peak": round(float(r.peak), 3),
                "final": round(float(r.final), 3),
            }
            for r in d.itertuples()
        ]

    return {
        "early_flag_curse": flag,
        "zero_conf_winners": zero,
        "immunity": imm,
        "era_difficulty": era_score,
        "decoys": rows(decoys),
        "underdogs": rows(underdogs),
    }


# track record bins: odds against an even split, and how many were left
TRACK_HEAT_BINS = [0, 0.5, 0.8, 1.25, 2, 3, 99]
TRACK_ALIVE_BINS = [0, 6, 9, 13, 99]


def build_track(preds: pd.DataFrame) -> dict:
    """How often players the model rated at a given level went on to win.

    Every row is loso so this is out of sample. Counts are kept per season so a
    season page can leave its own season out of its own track record.
    """
    p = preds.copy()
    p["n"] = p.groupby(["season", "episode"])["win_prob"].transform("size")
    p["heat"] = p["win_prob"] * p["n"]
    p["hb"] = pd.cut(p["heat"], TRACK_HEAT_BINS, right=False, labels=False)
    p["nb"] = pd.cut(p["n"], TRACK_ALIVE_BINS, right=True, labels=False)
    cells = (
        p.groupby(["season", "nb", "hb"])
        .agg(won=("is_winner", "sum"), of=("is_winner", "size"), inv_n=("n", lambda s: float((1 / s).sum())),
             heat=("heat", "sum"))
        .reset_index()
    )
    seasons: dict[str, list] = {}
    for r in cells.itertuples():
        seasons.setdefault(str(int(r.season)), []).append(
            [int(r.nb), int(r.hb), int(r.won), int(r.of), round(r.inv_n, 4), round(r.heat, 3)]
        )
    return {
        "heat_bins": TRACK_HEAT_BINS,
        "alive_bins": TRACK_ALIVE_BINS,
        # sums, not means, so a page can drop one season and still average
        "fields": ["alive_bin", "heat_bin", "won", "of", "sum_1_over_n", "sum_heat"],
        "seasons": seasons,
    }


def check_why_adds_up(rel: pd.DataFrame, rows: pd.DataFrame) -> None:
    """The factors have to explain the odds they sit under, or stop the export.

    rel summed across every feature should land on the log odds against the
    field. measured at a 0.025 median gap; a wide gap means the contributions
    and the probabilities came from different models or different data.
    """
    gap = (rel.sum(axis=1) - rows.loc[rel.index, "_vs_field"]).abs()
    med, p90 = float(gap.median()), float(gap.quantile(0.9))
    print(f"why vs odds: median gap {med:.3f}, p90 {p90:.3f} (log units)")
    if med > 0.1:
        raise SystemExit(f"why panels don't explain the odds: median gap {med:.3f}")


def sanity_check(preds: pd.DataFrame, out_dir: Path, live: pd.DataFrame | None = None) -> None:
    n_done = preds["season"].nunique()
    live_seasons = 0 if live is None or not len(live) else live["season"].nunique()
    live_len = 0 if live is None else len(live)
    season_files = sorted((out_dir / "seasons").glob("s*.json"))
    expect = n_done + live_seasons
    if len(season_files) != expect:
        raise SystemExit(f"expected {expect} season files, got {len(season_files)}")
    n_rows = n_live_rows = n_done_files = n_live_files = 0
    for f in season_files:
        data = json.loads(f.read_text())
        # holds for the live season too: probs are renormalized over whoever
        # is still alive that episode
        for e_i, e in enumerate(data["episodes"]):
            total = sum(p["probs"][e_i] for p in data["players"] if p["probs"][e_i] is not None)
            if abs(total - 1.0) > 1e-2:
                raise SystemExit(f"{f.name} episode {e}: probs sum to {total:.3f}")
        rows = sum(sum(x is not None for x in p["probs"]) for p in data["players"])
        if data.get("live"):
            n_live_rows += rows
            n_live_files += 1
            if any(p["winner"] for p in data["players"]):
                raise SystemExit(f"{f.name}: live season already has a winner")
            if data["outcome"] != "airing":
                raise SystemExit(f"{f.name}: live season outcome is {data['outcome']!r}")
        else:
            n_rows += rows
            n_done_files += 1
            if not any(p["winner"] for p in data["players"]):
                raise SystemExit(f"{f.name}: no winner")
    if n_done_files != n_done:
        raise SystemExit(f"{n_done_files} finished season files, parquet has {n_done}")
    if n_live_files != live_seasons:
        raise SystemExit(f"{n_live_files} live season files, expected {live_seasons}")
    if n_rows != len(preds):
        raise SystemExit(f"exported {n_rows} alive rows, parquet has {len(preds)}")
    if n_live_rows != live_len:
        raise SystemExit(f"exported {n_live_rows} live rows, predicted {live_len}")
    extra = f" + {live_seasons} live ({n_live_rows} rows)" if live_seasons else ""
    print(f"sanity ok: {n_done_files} seasons, {n_rows} rows{extra}")


def main() -> None:
    preds = pd.read_parquet(config.REPORTS_DIR / "retrospective" / "preds_blend.parquet")
    # "last" aggregations below assume episode order within each player
    preds = preds.sort_values(["season", "castaway_id", "episode"]).reset_index(drop=True)
    preds["_row"] = preds.index
    contrib = loso_contributions(preds)

    live, live_contrib = predict_airing(preds)
    # the site builders treat both the same; insights stays on finished
    # seasons only, an airing season has nothing to say about how it ended
    both = pd.concat([preds, live], ignore_index=True) if len(live) else preds
    both_contrib = pd.concat([contrib, live_contrib]) if len(live) else contrib
    both["_vs_field"] = log_odds_vs_field(both)
    by_row = both.set_index("_row")
    both_contrib = fold(relative_to_field(both_contrib, by_row))
    check_why_adds_up(both_contrib, by_row)
    levels = field_levels(by_row.loc[both_contrib.index], both_contrib.columns)

    out = config.PROJECT_ROOT / "docs" / "data"
    (out / "seasons").mkdir(parents=True, exist_ok=True)

    def dump(obj: dict, path: Path) -> None:
        path.write_text(json.dumps(obj, separators=(",", ":")))

    dump(build_index(both, season_names()), out / "index.json")
    for s in sorted(both["season"].unique()):
        dump(build_season(both, both_contrib, int(s), levels), out / "seasons" / f"s{int(s):02d}.json")
    dump(build_insights(preds), out / "insights.json")
    dump(build_track(preds), out / "track.json")
    sanity_check(preds, out, live)
    total_kb = sum(f.stat().st_size for f in out.rglob("*.json")) / 1024
    print(f"wrote docs/data ({total_kb:.0f} KB)")


if __name__ == "__main__":
    main()
