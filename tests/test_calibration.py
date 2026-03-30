"""Tests for calibration scoring."""

from polyscope.calibration import (
    brier_score,
    category_brier_scores,
    compute_calibration,
    overall_brier,
)
from polyscope.models import ResolvedMarket


def _resolved(price: float, outcome: int, category: str = "politics") -> ResolvedMarket:
    return ResolvedMarket(
        market_id=f"m_{price}_{outcome}",
        question="Test?",
        category=category,
        final_price=price,
        outcome=outcome,
        resolved_at="2025-01-01",
        brier_score=brier_score(price, outcome),
    )


class TestBrierScore:
    def test_perfect_yes(self):
        assert brier_score(1.0, 1) == 0.0

    def test_perfect_no(self):
        assert brier_score(0.0, 0) == 0.0

    def test_worst_yes(self):
        assert brier_score(0.0, 1) == 1.0

    def test_worst_no(self):
        assert brier_score(1.0, 0) == 1.0

    def test_50_50(self):
        assert brier_score(0.5, 1) == 0.25
        assert brier_score(0.5, 0) == 0.25

    def test_70_yes(self):
        score = brier_score(0.7, 1)
        assert round(score, 2) == 0.09


class TestComputeCalibration:
    def test_well_calibrated(self):
        """When predicted matches actual, calibration is good."""
        markets = [
            _resolved(0.75, 1),
            _resolved(0.75, 1),
            _resolved(0.75, 1),
            _resolved(0.75, 0),
        ]
        buckets = compute_calibration(markets)
        # All in the 70-80% bucket
        bucket_70 = next(b for b in buckets if b.bucket_low == 0.7)
        assert bucket_70.count == 4
        assert bucket_70.actual_pct == 0.75
        assert bucket_70.predicted_avg == 0.75

    def test_empty_input(self):
        buckets = compute_calibration([])
        assert len(buckets) == 10
        assert all(b.count == 0 for b in buckets)

    def test_multiple_buckets(self):
        markets = [
            _resolved(0.25, 0),
            _resolved(0.75, 1),
        ]
        buckets = compute_calibration(markets)
        filled = [b for b in buckets if b.count > 0]
        assert len(filled) == 2


class TestOverallBrier:
    def test_perfect(self):
        markets = [_resolved(1.0, 1), _resolved(0.0, 0)]
        assert overall_brier(markets) == 0.0

    def test_empty(self):
        assert overall_brier([]) == 0.0


class TestCategoryBrier:
    def test_by_category(self):
        markets = [
            _resolved(0.8, 1, "politics"),
            _resolved(0.2, 0, "politics"),
            _resolved(0.5, 1, "crypto"),
        ]
        scores = category_brier_scores(markets)
        assert "politics" in scores
        assert "crypto" in scores
        assert scores["politics"]["count"] == 2
        assert scores["crypto"]["count"] == 1
