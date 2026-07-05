"""Replay a completed season episode by episode. The model is trained without
the replayed season, so every snapshot is honest out-of-sample."""

from __future__ import annotations

import pandas as pd
from rich.console import Console
from rich.table import Table

from snuffml.models import sklearn_baseline as skb


def replay_season(df: pd.DataFrame, season: int, model: str = "hgb") -> pd.DataFrame:
    season_df = df[df["season"] == season]
    if season_df.empty:
        raise ValueError(f"no data for season {season}")
    if model == "gru":
        from snuffml.models import torch_seq

        m = torch_seq.train(df[df["season"] != season])
    else:
        m = skb.train(df[df["season"] != season], model)
    return m.predict(season_df)


def render_replay(preds: pd.DataFrame, season: int, model: str, top_n: int = 5) -> None:
    console = Console()
    episodes = sorted(preds["episode"].unique())
    table = Table(title=f"S{season} replay ({model}) - top {top_n} by episode")
    table.add_column("Ep", justify="right")
    table.add_column("Alive", justify="right")
    table.add_column(f"Top {top_n} (win prob)")
    winner = preds.loc[preds["is_winner"], "castaway"].iloc[0] if preds["is_winner"].any() else None
    for ep in episodes:
        snap = preds[preds["episode"] == ep].sort_values("win_prob", ascending=False)
        tops = ", ".join(
            f"[bold]{r.castaway}[/bold] {r.win_prob:.0%}"
            if winner is not None and r.castaway == winner
            else f"{r.castaway} {r.win_prob:.0%}"
            for r in snap.head(top_n).itertuples()
        )
        table.add_row(str(ep), str(len(snap)), tops)
    console.print(table)
    if winner is not None:
        traj = preds[preds["is_winner"]].sort_values("episode")
        console.print(
            f"\nWinner [bold]{winner}[/bold] trajectory: "
            + " -> ".join(f"e{int(r.episode)}:{r.win_prob:.0%}" for r in traj.itertuples())
        )
