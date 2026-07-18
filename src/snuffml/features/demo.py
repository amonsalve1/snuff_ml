"""Demographic columns. The edit treats demographics differently (female
winners get about half the confessional volume of male ones, for a start).
These tested slightly negative in cv for the logit (n=49 winners is just too
small for more interactions, gender is already in the base set), so they're
built for the study but not in the default model features.
"""

from __future__ import annotations

import pandas as pd

from snuffml.data import survivor2py

DEMO_FEATURES = [
    "age",
    "is_poc",
    "poc_x_share_cum",
    "female_x_zero_conf",
]


def add_demo_features(panel: pd.DataFrame, *, fetch: bool = True) -> pd.DataFrame:
    castaways = survivor2py.load_table("castaways", fetch=fetch)
    details = survivor2py.load_table("castaway_details", fetch=fetch)

    age = (
        castaways.dropna(subset=["season"])
        .groupby(["season", "castaway_id"], as_index=False)
        .agg(age=("age", "first"))
    )
    df = panel.merge(age, on=["season", "castaway_id"], how="left")
    df["age"] = df["age"].fillna(df["age"].median())

    poc = details.drop_duplicates("castaway_id")[["castaway_id", "bipoc"]]
    df = df.merge(poc, on="castaway_id", how="left")
    df["is_poc"] = df["bipoc"].fillna(False).astype(float)
    df = df.drop(columns=["bipoc"])

    df["poc_x_share_cum"] = df["is_poc"] * df["conf_share_cum"]
    df["female_x_zero_conf"] = df["is_female"] * df["zero_conf_eps"]
    return df
