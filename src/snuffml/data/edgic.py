"""Edgic ratings from wherever we can get them (Inside Survivor scrapes,
reddit, manual csvs under data/manual/edgic), normalized into one parquet.
Retrospective charts are spoiled since they're written knowing the winner,
so only contemporaneous=True rows are trusted for modeling.

Row = season, episode, castaway_id, castaway, rating (INV/UTR/MOR/CP/OTT),
tone (NN/N/M/P/PP or null), visibility (1-5 or null), source, source_url,
contemporaneous, retrieved_at.
"""

from __future__ import annotations

import re

import pandas as pd

from snuffml import config
from snuffml.data import survivor2py

SCHEMA_COLUMNS = [
    "season",
    "episode",
    "castaway_id",
    "castaway",
    "rating",
    "tone",
    "visibility",
    "source",
    "source_url",
    "contemporaneous",
    "retrieved_at",
]

# codes look like CPP5, OTTN3, UTR2, MORM3, INV
_CODE_RE = re.compile(r"^(INV|UTR|MOR|CP|OTT)(PP|P|MM|M|NN|N)?([1-5])?$")


def parse_code(code: str) -> tuple[str, str | None, int | None]:
    """CPP5 -> ("CP", "P", 5)."""
    m = _CODE_RE.match(code.strip().upper().replace(" ", ""))
    if not m:
        raise ValueError(f"unparseable edgic code {code!r}")
    rating, tone, vis = m.groups()
    if tone == "MM":  # some charts write MM for mixed
        tone = "M"
    return rating, tone, int(vis) if vis else None


def _resolve_castaways(df: pd.DataFrame, *, fetch: bool = True) -> pd.DataFrame:
    need = df["castaway_id"].isna() | (df["castaway_id"] == "")
    if not need.any():
        return df
    cast = survivor2py.load_table("castaways", fetch=fetch)
    lookup: dict[tuple[int, str], str] = {}
    ambiguous: set[tuple[int, str]] = set()
    for r in cast.dropna(subset=["season"]).itertuples():
        # sources write either "Jeremy" or "Jeremy Collins", index both
        names = {str(r.castaway).lower()}
        if hasattr(r, "full_name") and pd.notna(r.full_name):
            names.add(str(r.full_name).lower())
        for name in names:
            key = (int(r.season), name)
            if key in lookup and lookup[key] != r.castaway_id:
                ambiguous.add(key)  # two castaways with the same name in one season
            lookup[key] = r.castaway_id

    def _one(row: pd.Series) -> str:
        alias_key = (int(row["season"]), str(row["castaway"]))
        if alias_key in config.CASTAWAY_ALIASES:
            return config.CASTAWAY_ALIASES[alias_key]
        key = (int(row["season"]), str(row["castaway"]).lower())
        if key in lookup and key not in ambiguous:
            return lookup[key]
        problem = "ambiguous" if key in ambiguous else "cannot resolve"
        raise ValueError(
            f"{problem} castaway {row['castaway']!r} (season {row['season']}); "
            "add an entry to config.CASTAWAY_ALIASES"
        )

    df = df.copy()
    df.loc[need, "castaway_id"] = df[need].apply(_one, axis=1)
    return df


def _validate(df: pd.DataFrame) -> None:
    missing = set(SCHEMA_COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(f"edgic frame missing columns: {sorted(missing)}")
    bad_rating = set(df["rating"].dropna()) - set(config.EDGIC_RATINGS)
    if bad_rating:
        raise ValueError(f"invalid edgic ratings: {bad_rating}")
    bad_tone = set(df["tone"].dropna()) - set(config.EDGIC_TONES)
    if bad_tone:
        raise ValueError(f"invalid edgic tones: {bad_tone}")
    bad_src = set(df["source"].dropna()) - set(config.EDGIC_SOURCES)
    if bad_src:
        raise ValueError(f"invalid edgic sources: {bad_src}")
    vis = df["visibility"].dropna()
    if len(vis) and not vis.between(1, 5).all():
        raise ValueError("visibility outside 1-5")


def load_manual() -> pd.DataFrame:
    """Load data/manual/edgic/sXX.csv files. A single code column (CPP5)
    works in place of rating/tone/visibility."""
    frames = []
    for path in sorted(config.MANUAL_EDGIC_DIR.glob("s*.csv")):
        f = pd.read_csv(path)
        if "code" in f.columns and "rating" not in f.columns:
            parsed = f["code"].map(parse_code)
            f["rating"] = parsed.map(lambda x: x[0])
            f["tone"] = parsed.map(lambda x: x[1])
            f["visibility"] = parsed.map(lambda x: x[2])
            f = f.drop(columns=["code"])
        f["source"] = f.get("source", "manual")
        f["source_url"] = f.get("source_url", str(path))
        if "contemporaneous" not in f.columns:
            f["contemporaneous"] = False  # assume spoiled unless the csv says otherwise
        if "retrieved_at" not in f.columns:
            f["retrieved_at"] = ""
        if "castaway_id" not in f.columns:
            f["castaway_id"] = None
        frames.append(f)
    if not frames:
        return pd.DataFrame(columns=SCHEMA_COLUMNS)
    return pd.concat(frames, ignore_index=True)


def build(*, scraped: pd.DataFrame | None = None, fetch: bool = True) -> pd.DataFrame:
    """Merge scraped + manual and write data/interim/edgic.parquet."""
    parts = [p for p in [scraped, load_manual()] if p is not None and len(p)]
    if not parts:
        out = pd.DataFrame(columns=SCHEMA_COLUMNS)
    else:
        out = pd.concat(parts, ignore_index=True)
        out = _resolve_castaways(out, fetch=fetch)
        # manual wins over scraped on conflicts
        out["_prio"] = (out["source"] != "manual").astype(int)
        out = (
            out.sort_values("_prio")
            .drop_duplicates(["season", "episode", "castaway_id"], keep="first")
            .drop(columns="_prio")
        )
        out["visibility"] = pd.to_numeric(out["visibility"], errors="coerce").astype("Int8")
        out["season"] = out["season"].astype(int)
        out["episode"] = out["episode"].astype(int)
        _validate(out)
    config.ensure_dirs()
    out.to_parquet(config.INTERIM_DIR / "edgic.parquet", index=False)
    return out


def load() -> pd.DataFrame:
    path = config.INTERIM_DIR / "edgic.parquet"
    if not path.exists():
        raise FileNotFoundError("edgic.parquet missing; run snuffml build-edgic")
    return pd.read_parquet(path)


def covered_seasons(edgic: pd.DataFrame) -> set[int]:
    return set(edgic["season"].unique())
