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
