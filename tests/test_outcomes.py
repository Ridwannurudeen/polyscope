"""Tests for outcome determination and Brier improvement logic."""

import pytest

from polyscope.polymarket import PolymarketClient
from polyscope.calibration import brier_score


class TestDetermineOutcome:
    """Test PolymarketClient.determine_outcome static method."""

    def test_yes_won(self):
        raw = {"outcomePrices": ["0.99", "0.01"]}
        result = PolymarketClient.determine_outcome(raw)
        assert result is not None
        outcome, price = result
        assert outcome == 1
        assert price == 0.99

    def test_no_won(self):
        raw = {"outcomePrices": ["0.01", "0.99"]}
        result = PolymarketClient.determine_outcome(raw)
        assert result is not None
        outcome, price = result
        assert outcome == 0
        assert price == pytest.approx(0.01)

    def test_yes_won_exact_one(self):
        raw = {"outcomePrices": ["1.0", "0.0"]}
        result = PolymarketClient.determine_outcome(raw)
        assert result is not None
        assert result[0] == 1

    def test_no_won_exact_one(self):
        raw = {"outcomePrices": ["0.0", "1.0"]}
        result = PolymarketClient.determine_outcome(raw)
        assert result is not None
        assert result[0] == 0

    def test_unresolved_close_prices(self):
        """Market still in play — 60/40 split."""
        raw = {"outcomePrices": ["0.60", "0.40"]}
        result = PolymarketClient.determine_outcome(raw)
        assert result is None

    def test_near_resolution_not_enough(self):
        """98% is close but not >= 99%."""
        raw = {"outcomePrices": ["0.98", "0.02"]}
        result = PolymarketClient.determine_outcome(raw)
        assert result is None

    def test_missing_prices(self):
        raw = {}
        result = PolymarketClient.determine_outcome(raw)
        assert result is None

    def test_invalid_prices_string(self):
        raw = {"outcomePrices": "invalid"}
        result = PolymarketClient.determine_outcome(raw)
        assert result is None

    def test_empty_list(self):
        raw = {"outcomePrices": []}
        result = PolymarketClient.determine_outcome(raw)
        assert result is None

    def test_single_element(self):
        raw = {"outcomePrices": ["0.99"]}
        result = PolymarketClient.determine_outcome(raw)
        assert result is None

    def test_json_string_format(self):
        """Gamma API sometimes returns prices as a JSON string."""
        raw = {"outcomePrices": '["0.99","0.01"]'}
        result = PolymarketClient.determine_outcome(raw)
        assert result is not None
        assert result[0] == 1

    def test_non_numeric_values(self):
        raw = {"outcomePrices": ["abc", "def"]}
        result = PolymarketClient.determine_outcome(raw)
        assert result is None


class TestBrierImprovement:
    """Test Brier score computation for SM-correct vs SM-wrong scenarios."""

    def test_sm_correct_yes(self):
        """SM said YES, outcome was YES — should have low Brier for SM price."""
        sm_price = 0.80  # SM positioned 80% YES
        crowd_price = 0.50  # Crowd was 50/50
        outcome = 1  # YES won

        sm_brier = brier_score(sm_price, outcome)
        crowd_brier = brier_score(crowd_price, outcome)

        # SM should have lower (better) Brier than crowd
        assert sm_brier < crowd_brier

    def test_sm_correct_no(self):
        """SM said NO (low YES price), outcome was NO."""
        sm_price = 0.20  # SM positioned 20% YES (i.e., favors NO)
        crowd_price = 0.60  # Crowd was 60% YES
        outcome = 0  # NO won

        sm_brier = brier_score(sm_price, outcome)
        crowd_brier = brier_score(crowd_price, outcome)

        assert sm_brier < crowd_brier

    def test_sm_wrong(self):
        """SM was wrong — higher Brier."""
        sm_price = 0.85
        crowd_price = 0.50
        outcome = 0  # NO won, SM was wrong

        sm_brier = brier_score(sm_price, outcome)
        crowd_brier = brier_score(crowd_price, outcome)

        # SM should have worse Brier than crowd
        assert sm_brier > crowd_brier

    def test_perfect_prediction(self):
        assert brier_score(1.0, 1) == 0.0
        assert brier_score(0.0, 0) == 0.0

    def test_worst_prediction(self):
        assert brier_score(0.0, 1) == 1.0
        assert brier_score(1.0, 0) == 1.0
