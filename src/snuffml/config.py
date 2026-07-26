from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get("SNUFFML_ROOT", Path(__file__).resolve().parents[2]))

DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
SURVIVOR2PY_RAW_DIR = RAW_DIR / "survivor2py"
TDT_RAW_DIR = RAW_DIR / "tdt"
MANUAL_EDGIC_DIR = DATA_DIR / "manual" / "edgic"
INTERIM_DIR = DATA_DIR / "interim"
PROCESSED_DIR = DATA_DIR / "processed"
MODELS_DIR = PROJECT_ROOT / "models"
REPORTS_DIR = PROJECT_ROOT / "reports"

# the repo json is always current, the csv mirror lags (stale since ~s47)
SURVIVOR_GITHUB_JSON = "https://raw.githubusercontent.com/doehm/survivoR/master/dev/json/{table}.json"
SURVIVOR2PY_BASE = "https://stilesdata.com/survivor/survivor2py/processed/csv/{table}.csv"

# tables pulled from the survivoR2py mirror. screen_time is deprecated upstream, don't add it back
SURVIVOR2PY_TABLES = [
    "confessionals",
    "castaways",
    "castaway_details",
    "boot_mapping",
    "vote_history",
    "jury_votes",
    "episodes",
    "tribe_mapping",
    "season_summary",
    "challenge_results",
    "advantage_movement",
    "advantage_details",
]

TDT_BOXSCORE_URL = "https://truedorktimes.com/s{season}/boxscores/e{episode}.htm"

# S41+ is the 26-day format and the edit spreads confessionals much flatter,
# so treat it as its own regime
ERA_BOUNDARIES = {
    "old": range(1, 21),  # S1-S20
    "middle": range(21, 41),  # S21-S40
    "new": range(41, 100),  # S41+
}

# excluded from fitting, still predicted and scored. s41: erika won with the
# lowest confessional share of any winner, the edit pointed everywhere else
OUTLIER_SEASONS: set[int] = {41}

# seasons with edgic coverage we can actually use, filled in as sources get
# ingested. feature code gates on this.
EDGIC_SEASONS: set[int] = set()

EDGIC_RATINGS = ["INV", "UTR", "MOR", "CP", "OTT"]
EDGIC_TONES = ["NN", "N", "M", "P", "PP"]
EDGIC_SOURCES = ["inside_survivor", "reddit", "sucks", "manual"]

# (season, source spelling) -> castaway_id where sources disagree with survivoR
CASTAWAY_ALIASES: dict[tuple[int, str], str] = {
    (31, "Kass McQuillen"): "US0422",  # Kassandra
    (31, "Tasha Fox"): "US0419",  # Latasha
    (31, "Woo Hwang"): "US0423",  # Yung
    (37, "Daniel"): "US0546",  # Inside Survivor calls Dan Rengering "Daniel"
    (44, "Jamie"): "US0646",  # r/Edgic sheet spelling, survivoR has Jaime
    (45, "Brando M."): "US0664",  # Brando Meyer
    (45, "Brandon D."): "US0665",  # Brandon Donlon
    (45, "Janani"): "US0670",  # goes by J. Maya in survivoR
}


def era_of(season: int) -> str:
    for era, seasons in ERA_BOUNDARIES.items():
        if season in seasons:
            return era
    raise ValueError(f"season {season} not covered by ERA_BOUNDARIES")


def ensure_dirs() -> None:
    for d in [
        SURVIVOR2PY_RAW_DIR,
        TDT_RAW_DIR,
        MANUAL_EDGIC_DIR,
        INTERIM_DIR,
        PROCESSED_DIR,
        MODELS_DIR,
        REPORTS_DIR,
    ]:
        d.mkdir(parents=True, exist_ok=True)
