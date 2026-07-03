"""Points SNUFFML_ROOT at a throwaway tmp tree with synthetic data. Has to
happen before any snuffml import resolves config paths, hence the top-level
env var dance."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TEST_ROOT = Path(tempfile.mkdtemp(prefix="snuffml-test-"))
os.environ["SNUFFML_ROOT"] = str(_TEST_ROOT)

import pandas as pd  # noqa: E402
import pytest  # noqa: E402

from tests import synth  # noqa: E402


@pytest.fixture(scope="session")
def raw_dir() -> Path:
    from snuffml import config

    config.ensure_dirs()
    synth.write_raw(config.SURVIVOR2PY_RAW_DIR)
    return config.SURVIVOR2PY_RAW_DIR


@pytest.fixture(scope="session")
def features_df(raw_dir: Path) -> pd.DataFrame:
    from snuffml.features import build

    return build.build_features(fetch=False)
