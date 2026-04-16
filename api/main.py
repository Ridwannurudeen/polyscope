"""FastAPI app — PolyScope API."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from dataclasses import asdict

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

from .cache import cache
from .database import (
    add_to_watchlist,
    get_db,
    get_divergence_history,
    get_divergence_signals,
    get_expired_signal_count,
    get_metrics_summary,
    get_pending_whale_alerts,
    get_portfolio,
    get_resolved_markets,
    get_signal_accuracy,
    get_leaderboard_comparison,
    get_methodology_stats,
    get_signal_evidence,
    get_signal_pnl_simulation,
    get_signal_history_for_market,
    get_trader_accuracy_leaderboard,
    get_trader_profile,
    get_watchlist,
    get_whale_alerts,
    init_db,
    link_wallet_to_client,
    mark_alerts_notified,
    record_event,
    record_user_action,
    remove_from_watchlist,
    search_universal,
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


@app.get("/api/search")
async def search(q: str = Query(..., min_length=1, max_length=128)):
    """Universal search across markets (by question) and traders (by address)."""
    db = await get_db()
    try:
        return await search_universal(db, q, limit=8)
    finally:
        await db.close()


@app.get("/api/leaderboards/compare")
async def leaderboards_compare(
    limit: int = Query(25, ge=5, le=100),
    min_signals: int = Query(5, ge=1),
):
    """Side-by-side: Polymarket P&L leaderboard vs PolyScope accuracy leaderboard.

    Returns both rankings plus the overlap analysis: which P&L-top
    addresses also appear in the accuracy-top, and which accuracy
    leaders are missing from the P&L top entirely.
    """
    # P&L leaderboard from cache (kept fresh by fetch_leaderboard_job)
    pl_traders = cache.get("leaderboard") or []
    pl_top = [
        {
            "rank": t.rank,
            "address": t.address,
            "name": getattr(t, "name", None),
            "profit": t.profit,
            "volume": t.volume,
            "alpha_ratio": getattr(t, "alpha_ratio", None),
        }
        for t in pl_traders[:limit]
    ]
    pl_top_addresses = {t["address"].lower() for t in pl_top}

    db = await get_db()
    try:
        comp = await get_leaderboard_comparison(
            db, limit=limit, min_signals=min_signals
        )
    finally:
        await db.close()

    accuracy_top = comp["accuracy_top"]
    accuracy_top_addresses = {
        t["trader_address"].lower() for t in accuracy_top
    }

    # Overlap analysis
    overlap_addresses = pl_top_addresses & accuracy_top_addresses
    overlap_pct = (
        len(overlap_addresses) / len(accuracy_top_addresses) * 100
        if accuracy_top_addresses
        else None
    )

    # Which P&L leaders are anti-predictive (in fade list)?
    fade_addresses = {t["trader_address"].lower() for t in comp["accuracy_fade"]}
    pl_in_fade = [
        t for t in pl_top if t["address"].lower() in fade_addresses
    ]

    # Which accuracy leaders aren't on P&L top?
    accuracy_missing_from_pl = [
        t for t in accuracy_top if t["trader_address"].lower() not in pl_top_addresses
    ]

    return {
        "pl_leaderboard": pl_top,
        "accuracy_top": accuracy_top,
        "accuracy_fade": comp["accuracy_fade"],
        "overlap": {
            "addresses": sorted(overlap_addresses),
            "count": len(overlap_addresses),
            "overlap_pct_of_accuracy_top": overlap_pct,
        },
        "pl_top_in_fade_list": pl_in_fade,
        "accuracy_top_missing_from_pl": accuracy_missing_from_pl,
        "min_signals": min_signals,
        "limit": limit,
    }


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


# ── Portfolio / Watchlist ──────────────────────────────────
#
# Anonymous per-client storage keyed by a UUID the frontend generates
# and persists in localStorage. No auth, no account system — v1 is a
# convenience layer, not an identity system.


# EVM address: 0x + 40 hex chars. Case-insensitive; we lower() on write.
_EVM_ADDR_RE = r"^0x[a-fA-F0-9]{40}$"


class WatchlistAddRequest(BaseModel):
    client_id: str = Field(min_length=8, max_length=64)
    market_id: str = Field(min_length=1, max_length=128)
    wallet_address: str | None = Field(default=None, pattern=_EVM_ADDR_RE)


class UserActionRequest(BaseModel):
    client_id: str = Field(min_length=8, max_length=64)
    market_id: str = Field(min_length=1, max_length=128)
    action_direction: str = Field(pattern="^(YES|NO)$")
    size: float = Field(gt=0)
    price: float = Field(gt=0, lt=1)
    watchlist_id: int | None = None
    wallet_address: str | None = Field(default=None, pattern=_EVM_ADDR_RE)


class LinkWalletRequest(BaseModel):
    client_id: str = Field(min_length=8, max_length=64)
    wallet_address: str = Field(pattern=_EVM_ADDR_RE)


@app.post("/api/watchlist/add")
async def watchlist_add(body: WatchlistAddRequest):
    db = await get_db()
    wallet = body.wallet_address.lower() if body.wallet_address else None
    try:
        result = await add_to_watchlist(
            db, body.client_id, body.market_id, wallet_address=wallet
        )
        await db.commit()
    finally:
        await db.close()
    if not result:
        raise HTTPException(status_code=404, detail="no signal for this market")
    return result


@app.delete("/api/watchlist/{watchlist_id}")
async def watchlist_remove(watchlist_id: int, client_id: str = Query(..., min_length=8)):
    db = await get_db()
    try:
        removed = await remove_from_watchlist(db, client_id, watchlist_id)
        await db.commit()
    finally:
        await db.close()
    if not removed:
        raise HTTPException(status_code=404, detail="not found or not yours")
    return {"removed": True}


@app.get("/api/watchlist")
async def watchlist_list(
    client_id: str = Query(..., min_length=8),
    wallet_address: str | None = Query(default=None, pattern=_EVM_ADDR_RE),
):
    wallet = wallet_address.lower() if wallet_address else None
    db = await get_db()
    try:
        items = await get_watchlist(db, client_id, wallet_address=wallet)
    finally:
        await db.close()
    return {"items": items, "count": len(items)}


@app.post("/api/portfolio/act")
async def portfolio_act(body: UserActionRequest):
    db = await get_db()
    wallet = body.wallet_address.lower() if body.wallet_address else None
    try:
        action_id = await record_user_action(
            db,
            client_id=body.client_id,
            market_id=body.market_id,
            action_direction=body.action_direction,
            size=body.size,
            price=body.price,
            watchlist_id=body.watchlist_id,
            wallet_address=wallet,
        )
        await db.commit()
    finally:
        await db.close()
    return {"id": action_id}


@app.get("/api/portfolio")
async def portfolio(
    client_id: str = Query(..., min_length=8),
    wallet_address: str | None = Query(default=None, pattern=_EVM_ADDR_RE),
):
    wallet = wallet_address.lower() if wallet_address else None
    db = await get_db()
    try:
        return await get_portfolio(db, client_id, wallet_address=wallet)
    finally:
        await db.close()


@app.post("/api/wallet/link")
async def wallet_link(body: LinkWalletRequest):
    """Link an anonymous client_id to a wallet + migrate prior history.

    Called once on first wallet connect. Idempotent — subsequent calls
    update last_seen and migrate any rows still tagged with the raw
    client_id (e.g., actions taken from a second device before linking).

    Retries on transient "database is locked" errors — the scheduler
    does heavy writes that can block the busy_timeout window.
    """
    import asyncio
    import sqlite3

    last_err: Exception | None = None
    for attempt in range(4):
        db = await get_db()
        try:
            result = await link_wallet_to_client(
                db, body.client_id, body.wallet_address.lower()
            )
            await db.commit()
            return result
        except sqlite3.OperationalError as e:
            last_err = e
            if "locked" not in str(e).lower():
                raise
            # exponential backoff: 0.5s, 1s, 2s, 4s
            await asyncio.sleep(0.5 * (2 ** attempt))
        finally:
            await db.close()

    logger.warning("wallet_link failed after retries: %s", last_err)
    raise HTTPException(
        status_code=503,
        detail="Database busy — please retry in a few seconds",
    )


# ── Polymarket builder-attribution signing ─────────────────

from .polymarket_signing import is_configured, sign_request


class SignRequest(BaseModel):
    method: str = Field(pattern="^(GET|POST|DELETE|PUT|PATCH)$")
    path: str = Field(min_length=1, max_length=256, pattern="^/")
    body: str = Field(default="", max_length=16384)


@app.get("/api/builder/status")
async def builder_status():
    """Whether builder attribution secrets are configured on this server."""
    return {"configured": is_configured()}


@app.post("/api/sign")
async def sign(body: SignRequest):
    """Produce the four POLY_BUILDER_* attribution headers for a CLOB request.

    The secret never leaves the server — the frontend sends only the
    request method/path/body it intends to forward, receives the signed
    headers, and attaches them to its outbound request to Polymarket.

    If builder secrets aren't yet configured on this server, returns
    `mode: "stub"` so the UI can render a "Coming soon" state without
    the flow breaking.
    """
    signed = sign_request(body.method, body.path, body.body)
    return {
        "headers": signed.to_headers(),
        "mode": signed.mode,
    }


# ── Instrumentation ────────────────────────────────────────

import os


class EventRequest(BaseModel):
    event_type: str = Field(min_length=1, max_length=64)
    client_id: str | None = Field(default=None, max_length=64)
    properties: dict | None = None
    path: str | None = Field(default=None, max_length=256)
    referrer: str | None = Field(default=None, max_length=512)


@app.post("/api/events")
async def events_ingest(body: EventRequest):
    db = await get_db()
    try:
        await record_event(
            db,
            event_type=body.event_type,
            client_id=body.client_id,
            properties=body.properties,
            path=body.path,
            referrer=body.referrer,
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}


@app.get("/api/admin/metrics")
async def admin_metrics(
    token: str = Query(...),
    days: int = Query(7, ge=1, le=90),
):
    """Admin metrics dashboard. Requires POLYSCOPE_ADMIN_TOKEN env match."""
    expected = os.environ.get("POLYSCOPE_ADMIN_TOKEN", "")
    if not expected or token != expected:
        raise HTTPException(status_code=401, detail="invalid token")
    db = await get_db()
    try:
        return await get_metrics_summary(db, days=days)
    finally:
        await db.close()
