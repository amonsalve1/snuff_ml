"""r/Edgic scraper, mostly a stub for now. Needs praw and reddit api creds
(uv sync --extra reddit). Auth/search scaffolding only, actual chart
extraction from the weekly threads is still todo.
"""

from __future__ import annotations

import pandas as pd


def make_client(client_id: str, client_secret: str, user_agent: str = "snuffml/0.1"):
    try:
        import praw
    except ImportError as e:
        raise ImportError("install the reddit extra: uv sync --extra reddit") from e
    return praw.Reddit(client_id=client_id, client_secret=client_secret, user_agent=user_agent)


def find_weekly_threads(reddit, season: int) -> list[str]:
    results = reddit.subreddit("Edgic").search(f"survivor {season} episode", limit=100)
    return [s.url for s in results]


def scrape_season(reddit, season: int) -> pd.DataFrame:
    raise NotImplementedError(
        "r/Edgic extraction not implemented yet; use inside_survivor or manual CSVs"
    )
