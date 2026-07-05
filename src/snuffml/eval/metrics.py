"""Scoring for the per-episode win distributions. Everything here expects
alive-only rows with win_prob summing to 1 within each (season, episode)."""

from __future__ import annotations

import numpy as np
import pandas as pd

EPS = 1e-12


def snapshot_metrics(preds: pd.DataFrame) -> pd.DataFrame:
    # can only score snapshots where the eventual winner is actually among the
    # alive players; skips airing seasons and edge of extinction gaps
    winner_alive = preds.groupby(["season", "episode"])["is_winner"].transform("any")
    preds = preds[winner_alive]
    metric_cols = [
        "n_alive",
        "winner_rank",
        "reciprocal_rank",
        "top1",
        "top3",
        "winner_prob",
        "log_loss",
        "log_loss_uniform",
    ]
    if preds.empty:
        return pd.DataFrame(columns=["season", "episode", *metric_cols, "skill"])

    def _one(g: pd.DataFrame) -> pd.Series:
        g = g.sort_values("win_prob", ascending=False).reset_index(drop=True)
        n = len(g)
        winner_mask = g["is_winner"].to_numpy()
        rank = int(np.flatnonzero(winner_mask)[0]) + 1
        p_winner = float(g.loc[winner_mask, "win_prob"].iloc[0])
        return pd.Series(
            {
                "n_alive": n,
                "winner_rank": rank,
                "reciprocal_rank": 1.0 / rank,
                "top1": float(rank == 1),
                "top3": float(rank <= 3),
                "winner_prob": p_winner,
                "log_loss": -np.log(p_winner + EPS),
                "log_loss_uniform": -np.log(1.0 / n),
            }
        )

    out = (
        preds.groupby(["season", "episode"])
        .apply(_one, include_groups=False)
        .reset_index()
    )
    # skill = log-loss relative to the uniform-over-alive baseline, 0 means no
    # better than guessing
    out["skill"] = 1.0 - out["log_loss"] / out["log_loss_uniform"]
    return out


def summarize(snap: pd.DataFrame, by_frac_buckets: int = 4) -> pd.DataFrame:
    """means by season-progress bucket, quarters by default"""
    snap = snap.copy()
    n_eps = snap.groupby("season")["episode"].transform("max")
    frac = snap["episode"] / n_eps
    snap["progress"] = pd.cut(
        frac,
        bins=np.linspace(0, 1, by_frac_buckets + 1),
        labels=[f"q{i + 1}" for i in range(by_frac_buckets)],
        include_lowest=True,
    )
    return (
        snap.groupby("progress", observed=True)[
            ["winner_rank", "reciprocal_rank", "top1", "top3", "winner_prob", "skill"]
        ]
        .mean()
        .reset_index()
    )


def finale_metrics(snap: pd.DataFrame) -> pd.Series:
    """last snapshot per season, i.e. can it pick the winner out of the finalists"""
    last = snap.sort_values("episode").groupby("season").tail(1)
    return last[["winner_rank", "top1", "top3", "winner_prob", "skill"]].mean()
