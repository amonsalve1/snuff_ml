"""GRU winner model: shared per-player GRU, softmax over alive players.

One example = one (season, t) prefix, so episode prefixes multiply the data
(~46 seasons turns into ~600 examples). The masked softmax bakes in
one-winner-per-season.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.utils.data import Dataset

HIDDEN = 48
DROPOUT = 0.3
MIN_T = 2


def _era_matrix(era: str) -> list[float]:
    return [float(era == "middle"), float(era == "new")]


class SeasonTensors:
    """[P, T, d] tensors per season plus alive mask and winner index."""

    def __init__(self, df: pd.DataFrame, feature_cols: list[str], mean: np.ndarray, std: np.ndarray):
        self.seasons: dict[int, dict] = {}
        for season, g in df.groupby("season"):
            g = g.sort_values(["castaway_id", "episode"])
            players = sorted(g["castaway_id"].unique())
            episodes = sorted(g["episode"].unique())
            p_index = {p: i for i, p in enumerate(players)}
            e_index = {e: i for i, e in enumerate(episodes)}
            P, T, d = len(players), len(episodes), len(feature_cols)
            X = np.zeros((P, T, d + 2), dtype=np.float32)
            alive = np.zeros((P, T), dtype=bool)
            winner = np.full(P, False)
            feats = g[feature_cols].to_numpy(dtype=np.float32)
            feats = np.nan_to_num((feats - mean) / std, nan=0.0)
            era = _era_matrix(g["era"].iloc[0])
            for row, (_, r) in zip(feats, g.iterrows()):
                pi, ei = p_index[r["castaway_id"]], e_index[r["episode"]]
                X[pi, ei, :d] = row
                X[pi, ei, d:] = era
                alive[pi, ei] = bool(r["in_game"])
                if r["is_winner"]:
                    winner[pi] = True
            self.seasons[int(season)] = {
                "X": X,
                "alive": alive,
                "winner_idx": int(np.flatnonzero(winner)[0]) if winner.any() else -1,
                "players": players,
                "episodes": episodes,
            }


class SeasonPrefixDataset(Dataset):
    """(season, t) prefixes where the winner is still alive at t."""

    def __init__(self, tensors: SeasonTensors, seasons: list[int]):
        self.tensors = tensors
        self.items: list[tuple[int, int]] = []
        for s in seasons:
            data = tensors.seasons.get(s)
            if data is None or data["winner_idx"] < 0:
                continue
            for ti in range(MIN_T - 1, len(data["episodes"])):
                if data["alive"][data["winner_idx"], ti]:
                    self.items.append((s, ti))

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, i: int):
        s, ti = self.items[i]
        data = self.tensors.seasons[s]
        return {
            "X": torch.from_numpy(data["X"][:, : ti + 1, :]),
            "alive": torch.from_numpy(data["alive"][:, ti]),
            "winner_idx": data["winner_idx"],
        }


def _collate(batch: list[dict]):
    P = max(b["X"].shape[0] for b in batch)
    T = max(b["X"].shape[1] for b in batch)
    d = batch[0]["X"].shape[2]
    X = torch.zeros(len(batch), P, T, d)
    alive = torch.zeros(len(batch), P, dtype=torch.bool)
    winner = torch.zeros(len(batch), dtype=torch.long)
    for i, b in enumerate(batch):
        p, t, _ = b["X"].shape
        X[i, :p, -t:, :] = b["X"]  # left-pad time so the gru ends on episode t
        alive[i, :p] = b["alive"]
        winner[i] = b["winner_idx"]
    return X, alive, winner


class PlayerEncoder(nn.Module):
    def __init__(self, d_in: int):
        super().__init__()
        self.gru = nn.GRU(d_in, HIDDEN, num_layers=1, batch_first=True)
        self.head = nn.Sequential(
            nn.LayerNorm(HIDDEN), nn.Dropout(DROPOUT), nn.Linear(HIDDEN, 1)
        )

    def forward(self, X: torch.Tensor, alive: torch.Tensor) -> torch.Tensor:
        B, P, T, d = X.shape
        h, _ = self.gru(X.reshape(B * P, T, d))
        scores = self.head(h[:, -1, :]).reshape(B, P)
        return scores.masked_fill(~alive, float("-inf"))
