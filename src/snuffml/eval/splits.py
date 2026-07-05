"""CV splits. Always grouped by season, never by contestant."""

from __future__ import annotations

from collections.abc import Iterator

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

ERA_HOLDOUT_BOUNDARY = 41  # train <= S40, test S41+


def season_folds(
    df: pd.DataFrame, n_splits: int = 5
) -> Iterator[tuple[np.ndarray, np.ndarray]]:
    gkf = GroupKFold(n_splits=n_splits)
    yield from gkf.split(df, groups=df["season"].to_numpy())


def loso_folds(df: pd.DataFrame) -> Iterator[tuple[int, np.ndarray, np.ndarray]]:
    """yields (held_out_season, train_idx, test_idx)"""
    seasons = np.sort(df["season"].unique())
    s = df["season"].to_numpy()
    for season in seasons:
        test = np.flatnonzero(s == season)
        train = np.flatnonzero(s != season)
        yield int(season), train, test


def era_holdout(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    s = df["season"].to_numpy()
    return np.flatnonzero(s < ERA_HOLDOUT_BOUNDARY), np.flatnonzero(s >= ERA_HOLDOUT_BOUNDARY)
