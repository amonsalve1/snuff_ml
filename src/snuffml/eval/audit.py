"""The checks a skeptical reader asks for, on the same leave-one-season-out
harness as the study. Writes reports/retrospective/audit_*.csv, which
scripts/story.py turns into the README's tables.

- ablation: which feature groups carry the result, and how much edgic adds on
  the seasons that actually have edgic
- outliers: the headline numbers with S41 (and S38) kept in training
- leaderboard: logit, hgb, gru and blend, same folds, same metrics
- chance: how likely each headline count is from random picking
- flag: whether the episode-4 confessional-leader pattern survives episodes 3
  and 5 and the older eras
- calibration: predicted odds against how often players actually won
"""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

import numpy as np
import pandas as pd

from snuffml import config
from snuffml.eval import metrics
from snuffml.features import build as build_mod
from snuffml.features import edgic as edgic_mod
from snuffml.features import edit, gameplay
from snuffml.models import sklearn_baseline as skb

OUT = config.REPORTS_DIR / "retrospective"
CONF = list(edit.EDIT_FEATURES)
GAME = list(gameplay.GAMEPLAY_FEATURES)
EDGIC = list(edgic_mod.EDGIC_FEATURES)
IMMUNITY = ["imm_early_cum", "imm_late_cum", "imm_early_x_old"]


@contextmanager
def only_features(cols: list[str]):
    """Train on a subset of the model's features. Both model families look the
    feature list up at fit time, so swapping the function is enough."""
    keep = set(cols)
    original = build_mod.feature_columns
    build_mod.feature_columns = lambda df: [c for c in original(df) if c in keep]
    try:
        yield
    finally:
        build_mod.feature_columns = original


@contextmanager
def outlier_seasons(seasons: set[int]):
    original = config.OUTLIER_SEASONS
    config.OUTLIER_SEASONS = set(seasons)
    try:
        yield
    finally:
        config.OUTLIER_SEASONS = original


def score(preds: pd.DataFrame, seasons: set[int] | None = None) -> dict:
    """Finale top-1 and top-3 counts plus log-loss skill, for the given seasons."""
    snap = metrics.snapshot_metrics(preds)
    if seasons is not None:
        snap = snap[snap["season"].isin(seasons)]
    last = snap.sort_values("episode").groupby("season").tail(1)
    return {
        "seasons": int(last["season"].nunique()),
        "called": int(last["top1"].sum()),
        "top3": int(last["top3"].sum()),
        "finale_skill": round(float(last["skill"].mean()), 3),
        "skill": round(float(snap["skill"].mean()), 3),
    }


def loso(df: pd.DataFrame, model: str = "blend") -> pd.DataFrame:
    if model == "gru":
        return gru_loso(df)
    return skb.cross_val_predictions(df, model, loso=True)


def gru_loso(df: pd.DataFrame, seeds: int = 3) -> pd.DataFrame:
    """Leave-one-season-out for the GRU, so it's judged on the same folds as
    the sklearn models instead of its own 5-fold split. Slow, ~30s a season."""
    from snuffml.models import torch_seq

    rows = skb.training_frame(df)
    out = []
    for season in sorted(rows["season"].unique()):
        m = torch_seq.train(df[df["season"] != season], seeds=seeds)
        out.append(m.predict(df[df["season"] == season]))
    return pd.concat(out, ignore_index=True)


def edgic_seasons(df: pd.DataFrame) -> set[int]:
    """Seasons with contemporaneous edgic for at least half their snapshots."""
    rows = skb.training_frame(df)
    share = rows.groupby("season")["edgic_available"].mean()
    return {int(s) for s, v in share.items() if v >= 0.5}


def ablation(df: pd.DataFrame) -> pd.DataFrame:
    new_era = {s for s in skb.training_frame(df)["season"].unique() if s >= 41}
    with_edgic = edgic_seasons(df)
    configs = [
        ("immunity only", IMMUNITY),
        ("game stats only", GAME),
        ("confessionals only", CONF),
        ("confessionals + game stats", CONF + GAME),
        ("+ edgic (the full model)", CONF + GAME + EDGIC),
    ]
    rows = []
    for name, cols in configs:
        with only_features(cols):
            preds = loso(df, "blend")
        rows.append({"features": name, "n_features": len(cols), **score(preds),
                     **{f"edgic_{k}": v for k, v in score(preds, with_edgic).items()},
                     **{f"new_{k}": v for k, v in score(preds, new_era).items()}})
    return pd.DataFrame(rows)


def outliers(df: pd.DataFrame) -> pd.DataFrame:
    new_era = {s for s in skb.training_frame(df)["season"].unique() if s >= 41}
    rows = []
    for name, seasons in [("S38 and S41 left out (published)", {38, 41}),
                          ("S41 kept in training", {38}), ("both kept in training", set())]:
        with outlier_seasons(seasons):
            preds = loso(df, "blend")
        rows.append({"training": name, **score(preds), **{f"new_{k}": v for k, v in score(preds, new_era).items()}})
    return pd.DataFrame(rows)


def leaderboard(df: pd.DataFrame, models=("logit", "hgb", "blend", "gru")) -> pd.DataFrame:
    rows = []
    for m in models:
        rows.append({"model": m, **score(loso(df, m))})
    return pd.DataFrame(rows)


def at_least(k: int, ps: list[float]) -> float:
    """P(at least k successes) for independent trials with probabilities ps."""
    dist = np.zeros(len(ps) + 1)
    dist[0] = 1.0
    for p in ps:
        dist[1:] = dist[1:] * (1 - p) + dist[:-1] * p
        dist[0] *= 1 - p
    return float(dist[k:].sum())


def chance(preds: pd.DataFrame) -> pd.DataFrame:
    """For each headline count: what random picking expects, and how often it
    would do at least as well. Random means a uniform pick among whoever is
    left at the final snapshot."""
    last_ep = preds.groupby("season")["episode"].transform("max")
    final = preds[preds["episode"] == last_ep]
    n = final.groupby("season").size()
    snap = metrics.snapshot_metrics(preds)
    last = snap.sort_values("episode").groupby("season").tail(1).set_index("season")
    rows = []
    for label, seasons in [("all", list(n.index)), ("new era", [s for s in n.index if s >= 41])]:
        p1 = [1 / n[s] for s in seasons]
        p3 = [min(3, n[s]) / n[s] for s in seasons]
        k1, k3 = int(last.loc[seasons, "top1"].sum()), int(last.loc[seasons, "top3"].sum())
        rows += [
            {"seasons": label, "claim": "called", "got": k1, "of": len(seasons),
             "chance_expects": round(sum(p1), 1), "p_at_least": at_least(k1, p1)},
            {"seasons": label, "claim": "top3", "got": k3, "of": len(seasons),
             "chance_expects": round(sum(p3), 1), "p_at_least": at_least(k3, p3)},
        ]
    return pd.DataFrame(rows)


def flag(df: pd.DataFrame) -> pd.DataFrame:
    """Does leading cumulative confessional share through episode k predict
    losing? Counted per era for k = 3, 4, 5, with what chance expects (a
    random alive player wins 1/n of the time)."""
    rows = skb.training_frame(df)
    out = []
    for era in ["old", "middle", "new"]:
        for k in (3, 4, 5):
            won = held = 0
            expect = []
            for _, g in rows[(rows["era"] == era) & (rows["episode"] == k)].groupby("season"):
                if g.empty:
                    continue
                leader = g.loc[g["conf_share_cum"].idxmax()]
                held += 1
                won += bool(leader["is_winner"])
                expect.append(1 / len(g))
            out.append({"era": era, "through_episode": k, "leaders_who_won": won, "seasons": held,
                        "chance_expects": round(sum(expect), 2),
                        "p_zero_by_chance": round(float(np.prod([1 - p for p in expect])), 2)})
    return pd.DataFrame(out)


def calibration(preds: pd.DataFrame) -> pd.DataFrame:
    """Odds against an even split, binned, against the rate those players won.
    Wilson 95% intervals; "actual" is the win rate over the bin's even split."""
    p = preds.copy()
    p["n"] = p.groupby(["season", "episode"])["win_prob"].transform("size")
    p["heat"] = p["win_prob"] * p["n"]
    bins = [0, 0.5, 0.8, 1.25, 2, 3, 99]
    labels = ["under 0.5x", "0.5-0.8x", "0.8-1.25x", "1.25-2x", "2-3x", "over 3x"]
    p["band"] = pd.cut(p["heat"], bins, right=False, labels=labels)
    rows = []
    for band, g in p.groupby("band", observed=True):
        n, w = len(g), int(g["is_winner"].sum())
        even = float((1 / g["n"]).mean())
        r, z = w / n, 1.96
        c = (r + z * z / (2 * n)) / (1 + z * z / n)
        h = z * np.sqrt(r * (1 - r) / n + z * z / (4 * n * n)) / (1 + z * z / n)
        rows.append({"band": band, "cases": n, "won": w, "said": round(float(g["heat"].mean()), 2),
                     "actual": round(r / even, 2), "lo": round(max(0.0, c - h) / even, 2), "hi": round((c + h) / even, 2)})
    return pd.DataFrame(rows)


def run(df: pd.DataFrame, *, gru: bool = True) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    preds = pd.read_parquet(OUT / "preds_blend.parquet")
    chance(preds).to_csv(OUT / "audit_chance.csv", index=False)
    calibration(preds).to_csv(OUT / "audit_calibration.csv", index=False)
    flag(df).to_csv(OUT / "audit_flag.csv", index=False)
    ablation(df).to_csv(OUT / "audit_ablation.csv", index=False)
    outliers(df).to_csv(OUT / "audit_outliers.csv", index=False)
    models = ("logit", "hgb", "blend", "gru") if gru else ("logit", "hgb", "blend")
    leaderboard(df, models).to_csv(OUT / "audit_leaderboard.csv", index=False)
    return OUT
