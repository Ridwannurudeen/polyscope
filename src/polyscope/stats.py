"""Statistical helpers — confidence intervals, sample-size thresholds."""

from __future__ import annotations

import math

# Below this sample size, accuracy % is too noisy to publish.
MIN_SAMPLE_FOR_PUBLISH = 30

# z-score for 95% two-sided confidence interval.
_Z_95 = 1.959963984540054


def wilson_interval(correct: int, total: int, z: float = _Z_95) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion.

    Returns (low, high) bounds as fractions in [0, 1]. Wilson is preferred
    over Normal-approx on small samples and near 0/1 — which is exactly
    our regime (few resolved signals per trader).
    """
    if total <= 0:
        return (0.0, 0.0)
    p_hat = correct / total
    denom = 1 + z * z / total
    center = (p_hat + z * z / (2 * total)) / denom
    half = (z * math.sqrt(p_hat * (1 - p_hat) / total + z * z / (4 * total * total))) / denom
    lo = max(0.0, center - half)
    hi = min(1.0, center + half)
    return (lo, hi)


def accuracy_bounds(correct: int, total: int) -> dict:
    """Return accuracy point estimate + Wilson 95% CI + sufficiency flag.

    Shape matches what the frontend renders:
      { pct, lo, hi, total, correct, sufficient }
    """
    if total <= 0:
        return {
            "pct": 0.0,
            "lo": 0.0,
            "hi": 0.0,
            "total": 0,
            "correct": 0,
            "sufficient": False,
        }
    lo, hi = wilson_interval(correct, total)
    return {
        "pct": round(100.0 * correct / total, 2),
        "lo": round(100.0 * lo, 2),
        "hi": round(100.0 * hi, 2),
        "total": total,
        "correct": correct,
        "sufficient": total >= MIN_SAMPLE_FOR_PUBLISH,
    }
