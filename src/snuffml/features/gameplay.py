"""Gameplay features from vote_history and advantage_movement. Weak winner
signals (voting accuracy, votes against, advantages) but real ones. All
cumulative, so nothing from future episodes."""

from __future__ import annotations

import pandas as pd

from snuffml.data import survivor2py

GAMEPLAY_FEATURES = [
    "vfb_cum",
    "vote_acc_cum",
    "votes_against_cum",
    "adv_events_cum",
]


def add_gameplay_features(panel: pd.DataFrame, *, fetch: bool = True) -> pd.DataFrame:
    vh = survivor2py.load_table("vote_history", fetch=fetch)
    adv = survivor2py.load_table("advantage_movement", fetch=fetch)

    votes = vh.dropna(subset=["episode"]).copy()
    votes["correct"] = (votes["vote_id"] == votes["voted_out_id"]) & votes["vote_id"].notna()
    per_ep = (
        votes.groupby(["season", "episode", "castaway_id"])
        .agg(votes_cast=("castaway_id", "size"), vfb=("correct", "sum"))
        .reset_index()
    )
    received = (
        votes.dropna(subset=["vote_id"])
        .groupby(["season", "episode", "vote_id"])
        .size()
        .rename("votes_received")
        .reset_index()
        .rename(columns={"vote_id": "castaway_id"})
    )
    adv_ep = (
        adv.dropna(subset=["episode"])
        .groupby(["season", "episode", "castaway_id"])
        .size()
        .rename("adv_events")
        .reset_index()
    )

    df = panel.merge(per_ep, on=["season", "episode", "castaway_id"], how="left")
    df = df.merge(received, on=["season", "episode", "castaway_id"], how="left")
    df = df.merge(adv_ep, on=["season", "episode", "castaway_id"], how="left")
    for col in ["votes_cast", "vfb", "votes_received", "adv_events"]:
        df[col] = df[col].fillna(0.0).astype(float)

    df = df.sort_values(["season", "castaway_id", "episode"]).reset_index(drop=True)
    g = df.groupby(["season", "castaway_id"])
    df["vfb_cum"] = g["vfb"].cumsum()
    votes_cast_cum = g["votes_cast"].cumsum()
    df["vote_acc_cum"] = (df["vfb_cum"] / votes_cast_cum.where(votes_cast_cum > 0)).fillna(0.0)
    df["votes_against_cum"] = g["votes_received"].cumsum()
    df["adv_events_cum"] = g["adv_events"].cumsum()

    return df.drop(columns=["votes_cast", "vfb", "votes_received", "adv_events"])
