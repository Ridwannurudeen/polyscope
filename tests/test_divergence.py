"""Tests for divergence scoring engine."""

from polyscope.divergence import (
    DivergenceConfig,
    _score_liquidity,
    _score_magnitude,
    _score_sm_volume,
    _score_trader_count,
    _weighted_consensus,
    compute_divergence,
)
from polyscope.models import Market, Position, Trader


def _make_market(**kwargs) -> Market:
    defaults = {
        "condition_id": "0xabc123",
        "question": "Will X happen?",
        "slug": "will-x-happen",
        "price_yes": 0.70,
        "open_interest": 50000,
    }
    defaults.update(kwargs)
    return Market(**defaults)


def _make_trader(address: str, rank: int, profit: float = 10000, volume: float = 100000) -> Trader:
    return Trader(address=address, rank=rank, profit=profit, volume=volume, alpha_ratio=profit / max(volume, 1))


def _make_position(
    trader_addr: str, market_id: str, side: str, size: float = 1000, avg_price: float = 0.5
) -> Position:
    return Position(
        trader_address=trader_addr,
        market_id=market_id,
        side=side,
        size=size,
        avg_price=avg_price,
    )


class TestScoreComponents:
    def test_magnitude_zero(self):
        assert _score_magnitude(0) == 0

    def test_magnitude_25pct(self):
        assert _score_magnitude(0.25) == 50

    def test_magnitude_50pct_caps_at_100(self):
        assert _score_magnitude(0.50) == 100

    def test_magnitude_above_50_still_100(self):
        assert _score_magnitude(0.80) == 100

    def test_trader_count_all(self):
        assert _score_trader_count(50, 50) == 100

    def test_trader_count_half(self):
        # log2 scale: 30 + 70 * log2(25)/log2(50) ≈ 87.6
        result = _score_trader_count(25, 50)
        assert 85 < result < 90

    def test_trader_count_zero(self):
        assert _score_trader_count(0, 50) == 0

    def test_sm_volume_zero(self):
        assert _score_sm_volume([]) == 0

    def test_liquidity_zero(self):
        assert _score_liquidity(0) == 0

    def test_liquidity_high(self):
        score = _score_liquidity(1_000_000)
        assert score > 80


class TestWeightedConsensus:
    def test_all_yes_positions(self):
        traders = {f"0x{i}": _make_trader(f"0x{i}", i + 1) for i in range(5)}
        positions = [
            _make_position(f"0x{i}", "mkt", "YES", avg_price=0.80) for i in range(5)
        ]
        consensus = _weighted_consensus(positions, traders)
        assert consensus is not None
        assert consensus > 0.7

    def test_all_no_positions(self):
        traders = {f"0x{i}": _make_trader(f"0x{i}", i + 1) for i in range(5)}
        positions = [
            _make_position(f"0x{i}", "mkt", "NO", avg_price=0.80) for i in range(5)
        ]
        consensus = _weighted_consensus(positions, traders)
        assert consensus is not None
        assert consensus < 0.3

    def test_mixed_positions(self):
        traders = {f"0x{i}": _make_trader(f"0x{i}", i + 1) for i in range(6)}
        positions = [
            _make_position(f"0x{i}", "mkt", "YES", avg_price=0.75) for i in range(3)
        ] + [
            _make_position(f"0x{i}", "mkt", "NO", avg_price=0.75) for i in range(3, 6)
        ]
        consensus = _weighted_consensus(positions, traders)
        assert consensus is not None
        # Top-ranked traders (0, 1, 2) are YES, so consensus should lean YES
        assert consensus > 0.4

    def test_empty_positions(self):
        assert _weighted_consensus([], {}) is None

    def test_alpha_ratio_boosts_high_alpha_traders(self):
        """High alpha (profit/volume) traders should get more weight."""
        # Trader A: rank 5, high alpha (40% profit/volume)
        # Trader B: rank 5, low alpha (0.2% profit/volume)
        traders = {
            "0xA": Trader(address="0xA", rank=5, profit=200000, volume=500000),
            "0xB": Trader(address="0xB", rank=5, profit=1000, volume=500000),
        }
        # A says YES, B says NO — A should dominate due to higher alpha
        positions = [
            _make_position("0xA", "mkt", "YES", avg_price=0.80),
            _make_position("0xB", "mkt", "NO", avg_price=0.80),
        ]
        consensus = _weighted_consensus(positions, traders)
        assert consensus is not None
        # Should lean YES because trader A has much higher alpha
        assert consensus > 0.5


class TestComputeDivergence:
    def test_strong_divergence(self):
        """Market says 70% YES but SM is heavily NO."""
        market = _make_market(price_yes=0.70)
        traders = {f"0x{i}": _make_trader(f"0x{i}", i + 1) for i in range(10)}
        positions = [
            _make_position(f"0x{i}", "0xabc123", "NO", size=5000, avg_price=0.70)
            for i in range(10)
        ]
        config = DivergenceConfig(min_sm_traders=3, min_score=0)

        signal = compute_divergence(market, positions, traders, config)
        assert signal is not None
        assert signal.sm_direction == "NO"
        assert signal.divergence_pct > 0.1

    def test_no_divergence_when_aligned(self):
        """Market and SM agree — no signal."""
        market = _make_market(price_yes=0.70)
        traders = {f"0x{i}": _make_trader(f"0x{i}", i + 1) for i in range(10)}
        positions = [
            _make_position(f"0x{i}", "0xabc123", "YES", size=5000, avg_price=0.70)
            for i in range(10)
        ]
        config = DivergenceConfig(min_sm_traders=3, min_divergence_pct=0.15)

        signal = compute_divergence(market, positions, traders, config)
        # Should be None or very low score since SM agrees with market
        if signal:
            assert signal.divergence_pct < 0.15

    def test_insufficient_traders(self):
        """Too few SM traders — no signal."""
        market = _make_market(price_yes=0.70)
        traders = {"0x0": _make_trader("0x0", 1)}
        positions = [_make_position("0x0", "0xabc123", "NO", size=5000)]
        config = DivergenceConfig(min_sm_traders=5)

        signal = compute_divergence(market, positions, traders, config)
        assert signal is None

    def test_low_oi_market(self):
        """Market with very low OI — no signal."""
        market = _make_market(price_yes=0.70, open_interest=100)
        traders = {f"0x{i}": _make_trader(f"0x{i}", i + 1) for i in range(10)}
        positions = [
            _make_position(f"0x{i}", "0xabc123", "NO", size=5000)
            for i in range(10)
        ]

        signal = compute_divergence(market, positions, traders)
        assert signal is None

    def test_zero_price_market(self):
        market = _make_market(price_yes=0)
        signal = compute_divergence(market, [], {})
        assert signal is None
