"""There's exactly one winner per season, so per-player probabilities get
renormalized over the alive players at each (season, episode)."""

from __future__ import annotations

import pandas as pd


def normalize_by_group(
    df: pd.DataFrame,
    prob_col: str = "raw_prob",
    group_cols: tuple[str, str] = ("season", "episode"),
    out_col: str = "win_prob",
) -> pd.DataFrame:
    """Rows should already be alive players only. All-zero groups go uniform."""
    df = df.copy()
    total = df.groupby(list(group_cols))[prob_col].transform("sum")
    size = df.groupby(list(group_cols))[prob_col].transform("size")
    df[out_col] = (df[prob_col] / total).where(total > 0, 1.0 / size)
    return df
