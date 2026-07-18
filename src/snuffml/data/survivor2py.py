"""Pulls the survivoR data. US seasons only, cached under data/raw/survivor2py.

Primary source is the json in the survivoR repo itself (doehm/survivoR
dev/json), which is always current. The survivoR2py csv mirror is the
fallback, it went stale around s47. Two gotchas: confessional counts are
averaged across community counters so they're noisy, and the newest season
can be all-NaN placeholder rows until it actually airs.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import pandas as pd
import requests

from snuffml import config

# columns downstream code actually uses. extra upstream cols are fine,
# missing ones blow up at load time
REQUIRED_COLUMNS: dict[str, set[str]] = {
    "confessionals": {
        "version",
        "version_season",
        "season",
        "episode",
        "castaway",
        "castaway_id",
        "confessional_count",
        "confessional_time",
        "index_count",
        "index_time",
    },
    "castaways": {
        "version",
        "version_season",
        "season",
        "castaway_id",
        "castaway",
        "age",
        "result",
        "winner",
        "finalist",
        "jury",
        "order",
    },
    "boot_mapping": {
        "version",
        "version_season",
        "season",
        "episode",
        "sog_id",
        "castaway_id",
        "game_status",
        "final_n",
        "tribe",
    },
    "vote_history": {
        "version",
        "version_season",
        "season",
        "episode",
        "castaway_id",
        "vote_id",
        "voted_out_id",
    },
    "jury_votes": {
        "version",
        "version_season",
        "season",
        "castaway_id",
        "finalist_id",
        "vote",
    },
    "episodes": {
        "version",
        "version_season",
        "season",
        "episode",
        "episode_length",
    },
    "castaway_details": {
        "castaway_id",
        "gender",
        "bipoc",
    },
    "season_summary": {
        "version",
        "version_season",
        "season",
        "winner_id",
        "n_cast",
    },
}

# these arrive as floats in the csvs
_INT_COLUMNS = {"season", "episode", "sog_id", "order", "final_n", "n_boots"}


def _raw_path(table: str) -> Path:
    return config.SURVIVOR2PY_RAW_DIR / f"{table}.csv"


def _meta_path(table: str) -> Path:
    return config.SURVIVOR2PY_RAW_DIR / f"{table}.meta.json"


def fetch_table(table: str, *, force: bool = False, max_age_hours: float = 24.0) -> Path:
    """Download one table csv, reuse the cache if fresh enough."""
    if table not in config.SURVIVOR2PY_TABLES:
        raise ValueError(f"unknown table {table!r}; expected one of {config.SURVIVOR2PY_TABLES}")
    config.ensure_dirs()
    path = _raw_path(table)
    meta_path = _meta_path(table)
    if path.exists() and meta_path.exists() and not force:
        meta = json.loads(meta_path.read_text())
        age_hours = (time.time() - meta["fetched_at_unix"]) / 3600
        if age_hours < max_age_hours:
            return path

    # repo json first, csv mirror if that fails
    content = None
    url = config.SURVIVOR_GITHUB_JSON.format(table=table)
    try:
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        pd.DataFrame(resp.json()).to_csv(path, index=False)
        content = resp.content
    except (requests.RequestException, ValueError):
        url = config.SURVIVOR2PY_BASE.format(table=table)
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        path.write_bytes(resp.content)
        content = resp.content
    meta_path.write_text(
        json.dumps(
            {
                "url": url,
                "fetched_at_unix": time.time(),
                "sha256": hashlib.sha256(content).hexdigest(),
                "bytes": len(content),
            },
            indent=2,
        )
    )
    return path


def fetch_all(*, force: bool = False) -> list[Path]:
    return [fetch_table(t, force=force) for t in config.SURVIVOR2PY_TABLES]


def _validate(table: str, df: pd.DataFrame) -> None:
    required = REQUIRED_COLUMNS.get(table)
    if required:
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"table {table!r} missing expected columns: {sorted(missing)}")
    if table == "confessionals":
        dupes = df.duplicated(["version_season", "episode", "castaway_id"]).sum()
        if dupes:
            raise ValueError(f"confessionals has {dupes} duplicate (season, episode, castaway) rows")
    if table == "castaways":
        # completed seasons have exactly one winner row, airing ones have none
        winners = df[df["winner"] == True].groupby("version_season").size()  # noqa: E712
        bad = winners[winners > 1]
        if len(bad):
            raise ValueError(f"multiple winner rows in seasons: {list(bad.index)}")


def load_table(table: str, *, fetch: bool = True) -> pd.DataFrame:
    """Load from cache (fetch if missing), US rows only."""
    path = _raw_path(table)
    if not path.exists():
        if not fetch:
            raise FileNotFoundError(f"{path} not cached; run snuffml fetch")
        fetch_table(table)
    df = pd.read_csv(path, low_memory=False)
    if "version" in df.columns:
        df = df[df["version"] == "US"].copy()
    if "confessional_time" in df.columns:
        df["confessional_time"] = pd.to_numeric(df["confessional_time"], errors="coerce")
    for col in _INT_COLUMNS & set(df.columns):
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")
    _validate(table, df)
    return df


def completed_seasons(castaways: pd.DataFrame) -> list[int]:
    won = castaways[castaways["winner"] == True]  # noqa: E712
    return sorted(int(s) for s in won["season"].dropna().unique())
