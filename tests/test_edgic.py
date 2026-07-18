import numpy as np
import pandas as pd
import pytest

from snuffml.data import edgic as edgic_data
from snuffml.data.edgic_scrapers import inside_survivor
from snuffml.features import edgic as edgic_feat


def test_parse_code():
    assert edgic_data.parse_code("CPP5") == ("CP", "P", 5)
    assert edgic_data.parse_code("OTTNN3") == ("OTT", "NN", 3)
    assert edgic_data.parse_code("UTR2") == ("UTR", None, 2)
    assert edgic_data.parse_code("INV") == ("INV", None, None)
    assert edgic_data.parse_code("MORM3") == ("MOR", "M", 3)
    with pytest.raises(ValueError):
        edgic_data.parse_code("XYZ9")


def test_parse_chart_html():
    html = """
    <table class="edgic"><tbody>
    <tr class="titles"><td class="title-name">Name</td><td>EP 1</td><td>EP 2</td></tr>
    <tr><td class="player-name">Alice</td><td class="CP">CPP4</td><td class="MOR">MOR3</td></tr>
    <tr><td class="player-name">Bob</td><td class="INV">INV</td><td class="blank"></td></tr>
    </tbody></table>
    """
    chart = inside_survivor.parse_chart(html)
    assert len(chart) == 3
    assert set(chart["castaway"]) == {"Alice", "Bob"}


def _synthetic_ratings(season: int = 39) -> pd.DataFrame:
    # P1 (the winner) is CP-positive all season, P2 is OTT-negative
    rows = []
    for ep in range(1, 7):
        rows.append((season, ep, f"S{season}P1", "Player1", "CP", "P", 4))
        rows.append((season, ep, f"S{season}P2", "Player2", "OTT", "N", 3))
    return pd.DataFrame(
        rows,
        columns=["season", "episode", "castaway_id", "castaway", "rating", "tone", "visibility"],
    ).assign(source="manual", source_url="test", contemporaneous=True, retrieved_at="2026-01-01")


def test_edgic_features(features_df):
    ratings = _synthetic_ratings()
    df = edgic_feat.add_edgic_features(features_df, ratings=ratings)
    p1 = df[(df["season"] == 39) & (df["castaway_id"] == "S39P1") & (df["episode"] == 6)].iloc[0]
    assert p1["cp_share"] == 1.0
    assert p1["ott_count"] == 0.0
    assert p1["tone_consistency"] == 1.0
    assert p1["visibility_mean"] == 4.0
    assert p1["edgic_available"] == 1.0
    p2 = df[(df["season"] == 39) & (df["castaway_id"] == "S39P2") & (df["episode"] == 6)].iloc[0]
    assert p2["ott_count"] == 6.0
    assert p2["cp_share"] == 0.0
    # season 41 has no ratings -> unavailable, NaN features
    p41 = df[(df["season"] == 41) & (df["episode"] == 3)].iloc[0]
    assert p41["edgic_available"] == 0.0
    assert np.isnan(p41["cp_share"])


def test_retrospective_rows_excluded_by_default(features_df):
    ratings = _synthetic_ratings().assign(contemporaneous=False)
    df = edgic_feat.add_edgic_features(features_df, ratings=ratings)
    assert (df["edgic_available"] == 0.0).all()
    df2 = edgic_feat.add_edgic_features(features_df, ratings=ratings, allow_retrospective=True)
    assert (df2["edgic_available"] == 1.0).any()


def test_manual_csv_roundtrip(raw_dir):
    from snuffml import config

    config.MANUAL_EDGIC_DIR.mkdir(parents=True, exist_ok=True)
    path = config.MANUAL_EDGIC_DIR / "s39.csv"
    pd.DataFrame(
        {
            "season": [39, 39],
            "episode": [1, 1],
            "castaway": ["Player1", "Player2"],
            "code": ["CPP4", "UTRN2"],
            "contemporaneous": [True, True],
        }
    ).to_csv(path, index=False)
    try:
        out = edgic_data.build(fetch=False)
        assert len(out) == 2
        assert out.iloc[0]["castaway_id"] == "S39P1"  # resolved via castaways table
        assert set(out["rating"]) == {"CP", "UTR"}
    finally:
        path.unlink()
        edgic_data.build(fetch=False)  # reset parquet to empty


def test_unresolvable_name_raises(raw_dir):
    frame = pd.DataFrame(
        {
            "season": [39],
            "episode": [1],
            "castaway_id": [None],
            "castaway": ["Nobody"],
            "rating": ["CP"],
            "tone": ["P"],
            "visibility": [3],
            "source": ["manual"],
            "source_url": ["test"],
            "contemporaneous": [True],
            "retrieved_at": [""],
        }
    )
    with pytest.raises(ValueError, match="cannot resolve castaway"):
        edgic_data.build(scraped=frame, fetch=False)


def test_redgic_sheet_grid_parsing():
    import pandas as pd

    from snuffml.data.edgic_scrapers import redgic_sheets

    grid = pd.DataFrame(
        {
            "Players": ["Alice", "Bob", "Key:"],
            "Ep 1": ["CP4", "OTTNN2", "green = good"],
            "Ep 2": ["CP,M4", "", None],  # s44-style malformed cell, blank after boot
        }
    )
    out = redgic_sheets._grid_to_records(grid, 44, "test-url", contemporaneous=True)
    assert len(out) == 3  # key row and blanks skipped, malformed cell recovered
    row = out[(out["castaway"] == "Alice") & (out["episode"] == 2)].iloc[0]
    assert (row["rating"], row["tone"], row["visibility"]) == ("CP", "M", 4)
    assert out["contemporaneous"].all()
