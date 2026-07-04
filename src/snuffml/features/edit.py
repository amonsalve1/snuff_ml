"""Edit features from confessional counts.

No leakage: everything at episode t only uses episodes <= t. Cumulatives are
episode-sorted cumsums, shares/z-scores only look at the cross-section at t.
"""

from __future__ import annotations

import pandas as pd

from snuffml.data import survivor2py

EDIT_FEATURES = [
    "conf_ep",
    "conf_time_ep",
    "has_time",
    "conf_cum",
    "conf_share_ep",
    "conf_share_cum",
    "conf_z_cum",
    "index_resid_cum",
    "premiere_share",
    "late_clustering",
    "conf_trend",
    "is_female",
    "female_x_share_cum",
    "new_era_x_share_cum",
]


def _expanding_slope(df: pd.DataFrame, group_keys: list[str], x: str, y: str) -> pd.Series:
    # running ols slope of y on x, only rows up to the current one
    g = df.groupby(group_keys)
    n = g.cumcount() + 1
    sx = g[x].cumsum()
    sy = g[y].cumsum()
    sxx = df.assign(_v=df[x] * df[x]).groupby(group_keys)["_v"].cumsum()
    sxy = df.assign(_v=df[x] * df[y]).groupby(group_keys)["_v"].cumsum()
    denom = n * sxx - sx * sx
    slope = (n * sxy - sx * sy) / denom.where(denom != 0)
    return slope.fillna(0.0)


def add_edit_features(panel: pd.DataFrame, *, fetch: bool = True) -> pd.DataFrame:
    conf = survivor2py.load_table("confessionals", fetch=fetch)
    conf = conf[
        ["season", "episode", "castaway_id", "confessional_count", "confessional_time", "index_count"]
    ].copy()

    df = panel.merge(conf, on=["season", "episode", "castaway_id"], how="left")
    df = df.sort_values(["season", "castaway_id", "episode"]).reset_index(drop=True)

    df["conf_ep"] = df["confessional_count"].fillna(0.0)
    df["conf_time_ep"] = df["confessional_time"]
    # timing only counts for an episode if somebody in it was actually timed
    ep_has_time = df.groupby(["season", "episode"])["conf_time_ep"].transform(
        lambda s: s.notna().any()
    )
    df["has_time"] = ep_has_time.astype(float)
    df.loc[ep_has_time, "conf_time_ep"] = df.loc[ep_has_time, "conf_time_ep"].fillna(0.0)

    by_player = ["season", "castaway_id"]
    df["conf_cum"] = df.groupby(by_player)["conf_ep"].cumsum()

    ep_total = df.groupby(["season", "episode"])["conf_ep"].transform("sum")
    df["conf_share_ep"] = (df["conf_ep"] / ep_total.where(ep_total > 0)).fillna(0.0)

    # denominator = everything aired through t
    season_cum_total = df["conf_cum"].groupby([df["season"], df["episode"]]).transform("sum")
    df["conf_share_cum"] = (df["conf_cum"] / season_cum_total.where(season_cum_total > 0)).fillna(
        0.0
    )

    # z among alive players only
    alive_cum = df["conf_cum"].where(df["in_game"])
    alive_mu = alive_cum.groupby([df["season"], df["episode"]]).transform("mean")
    alive_sd = alive_cum.groupby([df["season"], df["episode"]]).transform("std")
    df["conf_z_cum"] = ((df["conf_cum"] - alive_mu) / alive_sd.where(alive_sd > 0)).fillna(0.0)

    # index_count = survivoR's observed/expected confessional ratio; running mean
    # of it is basically "camera likes them more than it needs to"
    df["_index"] = df["index_count"].fillna(1.0)
    df["index_resid_cum"] = df.groupby(by_player)["_index"].transform(
        lambda s: s.expanding().mean()
    )

    premiere = df[df["episode"] == 1][["season", "castaway_id", "conf_share_ep"]].rename(
        columns={"conf_share_ep": "premiere_share"}
    )
    df = df.merge(premiere, on=["season", "castaway_id"], how="left")
    df["premiere_share"] = df["premiere_share"].fillna(0.0)

    last3 = df.groupby(by_player)["conf_share_ep"].transform(
        lambda s: s.rolling(3, min_periods=1).mean()
    )
    df["late_clustering"] = last3 - df["conf_share_cum"]

    df["_ep_float"] = df["episode"].astype(float)
    df["conf_trend"] = _expanding_slope(df, by_player, "_ep_float", "conf_share_ep")

    df["is_female"] = (df["gender"] == "Female").astype(float)
    df["female_x_share_cum"] = df["is_female"] * df["conf_share_cum"]
    df["new_era_x_share_cum"] = (df["era"] == "new").astype(float) * df["conf_share_cum"]

    return df.drop(
        columns=["confessional_count", "confessional_time", "index_count", "_index", "_ep_float"]
    )
