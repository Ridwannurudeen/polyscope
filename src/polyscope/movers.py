"""Market mover detection — biggest probability shifts."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from polyscope.models import MarketMover

logger = logging.getLogger(__name__)

# Timeframe definitions
TIMEFRAMES = {
    "1h": timedelta(hours=1),
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
}

# Minimum absolute change to qualify as a mover
MIN_CHANGE = 0.05  # 5%


def detect_movers(
    snapshots: list[dict],
    timeframe: str = "24h",
    limit: int = 20,
    min_change: float = MIN_CHANGE,
) -> list[MarketMover]:
    """Detect biggest probability changes from historical snapshots.

    Args:
        snapshots: List of market snapshot dicts with keys:
            market_id, question, category, price_yes, timestamp, volume_24h
        timeframe: "1h", "24h", or "7d"
        limit: Max number of movers to return
        min_change: Minimum absolute price change to qualify

    Returns:
        List of MarketMover sorted by absolute change descending.
    """
    delta = TIMEFRAMES.get(timeframe)
    if not delta:
        return []

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - delta

    # Group snapshots by market_id
    by_market: dict[str, list[dict]] = {}
    for s in snapshots:
        mid = s.get("market_id", "")
        if not mid:
            continue
        by_market.setdefault(mid, []).append(s)

    movers = []
    for market_id, market_snaps in by_market.items():
        # Sort by timestamp
        sorted_snaps = sorted(market_snaps, key=lambda x: x.get("timestamp", ""))
        if not sorted_snaps:
            continue

        # Current price = latest snapshot
        latest = sorted_snaps[-1]
        price_now = float(latest.get("price_yes", 0))
        if price_now <= 0:
            continue

        # Find the snapshot closest to the cutoff time
        price_before = _find_price_at(sorted_snaps, cutoff)
        if price_before is None or price_before <= 0:
            continue

        change = price_now - price_before
        change_pct = change  # Already in probability units (0-1)

        if abs(change_pct) < min_change:
            continue

        movers.append(
            MarketMover(
                market_id=market_id,
                question=latest.get("question", ""),
                category=latest.get("category", ""),
                price_now=round(price_now, 4),
                price_before=round(price_before, 4),
                change_pct=round(change_pct, 4),
                timeframe=timeframe,
                volume_24h=float(latest.get("volume_24h", 0)),
            )
        )

    # Sort by absolute change descending
    movers.sort(key=lambda m: abs(m.change_pct), reverse=True)
    return movers[:limit]


def _find_price_at(snapshots: list[dict], target_time: datetime) -> float | None:
    """Find the price from the snapshot closest to target_time."""
    best = None
    best_diff = None

    for s in snapshots:
        ts_str = s.get("timestamp", "")
        if not ts_str:
            continue
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00").replace("+00:00", ""))
        except ValueError:
            continue

        diff = abs((ts - target_time).total_seconds())
        if best_diff is None or diff < best_diff:
            best_diff = diff
            best = float(s.get("price_yes", 0))

    return best
