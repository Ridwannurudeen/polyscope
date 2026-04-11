"""Tests for divergence scoring engine."""

from polyscope.divergence import (
    DivergenceConfig,
    _score_liquidity,
    _score_magnitude,
    _score_sm_volume,
    _score_trader_count,
    _trade_weighted_consensus,
    _weighted_consensus,
    compute_divergence,
)
from polyscope.models import Market, Position, Trade, Trader


def _make_market(**kwargs) -> Market:
    defaults = {
        "condition_id": "0xabc123",
        "question": "Will X happen?",
        "slug": "will-x-happen",
        "price_yes": 0.70,
        "open_interest": 100000,
        "volume_24h": 50000,
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


def _make_trade(
    trader_addr: str, market_id: str, side: str,
    size: float = 5000, price: float = 0.5, hours_ago: float = 0
) -> Trade:
    from datetime import datetime, timedelta, timezone
    ts = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()
    return Trade(
        trader_address=trader_addr,
        market_id=market_id,
        side=side,
        size=size,
        price=price,
        timestamp=ts,
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
        traders = {
            "0xA": Trader(address="0xA", rank=5, profit=200000, volume=500000),
            "0xB": Trader(address="0xB", rank=5, profit=1000, volume=500000),
        }
        positions = [
            _make_position("0xA", "mkt", "YES", avg_price=0.80),
            _make_position("0xB", "mkt", "NO", avg_price=0.80),
        ]
        consensus = _weighted_consensus(positions, traders)
        assert consensus is not None
        assert consensus > 0.5

    def test_category_weight_boost(self):
        """Category weights should boost/penalize traders."""
        traders = {
            "0xA": _make_trader("0xA", 1, profit=10000, volume=100000),
            "0xB": _make_trader("0xB", 1, profit=10000, volume=100000),
        }
        positions = [
            _make_position("0xA", "mkt", "YES", avg_price=0.80),
            _make_position("0xB", "mkt", "NO", avg_price=0.80),
        ]
        # Without category weights: should be balanced
        c1 = _weighted_consensus(positions, traders)

        # With 0xA boosted in crypto category
        cat_weights = {"0xA": {"crypto": 2.0}, "0xB": {"crypto": 0.5}}
        c2 = _weighted_consensus(positions, traders, category="crypto", category_weights=cat_weights)

        assert c1 is not None and c2 is not None
        # 0xA (YES) is boosted, so consensus should be more bullish
        assert c2 > c1

    def test_category_weight_penalty(self):
        """Low category weight should reduce trader influence."""
        traders = {
            "0xA": _make_trader("0xA", 1, profit=10000, volume=100000),
            "0xB": _make_trader("0xB", 1, profit=10000, volume=100000),
        }
        positions = [
            _make_position("0xA", "mkt", "YES", avg_price=0.80),
            _make_position("0xB", "mkt", "NO", avg_price=0.80),
        ]
        # Penalize 0xA in sports category
        cat_weights = {"0xA": {"sports": 0.2}, "0xB": {"sports": 1.8}}
        consensus = _weighted_consensus(positions, traders, category="sports", category_weights=cat_weights)
        assert consensus is not None
        # 0xB (NO) is boosted, so consensus should lean bearish
        assert consensus < 0.5


class TestTradeWeightedConsensus:
    def test_basic_trade_consensus(self):
        traders = {f"0x{i}": _make_trader(f"0x{i}", i + 1) for i in range(3)}
        trades = [
            _make_trade(f"0x{i}", "mkt", "YES", price=0.80, hours_ago=1) for i in range(3)
        ]
        consensus = _trade_weighted_consensus(trades, traders)
        assert consensus is not None
        assert consensus > 0.7

    def test_time_decay(self):
        """Recent trades should matter more than old ones."""
        traders = {"0x0": _make_trader("0x0", 1), "0x1": _make_trader("0x1", 1)}
        # Recent trade says YES
        recent = _make_trade("0x0", "mkt", "YES", price=0.80, hours_ago=1)
        # Old trade says NO
        old = _make_trade("0x1", "mkt", "NO", price=0.80, hours_ago=72)
        consensus = _trade_weighted_consensus([recent, old], traders)
        assert consensus is not None
        # Recent YES should dominate
        assert consensus > 0.5

    def test_no_valid_traders(self):
        traders = {}
        trades = [_make_trade("0xunknown", "mkt", "YES")]
        assert _trade_weighted_consensus(trades, traders) is None

    def test_category_weights_in_trades(self):
        traders = {
            "0xA": _make_trader("0xA", 1),
            "0xB": _make_trader("0xB", 1),
        }
        trades = [
            _make_trade("0xA", "mkt", "YES", price=0.80, hours_ago=1),
            _make_trade("0xB", "mkt", "NO", price=0.80, hours_ago=1),
        ]
        cat_weights = {"0xA": {"crypto": 2.0}, "0xB": {"crypto": 0.5}}
        consensus = _trade_weighted_consensus(
            trades, traders, category="crypto", category_weights=cat_weights
        )
        assert consensus is not None
        assert consensus > 0.5


class TestComputeDivergence:
    def test_strong_divergence(self):
        """Market says 70% YES but SM is heavily NO — contrarian signal says YES."""
        market = _make_market(price_yes=0.70)
        traders = {f"0x{i}": _make_trader(f"0x{i}", i + 1) for i in range(10)}
        positions = [
            _make_position(f"0x{i}", "0xabc123", "NO", size=5000, avg_price=0.70)
            for i in range(10)
        ]
        config = DivergenceConfig(min_sm_traders=3, min_score=0)

        signal = compute_divergence(market, positions, traders, config)
        assert signal is not None
        assert signal.sm_direction == "YES"
        assert signal.divergence_pct > 0.1
        assert signal.signal_source == "positions"

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
        """Market with very low OI — no signal (new threshold $50K)."""
        market = _make_market(price_yes=0.70, open_interest=100, volume_24h=50)
        traders = {f"0x{i}": _make_trader(f"0x{i}", i + 1) for i in range(10)}
        positions = [
            _make_position(f"0x{i}", "0xabc123", "NO", size=5000)
            for i in range(10)
        ]

        signal = compute_divergence(market, positions, traders)
        assert signal is None

    def test_low_volume_market(self):
        """Market with decent OI but low 24h volume — no signal."""
        market = _make_market(price_yes=0.70, open_interest=200000, volume_24h=500)
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

    def test_trade_based_signal_source(self):
        """When trades are provided, signal_source should be 'trades'."""
        market = _make_market(price_yes=0.70)
        traders = {f"0x{i}": _make_trader(f"0x{i}", i + 1) for i in range(5)}
        positions = [
            _make_position(f"0x{i}", "0xabc123", "NO", size=5000, avg_price=0.70)
            for i in range(5)
        ]
        trades = [
            _make_trade(f"0x{i}", "0xabc123", "NO", size=5000, price=0.70, hours_ago=1)
            for i in range(5)
        ]
        config = DivergenceConfig(min_sm_traders=1, min_score=0)

        signal = compute_divergence(market, positions, traders, config, trades=trades)
        assert signal is not None
        assert signal.signal_source == "trades"

    def test_falls_back_to_positions(self):
        """When trades are insufficient, should fall back to positions."""
        market = _make_market(price_yes=0.70)
        traders = {f"0x{i}": _make_trader(f"0x{i}", i + 1) for i in range(5)}
        positions = [
            _make_position(f"0x{i}", "0xabc123", "NO", size=5000, avg_price=0.70)
            for i in range(5)
        ]
        # Only 1 trade — below threshold of 2
        trades = [
            _make_trade("0x0", "0xabc123", "NO", size=5000, price=0.70, hours_ago=1)
        ]
        config = DivergenceConfig(min_sm_traders=1, min_score=0)

        signal = compute_divergence(market, positions, traders, config, trades=trades)
        assert signal is not None
        assert signal.signal_source == "positions"
