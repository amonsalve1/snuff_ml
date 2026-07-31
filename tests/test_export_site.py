import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import export_site  # noqa: E402


def _toy_preds() -> pd.DataFrame:
    # 3 players, 2 episodes; C booted after ep 1; winner B
    rows = [
        (1, 1, "A", "Alice", False, 0.3, 1.0, 0.0),
        (1, 1, "B", "Bob", True, 0.4, 0.0, 0.0),
        (1, 1, "C", "Cara", False, 0.3, 0.0, 0.0),
        (1, 2, "A", "Alice", False, 0.45, 1.0, 0.0),
        (1, 2, "B", "Bob", True, 0.55, 0.0, 0.0),
    ]
    return pd.DataFrame(
        rows,
        columns=["season", "episode", "castaway_id", "castaway", "is_winner", "win_prob", "early_flag", "zero_any"],
    )


def _toy_contrib(preds: pd.DataFrame) -> pd.DataFrame:
    c = pd.DataFrame(
        {
            "conf_share_cum": [0.5, -0.2, 0.1, 0.6, -0.1],
            "ott_count": [-0.3, 0.0, -0.8, -0.2, 0.4],
            "era_new": [9.0] * 5,  # must be excluded from why lists
        },
        index=preds.index,
    )
    return c


def test_top_k_why_excludes_era_and_sorts():
    contrib = _toy_contrib(_toy_preds())
    why = export_site.top_k_why(contrib.iloc[0])
    keys = [k for k, _ in why]
    assert "era_new" not in keys
    assert why[0] == ["conf_share_cum", 0.5]
    assert ["ott_count", -0.3] in why


def test_build_season_shapes():
    preds = _toy_preds()
    preds["_row"] = preds.index
    season = export_site.build_season(preds, _toy_contrib(preds), 1)
    assert season["episodes"] == [1, 2]
    cara = [p for p in season["players"] if p["name"] == "Cara"][0]
    assert cara["boot"] == 1
    assert cara["probs"] == [0.3, None]
    assert cara["why"][1] is None
    bob = [p for p in season["players"] if p["name"] == "Bob"][0]
    assert bob["winner"] and bob["boot"] is None
    # sums to 1 per episode over alive players
    for i in range(2):
        total = sum(p["probs"][i] for p in season["players"] if p["probs"][i] is not None)
        assert abs(total - 1.0) < 1e-9


def test_season_outcome_variants():
    preds = _toy_preds()
    assert export_site.season_outcome(preds) == "called"
    flipped = preds.copy()
    flipped["win_prob"] = [0.3, 0.4, 0.3, 0.55, 0.45]
    assert export_site.season_outcome(flipped) == "top3"
    # winner missing from the last snapshot = the s38 edge case
    edge = preds[~((preds["episode"] == 2) & (preds["castaway_id"] == "B"))]
    assert export_site.season_outcome(edge) == "edge return"


def test_labels_cover_model_features(features_df):
    from snuffml.features import build

    cols = build.feature_columns(features_df)
    missing = [c for c in cols if c not in export_site.FEATURE_LABELS]
    assert not missing, f"features without site labels: {missing}"
