"""Tests for market mover detection."""

from datetime import datetime, timedelta, timezone

from polyscope.movers import detect_movers


def _snap(market_id: str, price: float, hours_ago: float, **kwargs) -> dict:
    ts = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours_ago)).isoformat()
    return {
        "market_id": market_id,
        "price_yes": price,
        "timestamp": ts,
        "question": kwargs.get("question", "Test?"),
        "category": kwargs.get("category", "test"),
        "volume_24h": kwargs.get("volume_24h", 1000),
    }


class TestDetectMovers:
    def test_detects_big_move(self):
        snapshots = [
            _snap("m1", 0.30, 25),  # 25 hours ago
            _snap("m1", 0.60, 0),  # now
        ]
        movers = detect_movers(snapshots, timeframe="24h")
        assert len(movers) == 1
        assert movers[0].change_pct > 0.25

    def test_ignores_small_move(self):
        snapshots = [
            _snap("m1", 0.50, 25),
            _snap("m1", 0.52, 0),
        ]
        movers = detect_movers(snapshots, timeframe="24h", min_change=0.05)
        assert len(movers) == 0

    def test_negative_move(self):
        snapshots = [
            _snap("m1", 0.80, 25),
            _snap("m1", 0.40, 0),
        ]
        movers = detect_movers(snapshots, timeframe="24h")
        assert len(movers) == 1
        assert movers[0].change_pct < 0

    def test_multiple_markets_sorted(self):
        snapshots = [
            _snap("m1", 0.50, 25),
            _snap("m1", 0.60, 0),
            _snap("m2", 0.30, 25),
            _snap("m2", 0.70, 0),
        ]
        movers = detect_movers(snapshots, timeframe="24h")
        assert len(movers) == 2
        # m2 had bigger move
        assert movers[0].market_id == "m2"

    def test_1h_timeframe(self):
        snapshots = [
            _snap("m1", 0.40, 0.5),  # 30 min ago
            _snap("m1", 0.60, 0),
        ]
        movers = detect_movers(snapshots, timeframe="1h")
        assert len(movers) == 1

    def test_7d_timeframe(self):
        snapshots = [
            _snap("m1", 0.20, 150),  # 6+ days ago
            _snap("m1", 0.80, 0),
        ]
        movers = detect_movers(snapshots, timeframe="7d")
        assert len(movers) == 1

    def test_empty_snapshots(self):
        assert detect_movers([], "24h") == []

    def test_invalid_timeframe(self):
        assert detect_movers([_snap("m1", 0.5, 1)], "3h") == []

    def test_limit(self):
        snapshots = []
        for i in range(30):
            snapshots.append(_snap(f"m{i}", 0.20, 25))
            snapshots.append(_snap(f"m{i}", 0.50 + i * 0.01, 0))
        movers = detect_movers(snapshots, timeframe="24h", limit=5)
        assert len(movers) == 5
