"""Pretty output: rich table for the terminal plus a markdown file per episode."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from rich.console import Console
from rich.table import Table

from snuffml import config


def _delta_frame(preds: pd.DataFrame, season: int, episode: int) -> pd.DataFrame:
    now = preds[(preds["season"] == season) & (preds["episode"] == episode)].copy()
    prev = preds[(preds["season"] == season) & (preds["episode"] == episode - 1)]
    if len(prev):
        now = now.merge(
            prev[["castaway_id", "win_prob"]].rename(columns={"win_prob": "prev_prob"}),
            on="castaway_id",
            how="left",
        )
        now["delta"] = now["win_prob"] - now["prev_prob"]
    else:
        now["delta"] = float("nan")
    return now.sort_values("win_prob", ascending=False).reset_index(drop=True)


def render_terminal(preds: pd.DataFrame, season: int, episode: int, model_type: str) -> None:
    frame = _delta_frame(preds, season, episode)
    table = Table(title=f"Survivor S{season} - win probabilities after episode {episode} ({model_type})")
    table.add_column("#", justify="right")
    table.add_column("Player")
    table.add_column("Win prob", justify="right")
    table.add_column("chg vs prev ep", justify="right")
    for i, row in frame.iterrows():
        delta = "-" if pd.isna(row["delta"]) else f"{row['delta']:+.1%}"
        table.add_row(str(i + 1), str(row["castaway"]), f"{row['win_prob']:.1%}", delta)
    Console().print(table)


def write_markdown(preds: pd.DataFrame, season: int, episode: int, model_type: str) -> Path:
    frame = _delta_frame(preds, season, episode)
    out_dir = config.REPORTS_DIR / f"s{season}"
    out_dir.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Survivor S{season} - after episode {episode}",
        "",
        f"Model: `{model_type}`. Probabilities are normalized over alive players.",
        "",
        "| # | Player | Win prob | chg vs prev ep |",
        "|---:|---|---:|---:|",
    ]
    for i, row in frame.iterrows():
        delta = "-" if pd.isna(row["delta"]) else f"{row['delta']:+.1%}"
        lines.append(f"| {i + 1} | {row['castaway']} | {row['win_prob']:.1%} | {delta} |")
    path = out_dir / f"e{episode:02d}.md"
    path.write_text("\n".join(lines) + "\n")
    return path


def append_history(preds: pd.DataFrame, season: int, episode: int, model_type: str) -> Path:
    out_dir = config.REPORTS_DIR / f"s{season}"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "predictions.csv"
    snap = preds[(preds["season"] == season) & (preds["episode"] == episode)][
        ["season", "episode", "castaway_id", "castaway", "win_prob"]
    ].copy()
    snap["model"] = model_type
    if path.exists():
        hist = pd.read_csv(path)
        hist = hist[~((hist["episode"] == episode) & (hist["model"] == model_type))]
        snap = pd.concat([hist, snap], ignore_index=True)
    snap.to_csv(path, index=False)
    return path
