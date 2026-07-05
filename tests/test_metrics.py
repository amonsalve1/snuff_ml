import numpy as np
import pandas as pd

from snuffml.eval import metrics
from snuffml.models.normalize import normalize_by_group


def _toy_preds() -> pd.DataFrame:
    # one 3-player snapshot, winner ranked 2nd at 0.3
    return pd.DataFrame(
        {
            "season": [1, 1, 1],
            "episode": [5, 5, 5],
            "castaway_id": ["A", "B", "C"],
            "is_winner": [False, True, False],
            "win_prob": [0.5, 0.3, 0.2],
        }
    )


def test_snapshot_metrics_hand_computed():
    snap = metrics.snapshot_metrics(_toy_preds())
    assert len(snap) == 1
    row = snap.iloc[0]
    assert row["winner_rank"] == 2
    assert row["reciprocal_rank"] == 0.5
    assert row["top1"] == 0.0
    assert row["top3"] == 1.0
    assert np.isclose(row["winner_prob"], 0.3)
    assert np.isclose(row["log_loss"], -np.log(0.3), atol=1e-6)
    assert np.isclose(row["log_loss_uniform"], -np.log(1 / 3), atol=1e-6)
    # skill: uniform would assign 1/3 > 0.3, so slightly negative
    assert row["skill"] < 0


def test_snapshot_skips_winnerless_groups():
    preds = _toy_preds()
    preds["is_winner"] = False
    assert len(metrics.snapshot_metrics(preds)) == 0


def test_normalize_by_group():
    df = pd.DataFrame(
        {
            "season": [1, 1, 1, 2, 2],
            "episode": [1, 1, 1, 1, 1],
            "raw_prob": [0.2, 0.2, 0.6, 0.0, 0.0],
        }
    )
    out = normalize_by_group(df)
    assert np.allclose(out.groupby(["season", "episode"])["win_prob"].sum(), 1.0)
    # degenerate all-zero group falls back to uniform
    assert np.allclose(out[out["season"] == 2]["win_prob"], 0.5)


def test_uniform_baseline_has_zero_skill():
    preds = _toy_preds()
    preds["win_prob"] = 1 / 3
    snap = metrics.snapshot_metrics(preds)
    assert np.isclose(snap.iloc[0]["skill"], 0.0, atol=1e-9)
