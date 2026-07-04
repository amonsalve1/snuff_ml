"""Glue: run panel + feature modules, write features.parquet and the manifest."""

from __future__ import annotations

import json

import pandas as pd

from snuffml import config
from snuffml.features import edit, panel as panel_mod
from snuffml.features.panel import LABEL_COLUMNS

KEY_COLUMNS = ["season", "episode", "castaway_id", "castaway"]


def feature_columns(df: pd.DataFrame) -> list[str]:
    cols = list(edit.EDIT_FEATURES)
    try:
        from snuffml.features import gameplay

        cols += [c for c in gameplay.GAMEPLAY_FEATURES if c in df.columns]
    except ImportError:
        pass
    try:
        from snuffml.features import edgic as edgic_mod

        cols += [c for c in edgic_mod.EDGIC_FEATURES if c in df.columns]
    except ImportError:
        pass
    return [c for c in cols if c in df.columns]


def build_features(*, fetch: bool = True, include_gameplay: bool = True) -> pd.DataFrame:
    df = panel_mod.build_panel(fetch=fetch)
    df = edit.add_edit_features(df, fetch=fetch)
    manifest: dict[str, str] = {c: "features.edit" for c in edit.EDIT_FEATURES}

    if include_gameplay:
        try:
            from snuffml.features import gameplay

            df = gameplay.add_gameplay_features(df, fetch=fetch)
            manifest.update({c: "features.gameplay" for c in gameplay.GAMEPLAY_FEATURES})
        except ImportError:
            pass

    try:
        from snuffml.features import edgic as edgic_mod

        df = edgic_mod.add_edgic_features(df)
        manifest.update({c: "features.edgic" for c in edgic_mod.EDGIC_FEATURES if c in df.columns})
    except (ImportError, FileNotFoundError):
        pass

    config.ensure_dirs()
    df.to_parquet(config.PROCESSED_DIR / "features.parquet", index=False)
    (config.PROCESSED_DIR / "feature_manifest.json").write_text(
        json.dumps(
            {
                "features": manifest,
                "labels": LABEL_COLUMNS,
                "keys": KEY_COLUMNS,
            },
            indent=2,
        )
    )
    return df


def load_features() -> pd.DataFrame:
    path = config.PROCESSED_DIR / "features.parquet"
    if not path.exists():
        raise FileNotFoundError("features.parquet missing; run `snuffml build`")
    return pd.read_parquet(path)
