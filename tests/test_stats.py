"""Tests for stats helpers."""

from polyscope.stats import (
    MIN_SAMPLE_FOR_PUBLISH,
    accuracy_bounds,
    wilson_interval,
)


def test_wilson_interval_zero_total():
    assert wilson_interval(0, 0) == (0.0, 0.0)


def test_wilson_interval_extremes():
    lo, hi = wilson_interval(10, 10)
    assert hi >= 0.9999  # clamped to ≤1, FP may give 0.9999…9
    assert lo > 0.65  # CI far from zero when p_hat=1 with n=10

    lo, hi = wilson_interval(0, 10)
    assert lo == 0.0
    assert hi < 0.35


def test_wilson_interval_small_sample_is_wide():
    # 3/5 = 60% — CI should span most of [0, 1]
    lo, hi = wilson_interval(3, 5)
    assert hi - lo > 0.5


def test_wilson_interval_large_sample_is_narrow():
    # 600/1000 = 60% — CI should be tight
    lo, hi = wilson_interval(600, 1000)
    assert 0.56 < lo < 0.58
    assert 0.62 < hi < 0.64


def test_accuracy_bounds_shape():
    result = accuracy_bounds(70, 100)
    assert set(result.keys()) == {"pct", "lo", "hi", "total", "correct", "sufficient"}
    assert result["pct"] == 70.0
    assert result["total"] == 100
    assert result["correct"] == 70
    assert result["sufficient"] is True
    assert result["lo"] < 70.0 < result["hi"]


def test_accuracy_bounds_insufficient_sample():
    result = accuracy_bounds(8, 10)
    assert result["sufficient"] is False
    assert result["pct"] == 80.0
    # CI must be wide
    assert result["hi"] - result["lo"] > 30


def test_accuracy_bounds_sufficiency_threshold():
    just_below = accuracy_bounds(20, MIN_SAMPLE_FOR_PUBLISH - 1)
    just_at = accuracy_bounds(20, MIN_SAMPLE_FOR_PUBLISH)
    assert just_below["sufficient"] is False
    assert just_at["sufficient"] is True


def test_accuracy_bounds_empty():
    result = accuracy_bounds(0, 0)
    assert result["pct"] == 0.0
    assert result["lo"] == 0.0
    assert result["hi"] == 0.0
    assert result["sufficient"] is False
