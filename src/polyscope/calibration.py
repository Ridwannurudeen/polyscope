"""Calibration tracking — Brier scores and calibration curves."""

from __future__ import annotations

import logging
from collections import defaultdict

from polyscope.models import CalibrationBucket, ResolvedMarket

logger = logging.getLogger(__name__)

# Calibration bucket boundaries (10 buckets: 0-10%, 10-20%, ..., 90-100%)
BUCKET_EDGES = [(i / 10, (i + 1) / 10) for i in range(10)]


def brier_score(predicted: float, outcome: int) -> float:
    """Compute Brier score for a single prediction.

    Brier = (predicted - outcome)^2
    Perfect = 0.0, Worst = 1.0
    """
    return (predicted - outcome) ** 2


def compute_calibration(
    markets: list[ResolvedMarket],
) -> list[CalibrationBucket]:
    """Compute calibration curve from resolved markets.

    Groups markets into probability buckets and compares
    predicted probability vs actual outcome frequency.
    """
    buckets: dict[tuple[float, float], list[ResolvedMarket]] = {
        edges: [] for edges in BUCKET_EDGES
    }

    for m in markets:
        price = m.final_price
        if price < 0 or price > 1:
            continue
        for low, high in BUCKET_EDGES:
            if low <= price < high or (high == 1.0 and price == 1.0):
                buckets[(low, high)].append(m)
                break

    results = []
    for (low, high), bucket_markets in buckets.items():
        if not bucket_markets:
            results.append(
                CalibrationBucket(
                    bucket_low=low,
                    bucket_high=high,
                    predicted_avg=0,
                    actual_pct=0,
                    count=0,
                    brier_score=0,
                )
            )
            continue

        predicted_avg = sum(m.final_price for m in bucket_markets) / len(bucket_markets)
        actual_pct = sum(m.outcome for m in bucket_markets) / len(bucket_markets)
        avg_brier = sum(m.brier_score for m in bucket_markets) / len(bucket_markets)

        results.append(
            CalibrationBucket(
                bucket_low=low,
                bucket_high=high,
                predicted_avg=round(predicted_avg, 4),
                actual_pct=round(actual_pct, 4),
                count=len(bucket_markets),
                brier_score=round(avg_brier, 4),
            )
        )

    return results


def compute_calibration_by_category(
    markets: list[ResolvedMarket],
) -> dict[str, list[CalibrationBucket]]:
    """Compute calibration curves grouped by category."""
    by_cat: dict[str, list[ResolvedMarket]] = defaultdict(list)
    for m in markets:
        cat = m.category or "Uncategorized"
        by_cat[cat].append(m)

    return {cat: compute_calibration(cat_markets) for cat, cat_markets in by_cat.items()}


def overall_brier(markets: list[ResolvedMarket]) -> float:
    """Compute overall Brier score across all resolved markets."""
    if not markets:
        return 0.0
    return sum(m.brier_score for m in markets) / len(markets)


def category_brier_scores(
    markets: list[ResolvedMarket],
) -> dict[str, dict]:
    """Compute per-category Brier scores + counts."""
    by_cat: dict[str, list[ResolvedMarket]] = defaultdict(list)
    for m in markets:
        cat = m.category or "Uncategorized"
        by_cat[cat].append(m)

    result = {}
    for cat, cat_markets in by_cat.items():
        avg = sum(m.brier_score for m in cat_markets) / len(cat_markets)
        result[cat] = {
            "brier_score": round(avg, 4),
            "count": len(cat_markets),
        }

    return dict(sorted(result.items(), key=lambda x: x[1]["brier_score"]))
