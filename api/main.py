"""FastAPI app — PolyScope API."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from dataclasses import asdict

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from .cache import cache
from .database import (
    get_db,
    get_divergence_history,
    get_divergence_signals,
    get_expired_signal_count,
    get_pending_whale_alerts,
    get_resolved_markets,
    get_signal_accuracy,
    get_methodology_stats,
    get_signal_evidence,
    get_signal_pnl_simulation,
    get_signal_history_for_market,
    get_trader_accuracy_leaderboard,
    get_trader_profile,
    get_whale_alerts,
    init_db,
    mark_alerts_notified,
)
from .scheduler import (
    cleanup_job,
    close_client,
    compute_divergences_job,
    detect_movers_job,
    detect_whale_trades_job,
    fetch_leaderboard_job,
    fetch_markets_job,
    track_outcomes_job,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def _run_initial_scans():
    """Run divergence + movers + outcome scans in background after startup."""
    try:
        await compute_divergences_job()
        await detect_movers_job()
        await track_outcomes_job()
        logger.info("Initial scans complete")
    except Exception:
        logger.exception("Initial scan failed")

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()

    # Schedule jobs
    scheduler.add_job(fetch_markets_job, "interval", minutes=5, id="fetch_markets")
    scheduler.add_job(fetch_leaderboard_job, "interval", minutes=10, id="fetch_leaderboard")
    scheduler.add_job(compute_divergences_job, "interval", minutes=5, id="compute_divergences")
    scheduler.add_job(detect_movers_job, "interval", minutes=5, id="detect_movers")
    scheduler.add_job(track_outcomes_job, "interval", hours=1, id="track_outcomes")
    scheduler.add_job(detect_whale_trades_job, "interval", minutes=2, id="detect_whales")
    scheduler.add_job(cleanup_job, "interval", hours=24, id="cleanup")
    scheduler.start()

    # Run initial fetch (markets + leaderboard synchronously so API has data)
    logger.info("Running initial data fetch...")
    await fetch_markets_job()
    await fetch_leaderboard_job()

    # Run heavy scans in background so uvicorn starts immediately
    import asyncio

    asyncio.create_task(_run_initial_scans())

    yield

    # Shutdown
    scheduler.shutdown(wait=False)
    await close_client()
    cache.clear()


app = FastAPI(
    title="PolyScope",
    description="Counter-consensus intelligence for Polymarket",
    version="0.3.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://polyscope.gudman.xyz"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

DISCLAIMER = (
    "PolyScope provides market intelligence only. "
    "It does not facilitate, recommend, or enable participation in prediction markets."
)


@app.get("/")
async def root():
    return {"name": "PolyScope", "version": "0.3.0", "disclaimer": DISCLAIMER}


@app.get("/api/scan/latest")
async def scan_latest():
    """Latest scan: divergences + movers + summary."""
    divergences = cache.get("divergences")
    source = "cache"
    if divergences is None:
        db = await get_db()
        try:
            rows = await get_divergence_signals(db, limit=50, hours=1)
            divergences = rows
            source = "db_fallback"
        finally:
            await db.close()

    movers = cache.get("movers") or {}
    markets = cache.get("markets") or []

    if source == "db_fallback":
        div_out = divergences[:20]
    else:
        div_out = [asdict(d) for d in divergences[:20]]

    return {
        "divergences": div_out,
        "movers_24h": [asdict(m) for m in (movers.get("24h") or [])[:10]],
        "total_markets": len(markets),
        "total_divergences": len(divergences),
        "source": source,
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/divergences")
async def get_divergences():
    """Current counter-consensus signals."""
    divergences = cache.get("divergences")
    source = "cache"

    db = await get_db()
    try:
        expired_count = await get_expired_signal_count(db)
    finally:
        await db.close()

    if divergences is None:
        db = await get_db()
        try:
            rows = await get_divergence_signals(db, limit=50, hours=1)
            return {
                "signals": rows,
                "count": len(rows),
                "expired_count": expired_count,
                "source": "db_fallback",
                "disclaimer": DISCLAIMER,
            }
        finally:
            await db.close()

    return {
        "signals": [asdict(d) for d in divergences],
        "count": len(divergences),
        "expired_count": expired_count,
        "source": source,
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/divergences/history")
async def divergences_history(limit: int = Query(50, le=200)):
    """Past signals + outcomes (SM vs crowd accuracy)."""
    db = await get_db()
    try:
        history = await get_divergence_history(db, limit=limit)
        return {"history": history, "count": len(history)}
    finally:
        await db.close()


@app.get("/api/movers")
async def get_movers(timeframe: str = Query("24h", pattern="^(1h|24h|7d)$")):
    """Biggest probability changes."""
    movers = cache.get("movers") or {}
    tf_movers = movers.get(timeframe, [])
    return {
        "movers": [asdict(m) for m in tf_movers],
        "timeframe": timeframe,
        "count": len(tf_movers),
    }


@app.get("/api/markets")
async def list_markets(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    category: str | None = None,
):
    """Active markets with prices."""
    markets = cache.get("markets") or []
    if category:
        markets = [m for m in markets if category.lower() in m.category.lower()]
    total = len(markets)
    page = markets[offset : offset + limit]
    return {
        "markets": [asdict(m) for m in page],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/market/{condition_id}")
async def get_market(condition_id: str):
    """Single market detail + divergence info."""
    import re

    if not re.fullmatch(r"[0-9a-zA-Z_-]{1,128}", condition_id):
        return {"error": "Invalid condition ID"}

    markets = cache.get("markets") or []
    market = next((m for m in markets if m.condition_id == condition_id), None)
    if not market:
        return {"error": "Market not found"}

    # Check for divergence signal on this market
    divergences = cache.get("divergences") or []
    signal = next((d for d in divergences if d.market_id == condition_id), None)

    # Get price history (cached 5 min to prevent upstream abuse)
    cache_key = f"price_history:{condition_id}"
    price_history = cache.get(cache_key)
    if price_history is None:
        from .scheduler import get_client

        client = get_client()
        price_history = await client.get_price_history(market.token_id_yes or condition_id)
        cache.set(cache_key, price_history, ttl_seconds=300)

    # Get signal history from DB
    db = await get_db()
    try:
        signal_history = await get_signal_history_for_market(db, condition_id)
    finally:
        await db.close()

    return {
        "market": asdict(market),
        "divergence": asdict(signal) if signal else None,
        "price_history": price_history[:100],
        "signal_history": signal_history,
    }


@app.get("/api/smart-money/feed")
async def smart_money_feed():
    """Top trader positions (read-only)."""
    leaderboard = cache.get("leaderboard") or []
    return {
        "traders": [asdict(t) for t in leaderboard[:50]],
        "count": len(leaderboard[:50]),
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/smart-money/leaderboard")
async def smart_money_leaderboard():
    """Top traders ranked by profit."""
    leaderboard = cache.get("leaderboard") or []
    return {
        "traders": [asdict(t) for t in leaderboard],
        "count": len(leaderboard),
    }


@app.get("/api/traders/leaderboard")
async def traders_accuracy_leaderboard(
    order: str = Query("predictive", pattern="^(predictive|anti-predictive)$"),
    limit: int = Query(100, ge=1, le=500),
    min_signals: int = Query(10, ge=1),
):
    """Traders ranked by per-signal predictive accuracy.

    order=predictive      — highest accuracy first (the real smart money)
    order=anti-predictive — lowest accuracy first (fade list)

    Only traders with >= min_signals divergent positions are included.
    """
    import json

    db = await get_db()
    try:
        rows = await get_trader_accuracy_leaderboard(
            db, order=order, limit=limit, min_signals=min_signals
        )
    finally:
        await db.close()

    for r in rows:
        if r.get("accuracy_by_skew"):
            try:
                r["accuracy_by_skew"] = json.loads(r["accuracy_by_skew"])
            except (ValueError, TypeError):
                r["accuracy_by_skew"] = {}
        if r.get("accuracy_by_category"):
            try:
                r["accuracy_by_category"] = json.loads(r["accuracy_by_category"])
            except (ValueError, TypeError):
                r["accuracy_by_category"] = {}

    return {
        "traders": rows,
        "count": len(rows),
        "order": order,
        "min_signals": min_signals,
    }


@app.get("/api/methodology/stats")
async def methodology_stats():
    """Live dataset statistics for the public methodology page."""
    db = await get_db()
    try:
        return await get_methodology_stats(db)
    finally:
        await db.close()


@app.get("/api/signals/evidence/{market_id}")
async def signal_evidence(market_id: str):
    """Full evidence trail for the latest signal on a market.

    Returns signal metadata, per-trader contributors with their own
    predictive accuracy, historical hit rate at this market skew band,
    and historical hit rate for this category.
    """
    db = await get_db()
    try:
        evidence = await get_signal_evidence(db, market_id)
    finally:
        await db.close()

    if not evidence:
        return {"error": "no signal found for this market"}

    return evidence


@app.get("/api/traders/{trader_address}")
async def trader_profile(trader_address: str):
    """Individual trader accuracy profile with skew/category breakdowns."""
    import json

    db = await get_db()
    try:
        profile = await get_trader_profile(db, trader_address)
    finally:
        await db.close()

    if not profile:
        return {"error": "trader not found or has no scored signals"}

    if profile.get("accuracy_by_skew"):
        try:
            profile["accuracy_by_skew"] = json.loads(profile["accuracy_by_skew"])
        except (ValueError, TypeError):
            profile["accuracy_by_skew"] = {}
    if profile.get("accuracy_by_category"):
        try:
            profile["accuracy_by_category"] = json.loads(profile["accuracy_by_category"])
        except (ValueError, TypeError):
            profile["accuracy_by_category"] = {}

    return profile


@app.get("/api/calibration")
async def calibration_overview():
    """Brier scores + calibration by category."""
    from polyscope.calibration import (
        category_brier_scores,
        compute_calibration,
        overall_brier,
    )
    from polyscope.models import ResolvedMarket

    db = await get_db()
    try:
        rows = await get_resolved_markets(db)
    finally:
        await db.close()

    markets = [
        ResolvedMarket(
            market_id=r["market_id"],
            question=r["question"],
            category=r["category"] or "",
            final_price=r["final_price"],
            outcome=r["outcome"],
            resolved_at=r["resolved_at"],
            brier_score=r["brier_score"],
        )
        for r in rows
    ]

    return {
        "overall_brier": overall_brier(markets),
        "calibration": [asdict(b) for b in compute_calibration(markets)],
        "by_category": category_brier_scores(markets),
        "total_resolved": len(markets),
    }


@app.get("/api/signals/accuracy")
async def signals_accuracy():
    """Signal track record — win rates by tier, rolling 30-day, and simulated P&L."""
    db = await get_db()
    try:
        stats = await get_signal_accuracy(db)
        simulation = await get_signal_pnl_simulation(db)
        stats["simulation"] = simulation
        return stats
    finally:
        await db.close()


@app.get("/api/calibration/category/{category}")
async def calibration_by_category(category: str):
    """Category-specific accuracy."""
    from polyscope.calibration import compute_calibration
    from polyscope.models import ResolvedMarket

    db = await get_db()
    try:
        rows = await get_resolved_markets(db)
    finally:
        await db.close()

    markets = [
        ResolvedMarket(
            market_id=r["market_id"],
            question=r["question"],
            category=r["category"] or "",
            final_price=r["final_price"],
            outcome=r["outcome"],
            resolved_at=r["resolved_at"],
            brier_score=r["brier_score"],
        )
        for r in rows
        if (r.get("category") or "").lower() == category.lower()
    ]

    return {
        "category": category,
        "calibration": [asdict(b) for b in compute_calibration(markets)],
        "total_resolved": len(markets),
    }


@app.get("/api/events")
async def list_events(limit: int = Query(20, le=50)):
    """Group markets by event — aggregate SM sentiment per event cluster."""
    markets_list = cache.get("markets") or []
    divergences = cache.get("divergences") or []

    # Build divergence lookup
    div_map = {d.market_id: d for d in divergences}

    # Group by question prefix (first 40 chars) as a heuristic
    from collections import defaultdict

    groups: dict[str, list] = defaultdict(list)
    for m in markets_list:
        prefix = m.question[:40].rsplit(" ", 1)[0] if len(m.question) > 40 else m.question
        groups[prefix].append(m)

    # Only keep groups with 2+ markets (actual event clusters)
    events = []
    for title, mkts in groups.items():
        if len(mkts) < 2:
            continue
        total_vol = sum(m.volume_24h for m in mkts)
        div_signals = [div_map[m.condition_id] for m in mkts if m.condition_id in div_map]
        avg_div = (
            sum(d.divergence_pct for d in div_signals) / len(div_signals)
            if div_signals
            else 0
        )
        events.append({
            "title": title,
            "market_count": len(mkts),
            "total_volume": round(total_vol, 2),
            "divergence_signals": len(div_signals),
            "avg_divergence": round(avg_div, 4),
            "markets": [
                {"condition_id": m.condition_id, "question": m.question, "price_yes": m.price_yes}
                for m in mkts[:5]
            ],
        })

    events.sort(key=lambda e: e["total_volume"], reverse=True)
    return {"events": events[:limit], "total": len(events)}


# ── Whale Flow Endpoints ───────────────────────────────────


@app.get("/api/whale-flow")
async def whale_flow(
    hours: int = Query(24, ge=1, le=168),
    min_size: float = Query(10000, ge=0),
):
    """Recent whale trade alerts."""
    db = await get_db()
    try:
        alerts = await get_whale_alerts(db, hours=hours, min_size=min_size)
        return {
            "alerts": alerts,
            "count": len(alerts),
            "disclaimer": DISCLAIMER,
        }
    finally:
        await db.close()


@app.get("/api/whale-flow/pending")
async def whale_flow_pending():
    """Unnotified whale alerts (internal, for bot)."""
    db = await get_db()
    try:
        alerts = await get_pending_whale_alerts(db)
        return {"alerts": alerts, "count": len(alerts)}
    finally:
        await db.close()
