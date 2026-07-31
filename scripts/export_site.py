"""Exports the loso predictions to json for the docs/ site."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from snuffml import config
from snuffml.models.sklearn_baseline import EraBlendModel, WinnerModel  # noqa: F401

# feature -> (phrase when pushing up, phrase when pushing down)
FEATURE_LABELS: dict[str, tuple[str, str]] = {
    "conf_ep": ("big confessional episode", "quiet episode"),
    "conf_time_ep": ("lots of confessional screen time", "little confessional screen time"),
    "has_time": ("timing data exists this season", "no timing data this season"),
    "conf_cum": ("many confessionals so far", "few confessionals so far"),
    "conf_share_ep": ("large share of this episode", "small share of this episode"),
    "conf_share_cum": ("large cumulative confessional share", "small cumulative confessional share"),
    "conf_z_cum": ("well above average airtime", "well below average airtime"),
    "index_resid_cum": ("camera likes them beyond game events", "camera avoids them given game events"),
    "premiere_share": ("strong premiere presence", "invisible premiere"),
    "late_clustering": ("airtime clustering late", "airtime fading late"),
    "conf_trend": ("rising confessional trend", "falling confessional trend"),
    "is_female": ("model prior: female winners run quieter edits", "model prior: female winners run quieter edits"),
    "female_x_share_cum": ("model prior: share adjusted for gender", "model prior: share adjusted for gender"),
    "new_era_x_share_cum": ("high share in the new era", "low share in the new era"),
    "zero_any": ("no zero-confessional episodes", "has a zero-confessional episode"),
    "zero_any_x_new": ("clean sheet in the new era", "zero-confessional episode in the new era - near fatal"),
    "orig_tribe_over": ("starting tribe got the airtime", "starting tribe got buried"),
    "early_flag": ("early confessional frontrunner", "not the early frontrunner"),
    "early_flag_x_new": ("early frontrunner in the new era - historically a curse", "early frontrunner in the new era - historically a curse"),
    "vfb_cum": ("votes with the majority", "votes against the majority"),
    "vote_acc_cum": ("high voting accuracy", "low voting accuracy"),
    "votes_against_cum": ("collects votes at tribal", "rarely receives votes"),
    "adv_events_cum": ("finds advantages", "no advantage story"),
    "imm_early_cum": ("early merge immunity wins", "no early merge immunities"),
    "imm_late_cum": ("late merge immunity wins", "no late merge immunities"),
    "imm_early_x_old": ("early immunity in the old era - threat signal", "early immunity in the old era - threat signal"),
    "edgic_available": ("edgic coverage exists", "no edgic coverage"),
    "cp_share": ("complex-personality edit", "one-note edit"),
    "cpx_count": ("high-visibility complex episodes", "no big complex episodes"),
    "ott_count": ("over-the-top episodes - winners rarely have them", "no over-the-top episodes"),
    "inv_count": ("invisible episodes", "never invisible"),
    "utr_share": ("under-the-radar edit", "rarely under the radar"),
    "tone_consistency": ("consistently positive tone", "negative or mixed tone"),
    "tone_flips": ("tone flip-flops", "steady tone"),
    "visibility_mean": ("high edgic visibility", "low edgic visibility"),
    "visibility_z": ("more visible than the cast", "less visible than the cast"),
}


def strip_prefix(name: str) -> str:
    for p in ("num__", "cat__"):
        if name.startswith(p):
            return name[len(p):]
    return name


def logit_contributions(model: WinnerModel, rows: pd.DataFrame) -> pd.DataFrame:
    pre = model.pipeline.named_steps["pre"]
    clf = model.pipeline.named_steps["clf"]
    x = pre.transform(rows[model.feature_cols])
    if hasattr(x, "toarray"):
        x = x.toarray()
    names = [strip_prefix(n) for n in pre.get_feature_names_out()]
    return pd.DataFrame(x * clf.coef_[0], columns=names, index=rows.index)


def blend_contributions(blend: EraBlendModel, rows: pd.DataFrame) -> pd.DataFrame:
    # sqrt(p_pooled * p_era) is the mean of the two logits, so average the
    # contribution vectors where the era model applies
    contrib = logit_contributions(blend.pooled, rows)
    for era, m in blend.era_models.items():
        mask = rows["era"] == era
        if mask.any():
            era_c = logit_contributions(m, rows[mask])
            both = contrib.columns.intersection(era_c.columns)
            contrib.loc[mask, both] = (contrib.loc[mask, both] + era_c[both]) / 2
    return contrib


def top_k_why(contrib_row: pd.Series, k: int = 3) -> list[list]:
    row = contrib_row[[c for c in contrib_row.index if not c.startswith("era_")]]
    row = row[row.abs() > 1e-4].sort_values()
    down = row.head(k)
    up = row.tail(k).iloc[::-1]
    out = [[key, round(float(v), 3)] for key, v in up.items() if v > 0]
    out += [[key, round(float(v), 3)] for key, v in down.items() if v < 0]
    return out


def season_outcome(season_preds: pd.DataFrame) -> str:
    last = season_preds[season_preds["episode"] == season_preds["episode"].max()]
    last = last.sort_values("win_prob", ascending=False).reset_index(drop=True)
    if not last["is_winner"].any():
        return "edge return"  # s38, chris won from the edge
    rank = last.index[last["is_winner"]][0] + 1
    if rank == 1:
        return "called"
    if rank <= 3:
        return "top3"
    return "missed"
