"""The leakage guardrail: mess with everything after episode t, including who
wins, and features at episodes <= t must come out bit-identical."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from tests import synth


def _build_from(tables: dict[str, pd.DataFrame], root: Path) -> pd.DataFrame:
    from snuffml import config
    from snuffml.features import build

    synth.write_raw(config.SURVIVOR2PY_RAW_DIR, tables)
    return build.build_features(fetch=False)


@pytest.mark.parametrize("t", [1, 3, 5])
def test_future_episodes_do_not_change_past_features(raw_dir, t):
    from snuffml import config
    from snuffml.features import build

    base_tables = synth.make_tables()
    base = _build_from(base_tables, raw_dir)
    feats = build.feature_columns(base)

    # scramble everything after episode t: junk the confessional counts and
    # flip the winner from P1 to P2 (the winner label must not move the past)
    mutated = synth.make_tables()
    conf = mutated["confessionals"]
    future = conf["episode"] > t
    conf.loc[future, "confessional_count"] = 99.0
    conf.loc[future, "index_count"] = 9.9
    cast = mutated["castaways"]
    p1 = cast["castaway_id"].str.endswith("P1")
    p2 = cast["castaway_id"].str.endswith("P2")
    cast.loc[p1, ["winner", "result"]] = [False, "Runner-up"]
    cast.loc[p2, ["winner", "result"]] = [True, "Sole Survivor"]

    changed = _build_from(mutated, raw_dir)

    keys = ["season", "episode", "castaway_id"]
    past_base = base[base["episode"] <= t].set_index(keys)[feats].sort_index()
    past_changed = changed[changed["episode"] <= t].set_index(keys)[feats].sort_index()
    pd.testing.assert_frame_equal(past_base, past_changed)

    # restore untouched fixture data for other tests
    synth.write_raw(config.SURVIVOR2PY_RAW_DIR)
    build.build_features(fetch=False)


def test_manifest_contains_no_label_columns(features_df):
    from snuffml import config
    from snuffml.features.panel import LABEL_COLUMNS

    manifest = json.loads((config.PROCESSED_DIR / "feature_manifest.json").read_text())
    overlap = set(manifest["features"]) & set(LABEL_COLUMNS)
    assert not overlap, f"label columns leaked into features: {overlap}"


