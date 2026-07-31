"""Exports the loso predictions to json for the docs/ site.

Reads reports/retrospective/preds_blend.parquet and
models/blend_through_s50.joblib, writes docs/data/index.json,
docs/data/seasons/sNN.json and docs/data/insights.json. Run
`snuffml study --loso` and `snuffml train` first.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from snuffml import config
from snuffml.models.sklearn_baseline import EraBlendModel, WinnerModel  # noqa: F401

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
    "is_female": ("gender prior helps here", "gender prior hurts here"),
    "female_x_share_cum": ("share-for-gender adjustment helps", "share-for-gender adjustment hurts"),
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
    return pd.DataFrame(x * clf.coef_[0], columns=names, index=rows.index)


def blend_contributions(blend: EraBlendModel, rows: pd.DataFrame) -> pd.DataFrame:
    # sqrt(p_pooled * p_era) is the mean of the two logits, so average the
    # contribution vectors where the era model applies
    contrib = logit_contributions(blend.pooled, rows)
    for era, m in blend.era_models.items():
        mask = rows["era"] == era
        if mask.any():
            era_c = logit_contributions(m, rows[mask])
            both = contrib.columns.intersection(era_c.columns)
            contrib.loc[mask, both] = (contrib.loc[mask, both] + era_c[both]) / 2
    return contrib


def top_k_why(contrib_row: pd.Series, k: int = 3) -> list[list]:
    row = contrib_row[[c for c in contrib_row.index if not c.startswith("era_")]]
    row = row[row.abs() > 1e-4].sort_values()
    down = row.head(k)
    up = row.tail(k).iloc[::-1]
    out = [[key, round(float(v), 3)] for key, v in up.items() if v > 0]
    out += [[key, round(float(v), 3)] for key, v in down.items() if v < 0]
    return out


def season_outcome(season_preds: pd.DataFrame) -> str:
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


def build_index(preds: pd.DataFrame) -> dict:
    seasons = []
    for s, g in preds.groupby("season"):
        eps = sorted(g["episode"].unique())
        w = g[g["is_winner"]]
        wname = str(w["castaway"].iloc[0]) if len(w) else "?"
        wprobs = []
        for e in eps:
            we = w[w["episode"] == e]
            wprobs.append(round(float(we["win_prob"].iloc[0]), 4) if len(we) else None)
        seasons.append(
            {
                "season": int(s),
                "era": config.era_of(int(s)),
                "episodes": len(eps),
                "winner": wname,
                "outcome": season_outcome(g),
                "winner_probs": wprobs,
            }
        )
    labels = {k: list(v) for k, v in FEATURE_LABELS.items()}
    return {"labels": labels, "seasons": seasons}


def build_season(preds: pd.DataFrame, contrib: pd.DataFrame, season: int) -> dict:
    g = preds[preds["season"] == season]
    eps = sorted(g["episode"].unique())
    players = []
    for cid, p in g.groupby("castaway_id"):
        p = p.sort_values("episode")
        by_ep = p.set_index("episode")
        boot = int(p["episode"].max())
        probs, whys = [], []
        for e in eps:
            if e in by_ep.index:
                probs.append(round(float(by_ep.loc[e, "win_prob"]), 4))
                whys.append(top_k_why(contrib.loc[by_ep.loc[e, "_row"]]))
            else:
                probs.append(None)
                whys.append(None)
        players.append(
            {
                "id": str(cid),
                "name": str(p["castaway"].iloc[0]),
                "winner": bool(p["is_winner"].any()),
                "boot": None if boot == max(eps) else boot,
                "probs": probs,
                "why": whys,
            }
        )
    players.sort(key=lambda pl: (-(pl["probs"][-1] or 0), pl["name"]))
    return {
        "season": season,
        "era": config.era_of(season),
        "episodes": [int(e) for e in eps],
        "outcome": season_outcome(g),
        "players": players,
    }


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


def sanity_check(preds: pd.DataFrame, out_dir: Path) -> None:
    season_files = sorted((out_dir / "seasons").glob("s*.json"))
    if len(season_files) != preds["season"].nunique():
        raise SystemExit(f"expected {preds['season'].nunique()} season files, got {len(season_files)}")
    n_rows = 0
    for f in season_files:
        data = json.loads(f.read_text())
        for e_i, e in enumerate(data["episodes"]):
            total = sum(p["probs"][e_i] for p in data["players"] if p["probs"][e_i] is not None)
            if abs(total - 1.0) > 1e-2:
                raise SystemExit(f"{f.name} episode {e}: probs sum to {total:.3f}")
        n_rows += sum(sum(x is not None for x in p["probs"]) for p in data["players"])
        if not any(p["winner"] for p in data["players"]):
            raise SystemExit(f"{f.name}: no winner")
    if n_rows != len(preds):
        raise SystemExit(f"exported {n_rows} alive rows, parquet has {len(preds)}")
    print(f"sanity ok: {len(season_files)} seasons, {n_rows} rows")


def main() -> None:
    preds = pd.read_parquet(config.REPORTS_DIR / "retrospective" / "preds_blend.parquet")
    # "last" aggregations below assume episode order within each player
    preds = preds.sort_values(["season", "castaway_id", "episode"]).reset_index(drop=True)
    preds["_row"] = preds.index
    blend = EraBlendModel.load(config.MODELS_DIR / "blend_through_s50.joblib")
    contrib = blend_contributions(blend, preds)

    out = config.PROJECT_ROOT / "docs" / "data"
    (out / "seasons").mkdir(parents=True, exist_ok=True)

    def dump(obj: dict, path: Path) -> None:
        path.write_text(json.dumps(obj, separators=(",", ":")))

    dump(build_index(preds), out / "index.json")
    for s in sorted(preds["season"].unique()):
        dump(build_season(preds, contrib, int(s)), out / "seasons" / f"s{int(s):02d}.json")
    dump(build_insights(preds), out / "insights.json")
    sanity_check(preds, out)
    total_kb = sum(f.stat().st_size for f in out.rglob("*.json")) / 1024
    print(f"wrote docs/data ({total_kb:.0f} KB)")


if __name__ == "__main__":
    main()
