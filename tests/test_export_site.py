import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import export_site  # noqa: E402


COLUMNS = [
    "season",
    "episode",
    "castaway_id",
    "castaway",
    "is_winner",
    "made_ftc",
    "win_prob",
    "early_flag",
    "zero_any",
]


def _toy_preds() -> pd.DataFrame:
    # 3 players, 2 episodes; C booted after ep 1; winner B, A the runner up
    rows = [
        (1, 1, "A", "Alice", False, True, 0.3, 1.0, 0.0),
        (1, 1, "B", "Bob", True, True, 0.4, 0.0, 0.0),
        (1, 1, "C", "Cara", False, False, 0.3, 0.0, 0.0),
        (1, 2, "A", "Alice", False, True, 0.45, 1.0, 0.0),
        (1, 2, "B", "Bob", True, True, 0.55, 0.0, 0.0),
    ]
    df = pd.DataFrame(rows, columns=COLUMNS)
    df["_vs_field"] = export_site.log_odds_vs_field(df)
    return df


def _live_preds() -> pd.DataFrame:
    # still airing: one episode in the can, nobody has won, nobody at ftc yet
    rows = [
        (51, 1, "A", "Alice", False, False, 0.5, 0.0, 0.0),
        (51, 1, "B", "Bob", False, False, 0.3, 0.0, 0.0),
        (51, 1, "C", "Cara", False, False, 0.2, 0.0, 0.0),
    ]
    df = pd.DataFrame(rows, columns=COLUMNS)
    df["_vs_field"] = export_site.log_odds_vs_field(df)
    return df


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
    # winner missing from the last snapshot = the s38 edge case. he is still
    # in the panel earlier on, so it must not read as a season still airing
    edge = preds[~((preds["episode"] == 2) & (preds["castaway_id"] == "B"))]
    assert not export_site.season_is_live(edge)
    assert export_site.season_outcome(edge) == "edge return"


def test_live_season_is_airing():
    live = _live_preds()
    assert export_site.season_is_live(live)
    assert export_site.season_outcome(live) == "airing"


def test_winnerless_but_finished_is_not_airing():
    # winner flag never landed, but the finale happened, so it is not live
    done = _toy_preds()
    done["is_winner"] = False
    assert not export_site.season_is_live(done)
    assert export_site.season_outcome(done) == "edge return"


def test_build_season_marks_live():
    live = _live_preds()
    live["_row"] = live.index
    contrib = pd.DataFrame({"conf_cum": [0.4, -0.2, 0.1]}, index=live.index)
    season = export_site.build_season(live, contrib, 51)
    assert season["live"] is True
    assert season["outcome"] == "airing"
    assert not any(p["winner"] for p in season["players"])
    assert season["players"][0]["name"] == "Alice"


def test_build_index_live_entry():
    entry = export_site.build_index(_live_preds(), {51: "51"})["seasons"][0]
    assert entry["winner"] is None
    assert entry["outcome"] == "airing"
    assert entry["live"] is True
    assert entry["leader"] == "Alice"
    # compare view still needs a line, so the leader's probs stand in
    assert entry["winner_probs"] == [0.5]


def test_build_index_finished_entry_unchanged():
    entry = export_site.build_index(_toy_preds(), {1: "Borneo"})["seasons"][0]
    assert entry["winner"] == "Bob"
    assert entry["outcome"] == "called"
    assert entry["winner_probs"] == [0.4, 0.55]
    assert "live" not in entry and "leader" not in entry


def test_labels_cover_model_features(features_df):
    from snuffml.features import build

    cols = build.feature_columns(features_df)
    missing = [c for c in cols if c not in export_site.FEATURE_LABELS]
    assert not missing, f"features without site labels: {missing}"


def test_top_k_why_orders_by_size_either_sign():
    row = pd.Series({"a": 0.2, "b": -0.9, "c": 0.5, "d": 0.00001, "era_new": 5.0})
    assert export_site.top_k_why(row) == [["b", -0.9], ["c", 0.5], ["a", 0.2]]


def test_build_season_why_adds_up_to_total():
    preds = _toy_preds()
    preds["_row"] = preds.index
    contrib = _toy_contrib(preds)
    out = export_site.build_season(preds, contrib, 1)
    for pl in out["players"]:
        for why, rest, tot in zip(pl["why"], pl["why_rest"], pl["why_total"]):
            if why is None:
                assert rest is None and tot is None
                continue
            assert abs(sum(v for _, v in why) + rest - tot) < 0.002


def test_relative_contributions_explain_the_odds():
    """the claim the why panel rests on, on a real fitted pipeline.

    contributions scaled by the calibrator and centred on the field should sum
    to log(p / geometric mean p) within an episode. it is exact up to the
    curvature of the sigmoid, which is small when win probabilities are.
    """
    from types import SimpleNamespace

    from sklearn.compose import ColumnTransformer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    rng = np.random.default_rng(0)
    n = 1200
    X = pd.DataFrame({"a": rng.normal(size=n), "b": rng.normal(size=n), "c": rng.normal(size=n)})
    y = (rng.random(n) < 1 / (1 + np.exp(-(-4.5 + 1.2 * X["a"] - 0.8 * X["b"])))).astype(int)
    pipe = Pipeline([("pre", ColumnTransformer([("num", StandardScaler(), ["a", "b", "c"])])),
                     ("clf", LogisticRegression(class_weight="balanced"))]).fit(X, y)
    raw = pipe.predict_proba(X)[:, 1]
    logit = np.log(raw / (1 - raw)).reshape(-1, 1)
    cal = LogisticRegression().fit(logit, y)
    # pin the slope where the real calibrators sit (0.47 pooled, 0.24 new era),
    # so leaving it out of the contributions is a real error here too
    cal.coef_ = np.array([[0.3]])
    cal.intercept_ = np.array([-3.0])
    model = SimpleNamespace(pipeline=pipe, feature_cols=["a", "b", "c"], calibrator=cal)

    rows = X.iloc[:120].copy()
    rows["season"], rows["episode"] = 1, np.repeat(np.arange(10), 12)
    p = cal.predict_proba(np.log(raw[:120] / (1 - raw[:120])).reshape(-1, 1))[:, 1]
    rows["win_prob"] = p / pd.Series(p).groupby(rows["episode"].to_numpy()).transform("sum").to_numpy()
    rel = export_site.relative_to_field(export_site.logit_contributions(model, rows), rows)
    gap = (rel.sum(axis=1) - export_site.log_odds_vs_field(rows)).abs()
    assert gap.median() < 0.05
    # and without the calibrator slope the same sum overshoots badly
    unscaled = SimpleNamespace(pipeline=pipe, feature_cols=["a", "b", "c"], calibrator=None)
    raw_rel = export_site.relative_to_field(export_site.logit_contributions(unscaled, rows), rows)
    raw_gap = (raw_rel.sum(axis=1) - export_site.log_odds_vs_field(rows)).abs()
    assert raw_gap.median() > 3 * gap.median()
