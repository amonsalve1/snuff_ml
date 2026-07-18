import numpy as np


def test_zero_conf_eps(features_df):
    # only counts episodes you were actually in: P4 has the one zero-conf
    # episode (ep 2), booted players don't keep accruing
    s39 = features_df[features_df["season"] == 39]
    p4 = s39[s39["castaway_id"] == "S39P4"].set_index("episode")["zero_conf_eps"]
    assert p4[1] == 0
    assert p4[2] == 1
    assert p4[5] == 1  # booted at ep 5, counter frozen
    p8 = s39[s39["castaway_id"] == "S39P8"].set_index("episode")["zero_conf_eps"]
    assert (p8 == 0).all()  # out at ep 1 with confessionals, never accrues


def test_zero_conf_new_era_interaction(features_df):
    s39 = features_df[features_df["season"] == 39]
    s41 = features_df[features_df["season"] == 41]
    assert (s39["zero_any_x_new"] == 0).all()
    assert (s41["zero_any_x_new"] == s41["zero_any"]).all()


def test_tribe_share(features_df):
    # ep 1: tagi = players 1,3,5,7 -> conf 3+2+2+2 = 9 of 19 total
    row = features_df[
        (features_df["season"] == 39)
        & (features_df["castaway_id"] == "S39P1")
        & (features_df["episode"] == 1)
    ].iloc[0]
    assert np.isclose(row["tribe_share_ep"], 9 / 19)
    # post-merge there's one tribe, share saturates to 1
    merged = features_df[
        (features_df["season"] == 39) & (features_df["episode"] == 5) & features_df["in_game"]
    ]
    assert np.allclose(merged["tribe_share_ep"], 1.0)


def test_demo_features(features_df):
    p1 = features_df[
        (features_df["season"] == 39)
        & (features_df["castaway_id"] == "S39P1")
        & (features_df["episode"] == 1)
    ].iloc[0]
    assert p1["age"] == 27.0
    assert p1["is_poc"] == 0.0
    p3 = features_df[
        (features_df["season"] == 39)
        & (features_df["castaway_id"] == "S39P3")
        & (features_df["episode"] == 6)
    ].iloc[0]
    assert p3["is_poc"] == 1.0
    assert np.isclose(p3["poc_x_share_cum"], p3["conf_share_cum"])


def test_model_features_vs_columns(features_df):
    from snuffml.features import build

    cols = build.feature_columns(features_df)
    for c in ["zero_any", "zero_any_x_new"]:
        assert c in cols
    # built for the study but kept out of the model on purpose
    for c in ["zero_conf_eps", "tribe_share_ep", "tribe_share_cum", "age", "is_poc"]:
        assert c in features_df.columns
        assert c not in cols
