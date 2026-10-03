import pandas as pd

from snuffml.eval import audit
from snuffml.features import build as build_mod


def test_at_least_matches_binomial():
    # three fair coins: P(at least 2 heads) = 4/8
    assert abs(audit.at_least(2, [0.5, 0.5, 0.5]) - 0.5) < 1e-12
    assert audit.at_least(0, [0.1, 0.9]) == 1.0
    assert abs(audit.at_least(2, [0.1, 0.9]) - 0.09) < 1e-12


def test_only_features_restores_the_real_list():
    df = pd.DataFrame({c: [0.0] for c in audit.CONF + audit.GAME + audit.EDGIC})
    full = build_mod.feature_columns(df)
    with audit.only_features(audit.IMMUNITY):
        assert build_mod.feature_columns(df) == [c for c in full if c in audit.IMMUNITY]
    assert build_mod.feature_columns(df) == full


def test_outlier_seasons_restores_config():
    before = set(audit.config.OUTLIER_SEASONS)
    with audit.outlier_seasons(set()):
        assert audit.config.OUTLIER_SEASONS == set()
    assert audit.config.OUTLIER_SEASONS == before
