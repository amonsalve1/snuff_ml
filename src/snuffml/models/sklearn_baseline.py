"""sklearn baselines: logit + HistGradientBoosting.

Binary classifier on alive-castaway snapshots, Platt calibration on
season-grouped OOF preds, then renormalize within (season, episode) since
there's exactly one winner.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from snuffml import config
from snuffml.eval import splits
from snuffml.features import build as build_mod
from snuffml.models.normalize import normalize_by_group

CATEGORICAL = ["era"]


def make_pipeline(model: str, feature_cols: list[str]) -> Pipeline:
    numeric = [c for c in feature_cols if c not in CATEGORICAL]
    if model == "logit":
        # conf_time_ep is NaN where nothing was timed (has_time covers that),
        # impute 0 before scaling
        num_pipe = Pipeline(
            [
                ("impute", SimpleImputer(strategy="constant", fill_value=0.0)),
                ("scale", StandardScaler()),
            ]
        )
        pre = ColumnTransformer(
            [
                ("num", num_pipe, numeric),
                ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
            ]
        )
        clf = LogisticRegression(C=1.0, max_iter=5000, class_weight="balanced")
    elif model == "hgb":
        # hgb's binner crashes on an all-NaN column (conf_time_ep pre-s41),
        # impute constants; has_time keeps the missingness signal
        pre = ColumnTransformer(
            [
                ("num", SimpleImputer(strategy="constant", fill_value=0.0), numeric),
                ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL),
            ]
        )
        clf = HistGradientBoostingClassifier(
            max_depth=3,
            learning_rate=0.05,
            max_leaf_nodes=15,
            l2_regularization=1.0,
            max_iter=300,
            early_stopping=True,
            random_state=0,
        )
    else:
        raise ValueError(f"unknown model {model!r}; expected 'logit' or 'hgb'")
    return Pipeline([("pre", pre), ("clf", clf)])


def training_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Alive rows from finished seasons. Drops seasons where every confessional
    count is zero/missing (mirror placeholders) - pure label noise otherwise."""
    has_winner = df.groupby("season")["is_winner"].transform("any")
    has_edit_data = df.groupby("season")["conf_ep"].transform("sum") > 0
    return df[df["in_game"] & has_winner & has_edit_data].copy()


@dataclass
class WinnerModel:
    model_type: str
    feature_cols: list[str]
    pipeline: Pipeline
    calibrator: LogisticRegression | None = None
    trained_through: int | None = None
    meta: dict = field(default_factory=dict)

    def raw_prob(self, rows: pd.DataFrame) -> np.ndarray:
        p = self.pipeline.predict_proba(rows[self.feature_cols])[:, 1]
        if self.calibrator is not None:
            logit = np.log(np.clip(p, 1e-9, 1 - 1e-9) / (1 - np.clip(p, 1e-9, 1 - 1e-9)))
            p = self.calibrator.predict_proba(logit.reshape(-1, 1))[:, 1]
        return p

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        rows = df[df["in_game"]].copy()
        rows["raw_prob"] = self.raw_prob(rows)
        return normalize_by_group(rows)

    def save(self, path: Path) -> None:
        joblib.dump(self, path)

    @staticmethod
    def load(path: Path) -> "WinnerModel":
        return joblib.load(path)


@dataclass
class EraBlendModel:
    """Geometric mean of a pooled model and a same-era model.

    Era-only models rank finales better but calibrate badly on so few
    seasons; pooled is the reverse. The blend keeps most of both.
    """

    model_type: str
    pooled: "WinnerModel"
    era_models: dict[str, "WinnerModel"]
    trained_through: int | None = None

    def raw_prob(self, rows: pd.DataFrame) -> np.ndarray:
        p = self.pooled.raw_prob(rows)
        for era, m in self.era_models.items():
            mask = (rows["era"] == era).to_numpy()
            if mask.any():
                p_era = m.raw_prob(rows[mask])
                p[mask] = np.sqrt(p[mask] * p_era)
        return p

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        rows = df[df["in_game"]].copy()
        rows["raw_prob"] = self.raw_prob(rows)
        return normalize_by_group(rows)

    def save(self, path: Path) -> None:
        joblib.dump(self, path)

    @staticmethod
    def load(path: Path) -> "EraBlendModel":
        return joblib.load(path)


MIN_ERA_SEASONS = 5  # need at least this many seasons to fit an era model

# only the new era gets a blend. tried all three: new era finale top1
# doubled, old/middle got worse
BLEND_ERAS = {"new"}


def train_blend(
    df: pd.DataFrame, base_model: str = "logit", *, through_season: int | None = None
) -> EraBlendModel:
    pooled = train(df, base_model, through_season=through_season)
    era_models = {}
    for era in BLEND_ERAS & set(df["era"].dropna().unique()):
        era_df = df[df["era"] == era]
        rows = training_frame(era_df)
        rows = rows[~rows["season"].isin(config.OUTLIER_SEASONS)]
        n_seasons = rows["season"].nunique()
        if n_seasons < MIN_ERA_SEASONS:
            continue
        era_models[era] = train(era_df, base_model, through_season=through_season)
    return EraBlendModel(
        model_type=f"blend[{base_model}]",
        pooled=pooled,
        era_models=era_models,
        trained_through=pooled.trained_through,
    )


def _fit_calibrator(raw: np.ndarray, y: np.ndarray) -> LogisticRegression:
    logit = np.log(np.clip(raw, 1e-9, 1 - 1e-9) / (1 - np.clip(raw, 1e-9, 1 - 1e-9)))
    cal = LogisticRegression(max_iter=5000)
    cal.fit(logit.reshape(-1, 1), y)
    return cal


def train(
    df: pd.DataFrame,
    model: str = "hgb",
    *,
    through_season: int | None = None,
    calibrate: bool = True,
) -> WinnerModel:
    feature_cols = build_mod.feature_columns(df) + CATEGORICAL
    rows = training_frame(df)
    # outlier seasons are still predicted and scored, just not learned from
    rows = rows[~rows["season"].isin(config.OUTLIER_SEASONS)]
    if through_season is not None:
        rows = rows[rows["season"] <= through_season]
    y = rows["is_winner"].astype(int).to_numpy()

    calibrator = None
    n_seasons = rows["season"].nunique()
    if calibrate and n_seasons >= 2:
        # platt fit on season-grouped oof probs; fewer folds when the training
        # set is small (era models)
        oof = np.full(len(rows), np.nan)
        for train_idx, test_idx in splits.season_folds(rows, n_splits=min(5, n_seasons)):
            pipe = make_pipeline(model, feature_cols)
            pipe.fit(rows.iloc[train_idx][feature_cols], y[train_idx])
            oof[test_idx] = pipe.predict_proba(rows.iloc[test_idx][feature_cols])[:, 1]
        calibrator = _fit_calibrator(oof, y)

    pipeline = make_pipeline(model, feature_cols)
    pipeline.fit(rows[feature_cols], y)
    return WinnerModel(
        model_type=model,
        feature_cols=feature_cols,
        pipeline=pipeline,
        calibrator=calibrator,
        trained_through=through_season or int(rows["season"].max()),
    )


def fit(df: pd.DataFrame, model: str = "hgb", *, through_season: int | None = None):
    """train() or train_blend() depending on the model name."""
    if model == "blend":
        return train_blend(df, through_season=through_season)
    return train(df, model, through_season=through_season)


def cross_val_predictions(
    df: pd.DataFrame, model: str = "hgb", *, loso: bool = False
) -> pd.DataFrame:
    """OOF win distributions. Each fold reruns the whole training path,
    calibration included, so the eval is honest."""
    rows = training_frame(df).reset_index(drop=True)

    preds = []
    fold_iter = (
        ((s, tr, te) for s, tr, te in splits.loso_folds(rows))
        if loso
        else ((None, tr, te) for tr, te in splits.season_folds(rows, n_splits=5))
    )
    for _, train_idx, test_idx in fold_iter:
        fold_df = rows.iloc[train_idx]
        m = train_blend(fold_df) if model == "blend" else train(fold_df, model)
        test = rows.iloc[test_idx].copy()
        test["raw_prob"] = m.raw_prob(test)
        preds.append(test)
    out = pd.concat(preds, ignore_index=True)
    return normalize_by_group(out)


def model_path(model: str, through_season: int) -> Path:
    return config.MODELS_DIR / f"{model}_through_s{through_season}.joblib"
