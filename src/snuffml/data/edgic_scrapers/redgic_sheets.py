"""New-era edgic from the r/Edgic community google sheets.

The sub ran a survey after every episode for s41-s49 and published consensus
codes into one public sheet per season, so those are weekly-contemporaneous.
S50 only exists as a tab in the s31-50 master sheet, which was compiled after
the finale from the raters' weekly charts - inputs were contemporaneous but
the compilation wasn't, so s50 gets contemporaneous=False and only shows up
if you allow retrospective ratings.
"""

from __future__ import annotations

import io
import re
from datetime import date

import pandas as pd
import requests

from snuffml.data.edgic import SCHEMA_COLUMNS, parse_code

CSV_EXPORT = "https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
XLSX_EXPORT = "https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"

# one consensus sheet per season, weekly survey results
SEASON_SHEETS: dict[int, str] = {
    41: "1CkYJEuhSN1ajcCI3AnZbLOUojwSMENLWNPNO9L-cNG8",
    42: "1lEmRM_kgIfa5Ew7h441BXfYV2bWhmhV490ZGnEzyNiI",
    43: "1-ptzXXUP09Tem4BDjxzZTLipKsOkhecE8IOildmhJTE",
    44: "13OA4sFG71jIFY6DA8_zlEQrRO1l1N9Da9-NYRzkab7s",
    45: "1DuAsrnVNtj9Y6ZGvxcLKtcIE8rc9w6yrxstnd3-8n7E",
    46: "1lfuroUWWzK0wSigncR2QsfbYs1MCfBt9Wh4uN8Qtiso",
    47: "1nDfiEQ9BkfTVJeRUsnzbDDM4bZBapVmCCyRZIllWElw",
    48: "13L01UnsWphkrH2h_9_78bcbJmB-oc8sf213tNtBeXbo",
    49: "1ZKCXeazH6cJAqZJ7FrqGBZ11DdyQc1hSeWLqBl2emc4",
}

# s31-50 master sheet, only used for the 50 tab
MASTER_SHEET = "1f6YjL2sIuW4E4HbDVJP0DihGlgifsuZEB3eUr4oDeak"

_EP_RE = re.compile(r"ep\.?\s*(\d+)", re.I)


def _clean_code(cell: str) -> str:
    # the sheets have a few oddballs: "CP,M4", "OTTPP3" style triples are fine,
    # commas and stray spaces are not
    return cell.replace(",", "").replace(" ", "").strip()


def _grid_to_records(grid: pd.DataFrame, season: int, url: str, *, contemporaneous: bool) -> pd.DataFrame:
    ep_cols = {}
    for col in grid.columns[1:]:
        m = _EP_RE.search(str(col))
        if m:
            ep_cols[col] = int(m.group(1))
    out = []
    for _, row in grid.iterrows():
        name = str(row.iloc[0]).strip()
        if not name or name.lower() in ("nan", "players", "key:"):
            continue
        for col, ep in ep_cols.items():
            cell = row[col]
            if pd.isna(cell) or not str(cell).strip():
                continue
            try:
                rating, tone, vis = parse_code(_clean_code(str(cell)))
            except ValueError:
                continue  # key blocks, stray notes
            out.append(
                {
                    "season": season,
                    "episode": ep,
                    "castaway_id": None,
                    "castaway": name,
                    "rating": rating,
                    "tone": tone,
                    "visibility": vis,
                    "source": "reddit",
                    "source_url": url,
                    "contemporaneous": contemporaneous,
                    "retrieved_at": date.today().isoformat(),
                }
            )
    return pd.DataFrame(out, columns=SCHEMA_COLUMNS)


def scrape_season(season: int) -> pd.DataFrame:
    if season in SEASON_SHEETS:
        url = CSV_EXPORT.format(sheet_id=SEASON_SHEETS[season])
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        grid = pd.read_csv(io.BytesIO(resp.content))
        return _grid_to_records(grid, season, url, contemporaneous=True)
    if season == 50:
        url = XLSX_EXPORT.format(sheet_id=MASTER_SHEET)
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
        raw = pd.read_excel(io.BytesIO(resp.content), sheet_name="50", header=2)
        # master sheet layout: names in col 7, ratings to the right of that
        grid = raw.iloc[:, 7:]
        return _grid_to_records(grid, season, url, contemporaneous=False)
    raise ValueError(f"no r/Edgic sheet known for season {season}")
