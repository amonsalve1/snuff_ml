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


def test_outlier_seasons_excluded_from_training(features_df, monkeypatch):
    from snuffml import config
    from snuffml.models import sklearn_baseline as skb

    monkeypatch.setattr(config, "OUTLIER_SEASONS", {41})
    m = skb.train(features_df, "logit", calibrate=False)
    assert m.trained_through == 39
    monkeypatch.setattr(config, "OUTLIER_SEASONS", set())
    m = skb.train(features_df, "logit", calibrate=False)
    assert m.trained_through == 41


def test_era_blend_model(features_df, monkeypatch):
    from snuffml import config
    from snuffml.models import sklearn_baseline as skb

    monkeypatch.setattr(config, "OUTLIER_SEASONS", set())
    monkeypatch.setattr(skb, "MIN_ERA_SEASONS", 1)
    m = skb.train_blend(features_df)
    assert set(m.era_models) == {"new"}  # only the new era gets its own model
    preds = m.predict(features_df)
    sums = preds.groupby(["season", "episode"])["win_prob"].sum()
    assert (sums - 1).abs().max() < 1e-9


def test_immunity_timing_features(features_df):
    s39 = features_df[features_df["season"] == 39]
    p1 = s39[s39["castaway_id"] == "S39P1"].set_index("episode")
    p2 = s39[s39["castaway_id"] == "S39P2"].set_index("episode")
    # merge at ep 4: P2's ep-4 win is early, P1's ep-7 win is late
    assert p2["imm_early_cum"][7] == 1.0 and p2["imm_late_cum"][7] == 0.0
    assert p1["imm_early_cum"][7] == 0.0 and p1["imm_late_cum"][7] == 1.0
    assert (s39["imm_early_x_old"] == 0).all()  # s39 is middle era


def test_orig_tribe_over_frozen_at_merge(features_df):
    s39 = features_df[features_df["season"] == 39]
    p1 = s39[s39["castaway_id"] == "S39P1"].set_index("episode")["orig_tribe_over"]
    # pre-merge: tagi (p1,3,5,7) gets 9 of 19 ep-1 confs vs 4/8 fair share
    import numpy as np

    assert np.isclose(p1[1], 9 / 19 - 0.5)
    # frozen after the merge at ep 4
    assert np.isclose(p1[4], p1[7])


def test_early_flag(features_df):
    s39 = features_df[features_df["season"] == 39]
    # P1 leads cumulative share by ep 4 (3+4+5+6=18 vs P2's 16) and keeps the
    # flag frozen after; P2 never holds it from ep 4 on
    p1 = s39[s39["castaway_id"] == "S39P1"].set_index("episode")["early_flag"]
    p2 = s39[s39["castaway_id"] == "S39P2"].set_index("episode")["early_flag"]
    assert p1[4] == 1.0 and p1[7] == 1.0
    assert p2[4] == 0.0 and p2[7] == 0.0
    # era interaction only fires for the new-era season
    s41 = features_df[features_df["season"] == 41]
    assert (s39["early_flag_x_new"] == 0).all()
    p1_41 = s41[s41["castaway_id"] == "S41P1"].set_index("episode")
    assert p1_41["early_flag_x_new"][5] == 1.0
