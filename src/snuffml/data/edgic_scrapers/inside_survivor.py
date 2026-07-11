"""Scraper for Inside Survivor's weekly edgic articles. Each article has the
cumulative season table (one row per player, one column per episode, codes
like CPN3 / UTR2 / INV). The episode-N article went up before N+1 aired, so
only its newest column is guaranteed unspoiled; that's what scrape_season
keeps per article, with the rest optionally backfilled from the final chart
and flagged retrospective.
"""

from __future__ import annotations

import re
import time
from datetime import date

import pandas as pd
import requests
from bs4 import BeautifulSoup

from snuffml.data.edgic import SCHEMA_COLUMNS, parse_code

USER_AGENT = "snuffml/0.1 (survivor edit research)"
SEARCH_URL = "https://insidesurvivor.com/page/{page}?s=edgic"

# season -> slug fragment in their edgic article urls. coverage is S31-S37
# and S39 only, they skipped 38/40 and quit doing edgic after 39
SEASON_SLUGS: dict[int, str] = {
    31: "edgic-cambodia",
    32: "kaoh-rong",
    33: "millennials-vs-gen-x",
    34: "game-changers",
    35: "heroes-healers-hustlers",
    36: "ghost-island",
    37: "david-vs-goliath",
    39: "island-of-the-idols",
}

# pin article urls here if discovery misbehaves for a season
SEASON_URLS: dict[int, list[str]] = {}


def _get(url: str) -> str:
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    time.sleep(1.0)  # be polite
    return resp.text


def discover_article_urls(season: int, *, max_pages: int = 35) -> list[str]:
    """Walk the site search to find a season's edgic article urls."""
    if season in SEASON_URLS:
        return SEASON_URLS[season]
    slug = SEASON_SLUGS.get(season)
    if slug is None:
        raise ValueError(f"no Inside Survivor slug known for season {season}")
    pattern = re.compile(
        rf'href="(https://insidesurvivor\.com/[^"]*{re.escape(slug)}[^"]*edgic[^"]*)"'
    )
    urls: set[str] = set()
    for page in range(1, max_pages + 1):
        try:
            html = _get(SEARCH_URL.format(page=page))
        except requests.HTTPError:
            break
        urls.update(pattern.findall(html))
    return sorted(urls)


def parse_chart(html: str) -> pd.DataFrame:
    """Edgic table -> long df of castaway, episode, code."""
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", class_="edgic")
    if table is None:
        raise ValueError("no <table class='edgic'> found in article")
    rows = table.find_all("tr")
    header = rows[0].find_all("td")
    episodes: dict[int, int] = {}
    for idx, td in enumerate(header[1:], start=1):
        m = re.search(r"EP\s*(\d+)", td.get_text(strip=True), re.I)
        if m:
            episodes[idx] = int(m.group(1))
    records = []
    for tr in rows[1:]:
        tds = tr.find_all("td")
        if not tds:
            continue
        name = tds[0].get_text(strip=True)
        if not name:
            continue
        for idx, td in enumerate(tds[1:], start=1):
            code = td.get_text(strip=True)
            if not code or idx not in episodes:
                continue
            records.append({"castaway": name, "episode": episodes[idx], "code": code})
    return pd.DataFrame(records)


def _to_schema(
    long_df: pd.DataFrame, season: int, url: str, *, contemporaneous: bool
) -> pd.DataFrame:
    out = []
    for r in long_df.itertuples():
        try:
            rating, tone, vis = parse_code(r.code)
        except ValueError:
            continue  # junk cell
        out.append(
            {
                "season": season,
                "episode": int(r.episode),
                "castaway_id": None,
                "castaway": r.castaway,
                "rating": rating,
                "tone": tone,
                "visibility": vis,
                "source": "inside_survivor",
                "source_url": url,
                "contemporaneous": contemporaneous,
                "retrieved_at": date.today().isoformat(),
            }
        )
    return pd.DataFrame(out, columns=SCHEMA_COLUMNS)


def scrape_season(
    season: int, urls: list[str] | None = None, *, include_retrospective: bool = True
) -> pd.DataFrame:
    """Newest column of each weekly chart = contemporaneous rows; the final
    chart optionally backfills episodes no weekly article covered."""
    urls = urls or discover_article_urls(season)
    if not urls:
        raise ValueError(f"no edgic articles found for season {season}")
    charts: list[tuple[str, pd.DataFrame]] = []
    for url in urls:
        try:
            chart = parse_chart(_get(url))
        except (requests.HTTPError, ValueError):
            continue
        if len(chart):
            charts.append((url, chart))
    if not charts:
        raise ValueError(f"no parseable edgic charts for season {season}")

    frames = []
    seen_eps: set[int] = set()
    for url, chart in sorted(charts, key=lambda c: c[1]["episode"].max()):
        newest = chart["episode"].max()
        fresh = chart[chart["episode"] == newest]
        if newest not in seen_eps:
            frames.append(_to_schema(fresh, season, url, contemporaneous=True))
            seen_eps.add(newest)
    if include_retrospective:
        final_url, final_chart = max(charts, key=lambda c: c[1]["episode"].max())
        backfill = final_chart[~final_chart["episode"].isin(seen_eps)]
        if len(backfill):
            frames.append(_to_schema(backfill, season, final_url, contemporaneous=False))
    return pd.concat(frames, ignore_index=True)
