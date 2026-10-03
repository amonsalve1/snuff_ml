"""The forward test: log the frozen model's season 51 predictions, one block per
aired episode, before anyone knows who wins.

The backtest over seasons 1-50 was built with every season visible, so it can
only ever be a replay. This log is the part that can't be tuned after the fact:
the model in forward/ is frozen (its sha256 is checked before every run), rows
are only ever appended, and each block is stamped with the day it was logged.

    uv run python scripts/forward_log.py
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORWARD = ROOT / "forward"
LOG = FORWARD / "s51.csv"
FIELDS = ["logged_on", "episode", "rank", "castaway", "win_prob", "alive", "model_sha256"]


def frozen():
    meta = json.loads((FORWARD / "FROZEN.json").read_text())
    path = ROOT / meta["model"]
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != meta["sha256"]:
        raise SystemExit(f"{path.name} doesn't match FROZEN.json ({digest[:12]} vs {meta['sha256'][:12]}); refusing to log")
    return path, meta


def logged_episodes() -> set[int]:
    if not LOG.exists():
        return set()
    with LOG.open() as f:
        return {int(r["episode"]) for r in csv.DictReader(f)}


def main(season: int = 51) -> None:
    sys.path.insert(0, str(ROOT / "src"))
    from snuffml.features import build as build_mod
    from snuffml.models.sklearn_baseline import EraBlendModel

    path, meta = frozen()
    model = EraBlendModel.load(path)
    df = build_mod.load_features()
    rows = model.predict(df[df["season"] == season])
    done = logged_episodes()
    new = []
    for ep, g in rows.groupby("episode"):
        if int(ep) in done:
            continue
        g = g.sort_values("win_prob", ascending=False).reset_index(drop=True)
        for i, r in g.iterrows():
            new.append({"logged_on": date.today().isoformat(), "episode": int(ep), "rank": i + 1,
                        "castaway": r["castaway"], "win_prob": round(float(r["win_prob"]), 4),
                        "alive": len(g), "model_sha256": meta["sha256"][:12]})
    if not new:
        print("nothing new to log")
        return
    first = not LOG.exists()
    with LOG.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if first:
            w.writeheader()
        w.writerows(new)
    print(f"logged {len({r['episode'] for r in new})} episode(s), {len(new)} rows -> {LOG.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
