"""Edit features from confessional counts.

No leakage: everything at episode t only uses episodes <= t. Cumulatives are
episode-sorted cumsums, shares/z-scores only look at the cross-section at t.
"""

from __future__ import annotations

import numpy as np
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
    "zero_any",
    "zero_any_x_new",
    "orig_tribe_over",
    "early_flag",
    "early_flag_x_new",
]

# computed but not in the default model set: the raw zero-conf count helps
# finale ranking but wrecks mid-season calibration, and current-tribe share
# tested neutral in cv (the original-tribe version made the cut). kept as
# columns for the study.
EXTRA_COLUMNS = ["zero_conf_eps", "tribe_share_ep", "tribe_share_cum"]


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

    # the "coronation" death flag: whoever leads cumulative confessional share
    # through episode 4 has never won in the new era (0 for 10 through s50),
    # the editors build that person up to dethrone them around merge/f7.
    # frozen at ep 4; before ep 4 it's the running leader, still causal
    alive_share = df["conf_share_cum"].where(df["in_game"])
    lead = (alive_share == alive_share.groupby([df["season"], df["episode"]]).transform("max")) & df[
        "in_game"
    ]
    at4 = df["episode"] == 4
    l4 = pd.Series(
        lead[at4].astype(float).to_numpy(),
        index=pd.MultiIndex.from_frame(df.loc[at4, ["season", "castaway_id"]]),
    )
    key = pd.MultiIndex.from_frame(df[["season", "castaway_id"]])
    lead_at_4 = pd.Series(l4.reindex(key).to_numpy(), index=df.index).fillna(0.0)
    df["early_flag"] = np.where(df["episode"] < 4, lead.astype(float), lead_at_4)
    df["early_flag_x_new"] = (df["era"] == "new").astype(float) * df["early_flag"]

    df["is_female"] = (df["gender"] == "Female").astype(float)
    df["female_x_share_cum"] = df["is_female"] * df["conf_share_cum"]
    new_era = (df["era"] == "new").astype(float)
    df["new_era_x_share_cum"] = new_era * df["conf_share_cum"]

    # episodes where you were in the game but got zero confessionals. in the
    # new era winners basically never have one (1 of 10 through s50), in the
    # old era it just tracked whether your tribe went to tribal, hence the era
    # interaction. the binary beat the raw count in cv (the count punishes
    # people too hard mid-season), count kept as a column only
    zero = (df["in_game"] & (df["conf_ep"] == 0)).astype(float)
    df["zero_conf_eps"] = zero.groupby([df["season"], df["castaway_id"]]).cumsum()
    df["zero_any"] = (df["zero_conf_eps"] > 0).astype(float)
    df["zero_any_x_new"] = new_era * df["zero_any"]

    # how much air your current tribe gets. a winner's tribe doesn't get buried
    # pre-merge. post-merge there's one tribe so this saturates to ~1
    tribe_total = df.groupby(["season", "episode", "tribe"], dropna=False)["conf_ep"].transform(
        "sum"
    )
    ep_total2 = df.groupby(["season", "episode"])["conf_ep"].transform("sum")
    df["tribe_share_ep"] = (tribe_total / ep_total2.where(ep_total2 > 0)).where(
        df["tribe"].notna()
    ).fillna(0.0)
    df["tribe_share_cum"] = df.groupby(by_player)["tribe_share_ep"].transform(
        lambda s: s.expanding().mean()
    )

    # sharper version: your ORIGINAL tribe's share of pre-merge confessionals
    # minus its fair share by headcount, frozen once the merge hits. winners
    # tend to come from the starting tribe the edit didn't bury. merge
    # detection is causal, one tribe left among alive players.
    df["_orig_tribe"] = df.groupby(by_player)["tribe"].transform("first")
    by_ep = (
        df[df["in_game"]]
        .groupby(["season", "episode"])["tribe"]
        .nunique()
        .rename("_nt")
        .reset_index()
        .sort_values(["season", "episode"])
    )
    by_ep["_pre"] = 1.0 - (by_ep["_nt"] == 1).astype(float).groupby(by_ep["season"]).cummax()
    df = df.merge(by_ep[["season", "episode", "_pre"]], on=["season", "episode"], how="left")
    df["_pre"] = df["_pre"].fillna(0.0)
    # accumulate at (season, episode, tribe) level, per-row cumsums would mix
    # in other castaways' future episodes
    ep_tribe = (
        df.assign(_pc=df["conf_ep"] * df["_pre"])
        .groupby(["season", "episode", "_orig_tribe"], dropna=False)["_pc"]
        .sum()
        .reset_index()
        .sort_values(["season", "_orig_tribe", "episode"])
    )
    ep_tribe["_tribe_pre_cum"] = ep_tribe.groupby(["season", "_orig_tribe"], dropna=False)[
        "_pc"
    ].cumsum()
    df = df.merge(
        ep_tribe[["season", "episode", "_orig_tribe", "_tribe_pre_cum"]],
        on=["season", "episode", "_orig_tribe"],
        how="left",
    )
    total_pre = (
        ep_tribe.groupby(["season", "episode"], as_index=False)["_pc"]
        .sum()
        .sort_values(["season", "episode"])
    )
    total_pre["_total_pre_cum"] = total_pre.groupby("season")["_pc"].cumsum()
    df = df.merge(
        total_pre[["season", "episode", "_total_pre_cum"]], on=["season", "episode"], how="left"
    )
    cast_n = df.groupby("season")["castaway_id"].transform("nunique")
    tribe_n = df.groupby(["season", "_orig_tribe"])["castaway_id"].transform("nunique")
    df["orig_tribe_over"] = (
        (df["_tribe_pre_cum"] / df["_total_pre_cum"].where(df["_total_pre_cum"] > 0))
        - tribe_n / cast_n
    ).fillna(0.0)

    return df.drop(
        columns=[
            "confessional_count",
            "confessional_time",
            "index_count",
            "_index",
            "_ep_float",
            "_orig_tribe",
            "_pre",
            "_tribe_pre_cum",
            "_total_pre_cum",
        ]
    )
