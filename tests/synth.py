"""Two fake mini-seasons in the survivoR2py raw schema: 8 players, 7 episodes,
S39 (middle era) and S41 (new era). P8 boots first, then P7, and so on down to
a P1/P2 final two; P1 wins 4-1 and gets the rising confessional edit."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

SEASONS = [39, 41]
N_PLAYERS = 8
N_EPISODES = 7


def _pid(season: int, i: int) -> str:
    return f"S{season}P{i}"


def _players(season: int) -> list[dict]:
    return [
        {
            "castaway_id": _pid(season, i),
            "castaway": f"Player{i}",
            "gender": "Female" if i % 2 == 0 else "Male",
        }
        for i in range(1, N_PLAYERS + 1)
    ]


def _boot_episode(i: int) -> int | None:
    if i >= 3:
        return N_PLAYERS + 1 - i  # P8 -> ep1, P7 -> ep2, ..., P3 -> ep6
    return None


def _conf_count(season: int, i: int, ep: int) -> float:
    if i == 1:  # winner: rising edit
        return 2.0 + ep
    if i == 2:  # runner-up: flat-high
        return 4.0
    if i == 4 and ep == 2:  # P4 gets a zero-confessional episode
        return 0.0
    return 2.0


def make_tables(seasons: list[int] | None = None) -> dict[str, pd.DataFrame]:
    seasons = seasons or SEASONS
    conf, castaways, boot, eps, jury, votes, details, summary = [], [], [], [], [], [], [], []
    for season in seasons:
        vs = f"US{season:02d}"
        players = _players(season)
        for i, p in enumerate(players, start=1):
            details.append(
                {
                    "castaway_id": p["castaway_id"],
                    "gender": p["gender"],
                    "bipoc": i % 3 == 0,
                }
            )
        for i, p in enumerate(players, start=1):
            booted = _boot_episode(i)
            castaways.append(
                {
                    "version": "US",
                    "version_season": vs,
                    "season": season,
                    "castaway_id": p["castaway_id"],
                    "castaway": p["castaway"],
                    "age": 25 + 2 * i,
                    "result": "Sole Survivor" if i == 1 else "Runner-up" if i == 2 else "Voted out",
                    "winner": i == 1,
                    "finalist": i <= 2,
                    "jury": 3 <= i <= 7,
                    "order": (N_PLAYERS + 1 - i) if booted else N_PLAYERS,
                }
            )
        for ep in range(1, N_EPISODES + 1):
            eps.append(
                {
                    "version": "US",
                    "version_season": vs,
                    "season": season,
                    "episode": ep,
                    "episode_length": 44.0,
                }
            )
            alive = [
                (i, p)
                for i, p in enumerate(players, start=1)
                if _boot_episode(i) is None or _boot_episode(i) >= ep
            ]
            for i, p in alive:
                boot.append(
                    {
                        "version": "US",
                        "version_season": vs,
                        "season": season,
                        "episode": ep,
                        "sog_id": ep,
                        "castaway_id": p["castaway_id"],
                        "castaway": p["castaway"],
                        # odd players start on Tagi, even on Pagong, merge at ep 4
                        "tribe": "Merged" if ep >= 4 else ("Tagi" if i % 2 else "Pagong"),
                        "tribe_status": "Merged" if ep >= 4 else "Original",
                        "game_status": "In the game",
                        "final_n": 2,
                    }
                )
                cnt = _conf_count(season, i, ep)
                conf.append(
                    {
                        "version": "US",
                        "version_season": vs,
                        "season": season,
                        "episode": ep,
                        "castaway": p["castaway"],
                        "castaway_id": p["castaway_id"],
                        "confessional_count": cnt,
                        "confessional_time": cnt * 20.0 if season >= 41 else None,
                        "index_count": cnt / 2.5,
                        "index_time": None,
                    }
                )
            if ep <= 6:  # one boot per episode; everyone votes for the bootee
                bootee_i = N_PLAYERS + 1 - ep
                bootee = _pid(season, bootee_i)
                for i, p in alive:
                    if i == bootee_i:
                        continue
                    votes.append(
                        {
                            "version": "US",
                            "version_season": vs,
                            "season": season,
                            "episode": ep,
                            "castaway_id": p["castaway_id"],
                            "vote_id": bootee,
                            "voted_out_id": bootee,
                        }
                    )
        for juror_i in range(3, 8):  # 5 jurors: 4 vote P1, one votes P2
            jury.append(
                {
                    "version": "US",
                    "version_season": vs,
                    "season": season,
                    "castaway_id": _pid(season, juror_i),
                    "finalist_id": _pid(season, 1 if juror_i > 3 else 2),
                    "vote": 1.0,
                }
            )
        summary.append(
            {
                "version": "US",
                "version_season": vs,
                "season": season,
                "winner_id": _pid(season, 1),
                "n_cast": N_PLAYERS,
            }
        )
    advantage_movement = pd.DataFrame(
        columns=["version", "version_season", "season", "episode", "castaway_id", "event"]
    )
    # tribes merge at ep 4, so ep 4-6 are "early merge" and ep 7 is "late".
    # P2 wins immunity early, P1 (the winner) wins it late.
    challenge_results = pd.DataFrame(
        [
            {
                "version": "US",
                "version_season": f"US{season:02d}",
                "season": season,
                "episode": ep,
                "castaway_id": _pid(season, i),
                "challenge_type": "Immunity",
                "won_individual_immunity": 1.0,
            }
            for season in seasons
            for i, ep in [(2, 4), (1, 7)]
        ]
    )
    return {
        "advantage_movement": advantage_movement,
        "challenge_results": challenge_results,
        "confessionals": pd.DataFrame(conf),
        "castaways": pd.DataFrame(castaways),
        "boot_mapping": pd.DataFrame(boot),
        "episodes": pd.DataFrame(eps),
        "jury_votes": pd.DataFrame(jury),
        "vote_history": pd.DataFrame(votes),
        "castaway_details": pd.DataFrame(details),
        "season_summary": pd.DataFrame(summary),
    }


def write_raw(dest: Path, tables: dict[str, pd.DataFrame] | None = None) -> None:
    tables = tables or make_tables()
    dest.mkdir(parents=True, exist_ok=True)
    for name, frame in tables.items():
        frame.to_csv(dest / f"{name}.csv", index=False)
