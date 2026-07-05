"""snuffml command-line interface."""

from __future__ import annotations

import typer
from rich.console import Console

from snuffml import config

app = typer.Typer(no_args_is_help=True, pretty_exceptions_show_locals=False)
console = Console()


@app.command()
def fetch(force: bool = typer.Option(False, "--force", help="Ignore cache freshness")) -> None:
    """Refresh the survivoR2py raw cache."""
    from snuffml.data import survivor2py

    for path in survivor2py.fetch_all(force=force):
        console.print(f"[green]cached[/green] {path.name}")


@app.command()
def build(fetch_data: bool = typer.Option(True, help="Fetch missing tables")) -> None:
    """Build panel + features parquet."""
    from snuffml.features import build as build_mod

    df = build_mod.build_features(fetch=fetch_data)
    console.print(
        f"features built: {len(df):,} rows, seasons {df['season'].min()}-{df['season'].max()}"
    )


@app.command("build-edgic")
def build_edgic(
    seasons: str = typer.Option(None, help="Comma-separated seasons to scrape from Inside Survivor"),
    no_scrape: bool = typer.Option(False, "--no-scrape", help="Only rebuild from manual CSVs"),
) -> None:
    """Scrape/assemble edgic ratings into data/interim/edgic.parquet."""
    import pandas as pd

    from snuffml.data import edgic as edgic_data

    scraped = None
    if seasons and not no_scrape:
        from snuffml.data.edgic_scrapers import inside_survivor

        frames = []
        for s in [int(x) for x in seasons.split(",")]:
            console.print(f"scraping Inside Survivor edgic for season {s}")
            frames.append(inside_survivor.scrape_season(s))
        scraped = pd.concat(frames, ignore_index=True)
    out = edgic_data.build(scraped=scraped)
    n_contemp = int(out["contemporaneous"].sum()) if len(out) else 0
    console.print(
        f"edgic.parquet: {len(out)} ratings, {n_contemp} contemporaneous, "
        f"seasons {sorted(edgic_data.covered_seasons(out)) if len(out) else []}"
    )
    console.print("re-run `snuffml build` to fold edgic into features")


@app.command()
def train(
    model: str = typer.Option("hgb", help="hgb | logit | gru"),
    through_season: int = typer.Option(None, help="Train on seasons <= this (default: all completed)"),
) -> None:
    """Train a winner model on completed seasons and save it."""
    from snuffml.features import build as build_mod

    df = build_mod.load_features()
    if model == "gru":
        from snuffml.models import torch_seq

        m = torch_seq.train(df, through_season=through_season)
        path = torch_seq.model_path(m.trained_through)
        m.save(path)
    else:
        from snuffml.models import sklearn_baseline as skb

        m = skb.train(df, model, through_season=through_season)
        path = skb.model_path(model, m.trained_through)
        m.save(path)
    console.print(f"[green]saved[/green] {path}")


@app.command()
def predict(
    season: int = typer.Option(..., help="Season to predict"),
    episode: int = typer.Option(None, help="Episode number (default: latest with data)"),
    model: str = typer.Option("hgb", help="hgb | logit | gru"),
    refresh: bool = typer.Option(True, help="Refresh data + rebuild features first"),
) -> None:
    """Emit ranked win probabilities for a season after a given episode."""
    from snuffml import report
    from snuffml.features import build as build_mod

    df = build_mod.build_features() if refresh else build_mod.load_features()

    season_df = df[df["season"] == season]
    if season_df.empty:
        raise typer.BadParameter(f"no data for season {season}")
    if episode is None:
        # default to the latest episode that actually has confessional counts
        has_data = season_df.groupby("episode")["conf_ep"].sum()
        with_data = has_data[has_data > 0]
        if with_data.empty:
            raise typer.BadParameter(
                f"season {season} has no confessional counts in the survivoR2py mirror yet; "
                "counts usually land within a day or two of airing (try `snuffml fetch --force`)"
            )
        episode = int(with_data.index.max())

    m = _load_model(model, df, exclude_season=season)
    preds = m.predict(season_df[season_df["episode"] <= episode])
    report.render_terminal(preds, season, episode, model)
    md = report.write_markdown(preds, season, episode, model)
    report.append_history(preds, season, episode, model)
    console.print(f"report: {md}")


@app.command()
def backtest(
    season: int = typer.Option(..., help="Completed season to replay"),
    model: str = typer.Option("hgb", help="hgb | logit | gru"),
) -> None:
    """Replay a completed season episode-by-episode with a model trained without it."""
    from snuffml.eval import backtest as bt
    from snuffml.features import build as build_mod

    df = build_mod.load_features()
    result = bt.replay_season(df, season, model)
    bt.render_replay(result, season, model)


@app.command()
def study(loso: bool = typer.Option(False, help="Leave-one-season-out (slow, honest)")) -> None:
    """Regenerate the retrospective study artifacts."""
    from snuffml.eval import study as study_mod
    from snuffml.features import build as build_mod

    df = build_mod.load_features()
    out = study_mod.run(df, loso=loso)
    console.print(f"study artifacts written to {out}")


def _load_model(model: str, df, exclude_season: int | None = None):
    # dropping the target season from training keeps predictions for completed
    # seasons honest; an airing season has no winner rows yet, so no loss there
    from snuffml.models import sklearn_baseline as skb

    train_df = df[df["season"] != exclude_season] if exclude_season is not None else df
    eligible = skb.training_frame(train_df)["season"]
    tag = f"excl_s{exclude_season}" if exclude_season is not None else f"through_s{int(eligible.max())}"

    if model == "gru":
        from snuffml.models import torch_seq

        path = config.MODELS_DIR / f"gru_{tag}.pt"
        if path.exists():
            return torch_seq.GRUWinnerModel.load(path)
        m = torch_seq.train(train_df)
    else:
        path = config.MODELS_DIR / f"{model}_{tag}.joblib"
        if path.exists():
            return skb.WinnerModel.load(path)
        m = skb.train(train_df, model)
    config.ensure_dirs()
    m.save(path)
    return m


if __name__ == "__main__":
    app()
