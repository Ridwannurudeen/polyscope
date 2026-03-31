"""APScheduler jobs — data fetching and computation cycles."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict
from datetime import datetime, timezone

from polyscope.divergence import DivergenceConfig, compute_divergence
from polyscope.models import Trader
from polyscope.polymarket import PolymarketClient

from .cache import cache
from .database import (
    get_db,
    save_divergence_signal,
    save_resolved_market,
    save_snapshot,
    update_signal_outcomes,
)

logger = logging.getLogger(__name__)

# Shared state for scheduler jobs
_client: PolymarketClient | None = None
_traders: dict[str, Trader] = {}
_divergence_config = DivergenceConfig()


def get_client() -> PolymarketClient:
    global _client
    if _client is None:
        _client = PolymarketClient()
    return _client


async def close_client():
    global _client
    if _client:
        await _client.close()
        _client = None


async def fetch_markets_job():
    """Fetch active markets from Gamma API and cache them."""
    client = get_client()
    try:
        markets = []
        for offset in range(0, 500, 100):
            batch = await client.get_markets(limit=100, offset=offset)
            markets.extend(batch)
            if len(batch) < 100:
                break

        cache.set("markets", markets, ttl_seconds=600)
        logger.info("Fetched %d active markets", len(markets))
    except Exception:
        logger.exception("fetch_markets_job failed")


async def fetch_leaderboard_job():
    """Fetch top traders from leaderboard."""
    global _traders
    client = get_client()
    try:
        trader_list = await client.get_leaderboard(limit=100)
        _traders = {t.address: t for t in trader_list}
        cache.set("leaderboard", trader_list, ttl_seconds=1200)
        logger.info("Fetched %d top traders", len(trader_list))
    except Exception:
        logger.exception("fetch_leaderboard_job failed")


async def compute_divergences_job():
    """Run divergence scoring across all active markets."""
    client = get_client()
    markets = cache.get("markets")
    if not markets:
        logger.warning("No markets cached, skipping divergence computation")
        return

    if not _traders:
        logger.warning("No traders cached, skipping divergence computation")
        return

    signals = []
    db = await get_db()
    now = datetime.now(timezone.utc).isoformat()
    total_sm_matches = 0
    markets_with_sm = 0

    try:
        # For each market, fetch SM positions and compute divergence
        trader_addresses = list(_traders.keys())

        for market in markets:
            if not market.condition_id or market.price_yes <= 0:
                continue

            # Fetch positions for this market from top traders
            positions = []
            try:
                market_positions = await client.get_market_positions(
                    market.condition_id, limit=200
                )
                # Filter to only SM traders
                positions = [
                    p for p in market_positions if p.trader_address in _traders
                ]
                if positions:
                    total_sm_matches += len(positions)
                    markets_with_sm += 1
            except Exception:
                continue

            signal = compute_divergence(market, positions, _traders, _divergence_config)
            if positions and not signal and len(positions) >= 1:
                # Debug: log near-misses
                from polyscope.divergence import _weighted_consensus
                sm_c = _weighted_consensus(positions, _traders)
                if sm_c is not None:
                    div = abs(market.price_yes - sm_c)
                    if div > 0.05:
                        logger.debug(
                            "Near-miss: %s | price=%.2f sm=%.2f div=%.2f traders=%d",
                            market.question[:40], market.price_yes, sm_c, div, len(positions),
                        )
            if signal:
                signals.append(signal)
                signal_dict = asdict(signal)
                await save_divergence_signal(db, signal_dict)

            # Save snapshot
            snapshot = {
                "market_id": market.condition_id,
                "timestamp": now,
                "question": market.question,
                "category": market.category,
                "price_yes": market.price_yes,
                "volume_24h": market.volume_24h,
                "open_interest": market.open_interest,
                "sm_yes_pct": signal.sm_consensus if signal else None,
                "sm_trader_count": len(positions),
                "divergence_score": signal.score if signal else None,
            }
            await save_snapshot(db, snapshot)

            # Rate limit: small delay between markets
            await asyncio.sleep(0.1)

        await db.commit()
        cache.set("divergences", signals, ttl_seconds=600)
        logger.info(
            "Divergence scan complete: %d signals from %d markets "
            "(%d markets with SM positions, %d total SM matches)",
            len(signals),
            len(markets),
            markets_with_sm,
            total_sm_matches,
        )
    except Exception:
        logger.exception("compute_divergences_job failed")
    finally:
        await db.close()


async def detect_movers_job():
    """Detect biggest probability shifts."""
    from polyscope.movers import detect_movers

    db = await get_db()
    try:
        from .database import get_latest_snapshots

        snapshots = await get_latest_snapshots(db, hours=168)

        movers_by_tf = {}
        for tf in ("1h", "24h", "7d"):
            movers = detect_movers(snapshots, timeframe=tf, limit=20)
            movers_by_tf[tf] = movers

        cache.set("movers", movers_by_tf, ttl_seconds=300)
        total = sum(len(v) for v in movers_by_tf.values())
        logger.info("Detected %d total movers across timeframes", total)
    except Exception:
        logger.exception("detect_movers_job failed")
    finally:
        await db.close()


async def track_outcomes_job():
    """Fetch closed markets, determine outcomes, update signal accuracy."""
    from polyscope.calibration import brier_score
    from polyscope.polymarket import PolymarketClient

    client = get_client()
    db = await get_db()
    saved = 0
    try:
        for offset in range(0, 500, 100):
            batch = await client.get_closed_markets(limit=100, offset=offset)
            if not batch:
                break

            for raw in batch:
                result = PolymarketClient.determine_outcome(raw)
                if result is None:
                    continue

                outcome, final_price = result
                market_id = raw.get("conditionId", raw.get("condition_id", ""))
                if not market_id:
                    continue

                bs = brier_score(final_price, outcome)

                tags_raw = raw.get("tags", [])
                category = ""
                if isinstance(tags_raw, list) and tags_raw:
                    first = tags_raw[0]
                    category = first.get("label", first) if isinstance(first, dict) else str(first)

                await save_resolved_market(db, {
                    "market_id": market_id,
                    "question": raw.get("question", raw.get("title", "")),
                    "category": category or raw.get("groupItemTitle", ""),
                    "final_price": final_price,
                    "outcome": outcome,
                    "resolved_at": raw.get("endDate", raw.get("end_date_iso", "")),
                    "brier_score": round(bs, 6),
                })
                await update_signal_outcomes(db, market_id, outcome)
                saved += 1

            if len(batch) < 100:
                break

        await db.commit()
        logger.info("Outcome tracking complete: %d resolved markets saved", saved)
    except Exception:
        logger.exception("track_outcomes_job failed")
    finally:
        await db.close()


async def cleanup_job():
    """Periodic cleanup of old data."""
    db = await get_db()
    try:
        from .database import cleanup_old_snapshots

        await cleanup_old_snapshots(db, days=30)
        logger.info("Cleanup complete")
    except Exception:
        logger.exception("cleanup_job failed")
    finally:
        await db.close()
