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
FEATURE_LABELS: dict[str, tuple[str, str]] = {
    "conf_ep": ("big confessional episode", "quiet episode"),
    "conf_time_ep": ("lots of confessional screen time", "little confessional screen time"),
    "has_time": ("timing data exists this season", "no timing data this season"),
    "conf_cum": ("many confessionals so far", "few confessionals so far"),
    "conf_share_ep": ("large share of this episode", "small share of this episode"),
    "conf_share_cum": ("large cumulative confessional share", "small cumulative confessional share"),
    "conf_z_cum": ("well above average airtime", "well below average airtime"),
    "index_resid_cum": ("camera likes them beyond game events", "camera avoids them given game events"),
    "premiere_share": ("strong premiere presence", "invisible premiere"),
    "late_clustering": ("airtime clustering late", "airtime fading late"),
    "conf_trend": ("rising confessional trend", "falling confessional trend"),
    "is_female": ("women tend to win with quieter edits", "men tend to need louder edits to win"),
    "female_x_share_cum": ("her airtime beats the quieter-edit bar", "airtime adjusted for how their gender gets edited"),
    "new_era_x_share_cum": ("high share in the new era", "low share in the new era"),
    "zero_any": ("no zero-confessional episodes", "has a zero-confessional episode"),
    "zero_any_x_new": ("clean sheet in the new era", "zero-confessional episode in the new era - near fatal"),
    "orig_tribe_over": ("starting tribe got the airtime", "starting tribe got buried"),
    "early_flag": ("early confessional frontrunner", "not the early frontrunner"),
    "early_flag_x_new": ("early frontrunner in the new era - historically a curse", "early frontrunner in the new era - historically a curse"),
    "vfb_cum": ("votes with the majority", "votes against the majority"),
    "vote_acc_cum": ("high voting accuracy", "low voting accuracy"),
    "votes_against_cum": ("collects votes at tribal", "rarely receives votes"),
    "adv_events_cum": ("finds advantages", "no advantage story"),
    "imm_early_cum": ("early merge immunity wins", "no early merge immunities"),
    "imm_late_cum": ("late merge immunity wins", "no late merge immunities"),
    "imm_early_x_old": ("early immunity in the old era - threat signal", "early immunity in the old era - threat signal"),
    "edgic_available": ("edgic coverage exists", "no edgic coverage"),
    "cp_share": ("complex-personality edit", "one-note edit"),
    "cpx_count": ("high-visibility complex episodes", "no big complex episodes"),
    "ott_count": ("over-the-top episodes - winners rarely have them", "no over-the-top episodes"),
    "inv_count": ("invisible episodes", "never invisible"),
    "utr_share": ("under-the-radar edit", "rarely under the radar"),
    "tone_consistency": ("consistently positive tone", "negative or mixed tone"),
    "tone_flips": ("tone flip-flops", "steady tone"),
    "visibility_mean": ("high edgic visibility", "low edgic visibility"),
    "visibility_z": ("more visible than the cast", "less visible than the cast"),
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

    model = EraBlendModel.load(model_path("blend", max(done)))
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


def top_k_why(contrib_row: pd.Series, k: int = 6) -> list[list]:
    """The k biggest pushes either way, biggest first."""
    row = contrib_row[[c for c in contrib_row.index if not c.startswith("era_")]]
    row = row[row.abs() > 1e-4]
    row = row.reindex(row.abs().sort_values(ascending=False).index).head(k)
    return [[key, round(float(v), 3)] for key, v in row.items()]


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
        gone = v["voted_out"].dropna().unique()
        if len(gone):
            out["just_out"] = str(gone[0])
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
            wprobs.append(round(float(we["win_prob"].iloc[0]), 4) if len(we) else None)
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


def build_season(preds: pd.DataFrame, contrib: pd.DataFrame, season: int) -> dict:
    g = preds[preds["season"] == season]
    eps = sorted(g["episode"].unique())
    live = season_is_live(g)
    # in a live season the newest episode is also the last one in the data, so
    # whoever went home in it would read as still in. the vote history knows.
    just_out = live_notes(season, [int(e) for e in eps]).get("just_out") if live else None
    players = []
    for cid, p in g.groupby("castaway_id"):
        p = p.sort_values("episode")
        by_ep = p.set_index("episode")
        boot = int(p["episode"].max())
        probs, whys, rest, total = [], [], [], []
        for e in eps:
            if e in by_ep.index:
                r = by_ep.loc[e, "_row"]
                probs.append(round(float(by_ep.loc[e, "win_prob"]), 4))
                top = top_k_why(contrib.loc[r])
                whys.append(top)
                # what the shown rows leave out, so the panel always adds up
                # to the total: the smaller features plus whatever the linear
                # read misses at the top of the sigmoid
                tot = float(by_ep.loc[e, "_vs_field"])
                total.append(round(tot, 3))
                rest.append(round(tot - sum(v for _, v in top), 3))
            else:
                probs.append(None)
                whys.append(None)
                rest.append(None)
                total.append(None)
        name = str(p["castaway"].iloc[0])
        players.append(
            {
                "id": str(cid),
                "name": name,
                "winner": bool(p["is_winner"].any()),
                # several people can go home inside a finale episode, so being
                # alive at its start doesn't mean reaching final tribal
                "ftc": bool(p["made_ftc"].any()) if "made_ftc" in p else None,
                "boot": boot if name == just_out else None if boot == max(eps) else boot,
                "probs": probs,
                "why": whys,
                "why_rest": rest,
                "why_total": total,
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
    both_contrib = relative_to_field(both_contrib, by_row)
    check_why_adds_up(both_contrib, by_row)

    out = config.PROJECT_ROOT / "docs" / "data"
    (out / "seasons").mkdir(parents=True, exist_ok=True)

    def dump(obj: dict, path: Path) -> None:
        path.write_text(json.dumps(obj, separators=(",", ":")))

    dump(build_index(both, season_names()), out / "index.json")
    for s in sorted(both["season"].unique()):
        dump(build_season(both, both_contrib, int(s)), out / "seasons" / f"s{int(s):02d}.json")
    dump(build_insights(preds), out / "insights.json")
    sanity_check(preds, out, live)
    total_kb = sum(f.stat().st_size for f in out.rglob("*.json")) / 1024
    print(f"wrote docs/data ({total_kb:.0f} KB)")


if __name__ == "__main__":
    main()
