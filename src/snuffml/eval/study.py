"""The retrospective study: LOSO eval, era splits, feature importance.
Dumps everything under reports/retrospective/."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.inspection import permutation_importance

from snuffml import config
from snuffml.eval import metrics, splits
from snuffml.models import sklearn_baseline as skb

MODELS = ["logit", "hgb"]


def _era_of_row(s: pd.Series) -> str:
    return s.map(lambda x: config.era_of(int(x)))


def run(df: pd.DataFrame, *, loso: bool = True) -> Path:
    out = config.REPORTS_DIR / "retrospective"
    out.mkdir(parents=True, exist_ok=True)

    all_snapshots = {}
    for model in MODELS:
        preds = skb.cross_val_predictions(df, model, loso=loso)
        snap = metrics.snapshot_metrics(preds)
        snap["era"] = _era_of_row(snap["season"])
        all_snapshots[model] = snap
        preds.to_parquet(out / f"preds_{model}.parquet", index=False)

        metrics.summarize(snap).to_csv(out / f"summary_{model}.csv", index=False)
        metrics.finale_metrics(snap).to_frame("value").to_csv(out / f"finale_{model}.csv")
        snap.groupby("era", observed=True)[
            ["winner_rank", "top1", "top3", "winner_prob", "skill"]
        ].mean().to_csv(out / f"era_split_{model}.csv")

    _era_holdout_experiment(df, out)
    _feature_importance(df, out)
    _figures(all_snapshots, out)
    _write_report(all_snapshots, out, loso=loso)
    return out


def _era_holdout_experiment(df: pd.DataFrame, out: Path) -> None:
    """does an old-era model transfer? train <= S40, score on S41+"""
    rows = skb.training_frame(df)
    results = []
    for model in MODELS:
        m = skb.train(rows[rows["season"] < splits.ERA_HOLDOUT_BOUNDARY], model)
        test = rows[rows["season"] >= splits.ERA_HOLDOUT_BOUNDARY]
        preds = m.predict(test)
        snap = metrics.snapshot_metrics(preds)
        fin = metrics.finale_metrics(snap)
        fin["model"] = model
        results.append(fin)
    pd.DataFrame(results).set_index("model").to_csv(out / "era_holdout.csv")


def _feature_importance(df: pd.DataFrame, out: Path) -> None:
    rows = skb.training_frame(df)

    # standardized logit coefs
    logit = skb.train(rows, "logit", calibrate=False)
    pre = logit.pipeline.named_steps["pre"]
    clf = logit.pipeline.named_steps["clf"]
    names = pre.get_feature_names_out()
    pd.DataFrame({"feature": names, "coef": clf.coef_[0]}).sort_values(
        "coef", key=abs, ascending=False
    ).to_csv(out / "logit_coefficients.csv", index=False)

    # permutation importance for hgb, scored on the era holdout with log-loss
    hgb = skb.train(rows[rows["season"] < splits.ERA_HOLDOUT_BOUNDARY], "hgb", calibrate=False)
    test = rows[rows["season"] >= splits.ERA_HOLDOUT_BOUNDARY]
    imp = permutation_importance(
        hgb.pipeline,
        test[hgb.feature_cols],
        test["is_winner"].astype(int),
        scoring="neg_log_loss",
        n_repeats=10,
        random_state=0,
    )
    pd.DataFrame(
        {
            "feature": hgb.feature_cols,
            "importance": imp.importances_mean,
            "std": imp.importances_std,
        }
    ).sort_values("importance", ascending=False).to_csv(out / "hgb_permutation_importance.csv", index=False)


def _figures(all_snapshots: dict[str, pd.DataFrame], out: Path) -> None:
    fig, ax = plt.subplots(figsize=(8, 5))
    for model, snap in all_snapshots.items():
        n_eps = snap.groupby("season")["episode"].transform("max")
        frac = snap["episode"] / n_eps
        bucket = (frac * 10).round() / 10
        curve = snap.groupby(bucket)["winner_prob"].mean()
        ax.plot(curve.index, curve.values, marker="o", label=model)
    snap0 = next(iter(all_snapshots.values()))
    n_eps = snap0.groupby("season")["episode"].transform("max")
    bucket = ((snap0["episode"] / n_eps) * 10).round() / 10
    uniform = (1 / snap0["n_alive"]).groupby(bucket).mean()
    ax.plot(uniform.index, uniform.values, linestyle="--", color="gray", label="uniform baseline")
    ax.set_xlabel("season progress")
    ax.set_ylabel("mean probability assigned to eventual winner")
    ax.set_title("Winner probability vs season progress (LOSO out-of-sample)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out / "winner_prob_curve.png", dpi=150)
    plt.close(fig)


def _write_report(all_snapshots: dict[str, pd.DataFrame], out: Path, *, loso: bool) -> None:
    lines = [
        "# Retrospective study - what does the edit know?",
        "",
        f"Evaluation: {'leave-one-season-out' if loso else 'GroupKFold-5 by season'} "
        "over completed US seasons with confessional data. All probabilities are "
        "out-of-sample and normalized within (season, episode) over alive players.",
        "",
    ]
    for model, snap in all_snapshots.items():
        fin = metrics.finale_metrics(snap)
        lines += [
            f"## {model}",
            "",
            f"- Finale snapshot: winner ranked #1 in {fin['top1']:.0%} of seasons, "
            f"top-3 in {fin['top3']:.0%}; mean winner probability {fin['winner_prob']:.1%}; "
            f"log-loss skill vs uniform {fin['skill']:+.3f}.",
            "",
            "Progress buckets (season quarters):",
            "",
            metrics.summarize(snap).round(3).to_markdown(index=False),
            "",
            "By era:",
            "",
            snap.groupby("era", observed=True)[["winner_rank", "top1", "top3", "winner_prob", "skill"]]
            .mean()
            .round(3)
            .to_markdown(),
            "",
        ]
    lines += [
        "![winner probability curve](winner_prob_curve.png)",
        "",
        "Artifacts: `logit_coefficients.csv`, `hgb_permutation_importance.csv`, "
        "`era_holdout.csv`, `preds_*.parquet`.",
    ]
    (out / "README.md").write_text("\n".join(lines) + "\n")
