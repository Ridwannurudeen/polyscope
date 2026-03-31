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
    expire_converged_signals,
    get_category_weights,
    get_db,
    rebuild_trader_category_stats,
    save_divergence_signal,
    save_resolved_market,
    save_sm_trades,
    save_snapshot,
    save_whale_alert,
    update_signal_outcomes,
)

logger = logging.getLogger(__name__)

# Shared state for scheduler jobs
_client: PolymarketClient | None = None
_traders: dict[str, Trader] = {}
_divergence_config = DivergenceConfig()
_category_weights: dict[str, dict[str, float]] = {}


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
    """Run divergence scoring across all active markets.

    Two-pass approach:
    1. Position scan all markets (fast)
    2. For candidates with high divergence or volume, fetch recent trades
       and recompute with trade-weighted consensus
    """
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
    divergences_map: dict[str, float] = {}

    # Track candidates for trade-based pass
    trade_candidates = []

    try:
        # ── Pass 1: Position-based scan ──
        trader_addresses = set(_traders.keys())

        for market in markets:
            if not market.condition_id or market.price_yes <= 0:
                continue

            positions = []
            try:
                market_positions = await client.get_market_positions(
                    market.condition_id, limit=200
                )
                positions = [
                    p for p in market_positions if p.trader_address in _traders
                ]
                if positions:
                    total_sm_matches += len(positions)
                    markets_with_sm += 1
            except Exception:
                continue

            signal = compute_divergence(
                market, positions, _traders, _divergence_config,
                category_weights=_category_weights,
            )
            if positions and not signal and len(positions) >= 1:
                from polyscope.divergence import _weighted_consensus
                sm_c = _weighted_consensus(positions, _traders)
                if sm_c is not None:
                    div = abs(market.price_yes - sm_c)
                    divergences_map[market.condition_id] = div
                    if div > 0.05:
                        logger.debug(
                            "Near-miss: %s | price=%.2f sm=%.2f div=%.2f traders=%d",
                            market.question[:40], market.price_yes, sm_c, div, len(positions),
                        )

            if signal:
                divergences_map[market.condition_id] = signal.divergence_pct
                signals.append(signal)
                signal_dict = asdict(signal)
                await save_divergence_signal(db, signal_dict)

                # Mark as candidate for trade-based refinement
                if signal.divergence_pct > 0.05 or market.volume_24h > 100000:
                    trade_candidates.append((market, positions))
            elif market.volume_24h > 100000 and positions:
                trade_candidates.append((market, positions))

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

            await asyncio.sleep(0.1)

        # ── Pass 2: Trade-based refinement for candidates (max ~80) ──
        for market, positions in trade_candidates[:80]:
            try:
                sm_trades = await client.get_sm_recent_trades(
                    market.condition_id, trader_addresses, hours=48
                )
                if len(sm_trades) >= 2:
                    # Save trades for historical reference
                    trade_dicts = [
                        {
                            "trader_address": t.trader_address,
                            "market_id": t.market_id,
                            "side": t.side,
                            "size": t.size,
                            "price": t.price,
                            "trade_timestamp": t.timestamp,
                        }
                        for t in sm_trades
                    ]
                    await save_sm_trades(db, trade_dicts)

                    # Recompute with trade data
                    trade_signal = compute_divergence(
                        market, positions, _traders, _divergence_config,
                        trades=sm_trades,
                        category_weights=_category_weights,
                    )
                    if trade_signal and trade_signal.signal_source == "trades":
                        # Replace position-based signal if trade-based is stronger
                        existing = next(
                            (s for s in signals if s.market_id == market.condition_id),
                            None,
                        )
                        if existing:
                            if trade_signal.score > existing.score:
                                signals.remove(existing)
                                signals.append(trade_signal)
                                await save_divergence_signal(db, asdict(trade_signal))
                        else:
                            signals.append(trade_signal)
                            await save_divergence_signal(db, asdict(trade_signal))
                            divergences_map[market.condition_id] = trade_signal.divergence_pct

                await asyncio.sleep(0.2)
            except Exception:
                continue

        # ── Expire converged signals ──
        await expire_converged_signals(db, divergences_map)

        await db.commit()
        cache.set("divergences", signals, ttl_seconds=600)
        logger.info(
            "Divergence scan complete: %d signals from %d markets "
            "(%d markets with SM positions, %d total SM matches, %d trade candidates)",
            len(signals),
            len(markets),
            markets_with_sm,
            total_sm_matches,
            len(trade_candidates),
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
    global _category_weights

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

                outcome, _resolved_price = result
                market_id = raw.get("conditionId", raw.get("condition_id", ""))
                if not market_id:
                    continue

                last_trade = float(raw.get("lastTradePrice", 0) or 0)
                final_price = last_trade if last_trade > 0 else _resolved_price
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

        # Rebuild category stats after processing outcomes
        await rebuild_trader_category_stats(db)
        _category_weights = await get_category_weights(db)

        await db.commit()
        logger.info(
            "Outcome tracking complete: %d resolved markets saved, %d category weights loaded",
            saved,
            sum(len(v) for v in _category_weights.values()),
        )
    except Exception:
        logger.exception("track_outcomes_job failed")
    finally:
        await db.close()


async def detect_whale_trades_job():
    """Detect large SM trades (>= $10K) on top markets."""
    client = get_client()
    markets = cache.get("markets")
    if not markets or not _traders:
        return

    db = await get_db()
    now = datetime.now(timezone.utc).isoformat()
    trader_addresses = set(_traders.keys())
    new_alerts = 0

    try:
        # Top 50 markets by volume
        sorted_markets = sorted(markets, key=lambda m: m.volume_24h, reverse=True)[:50]

        for market in sorted_markets:
            if not market.condition_id:
                continue

            try:
                trades = await client.get_sm_recent_trades(
                    market.condition_id, trader_addresses, hours=2
                )

                for trade in trades:
                    if trade.size < 10000:
                        continue

                    trader = _traders.get(trade.trader_address)
                    if not trader:
                        continue

                    # Dedupe: check if we already have this alert
                    cursor = await db.execute(
                        """SELECT COUNT(*) FROM whale_alerts
                           WHERE trader_address = ? AND market_id = ?
                                 AND trade_timestamp = ?""",
                        (trade.trader_address, trade.market_id, trade.timestamp),
                    )
                    row = await cursor.fetchone()
                    if row[0] > 0:
                        continue

                    await save_whale_alert(db, {
                        "trader_address": trade.trader_address,
                        "trader_rank": trader.rank,
                        "market_id": market.condition_id,
                        "question": market.question,
                        "side": trade.side,
                        "size": trade.size,
                        "price": trade.price,
                        "trade_timestamp": trade.timestamp,
                        "detected_at": now,
                    })
                    new_alerts += 1

                await asyncio.sleep(0.2)
            except Exception:
                continue

        await db.commit()
        if new_alerts:
            logger.info("Whale detection: %d new alerts", new_alerts)
    except Exception:
        logger.exception("detect_whale_trades_job failed")
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
