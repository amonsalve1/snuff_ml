import pandas as pd


def test_panel_shape_and_alive_counts(features_df: pd.DataFrame):
    df = features_df
    assert set(df["season"].unique()) == {39, 41}
    # 8 players x 7 episodes per season
    assert len(df) == 2 * 8 * 7

    s39 = df[df["season"] == 39]
    alive = s39.groupby("episode")["in_game"].sum()
    # one boot per episode: 8, 7, 6, 5, 4, 3, 2
    assert list(alive) == [8, 7, 6, 5, 4, 3, 2]
    n_alive = s39[s39["in_game"]].groupby("episode")["n_alive"].first()
    assert list(n_alive) == [8, 7, 6, 5, 4, 3, 2]


def test_winner_labels(features_df: pd.DataFrame):
    df = features_df
    for season in (39, 41):
        s = df[df["season"] == season]
        winners = s[s["is_winner"]]["castaway_id"].unique()
        assert list(winners) == [f"S{season}P1"]
        # winner alive at the finale
        finale = s[s["episode"] == s["episode"].max()]
        assert finale[finale["is_winner"]]["in_game"].all()


def test_jury_vote_share_is_label_only(features_df: pd.DataFrame):
    from snuffml.features import build

    feats = build.feature_columns(features_df)
    assert "jury_vote_share" not in feats
    assert "is_winner" not in feats
    winner = features_df[features_df["is_winner"] & (features_df["season"] == 39)]
    assert (winner["jury_vote_share"] == 0.8).all()


def test_eras(features_df: pd.DataFrame):
    assert (features_df.loc[features_df["season"] == 39, "era"] == "middle").all()
    assert (features_df.loc[features_df["season"] == 41, "era"] == "new").all()
