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

Main source is the [survivoR](https://github.com/doehm/survivoR) R package,
read straight from the json in its repo (the
[survivoR2py](https://github.com/stiles/survivoR2py) csv mirror is the
fallback, it stopped updating). Confessional counts per player per episode
back to season 1, plus boot order, votes, jury votes and advantages.
`snuffml fetch` caches it under `data/raw/`.

Edgic ratings (the CP/MOR/UTR/OTT codes with tone and visibility) have no
single public dataset, so there are two scrapers: the weekly charts Inside
Survivor published for roughly S31-S39, and the r/Edgic community survey
sheets for S41-S50. Hand-typed CSVs in `data/manual/edgic/` also work. One
thing I care about here: most edgic charts you find online were written by
people who already knew the winner. Every rating row carries a
`contemporaneous` flag and only ratings made week-of-airing go into the
features by default (which is why the S50 chart, compiled after the finale,
is stored but unused).

## Modeling notes

There's exactly one winner per season, so treating this as normal binary
classification is wrong. Instead the models score every player still alive at
each episode snapshot and the probabilities get renormalized within the
season. All cross-validation splits by season, and the headline numbers are
leave-one-season-out. Accuracy is a useless metric at this class balance, so
everything is reported as rank-of-winner, top-k, and log-loss skill against a
uniform baseline.

Four models, pick with `--model`:

- `blend` (default): geometric mean of the pooled logit and a new-era-only
  logit. The new era is edited differently enough that it earns its own
  model, but only ~9 usable seasons exist, so blending with the pooled model
  keeps the calibration. Old and middle era predictions stay pooled, blending
  those tested worse.
- `logit`: plain logistic regression, easy to interpret
- `hgb`: gradient boosting
- `gru`: per-player GRU over the episode sequence with a masked softmax over
  the season roster, averaged over seeds

Season 41 is treated as an outlier: still predicted and scored, never learned
from. Erika won off the lowest confessional share of any winner while the
edit pointed at everyone else, and keeping that season in training measurably
dragged down the fit on every other new-era season.

How well does it work? Leave-one-season-out over 50 seasons with the blend:
at the finale the eventual winner is the top pick 44% of the time and in the
top 3 94% of the time. On seasons with edgic coverage the edgic features
roughly double the log-loss skill. The new era (S41+) is still much harder,
the show spreads confessionals around almost evenly now; the r/Edgic ratings,
a zero-confessional-episode flag (new-era winners basically never have one)
and the era-blended model got the winner top-3 at all ten new-era finales.

Immunity timing turned out to matter more than immunity counts: late-merge
immunity wins point at the winner in every era, while winning early in the
merge is a threat signal that old-era winners specifically avoided (they won
less early immunity than losing finalists). Those features were the single
biggest gain in matched cv. The winner's original tribe also over-indexes on
pre-merge confessionals, a small but real effect (`orig_tribe_over`).
Demographic and current-tribe-share columns are in the data too; they tested
neutral-to-negative as model inputs at this sample size, so they're
study-only.

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
