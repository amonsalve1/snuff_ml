"""Edgic features, only for seasons that have coverage.

Causal cumulatives over rated episodes <= t. Uncovered seasons stay NaN with
edgic_available=0 (hgb eats NaN fine, logit imputes 0). Contemporaneous
ratings only unless allow_retrospective.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from snuffml.data import edgic as edgic_data

EDGIC_FEATURES = [
    "edgic_available",
    "cp_share",
    "cpx_count",
    "ott_count",
    "inv_count",
    "utr_share",
    "tone_consistency",
    "tone_flips",
    "visibility_mean",
    "visibility_z",
]

_TONE_VALUE = {"NN": -2.0, "N": -1.0, "M": 0.0, "P": 1.0, "PP": 2.0}


def add_edgic_features(
    panel: pd.DataFrame, ratings: pd.DataFrame | None = None, *, allow_retrospective: bool = False
) -> pd.DataFrame:
    if ratings is None:
        ratings = edgic_data.load()  # raises FileNotFoundError if never built
    if not allow_retrospective:
        ratings = ratings[ratings["contemporaneous"]]

    df = panel.copy()
    if ratings.empty:
        df["edgic_available"] = 0.0
        for col in EDGIC_FEATURES[1:]:
            df[col] = np.nan
        return df

    r = ratings[["season", "episode", "castaway_id", "rating", "tone", "visibility"]].copy()
    r["tone_val"] = r["tone"].map(_TONE_VALUE)
    df = df.merge(r, on=["season", "episode", "castaway_id"], how="left")
    df = df.sort_values(["season", "castaway_id", "episode"]).reset_index(drop=True)

    g = ["season", "castaway_id"]
    rated = df["rating"].notna()
    df["_rated"] = rated.astype(float)
    rated_cum = df.groupby(g)["_rated"].cumsum()

    def _cum_flag(flag: pd.Series) -> pd.Series:
        return flag.astype(float).groupby([df["season"], df["castaway_id"]]).cumsum()

    cp_cum = _cum_flag(df["rating"] == "CP")
    df["cp_share"] = (cp_cum / rated_cum.where(rated_cum > 0)).where(rated_cum > 0)
    df["cpx_count"] = _cum_flag((df["rating"] == "CP") & (df["visibility"] >= 4))
    df["ott_count"] = _cum_flag(df["rating"] == "OTT")
    df["inv_count"] = _cum_flag(df["rating"] == "INV")
    utr_cum = _cum_flag(df["rating"] == "UTR")
    df["utr_share"] = (utr_cum / rated_cum.where(rated_cum > 0)).where(rated_cum > 0)

    pos_cum = _cum_flag(df["tone_val"] > 0)
    toned_cum = _cum_flag(df["tone_val"].notna())
    df["tone_consistency"] = (pos_cum / toned_cum.where(toned_cum > 0)).where(toned_cum > 0)

    # tone flip = sign change vs the previous toned episode
    tone_sign = np.sign(df["tone_val"])
    prev_sign = (
        tone_sign.where(df["tone_val"].notna())
        .groupby([df["season"], df["castaway_id"]])
        .ffill()
        .groupby([df["season"], df["castaway_id"]])
        .shift(1)
    )
    flip = ((tone_sign * prev_sign) < 0).astype(float)
    df["tone_flips"] = flip.groupby([df["season"], df["castaway_id"]]).cumsum()

    vis_cum = df.groupby(g)["visibility"].transform(lambda s: s.expanding().mean())
    df["visibility_mean"] = vis_cum
    alive_vis = df["visibility_mean"].where(df["in_game"])
    mu = alive_vis.groupby([df["season"], df["episode"]]).transform("mean")
    sd = alive_vis.groupby([df["season"], df["episode"]]).transform("std")
    df["visibility_z"] = ((df["visibility_mean"] - mu) / sd.where(sd > 0)).where(sd.notna())

    covered = df["season"].isin(edgic_data.covered_seasons(ratings))
    df["edgic_available"] = (covered & (rated_cum > 0)).astype(float)

    return df.drop(columns=["rating", "tone", "visibility", "tone_val", "_rated"])
