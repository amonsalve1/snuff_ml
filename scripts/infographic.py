"""One-page infographic of the LOSO backtest: one small chart per season with
everyone's win-prob lines and the winner highlighted, plus the called/top-3
scoreboard.

Reads reports/retrospective/preds_blend.parquet (run `snuffml study --loso`
first), writes reports/infographic.png.
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from snuffml import config
from snuffml.eval import metrics

# okabe-ito, colorblind safe; the outcome badge is text anyway so color
# isn't the only cue
C_CALLED = "#009E73"
C_TOP3 = "#E69F00"
C_MISS = "#D55E00"
C_OTHERS = "#c9c9c4"
C_INK = "#26251f"
C_MUTED = "#8a887f"
SURFACE = "#fcfcfb"
ERA_TINT = {"old": "#ffffff", "middle": "#f5f4ef", "new": "#eef3f2"}


def outcome(season_preds: pd.DataFrame) -> tuple[str, str]:
    last = season_preds[season_preds["episode"] == season_preds["episode"].max()]
    last = last.sort_values("win_prob", ascending=False).reset_index(drop=True)
    if not last["is_winner"].any():
        # s38: chris won from the edge, not in the final alive snapshot
        return "edge return", C_MISS
    rank = last.index[last["is_winner"]][0] + 1
    if rank == 1:
        return "called", C_CALLED
    if rank <= 3:
        return f"top 3 (#{rank})", C_TOP3
    return f"missed (#{rank})", C_MISS


def main() -> None:
    preds = pd.read_parquet(config.REPORTS_DIR / "retrospective" / "preds_blend.parquet")
    snap = metrics.snapshot_metrics(preds)
    fin = metrics.finale_metrics(snap)
    seasons = sorted(preds["season"].unique())

    fig = plt.figure(figsize=(15, 21), facecolor=SURFACE)
    gs = fig.add_gridspec(
        10, 5, top=0.875, bottom=0.03, left=0.045, right=0.985, hspace=0.8, wspace=0.18
    )

    fig.text(0.045, 0.972, "does the edit know the winner?", fontsize=26, fontweight="bold", color=C_INK)
    fig.text(
        0.045,
        0.958,
        "win probability for every player after each episode, blend model, leave-one-season-out "
        "(the model never saw the season it's predicting)",
        fontsize=11,
        color=C_MUTED,
    )

    # scoreboard
    new_last = snap[snap["season"] >= 41]
    new_last = new_last[new_last["episode"] == new_last.groupby("season")["episode"].transform("max")]
    tiles = [
        (f"{fin.top1:.0%}", "of finales: winner was\nthe model's #1 pick", C_CALLED),
        (f"{fin.top3:.0%}", "of finales: winner\nin the top 3", C_TOP3),
        (f"{new_last.top1.mean():.0%}", "new era (s41+)\nwinners called", C_CALLED),
        (f"{fin.winner_prob:.0%}", "mean probability on\nthe winner at the finale", C_INK),
    ]
    for i, (num, label, color) in enumerate(tiles):
        x = 0.045 + i * 0.16
        fig.text(x, 0.925, num, fontsize=30, fontweight="bold", color=color)
        fig.text(x, 0.912, label, fontsize=9.5, color=C_MUTED, va="top")
    fig.text(
        0.70,
        0.938,
        "gray lines: everyone else in the season\ncolored line: the eventual winner\n"
        "badge: where the winner ranked at the finale\n"
        "tint: white = s1-20, warm = s21-40, cool = s41+",
        fontsize=10,
        color=C_MUTED,
        va="top",
    )

    for idx, season in enumerate(seasons):
        row, col = divmod(idx, 5)
        ax = fig.add_subplot(gs[row, col])
        sp = preds[preds["season"] == season]
        era = config.era_of(int(season))
        ax.set_facecolor(ERA_TINT[era])

        for cid, g in sp.groupby("castaway_id"):
            g = g.sort_values("episode")
            if not g["is_winner"].any():
                ax.plot(g["episode"], g["win_prob"], color=C_OTHERS, lw=0.9, zorder=1)
        w = sp[sp["is_winner"]].sort_values("episode")
        label, color = outcome(sp)
        ax.plot(w["episode"], w["win_prob"], color=color, lw=2.2, zorder=3)
        ax.plot(w["episode"].iloc[-1], w["win_prob"].iloc[-1], "o", color=color, ms=5, zorder=4)

        name = str(w["castaway"].iloc[0])
        ax.set_title(f"S{season}  {name}", fontsize=10, fontweight="bold", color=C_INK, loc="left", pad=2)
        ax.text(
            1.0,
            1.06,
            label,
            transform=ax.transAxes,
            fontsize=8,
            ha="right",
            color=color,
            fontweight="bold",
        )
        ax.set_ylim(0, max(0.55, float(sp["win_prob"].max()) * 1.05))
        ax.set_xlim(sp["episode"].min(), sp["episode"].max())
        ax.set_yticks([0, 0.25, 0.5])
        ax.set_yticklabels(["0", "25%", "50%"] if col == 0 else ["", "", ""], fontsize=7, color=C_MUTED)
        ax.set_xticks([])
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
        for s in ("left", "bottom"):
            ax.spines[s].set_color("#dddad2")
        ax.grid(axis="y", color="#e8e6df", lw=0.6, zorder=0)
        ax.tick_params(length=0)

    out = config.REPORTS_DIR / "infographic.png"
    fig.savefig(out, dpi=150, facecolor=SURFACE)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
