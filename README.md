# snuffml

Predicting the winner of Survivor (US) from the edit: confessional counts plus
community edgic ratings. Started as a way to work through Machine Learning with
PyTorch & Scikit-Learn on a dataset I actually care about, so the modeling goes
sklearn first, then a small PyTorch model.

Two things it can do:

- rank every remaining player's win probability after each episode of an
  airing season
- a retrospective study over ~46 finished seasons of which edit features
  actually predict winners (output lands in `reports/retrospective/`)

## Setup

```bash
uv sync
uv run snuffml fetch                 # pull the survivoR2py data mirror
uv run snuffml build                 # build the feature panel
uv run snuffml predict --season 46 --model logit
uv run snuffml backtest --season 45  # replay a season out-of-sample
uv run snuffml study --loso          # rerun the full study (slow)
uv run pytest -m "not slow"
```

Needs Python 3.12+.

## Data

Main source is [survivoR2py](https://github.com/stiles/survivoR2py), a daily
CSV mirror of the [survivoR](https://github.com/doehm/survivoR) R package. It
has confessional counts per player per episode back to season 1, plus boot
order, votes, jury votes and advantages. `snuffml fetch` caches it under
`data/raw/`.

Edgic ratings (the CP/MOR/UTR/OTT codes with tone and visibility) have no
public dataset anywhere, so there's a scraper for the weekly charts Inside
Survivor used to publish (roughly S31-S39), plus support for hand-typed CSVs in
`data/manual/edgic/`. One thing I care about here: most edgic charts you find
online were written by people who already knew the winner. Every rating row
carries a `contemporaneous` flag and only ratings made week-of-airing go into
the features by default.

## Modeling notes

There's exactly one winner per season, so treating this as normal binary
classification is wrong. Instead the models score every player still alive at
each episode snapshot and the probabilities get renormalized within the
season. All cross-validation splits by season, and the headline numbers are
leave-one-season-out. Accuracy is a useless metric at this class balance, so
everything is reported as rank-of-winner, top-k, and log-loss skill against a
uniform baseline.

Three models, pick with `--model`:

- `logit`: plain logistic regression, best ranker so far and easy to interpret
- `hgb`: gradient boosting
- `gru`: per-player GRU over the episode sequence with a masked softmax over
  the season roster, averaged over seeds

How well does it work? At the finale the eventual winner is the top pick about
46% of the time and in the top 3 about 89% of the time. On seasons with edgic
coverage the edgic features roughly double the log-loss skill and push finale
top-1 to 62.5%. The new era (S41+) is much harder, the show spreads
confessionals around pretty evenly now and nobody publishes edgic for it.

## Layout

```
src/snuffml/
  config.py        paths, eras, name aliases
  data/            survivor2py mirror, edgic ingestion + scrapers
  features/        panel, edit, gameplay, edgic, build
  models/          sklearn_baseline, torch_seq, normalize
  eval/            splits, metrics, backtest, study
  report.py, cli.py
tests/
```

The tests run on synthetic fixture seasons, no network needed. The one to know
about is `test_leakage.py`: it rebuilds the features with all future episodes
scrambled (different winner included) and asserts the past features come out
bit-identical. If a new feature breaks that test it's peeking at the future.
