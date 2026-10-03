import pandas as pd
import pytest

from snuffml.data import survivor2py


def test_load_table_filters_us_and_coerces(raw_dir):
    conf = survivor2py.load_table("confessionals", fetch=False)
    assert (conf["version"] == "US").all()
    assert str(conf["episode"].dtype) == "Int64"


def test_validate_missing_columns_raises():
    with pytest.raises(ValueError, match="missing expected columns"):
        survivor2py._validate("confessionals", pd.DataFrame({"season": [1]}))


def test_validate_duplicate_winner_raises():
    df = pd.DataFrame(
        {
            "version": ["US", "US"],
            "version_season": ["US01", "US01"],
            "season": [1, 1],
            "castaway_id": ["A", "B"],
            "castaway": ["A", "B"],
            "age": [30, 40],
            "result": ["Sole Survivor", "Sole Survivor"],
            "winner": [True, True],
            "finalist": [True, True],
            "jury": [False, False],
            "order": [16, 15],
        }
    )
    with pytest.raises(ValueError, match="multiple winner rows"):
        survivor2py._validate("castaways", df)


def test_unknown_table_raises():
    with pytest.raises(ValueError, match="unknown table"):
        survivor2py.fetch_table("screen_time")


def test_completed_seasons(raw_dir):
    cast = survivor2py.load_table("castaways", fetch=False)
    assert survivor2py.completed_seasons(cast) == [39, 41]


def test_manual_overlay_only_replaces_colliding_rows(tmp_path, monkeypatch):
    # a cached table with several rows per (season, episode, castaway) - one per
    # stage of the game, the way boot_mapping really is - in a finished season
    cached = pd.DataFrame({
        "season": [41, 41, 41, 51, 51],
        "episode": [1, 1, 1, 2, 2],
        "castaway_id": ["A", "A", "B", "C", "C"],
        "sog_id": [1, 2, 1, 3, 4],
        "game_status": ["In the game"] * 5,
    })
    manual = pd.DataFrame({
        "season": [51, 51],
        "episode": [2, 2],
        "castaway_id": ["C", "C"],
        "sog_id": [3, 4],
        "game_status": ["In the game", "Voted out"],
    })
    monkeypatch.setattr(survivor2py, "manual_live_dir", lambda: tmp_path)
    manual.to_csv(tmp_path / "boot_mapping.csv", index=False)
    out = survivor2py._merge_manual("boot_mapping", cached)
    # the finished season is untouched, duplicates per key included
    s41 = out[out["season"] == 41].sort_values(["castaway_id", "sog_id"])
    assert len(s41) == 3
    assert list(s41["sog_id"]) == [1, 2, 1]
    # the airing episode is exactly the manual rows, both of them
    s51 = out[out["season"] == 51].sort_values("sog_id")
    assert list(s51["game_status"]) == ["In the game", "Voted out"]
    assert len(out) == 5
