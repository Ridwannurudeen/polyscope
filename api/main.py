"""FastAPI app — PolyScope API."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from dataclasses import asdict

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from .cache import cache
from .database import get_db, get_divergence_history, get_divergence_signals, get_resolved_markets, init_db
from .scheduler import (
    cleanup_job,
    close_client,
    compute_divergences_job,
    detect_movers_job,
    fetch_leaderboard_job,
    fetch_markets_job,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

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
    scheduler.add_job(cleanup_job, "interval", hours=24, id="cleanup")
    scheduler.start()

    # Run initial fetch + compute
    logger.info("Running initial data fetch...")
    await fetch_markets_job()
    await fetch_leaderboard_job()
    await compute_divergences_job()
    await detect_movers_job()

    yield

    # Shutdown
    scheduler.shutdown(wait=False)
    await close_client()
    cache.clear()


app = FastAPI(
    title="PolyScope",
    description="Counter-consensus intelligence for Polymarket",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

DISCLAIMER = (
    "PolyScope provides market intelligence only. "
    "It does not facilitate, recommend, or enable participation in prediction markets."
)


@app.get("/")
async def root():
    return {"name": "PolyScope", "version": "0.1.0", "disclaimer": DISCLAIMER}


@app.get("/api/scan/latest")
async def scan_latest():
    """Latest scan: divergences + movers + summary."""
    divergences = cache.get("divergences") or []
    movers = cache.get("movers") or {}
    markets = cache.get("markets") or []

    return {
        "divergences": [asdict(d) for d in divergences[:20]],
        "movers_24h": [asdict(m) for m in (movers.get("24h") or [])[:10]],
        "total_markets": len(markets),
        "total_divergences": len(divergences),
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/divergences")
async def get_divergences():
    """Current counter-consensus signals."""
    divergences = cache.get("divergences") or []
    return {
        "signals": [asdict(d) for d in divergences],
        "count": len(divergences),
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
    markets = cache.get("markets") or []
    market = next((m for m in markets if m.condition_id == condition_id), None)
    if not market:
        return {"error": "Market not found"}

    # Check for divergence signal on this market
    divergences = cache.get("divergences") or []
    signal = next((d for d in divergences if d.market_id == condition_id), None)

    # Get price history
    from .scheduler import get_client

    client = get_client()
    price_history = await client.get_price_history(condition_id)

    return {
        "market": asdict(market),
        "divergence": asdict(signal) if signal else None,
        "price_history": price_history[:100],
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
