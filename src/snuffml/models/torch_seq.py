"""GRU winner model: shared per-player GRU, softmax over alive players.

One example = one (season, t) prefix, so episode prefixes multiply the data
(~46 seasons turns into ~600 examples). The masked softmax bakes in
one-winner-per-season. Kept deliberately small (hidden 48, one layer, dropout,
noise, seed averaging) because there just isn't much data.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from torch import nn
from torch.utils.data import DataLoader, Dataset

from snuffml import config
from snuffml.features import build as build_mod
from snuffml.models.normalize import normalize_by_group
from snuffml.models.sklearn_baseline import training_frame

HIDDEN = 48
DROPOUT = 0.3
NOISE_SIGMA = 0.05
LR = 1e-3
WEIGHT_DECAY = 1e-2
MAX_EPOCHS = 200
PATIENCE = 15
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


@dataclass
class GRUWinnerModel:
    feature_cols: list[str]
    mean: np.ndarray
    std: np.ndarray
    state_dicts: list[dict]  # one per seed, averaged at predict time
    trained_through: int

    def _models(self) -> list[PlayerEncoder]:
        models = []
        for sd in self.state_dicts:
            m = PlayerEncoder(len(self.feature_cols) + 2)
            m.load_state_dict(sd)
            m.eval()
            models.append(m)
        return models

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        tensors = SeasonTensors(df, self.feature_cols, self.mean, self.std)
        models = self._models()
        out = []
        for season, data in tensors.seasons.items():
            X_full = torch.from_numpy(data["X"])
            for ti, episode in enumerate(data["episodes"]):
                alive = torch.from_numpy(data["alive"][:, ti])
                if not alive.any():
                    continue
                X = X_full[:, : ti + 1, :].unsqueeze(0)
                with torch.no_grad():
                    probs = torch.stack(
                        [
                            F.softmax(m(X, alive.unsqueeze(0)), dim=-1).squeeze(0)
                            for m in models
                        ]
                    ).mean(0)
                alive_idx = np.flatnonzero(data["alive"][:, ti])
                for pi in alive_idx:
                    out.append(
                        {
                            "season": season,
                            "episode": episode,
                            "castaway_id": data["players"][pi],
                            "raw_prob": float(probs[pi]),
                        }
                    )
        preds = pd.DataFrame(out)
        keys = ["season", "episode", "castaway_id"]
        extra = [c for c in ["castaway", "is_winner", "in_game"] if c in df.columns]
        preds = preds.merge(df[keys + extra], on=keys, how="left")
        preds = preds[preds["in_game"]]
        return normalize_by_group(preds)

    def save(self, path: Path) -> None:
        torch.save(
            {
                "feature_cols": self.feature_cols,
                "mean": self.mean,
                "std": self.std,
                "state_dicts": self.state_dicts,
                "trained_through": self.trained_through,
            },
            path,
        )

    @staticmethod
    def load(path: Path) -> "GRUWinnerModel":
        blob = torch.load(path, weights_only=False)
        return GRUWinnerModel(**blob)


def _fit_one_seed(
    seed: int,
    tensors: SeasonTensors,
    train_seasons: list[int],
    val_seasons: list[int],
) -> dict:
    torch.manual_seed(seed)
    model = PlayerEncoder(next(iter(tensors.seasons.values()))["X"].shape[2])
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    train_dl = DataLoader(
        SeasonPrefixDataset(tensors, train_seasons),
        batch_size=32,
        shuffle=True,
        collate_fn=_collate,
    )
    val_dl = DataLoader(
        SeasonPrefixDataset(tensors, val_seasons),
        batch_size=64,
        shuffle=False,
        collate_fn=_collate,
    )
    best_state, best_val, patience = None, float("inf"), 0
    for _epoch in range(MAX_EPOCHS):
        model.train()
        for X, alive, winner in train_dl:
            X = X + torch.randn_like(X) * NOISE_SIGMA
            loss = F.cross_entropy(model(X, alive), winner)
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        model.eval()
        with torch.no_grad():
            losses = [
                F.cross_entropy(model(X, alive), winner, reduction="sum").item()
                for X, alive, winner in val_dl
            ]
            n = sum(len(w) for _, _, w in val_dl)
        val = sum(losses) / max(n, 1)
        if val < best_val - 1e-4:
            best_val, patience = val, 0
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
            if patience >= PATIENCE:
                break
    return best_state if best_state is not None else model.state_dict()


def train(
    df: pd.DataFrame,
    *,
    through_season: int | None = None,
    seeds: int = 5,
    val_fraction: float = 0.15,
) -> GRUWinnerModel:
    feature_cols = build_mod.feature_columns(df)
    rows = training_frame(df)
    if through_season is not None:
        rows = rows[rows["season"] <= through_season]
    seasons = sorted(rows["season"].unique())

    # standardize on training alive rows only
    train_feats = rows[feature_cols].to_numpy(dtype=np.float32)
    mean = np.nanmean(train_feats, axis=0)
    std = np.nanstd(train_feats, axis=0)
    std[std == 0] = 1.0

    season_df = df[df["season"].isin(seasons)]
    tensors = SeasonTensors(season_df, feature_cols, mean, std)

    rng = np.random.default_rng(0)
    n_val = max(2, int(len(seasons) * val_fraction))
    val_seasons = list(rng.choice(seasons, size=n_val, replace=False))
    train_seasons = [s for s in seasons if s not in val_seasons]

    state_dicts = [
        _fit_one_seed(seed, tensors, train_seasons, val_seasons) for seed in range(seeds)
    ]
    return GRUWinnerModel(
        feature_cols=feature_cols,
        mean=mean,
        std=std,
        state_dicts=state_dicts,
        trained_through=int(max(seasons)),
    )


def cross_val_predictions(df: pd.DataFrame, *, n_splits: int = 5, seeds: int = 3) -> pd.DataFrame:
    """season-grouped oof preds, same harness as the sklearn side"""
    rows = training_frame(df)
    seasons = np.array(sorted(rows["season"].unique()))
    rng = np.random.default_rng(0)
    rng.shuffle(seasons)
    folds = np.array_split(seasons, n_splits)
    preds = []
    for fold in folds:
        train_df = df[df["season"].isin(set(rows["season"].unique()) - set(fold))]
        m = train(train_df, seeds=seeds)
        test_df = df[df["season"].isin(fold)]
        preds.append(m.predict(test_df))
    return pd.concat(preds, ignore_index=True)


def model_path(through_season: int) -> Path:
    return config.MODELS_DIR / f"gru_through_s{through_season}.pt"
