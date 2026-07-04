"""Base panel: one row per (season, episode, castaway_id).

in_game = alive in the main game entering the episode; Edge/Redemption people
drop out and come back on their own. Label columns are targets only, never
features (there's a manifest check in tests for this).
"""

from __future__ import annotations

import pandas as pd

from snuffml import config
from snuffml.data import survivor2py

LABEL_COLUMNS = ["is_winner", "made_merge", "made_ftc", "jury_vote_share", "result_order"]
STATE_COLUMNS = ["in_game", "n_alive", "final_n", "episode_frac", "era", "gender"]


def _alive_by_episode(boot_mapping: pd.DataFrame) -> pd.DataFrame:
    # first sog of an episode = the entering-the-episode state
    bm = boot_mapping.dropna(subset=["episode", "sog_id"]).copy()
    first_sog = bm.groupby(["season", "episode"])["sog_id"].transform("min")
    entering = bm[bm["sog_id"] == first_sog].copy()
    entering["in_game"] = entering["game_status"] == "In the game"
    out = (
        entering.groupby(["season", "episode", "castaway_id"], as_index=False)
        .agg(in_game=("in_game", "any"), final_n=("final_n", "first"))
    )
    n_alive = (
        out[out["in_game"]]
        .groupby(["season", "episode"])["castaway_id"]
        .size()
        .rename("n_alive")
        .reset_index()
    )
    return out.merge(n_alive, on=["season", "episode"], how="left")


def build_panel(*, fetch: bool = True) -> pd.DataFrame:
    castaways = survivor2py.load_table("castaways", fetch=fetch)
    boot_mapping = survivor2py.load_table("boot_mapping", fetch=fetch)
    episodes = survivor2py.load_table("episodes", fetch=fetch)
    jury_votes = survivor2py.load_table("jury_votes", fetch=fetch)
    details = survivor2py.load_table("castaway_details", fetch=fetch)

    alive = _alive_by_episode(boot_mapping)

    ep = episodes.dropna(subset=["episode"])[["season", "episode"]].drop_duplicates()
    # castaways can have dup rows (quit/return, Edge re-entry), keep the final result
    cast = (
        castaways.sort_values("order")
        .groupby(["season", "castaway_id"], as_index=False)
        .agg(
            castaway=("castaway", "last"),
            is_winner=("winner", "any"),
            made_ftc=("finalist", "any"),
            was_jury=("jury", "any"),
            result_order=("order", "max"),
        )
    )
    grid = ep.merge(cast, on="season", how="inner")

    panel = grid.merge(alive, on=["season", "episode", "castaway_id"], how="left")
    panel["in_game"] = panel["in_game"].fillna(False)
    panel["final_n"] = panel.groupby("season")["final_n"].transform("first")
    panel["n_alive"] = (
        panel.groupby(["season", "episode"])["n_alive"].transform("max").astype("Int64")
    )

    n_eps = panel.groupby("season")["episode"].transform("max")
    panel["episode_frac"] = panel["episode"].astype(float) / n_eps.astype(float)
    panel["era"] = panel["season"].map(lambda s: config.era_of(int(s)))

    gender = details.drop_duplicates("castaway_id")[["castaway_id", "gender"]]
    panel = panel.merge(gender, on="castaway_id", how="left")

    # no direct merge flag in survivoR; jury-or-finalist is close enough
    panel["made_merge"] = panel["was_jury"] | panel["made_ftc"]
    panel = panel.drop(columns=["was_jury"])

    # jury vote share, label only
    jv = (
        jury_votes.groupby(["season", "finalist_id"])["vote"]
        .sum()
        .reset_index()
        .rename(columns={"finalist_id": "castaway_id", "vote": "jury_votes_received"})
    )
    jv["jury_vote_share"] = jv["jury_votes_received"] / jv.groupby("season")[
        "jury_votes_received"
    ].transform("sum")
    panel = panel.merge(
        jv[["season", "castaway_id", "jury_vote_share"]],
        on=["season", "castaway_id"],
        how="left",
    )

    panel["season"] = panel["season"].astype(int)
    panel["episode"] = panel["episode"].astype(int)
    return panel.sort_values(["season", "episode", "castaway_id"]).reset_index(drop=True)
