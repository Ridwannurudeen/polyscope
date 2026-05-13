"""FastAPI app — PolyScope API."""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from dataclasses import asdict, is_dataclass

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

from .cache import cache
from .database import (
    add_to_watchlist,
    follow_trader,
    get_db,
    get_divergence_history,
    get_divergence_signals,
    get_expired_signal_count,
    get_follow_alerts,
    get_followed_traders,
    get_metrics_summary,
    get_pending_whale_alerts,
    get_portfolio,
    get_predictive_contributors_for_markets,
    get_low_priority_write_db,
    get_public_read_db,
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
    is_following,
    client_has_linked_wallet,
    is_wallet_linked_to_client,
    link_wallet_to_client,
    builder_trades_stats,
    list_builder_orders,
    list_builder_trades,
    mark_alerts_seen,
    record_builder_order_attempt,
    record_event,
    record_user_action,
    remove_from_watchlist,
    unfollow_trader,
    update_builder_order_result,
)
from . import wss_runtime
from .scheduler import (
    cleanup_job,
    close_client,
    compute_divergences_job,
    compute_live_divergences_job,
    detect_movers_job,
    detect_whale_trades_job,
    fetch_leaderboard_job,
    fetch_markets_job,
    refresh_wss_subscription_job,
    sync_attributed_trades_job,
    sync_builder_orders_job,
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
SCHEDULER_DISABLED_VALUES = {"1", "true", "yes", "on"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()

    scheduler_disabled = (
        os.getenv("POLYSCOPE_DISABLE_SCHEDULER", "").strip().lower() in SCHEDULER_DISABLED_VALUES
    )
    if scheduler_disabled:
        logger.info("Scheduler disabled by POLYSCOPE_DISABLE_SCHEDULER")
    else:
        # Schedule jobs
        # max_instances=1 + coalesce=True prevents overlap when a long
        # job overruns its interval; misfire_grace_time runs a missed
        # tick if the scheduler was momentarily blocked.
        _job_kwargs = dict(max_instances=1, coalesce=True, misfire_grace_time=60)
        scheduler.add_job(
            fetch_markets_job, "interval", minutes=5, id="fetch_markets", **_job_kwargs
        )
        scheduler.add_job(
            fetch_leaderboard_job, "interval", minutes=10, id="fetch_leaderboard", **_job_kwargs
        )
        scheduler.add_job(
            compute_divergences_job, "interval", minutes=5, id="compute_divergences", **_job_kwargs
        )
        scheduler.add_job(
            detect_movers_job, "interval", minutes=5, id="detect_movers", **_job_kwargs
        )
        scheduler.add_job(
            track_outcomes_job, "interval", hours=1, id="track_outcomes", **_job_kwargs
        )
        scheduler.add_job(
            detect_whale_trades_job, "interval", minutes=2, id="detect_whales", **_job_kwargs
        )
        scheduler.add_job(
            sync_builder_orders_job, "interval", seconds=60, id="sync_builder_orders", **_job_kwargs
        )
        scheduler.add_job(
            sync_attributed_trades_job,
            "interval",
            minutes=3,
            id="sync_builder_trades",
            **_job_kwargs,
        )
        scheduler.add_job(cleanup_job, "interval", hours=24, id="cleanup", **_job_kwargs)
        # WSS subscription is re-evaluated every 10 min to track shifts in
        # the top-N-by-volume set. Gated on POLYSCOPE_WSS_ENABLED inside
        # the job itself — registering unconditionally is harmless.
        scheduler.add_job(
            refresh_wss_subscription_job,
            "interval",
            minutes=10,
            id="refresh_wss_subscription",
            **_job_kwargs,
        )
        # Live divergence recompute on WSS prices, 30s cadence. Internally
        # gated on POLYSCOPE_WSS_ENABLED + a populated positions cache, so
        # registering unconditionally is harmless.
        scheduler.add_job(
            compute_live_divergences_job,
            "interval",
            seconds=30,
            id="compute_live_divergences",
            **_job_kwargs,
        )
        scheduler.start()

        # Run initial fetch (markets + leaderboard synchronously so API has data)
        logger.info("Running initial data fetch...")
        await fetch_markets_job()
        await fetch_leaderboard_job()
        await _warm_public_stats_caches()

        # Bootstrap the WSS stream immediately if enabled, so prices start
        # flowing without waiting for the 10-min scheduler tick.
        if wss_runtime.is_enabled():
            await refresh_wss_subscription_job()

        # Run heavy scans in background so uvicorn starts immediately
        asyncio.create_task(_run_initial_scans())

    yield

    # Shutdown
    if scheduler.running:
        scheduler.shutdown(wait=False)
    await wss_runtime.stop_stream()
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


def _cors_origins() -> list[str]:
    """Comma-separated POLYSCOPE_CORS_ORIGINS override, defaulting to prod."""
    raw = os.getenv("POLYSCOPE_CORS_ORIGINS", "").strip()
    if not raw:
        return ["https://polyscope.gudman.xyz"]
    return [o.strip() for o in raw.split(",") if o.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

DISCLAIMER = (
    "PolyScope provides market intelligence and non-custodial workflow tools. "
    "It is not financial advice and does not custody funds."
)

_CONDITION_ID_RE = re.compile(r"^[0-9a-zA-Z_-]{1,128}$")
_GAMMA_MARKETS_URL = "https://gamma-api.polymarket.com/markets"
_WALLET_LINK_TTL_SECONDS = 300
_WALLET_LINK_DOMAINS = {"polyscope.gudman.xyz"}
_DEV_DOMAIN_FLAGS = {"1", "true", "yes", "on"}


def _dev_wallet_domains_allowed() -> bool:
    return os.getenv("POLYSCOPE_ALLOW_DEV_DOMAINS", "").strip().lower() in _DEV_DOMAIN_FLAGS


_PUBLIC_READ_BUSY_TIMEOUT_MS = 1000
_PUBLIC_STATS_TTL_SECONDS = 600
_PUBLIC_PARTIAL_STATS_TTL_SECONDS = 60
_PUBLIC_STATS_DEADLINE_SECONDS = 6.0
_PUBLIC_CACHE_REFRESH_TASKS: dict[str, asyncio.Task] = {}


async def _get_public_read_db():
    return await get_public_read_db(_PUBLIC_READ_BUSY_TIMEOUT_MS)


def _with_public_cache_meta(
    payload: dict,
    *,
    source: str,
    stale: bool,
    partial: bool | None = None,
    fallback_reason: str | None = None,
) -> dict:
    data = dict(payload)
    data["source"] = source
    data["stale"] = stale
    if partial is not None:
        data["partial"] = partial
    elif "partial" in data:
        data["partial"] = bool(data["partial"])
    if fallback_reason:
        data["fallback_reason"] = fallback_reason
    else:
        data.pop("fallback_reason", None)
    return data


def _cache_value_with_source(key: str, empty):
    cached = cache.get(key)
    if cached is not None:
        return cached, "cache", False

    stale = cache.get_stale(key)
    if stale is not None:
        return stale, "stale_cache", True

    return empty, "unavailable", True


async def _wait_for_public_task(
    task: asyncio.Task, timeout_seconds: float
) -> dict | tuple[list[dict], int] | None:
    done, _pending = await asyncio.wait({task}, timeout=timeout_seconds)
    if task not in done:
        return None
    return task.result()


def _log_background_task_failure(task_name: str, done_task: asyncio.Task) -> None:
    if done_task.cancelled():
        return
    try:
        done_task.result()
    except Exception:
        logger.warning("%s failed", task_name, exc_info=True)


def _ensure_public_cache_refresh(cache_key: str, loader, ttl_seconds: int) -> asyncio.Task:
    existing = _PUBLIC_CACHE_REFRESH_TASKS.get(cache_key)
    if existing is not None and not existing.done():
        return existing

    async def _refresh():
        result = await loader()
        cache.set(cache_key, result, ttl_seconds=ttl_seconds)
        return result

    task = asyncio.create_task(_refresh())
    _PUBLIC_CACHE_REFRESH_TASKS[cache_key] = task

    def _on_done(done_task: asyncio.Task):
        if _PUBLIC_CACHE_REFRESH_TASKS.get(cache_key) is done_task:
            _PUBLIC_CACHE_REFRESH_TASKS.pop(cache_key, None)
        _log_background_task_failure(f"Public cache refresh for {cache_key}", done_task)

    task.add_done_callback(_on_done)
    return task


async def _load_methodology_stats(include_predictive_filter: bool = True) -> dict:
    db = await _get_public_read_db()
    try:
        return await get_methodology_stats(db, include_predictive_filter=include_predictive_filter)
    finally:
        await db.close()


async def _load_signals_accuracy(include_simulation: bool = True) -> dict:
    db = await _get_public_read_db()
    try:
        stats = await get_signal_accuracy(db)
        if include_simulation:
            stats["simulation"] = await get_signal_pnl_simulation(db)
        return stats
    finally:
        await db.close()


async def _warm_public_stats_caches() -> None:
    for cache_key, loader in (
        ("divergences", _warm_divergences_cache),
        ("methodology_stats", _load_methodology_stats),
        ("signals_accuracy", _load_signals_accuracy),
    ):
        try:
            cache.set(
                cache_key,
                await asyncio.wait_for(loader(), 120.0),
                ttl_seconds=_PUBLIC_STATS_TTL_SECONDS,
            )
            logger.info("Warmed public stats cache: %s", cache_key)
        except Exception:
            logger.exception("Failed to warm public stats cache: %s", cache_key)


def _empty_methodology_stats() -> dict:
    return {
        "available": False,
        "signals": {
            "total": 0,
            "resolved": 0,
            "correct": 0,
            "overall_win_rate_pct": None,
            "first_captured": None,
            "latest_captured": None,
        },
        "skew_breakdown": {},
        "resolved_markets": 0,
        "per_trader": {
            "records_captured": 0,
            "traders_scored": 0,
            "avg_accuracy_pct": None,
        },
    }


def _empty_signals_accuracy() -> dict:
    empty_tier = {"total": 0, "correct": 0, "win_rate": 0.0}
    return {
        "available": False,
        "overall": {
            "total_signals": 0,
            "correct": 0,
            "win_rate": 0.0,
            "avg_score": 0.0,
        },
        "by_tier": {
            "high": dict(empty_tier),
            "medium": dict(empty_tier),
            "low": dict(empty_tier),
        },
        "by_skew": {
            "very_lopsided": dict(empty_tier),
            "lopsided": dict(empty_tier),
            "moderate": dict(empty_tier),
            "tight": dict(empty_tier),
        },
        "rolling_30d": dict(empty_tier),
    }


def _serialize_divergence_signals(
    divergences, predictive: dict[str, dict] | None = None
) -> list[dict]:
    predictive = predictive or {}
    signals = []
    for item in divergences:
        signal = asdict(item) if is_dataclass(item) else dict(item)
        signal.setdefault(
            "predictive_contributor",
            predictive.get(signal.get("market_id")),
        )
        signals.append(signal)
    return signals


def _divergences_response(
    signals: list[dict],
    *,
    source: str,
    stale: bool,
    expired_count: int | None,
    fallback_reason: str | None = None,
) -> dict:
    response = {
        "signals": signals,
        "count": len(signals),
        "expired_count": expired_count,
        "expired_count_source": "db" if expired_count is not None else "unavailable",
        "source": source,
        "stale": stale,
        "disclaimer": DISCLAIMER,
    }
    if fallback_reason:
        response["fallback_reason"] = fallback_reason
    return response


async def _load_divergences_from_db() -> tuple[list[dict], int]:
    db = await _get_public_read_db()
    try:
        rows = await get_divergence_signals(db, limit=50, hours=1)
        expired_count = await get_expired_signal_count(db)
        cache.set("divergences_expired_count", expired_count, ttl_seconds=300)
        return rows, expired_count
    finally:
        await db.close()


async def _predictive_for_divergences(
    divergences,
    cached: dict[str, dict] | None = None,
) -> dict[str, dict]:
    predictive = dict(cached or {})
    missing: list[str] = []
    for item in divergences:
        market_id = getattr(item, "market_id", None)
        if market_id is None and isinstance(item, dict):
            market_id = item.get("market_id")
        if isinstance(market_id, str) and market_id and market_id not in predictive:
            missing.append(market_id)
    if not missing:
        return predictive

    db = await _get_public_read_db()
    try:
        predictive.update(
            await get_predictive_contributors_for_markets(
                db,
                list(dict.fromkeys(missing)),
            )
        )
    finally:
        await db.close()
    return predictive


async def _warm_divergences_cache() -> list[dict]:
    rows, expired_count = await _load_divergences_from_db()
    predictive = await _predictive_for_divergences(
        rows,
        cache.get("divergence_predictive_contributors") or {},
    )
    cache.set("divergences_expired_count", expired_count, ttl_seconds=300)
    cache.set(
        "divergence_predictive_contributors",
        predictive,
        ttl_seconds=_PUBLIC_STATS_TTL_SECONDS,
    )
    return rows


@app.get("/")
async def root():
    return {"name": "PolyScope", "version": "0.3.0", "disclaimer": DISCLAIMER}


@app.get("/api/scan/latest")
async def scan_latest():
    """Latest scan: divergences + movers + summary."""
    divergences = cache.get("divergences")
    predictive = cache.get("divergence_predictive_contributors") or {}
    source = "cache"
    stale = False
    fallback_reason = None
    if divergences is None:
        stale_divergences = cache.get_stale("divergences")
        if stale_divergences is not None:
            divergences = stale_divergences
            source = "stale_cache"
            stale = True
        else:
            task = asyncio.create_task(_load_divergences_from_db())
            try:
                result = await _wait_for_public_task(task, _PUBLIC_STATS_DEADLINE_SECONDS)
            except Exception as e:
                logger.warning("Latest scan DB fallback failed: %s", e)
                result = None
            if result is None:
                if not task.done():
                    task.add_done_callback(
                        lambda done_task: _log_background_task_failure(
                            "Latest scan DB fallback", done_task
                        )
                    )
                divergences = []
                source = "unavailable"
                stale = True
                fallback_reason = "timeout"
            else:
                divergences, _expired_count = result
                predictive = await _predictive_for_divergences(
                    divergences[:20],
                    predictive,
                )
                source = "db_fallback"

    movers, movers_source, movers_stale = _cache_value_with_source("movers", {})
    markets, markets_source, markets_stale = _cache_value_with_source("markets", [])

    if source == "unavailable":
        div_out = divergences[:20]
    else:
        div_out = _serialize_divergence_signals(divergences[:20], predictive)

    response = {
        "divergences": div_out,
        "movers_24h": [asdict(m) for m in (movers.get("24h") or [])[:10]],
        "total_markets": len(markets),
        "total_divergences": len(divergences),
        "source": source,
        "stale": stale or movers_stale or markets_stale,
        "sources": {
            "divergences": source,
            "movers": movers_source,
            "markets": markets_source,
        },
        "disclaimer": DISCLAIMER,
    }
    if fallback_reason:
        response["fallback_reason"] = fallback_reason
    return response


@app.get("/api/divergences")
async def get_divergences():
    """Current counter-consensus signals."""
    divergences = cache.get("divergences")
    expired_count = cache.get("divergences_expired_count")
    predictive = cache.get("divergence_predictive_contributors") or {}

    if divergences is not None:
        return _divergences_response(
            _serialize_divergence_signals(divergences, predictive),
            source="cache",
            stale=False,
            expired_count=expired_count,
        )

    stale_divergences = cache.get_stale("divergences")
    if stale_divergences is not None:
        return _divergences_response(
            _serialize_divergence_signals(stale_divergences, predictive),
            source="stale_cache",
            stale=True,
            expired_count=expired_count,
        )

    task = asyncio.create_task(_load_divergences_from_db())
    try:
        result = await _wait_for_public_task(task, _PUBLIC_STATS_DEADLINE_SECONDS)
    except Exception as e:
        logger.warning("Divergence DB fallback failed: %s", e)
        result = None
    if result is None:
        if not task.done():
            task.add_done_callback(
                lambda done_task: _log_background_task_failure("Divergence DB fallback", done_task)
            )
        return _divergences_response(
            [],
            source="unavailable",
            stale=True,
            expired_count=None,
            fallback_reason="timeout",
        )

    rows, db_expired_count = result
    predictive = await _predictive_for_divergences(rows, predictive)
    return _divergences_response(
        _serialize_divergence_signals(rows, predictive),
        source="db_fallback",
        stale=False,
        expired_count=db_expired_count,
    )


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
    movers, source, stale = _cache_value_with_source("movers", {})
    tf_movers = movers.get(timeframe, [])
    return {
        "movers": [asdict(m) for m in tf_movers],
        "timeframe": timeframe,
        "count": len(tf_movers),
        "source": source,
        "stale": stale,
    }


@app.get("/api/markets")
async def list_markets(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    category: str | None = None,
):
    """Active markets with prices."""
    markets, source, stale = _cache_value_with_source("markets", [])
    if category:
        markets = [m for m in markets if category.lower() in m.category.lower()]
    total = len(markets)
    page = markets[offset : offset + limit]
    return {
        "markets": [asdict(m) for m in page],
        "total": total,
        "limit": limit,
        "offset": offset,
        "source": source,
        "stale": stale,
    }


@app.get("/api/market/{condition_id}")
async def get_market(condition_id: str):
    """Single market detail + divergence info."""
    if not _CONDITION_ID_RE.fullmatch(condition_id):
        return {"error": "Invalid condition ID"}

    markets, _source, _stale = _cache_value_with_source("markets", [])
    market = next((m for m in markets if m.condition_id == condition_id), None)
    if not market:
        return {"error": "Market not found"}

    # Check for divergence signal on this market
    divergences, _divergence_source, _divergence_stale = _cache_value_with_source("divergences", [])
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


def _parse_clob_token_ids(raw: object) -> tuple[str, str]:
    tokens = raw
    if isinstance(tokens, str):
        try:
            tokens = json.loads(tokens)
        except json.JSONDecodeError:
            tokens = [part.strip() for part in tokens.split(",")]
    if not isinstance(tokens, list) or len(tokens) < 2:
        raise HTTPException(
            status_code=502,
            detail="Polymarket returned malformed token IDs",
        )
    yes_token = str(tokens[0]).strip()
    no_token = str(tokens[1]).strip()
    if not yes_token or not no_token:
        raise HTTPException(
            status_code=502,
            detail="Polymarket returned incomplete token IDs",
        )
    return yes_token, no_token


def _tick_size_from_gamma(value: object) -> str:
    try:
        min_tick = float(value)
    except (TypeError, ValueError):
        return "0.01"
    if min_tick <= 0.001:
        return "0.001"
    if min_tick <= 0.01:
        return "0.01"
    return "0.1"


async def _fetch_gamma_market(condition_id: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                _GAMMA_MARKETS_URL,
                params={"condition_ids": condition_id, "limit": 1},
                headers={"User-Agent": "PolyScope/0.3"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Polymarket market lookup failed: {type(e).__name__}",
        ) from e
    except ValueError as e:
        raise HTTPException(
            status_code=502,
            detail="Polymarket returned invalid JSON",
        ) from e

    gamma = data[0] if isinstance(data, list) and data else None
    gamma_condition = (
        gamma.get("conditionId") or gamma.get("condition_id") or gamma.get("id")
        if isinstance(gamma, dict)
        else None
    )
    if not isinstance(gamma, dict) or str(gamma_condition).lower() != condition_id.lower():
        raise HTTPException(status_code=404, detail="Market not found on Polymarket")
    return gamma


@app.get("/api/market/{condition_id}/trade")
async def get_market_trade(condition_id: str):
    """Server-side Polymarket trade metadata for the order modal.

    The browser cannot safely call Gamma directly because production CORS
    blocks it. This endpoint fetches Gamma from the server, validates the
    token IDs against PolyScope's cached market, and returns only the fields
    needed for non-custodial CLOB order construction.
    """
    if not _CONDITION_ID_RE.fullmatch(condition_id):
        raise HTTPException(status_code=400, detail="Invalid condition ID")

    markets, _source, _stale = _cache_value_with_source("markets", [])
    market = next(
        (m for m in markets if m.condition_id.lower() == condition_id.lower()),
        None,
    )
    if not market:
        raise HTTPException(status_code=404, detail="Market not found")

    gamma = await _fetch_gamma_market(condition_id)
    if gamma.get("closed"):
        raise HTTPException(status_code=409, detail="Market is closed")
    if gamma.get("enableOrderBook") is False or gamma.get("acceptingOrders") is False:
        raise HTTPException(
            status_code=409,
            detail="Polymarket is not accepting orders on this market",
        )

    yes_token, no_token = _parse_clob_token_ids(gamma.get("clobTokenIds"))
    if market.token_id_yes and market.token_id_yes != yes_token:
        raise HTTPException(status_code=409, detail="YES token mismatch")
    if market.token_id_no and market.token_id_no != no_token:
        raise HTTPException(status_code=409, detail="NO token mismatch")

    return {
        "market": asdict(market),
        "tokens": {"YES": yes_token, "NO": no_token},
        "tick_size": _tick_size_from_gamma(gamma.get("orderPriceMinTickSize")),
        "neg_risk": bool(gamma.get("negRisk")),
        "accepting_orders": True,
    }


@app.get("/api/smart-money/feed")
async def smart_money_feed():
    """Top trader positions (read-only)."""
    leaderboard, source, stale = _cache_value_with_source("leaderboard", [])
    return {
        "traders": [asdict(t) for t in leaderboard[:50]],
        "count": len(leaderboard[:50]),
        "source": source,
        "stale": stale,
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/smart-money/leaderboard")
async def smart_money_leaderboard():
    """Top traders ranked by profit."""
    leaderboard, source, stale = _cache_value_with_source("leaderboard", [])
    return {
        "traders": [asdict(t) for t in leaderboard],
        "count": len(leaderboard),
        "source": source,
        "stale": stale,
    }


@app.get("/api/traders/leaderboard")
async def traders_accuracy_leaderboard(
    order: str = Query("predictive", pattern="^(predictive|anti-predictive)$"),
    limit: int = Query(100, ge=1, le=500),
    min_signals: int = Query(10, ge=1),
):
    """Traders ranked by per-signal predictive accuracy.

    order=predictive      — highest accuracy first
    order=anti-predictive — lowest accuracy first

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
    cached = cache.get("methodology_stats")
    if cached is not None:
        return _with_public_cache_meta(cached, source="cache", stale=False)

    stale = cache.get_stale("methodology_stats")
    _ensure_public_cache_refresh(
        "methodology_stats",
        _load_methodology_stats,
        _PUBLIC_STATS_TTL_SECONDS,
    )
    if stale is not None:
        return _with_public_cache_meta(stale, source="stale_cache", stale=True)

    task = asyncio.create_task(_load_methodology_stats(include_predictive_filter=False))
    try:
        result = await _wait_for_public_task(task, _PUBLIC_STATS_DEADLINE_SECONDS)
    except Exception as e:
        logger.warning("Methodology partial stats failed: %s", e)
        result = None

    if result is None:
        if not task.done():
            task.add_done_callback(
                lambda done_task: _log_background_task_failure(
                    "Methodology partial stats", done_task
                )
            )
        return _with_public_cache_meta(
            _empty_methodology_stats(),
            source="unavailable",
            stale=True,
            partial=True,
            fallback_reason="timeout",
        )

    result["partial"] = True
    if cache.get("methodology_stats") is None:
        cache.set(
            "methodology_stats",
            result,
            ttl_seconds=_PUBLIC_PARTIAL_STATS_TTL_SECONDS,
        )
    return _with_public_cache_meta(result, source="db_partial", stale=False)


@app.get("/api/search")
async def search(q: str = Query(..., min_length=1, max_length=128)):
    """Universal search across markets (by question) and traders (by address).

    Markets: scanned in-memory from the active `divergences` cache.
    DB-side LIKE on `divergence_signals.question` was 15+ seconds even
    bounded to 28 days because the planner couldn't use an index for the
    leading-wildcard substring match. The active-divergences cache is
    ~50 entries, so a Python scan is microseconds.

    Traders: small prefix lookup against `trader_accuracy`.
    """
    needle = q.strip().lower()
    if not needle:
        return {"markets": [], "traders": []}

    cached_signals = cache.get("divergences") or []
    market_matches: list[dict] = []
    seen_market_ids: set[str] = set()
    for signal in cached_signals:
        record = asdict(signal) if is_dataclass(signal) else dict(signal)
        question = (record.get("question") or "").lower()
        if needle not in question:
            continue
        market_id = record.get("market_id")
        if market_id in seen_market_ids:
            continue
        seen_market_ids.add(market_id)
        market_matches.append(
            {
                "market_id": market_id,
                "question": record.get("question"),
                "category": record.get("category"),
                "sm_direction": record.get("sm_direction"),
                "market_price": record.get("market_price"),
                "sm_consensus": record.get("sm_consensus"),
                "divergence_pct": record.get("divergence_pct"),
                "signal_strength": record.get("signal_strength"),
                "latest_ts": record.get("timestamp"),
            }
        )
        if len(market_matches) >= 8:
            break

    traders: list[dict] = []
    if needle.startswith("0x"):
        db = await get_db()
        try:
            cursor = await db.execute(
                """SELECT trader_address, accuracy_pct, total_divergent_signals,
                          correct_predictions
                   FROM trader_accuracy
                   WHERE trader_address LIKE ? COLLATE NOCASE
                   ORDER BY accuracy_pct DESC, total_divergent_signals DESC
                   LIMIT ?""",
                (f"{needle}%", 8),
            )
            traders = [dict(r) for r in await cursor.fetchall()]
        finally:
            await db.close()
    return {"markets": market_matches, "traders": traders}


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
    pl_traders, pl_source, pl_stale = _cache_value_with_source("leaderboard", [])
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
        comp = await get_leaderboard_comparison(db, limit=limit, min_signals=min_signals)
    finally:
        await db.close()

    accuracy_top = comp["accuracy_top"]
    accuracy_top_addresses = {t["trader_address"].lower() for t in accuracy_top}

    # Overlap analysis
    overlap_addresses = pl_top_addresses & accuracy_top_addresses
    overlap_pct = (
        len(overlap_addresses) / len(accuracy_top_addresses) * 100
        if accuracy_top_addresses
        else None
    )

    # Which P&L leaders are low-accuracy on divergent signals?
    fade_addresses = {t["trader_address"].lower() for t in comp["accuracy_fade"]}
    pl_in_fade = [t for t in pl_top if t["address"].lower() in fade_addresses]

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
        "pnl_source": pl_source,
        "pnl_stale": pl_stale,
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
    """Brier scores + calibration by category.

    Cached for 10 minutes — the underlying scan over `resolved_markets`
    plus per-row Brier computation takes ~14s on the live dataset, far
    over the public-stats deadline. Frontend polls every 600s.
    """
    cached = cache.get("calibration_overview")
    if cached is not None:
        return cached

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

    result = {
        "overall_brier": overall_brier(markets),
        "calibration": [asdict(b) for b in compute_calibration(markets)],
        "by_category": category_brier_scores(markets),
        "total_resolved": len(markets),
    }
    cache.set("calibration_overview", result, ttl_seconds=600)
    return result


@app.get("/api/signals/accuracy")
async def signals_accuracy():
    """Signal track record — win rates by tier, rolling 30-day, and simulated P&L."""
    cached = cache.get("signals_accuracy")
    if cached is not None:
        return _with_public_cache_meta(cached, source="cache", stale=False)

    stale = cache.get_stale("signals_accuracy")
    _ensure_public_cache_refresh(
        "signals_accuracy",
        _load_signals_accuracy,
        _PUBLIC_STATS_TTL_SECONDS,
    )
    if stale is not None:
        return _with_public_cache_meta(stale, source="stale_cache", stale=True)

    task = asyncio.create_task(_load_signals_accuracy(include_simulation=False))
    try:
        stats = await _wait_for_public_task(task, _PUBLIC_STATS_DEADLINE_SECONDS)
    except Exception as e:
        logger.warning("Signals accuracy partial stats failed: %s", e)
        stats = None

    if stats is None:
        if not task.done():
            task.add_done_callback(
                lambda done_task: _log_background_task_failure(
                    "Signals accuracy partial stats", done_task
                )
            )
        return _with_public_cache_meta(
            _empty_signals_accuracy(),
            source="unavailable",
            stale=True,
            partial=True,
            fallback_reason="timeout",
        )

    stats["partial"] = True
    if cache.get("signals_accuracy") is None:
        cache.set(
            "signals_accuracy",
            stats,
            ttl_seconds=_PUBLIC_PARTIAL_STATS_TTL_SECONDS,
        )
    return _with_public_cache_meta(stats, source="db_partial", stale=False)


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
    markets_list, _markets_source, _markets_stale = _cache_value_with_source("markets", [])
    divergences, _divergence_source, _divergence_stale = _cache_value_with_source("divergences", [])

    def _signal_market_id(signal) -> str | None:
        if isinstance(signal, dict):
            return signal.get("market_id")
        return getattr(signal, "market_id", None)

    def _signal_divergence_pct(signal) -> float:
        value = (
            signal.get("divergence_pct")
            if isinstance(signal, dict)
            else getattr(signal, "divergence_pct", 0)
        )
        return float(value or 0)

    # Build divergence lookup. Startup DB warm-cache stores dict rows;
    # scheduler scans store DivergenceSignal dataclasses.
    div_map = {market_id: d for d in divergences if (market_id := _signal_market_id(d))}

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
            sum(_signal_divergence_pct(d) for d in div_signals) / len(div_signals)
            if div_signals
            else 0
        )
        events.append(
            {
                "title": title,
                "market_count": len(mkts),
                "total_volume": round(total_vol, 2),
                "divergence_signals": len(div_signals),
                "avg_divergence": round(avg_div, 4),
                "markets": [
                    {
                        "condition_id": m.condition_id,
                        "question": m.question,
                        "price_yes": m.price_yes,
                    }
                    for m in mkts[:5]
                ],
            }
        )

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


import re as _re  # noqa: E402

# EVM address: 0x + 40 hex chars. Case-insensitive; we lower() on write.
_EVM_ADDR_RE = r"^0x[a-fA-F0-9]{40}$"
_EVM_ADDR_RE_COMPILED = _re.compile(_EVM_ADDR_RE)


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
    domain: str = Field(min_length=1, max_length=128, pattern=r"^[^\s/]+$")
    issued_at: int = Field(gt=0)
    signature: str = Field(
        min_length=132,
        max_length=132,
        pattern=r"^0x[0-9a-fA-F]{130}$",
    )


def _wallet_link_message(
    client_id: str,
    wallet_address: str,
    domain: str,
    issued_at: int,
) -> str:
    return (
        "PolyScope wallet link\n"
        f"Domain: {domain}\n"
        f"Client ID: {client_id}\n"
        f"Wallet: {wallet_address.lower()}\n"
        f"Issued At: {issued_at}"
    )


def _verify_wallet_link_signature(body: LinkWalletRequest) -> None:
    dev_allowed = _dev_wallet_domains_allowed()
    domain_allowed = body.domain in _WALLET_LINK_DOMAINS
    if not domain_allowed and dev_allowed:
        domain_allowed = (
            body.domain == "testserver"
            or body.domain.startswith("localhost:")
            or body.domain.startswith("127.0.0.1:")
        )
    if not domain_allowed:
        raise HTTPException(status_code=400, detail="wallet link domain not allowed")

    now = int(time.time())
    if abs(now - body.issued_at) > _WALLET_LINK_TTL_SECONDS:
        raise HTTPException(status_code=400, detail="wallet link signature expired")

    try:
        from eth_account import Account
        from eth_account.messages import encode_defunct

        message = _wallet_link_message(
            body.client_id,
            body.wallet_address,
            body.domain,
            body.issued_at,
        )
        recovered = Account.recover_message(
            encode_defunct(text=message),
            signature=body.signature,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail="invalid wallet signature") from e

    if recovered.lower() != body.wallet_address.lower():
        raise HTTPException(status_code=401, detail="signature does not match wallet")


async def _require_wallet_link(db, client_id: str, wallet_address: str | None) -> None:
    """Enforce wallet-signature ownership once a client_id has linked a wallet.

    Anonymous (pre-link) clients keep working with client_id alone — the
    wallet-link flow is opt-in. Once a wallet is linked, that client_id is
    permanently sealed: every subsequent read/write must present the
    matching wallet_address. Without this, a leaked client_id would grant
    unrestricted access to wallet-bound state (watchlist, follows, portfolio).
    """
    if wallet_address:
        if not await is_wallet_linked_to_client(db, client_id, wallet_address):
            raise HTTPException(status_code=401, detail="wallet is not linked to client")
        return
    if await client_has_linked_wallet(db, client_id):
        raise HTTPException(
            status_code=401,
            detail="wallet signature required for this client_id",
        )


@app.post("/api/watchlist/add")
async def watchlist_add(body: WatchlistAddRequest):
    wallet = body.wallet_address.lower() if body.wallet_address else None

    async def _op(db):
        await _require_wallet_link(db, body.client_id, wallet)
        return await add_to_watchlist(
            db,
            body.client_id,
            body.market_id,
            wallet_address=wallet,
        )

    result = await _retry_on_locked(
        "watchlist_add",
        _op,
    )
    if not result:
        raise HTTPException(status_code=404, detail="no signal for this market")
    return result


@app.delete("/api/watchlist/{watchlist_id}")
async def watchlist_remove(
    watchlist_id: int,
    client_id: str = Query(..., min_length=8),
    wallet_address: str | None = Query(default=None, pattern=_EVM_ADDR_RE),
):
    wallet = wallet_address.lower() if wallet_address else None

    async def _op(db):
        await _require_wallet_link(db, client_id, wallet)
        return {
            "removed": await remove_from_watchlist(
                db,
                client_id,
                watchlist_id,
                wallet_address=wallet,
            )
        }

    result = await _retry_on_locked("watchlist_remove", _op)
    if not result["removed"]:
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
        await _require_wallet_link(db, client_id, wallet)
        items = await get_watchlist(db, client_id, wallet_address=wallet)
    finally:
        await db.close()
    return {"items": items, "count": len(items)}


@app.post("/api/portfolio/act")
async def portfolio_act(body: UserActionRequest):
    wallet = body.wallet_address.lower() if body.wallet_address else None

    async def _op(db):
        await _require_wallet_link(db, body.client_id, wallet)
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
        return {"id": action_id}

    return await _retry_on_locked("portfolio_act", _op)


@app.get("/api/portfolio")
async def portfolio(
    client_id: str = Query(..., min_length=8),
    wallet_address: str | None = Query(default=None, pattern=_EVM_ADDR_RE),
):
    wallet = wallet_address.lower() if wallet_address else None
    db = await get_db()
    try:
        await _require_wallet_link(db, client_id, wallet)
        return await get_portfolio(db, client_id, wallet_address=wallet)
    finally:
        await db.close()


import asyncio as _asyncio  # noqa: E402
import sqlite3 as _sqlite3  # noqa: E402


async def _retry_on_locked(op_name: str, coro_factory):
    """Run a DB write coroutine with retries on 'database is locked'.

    The scheduler holds sustained write locks during heavy Polymarket
    position scans. busy_timeout (30s) usually covers it, but under
    contention we fall back to exponential backoff.

    `coro_factory` is a callable returning a fresh coroutine that takes
    an open db connection and returns a result. We re-open the db each
    attempt because aiosqlite doesn't recover from a failed commit.
    """
    last_err: Exception | None = None
    for attempt in range(4):
        db = await get_db()
        try:
            result = await coro_factory(db)
            await db.commit()
            return result
        except _sqlite3.OperationalError as e:
            last_err = e
            if "locked" not in str(e).lower():
                raise
            await _asyncio.sleep(0.5 * (2**attempt))
        finally:
            await db.close()
    logger.warning("%s failed after retries: %s", op_name, last_err)
    raise HTTPException(
        status_code=503,
        detail="Database busy — please retry in a few seconds",
    )


@app.post("/api/wallet/link")
async def wallet_link(body: LinkWalletRequest):
    """Link an anonymous client_id to a wallet after proving wallet ownership.

    Idempotent — subsequent calls update last_seen and migrate any rows
    still tagged with the raw client_id.
    """
    _verify_wallet_link_signature(body)
    return await _retry_on_locked(
        "wallet_link",
        lambda db: link_wallet_to_client(db, body.client_id, body.wallet_address.lower()),
    )


# ── Follow-trader ──────────────────────────────────────────


class FollowRequest(BaseModel):
    client_id: str = Field(min_length=8, max_length=64)
    trader_address: str = Field(pattern=_EVM_ADDR_RE)
    wallet_address: str | None = Field(default=None, pattern=_EVM_ADDR_RE)


@app.post("/api/follow/trader")
async def follow(body: FollowRequest):
    wallet = body.wallet_address.lower() if body.wallet_address else None

    async def _op(db):
        await _require_wallet_link(db, body.client_id, wallet)
        return await follow_trader(
            db,
            body.trader_address,
            body.client_id,
            wallet_address=wallet,
        )

    return await _retry_on_locked(
        "follow",
        _op,
    )


@app.delete("/api/follow/trader/{trader_address}")
async def unfollow(
    trader_address: str,
    client_id: str = Query(..., min_length=8),
    wallet_address: str | None = Query(default=None, pattern=_EVM_ADDR_RE),
):
    if not _EVM_ADDR_RE_COMPILED.match(trader_address):
        raise HTTPException(status_code=400, detail="invalid trader address")
    wallet = wallet_address.lower() if wallet_address else None

    async def _op(db):
        await _require_wallet_link(db, client_id, wallet)
        return {
            "removed": await unfollow_trader(db, trader_address, client_id, wallet_address=wallet)
        }

    return await _retry_on_locked("unfollow", _op)


@app.get("/api/follow/list")
async def follow_list(
    client_id: str = Query(..., min_length=8),
    wallet_address: str | None = Query(default=None, pattern=_EVM_ADDR_RE),
):
    wallet = wallet_address.lower() if wallet_address else None
    db = await get_db()
    try:
        await _require_wallet_link(db, client_id, wallet)
        items = await get_followed_traders(db, client_id, wallet_address=wallet)
    finally:
        await db.close()
    return {"items": items, "count": len(items)}


@app.get("/api/follow/is-following/{trader_address}")
async def follow_status(
    trader_address: str,
    client_id: str = Query(..., min_length=8),
    wallet_address: str | None = Query(default=None, pattern=_EVM_ADDR_RE),
):
    if not _EVM_ADDR_RE_COMPILED.match(trader_address):
        raise HTTPException(status_code=400, detail="invalid trader address")
    wallet = wallet_address.lower() if wallet_address else None
    db = await get_db()
    try:
        await _require_wallet_link(db, client_id, wallet)
        following = await is_following(db, trader_address, client_id, wallet_address=wallet)
    finally:
        await db.close()
    return {"following": following}


@app.get("/api/follow/alerts")
async def follow_alerts(
    client_id: str = Query(..., min_length=8),
    wallet_address: str | None = Query(default=None, pattern=_EVM_ADDR_RE),
    unseen_only: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
):
    wallet = wallet_address.lower() if wallet_address else None
    db = await get_db()
    try:
        await _require_wallet_link(db, client_id, wallet)
        items = await get_follow_alerts(
            db,
            client_id,
            wallet_address=wallet,
            unseen_only=unseen_only,
            limit=limit,
        )
    finally:
        await db.close()
    return {"items": items, "count": len(items)}


@app.post("/api/follow/alerts/mark-seen")
async def follow_alerts_mark_seen(
    client_id: str = Query(..., min_length=8),
    wallet_address: str | None = Query(default=None, pattern=_EVM_ADDR_RE),
):
    wallet = wallet_address.lower() if wallet_address else None

    async def _op(db):
        await _require_wallet_link(db, client_id, wallet)
        updated = await mark_alerts_seen(db, client_id, wallet_address=wallet)
        return {"marked_seen": updated}

    return await _retry_on_locked("mark_alerts_seen", _op)


# ── Polymarket builder-attribution signing ─────────────────

from .polymarket_signing import (  # noqa: E402
    get_builder_code,
    get_builder_signer,
    is_builder_code_configured,
)


@app.get("/api/builder/status")
async def builder_status():
    """Whether public Builder Code attribution is configured on this server."""
    return {"configured": is_builder_code_configured()}


@app.get("/api/builder/identity")
async def builder_identity():
    """Public Polymarket Builder Code for this deployment.

    Returned unconditionally — the code is a public on-chain identifier,
    not a secret. When unset, ``configured`` is false and ``code`` is null.
    """
    return {
        "configured": is_builder_code_configured(),
        "code": get_builder_code(),
    }


class BuilderSignRequest(BaseModel):
    method: str = Field(min_length=1, max_length=10, pattern="^[A-Z]+$")
    path: str = Field(min_length=1, max_length=200)
    body: str = Field(max_length=65536)


@app.post("/api/polymarket/builder/sign")
async def polymarket_builder_sign(req: BuilderSignRequest):
    """HMAC-sign a request for Polymarket Relayer / authenticated CLOB auth.

    The browser-side ``RelayClient`` and ``ClobClient`` are configured with
    ``BuilderConfig({ remoteBuilderConfig: { url: <this endpoint> } })``.
    On every authenticated call, the SDK POSTs the outgoing request shape
    here and attaches the four ``POLY_BUILDER_*`` headers we return.

    This keeps the Builder API Secret + Passphrase on the server. The four
    headers are intentionally short-lived (the SDK requests one per call)
    and only authenticate ``builder=this account`` to Polymarket — they
    do not authorize transactions. Per-IP rate limits on ``/api/*`` cap
    abuse; misuse would still attribute traffic to us, which is the goal.
    """
    signer = get_builder_signer()
    if signer is None:
        raise HTTPException(
            status_code=503,
            detail="Builder API credentials not configured",
        )
    payload = signer.create_builder_header_payload(
        method=req.method,
        path=req.path,
        body=req.body,
    )
    return {
        "POLY_BUILDER_API_KEY": payload.POLY_BUILDER_API_KEY,
        "POLY_BUILDER_PASSPHRASE": payload.POLY_BUILDER_PASSPHRASE,
        "POLY_BUILDER_SIGNATURE": payload.POLY_BUILDER_SIGNATURE,
        "POLY_BUILDER_TIMESTAMP": payload.POLY_BUILDER_TIMESTAMP,
    }


# ── Safe ownership verification ────────────────────────────
#
# Server-side getCode + getOwners against Polygon. The trade modal
# uses this instead of wagmi's browser-side readContract because
# public Polygon RPCs frequently fail in browser fetch contexts
# (CORS edge cases, ISP-level TLS rewriting, regional rate limits)
# even when they work fine over curl. Hitting our own origin
# eliminates that surface entirely.

_SAFE_RPC_ENDPOINTS = (
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon.drpc.org",
)
# selector for getOwners() on a Gnosis Safe — keccak256("getOwners()")[:4]
_GET_OWNERS_SELECTOR = "0xa0e67e2b"
# selector for owner() — keccak256("owner()")[:4]. Used by Polymarket's
# DepositWallet (a Solady-style Ownable contract) and other ERC-1271 SCAs
# whose authorized signer is exposed via this getter.
_OWNER_SELECTOR = "0x8da5cb5b"


async def _polygon_rpc_call(method: str, params: list) -> str:
    """POST a single eth_* call to the first healthy Polygon RPC.

    Returns the ``result`` field as a hex string. Raises HTTPException
    on transport failure across all endpoints or on JSON-RPC error.
    """
    last_err: str | None = None
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    async with httpx.AsyncClient(timeout=8.0) as client:
        for endpoint in _SAFE_RPC_ENDPOINTS:
            try:
                resp = await client.post(endpoint, json=payload)
                resp.raise_for_status()
                body = resp.json()
                if "error" in body:
                    last_err = str(body["error"])[:200]
                    continue
                result = body.get("result")
                if result is None:
                    last_err = "rpc returned no result"
                    continue
                return result
            except Exception as e:
                last_err = f"{type(e).__name__}: {str(e)[:150]}"
                continue
    raise HTTPException(
        status_code=502,
        detail=f"Polygon RPC unreachable: {last_err or 'unknown'}",
    )


def _decode_owner_list(raw: str) -> list[str]:
    """Decode ABI-encoded ``address[]`` response from getOwners().

    Layout: 32-byte offset (always 0x20) + 32-byte length + N×32-byte addresses.
    """
    if not raw or not raw.startswith("0x") or len(raw) < 130:
        return []
    data = raw[2:]
    try:
        length = int(data[64:128], 16)
    except ValueError:
        return []
    if length > 64:  # sanity cap — Safes never have this many owners
        return []
    owners: list[str] = []
    for i in range(length):
        start = 128 + i * 64
        chunk = data[start : start + 64]
        if len(chunk) != 64:
            return []
        owners.append("0x" + chunk[24:].lower())
    return owners


@app.get("/api/safe/{address}/owners")
async def safe_owners(address: str):
    """Verify a Polygon address is a Gnosis Safe and return its owners.

    Used by the trade modal's funder-paste verification. Returns
    ``{address, owners}`` on success, or 4xx with a specific reason.
    """
    if not _EVM_ADDR_RE_COMPILED.match(address):
        raise HTTPException(status_code=400, detail="invalid address format")
    addr = address.lower()

    code = await _polygon_rpc_call("eth_getCode", [addr, "latest"])
    if not code or code == "0x":
        raise HTTPException(
            status_code=404,
            detail="No contract at that address on Polygon",
        )

    raw = await _polygon_rpc_call(
        "eth_call",
        [{"to": addr, "data": _GET_OWNERS_SELECTOR}, "latest"],
    )
    owners = _decode_owner_list(raw)
    if not owners:
        raise HTTPException(
            status_code=400,
            detail="Address is a contract but does not expose getOwners() — not a Gnosis Safe",
        )

    return {"address": addr, "owners": owners}


@app.get("/api/polymarket-wallet/{address}/owner")
async def polymarket_wallet_owner(address: str):
    """Return ``owner()`` for a Polymarket DepositWallet (or any Ownable SCA).

    Used by the trade modal's funder-paste verification when the funder
    is a Polymarket DepositWallet rather than a Gnosis Safe. Polymarket's
    MetaMask/Rabby signups create an ERC-1271 DepositWallet whose
    authorized signer is exposed via ``owner()`` — orders signed by the
    EOA are verified inside the SCA via that owner check, so the trade
    flow uses ``signatureType=POLY_1271`` and the SCA as ``funder``.

    Returns ``{address, owner}`` on success, 4xx with a specific reason.
    """
    if not _EVM_ADDR_RE_COMPILED.match(address):
        raise HTTPException(status_code=400, detail="invalid address format")
    addr = address.lower()

    code = await _polygon_rpc_call("eth_getCode", [addr, "latest"])
    if not code or code == "0x":
        raise HTTPException(
            status_code=404,
            detail="No contract at that address on Polygon",
        )

    raw = await _polygon_rpc_call(
        "eth_call",
        [{"to": addr, "data": _OWNER_SELECTOR}, "latest"],
    )
    if not raw or raw == "0x" or len(raw) < 66:
        raise HTTPException(
            status_code=400,
            detail="Address is a contract but does not expose owner() — not a Polymarket DepositWallet",
        )
    owner_hex = raw[-40:].lower()
    if int(owner_hex, 16) == 0:
        raise HTTPException(
            status_code=400,
            detail="owner() returned the zero address — wallet not initialized",
        )
    return {"address": addr, "owner": "0x" + owner_hex}


# ── Attributed order submission (Phase B) ──────────────────

import os as _os  # noqa: E402
import json as _json  # noqa: E402
from fastapi import Header  # noqa: E402

from .polymarket_trading import (  # noqa: E402
    OrderCapExceeded,
    TradingConfigError,
    is_trading_configured,
    max_order_usdc,
    place_attributed_order,
)


class PlaceOrderRequest(BaseModel):
    token_id: str = Field(min_length=1, max_length=128)
    side: str = Field(pattern="^(BUY|SELL)$")
    price: float = Field(gt=0.0, lt=1.0)
    size: float = Field(gt=0.0, le=1_000_000.0)
    order_type: str = Field(default="GTC", pattern="^(GTC|GTD|FOK|FAK)$")
    market_id: str | None = Field(default=None, max_length=128)
    tick_size: str = Field(default="0.01", pattern="^0\\.(001|01|1)$")
    neg_risk: bool = False


def _require_admin(x_admin_token: str | None):
    expected = _os.getenv("POLYSCOPE_ADMIN_TOKEN")
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="Admin endpoint disabled (POLYSCOPE_ADMIN_TOKEN not set)",
        )
    if not x_admin_token or not hmac.compare_digest(x_admin_token, expected):
        raise HTTPException(status_code=401, detail="Invalid admin token")


@app.post("/api/orders/place")
async def place_order(
    body: PlaceOrderRequest,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
):
    """Submit a builder-attributed CLOB order to Polymarket.

    Admin-gated (requires ``X-Admin-Token`` matching ``POLYSCOPE_ADMIN_TOKEN``).
    Enforces ``POLYMARKET_MAX_ORDER_USDC`` cap. Attaches the configured
    Builder Code to every order.
    """
    _require_admin(x_admin_token)

    if not is_trading_configured():
        raise HTTPException(
            status_code=503,
            detail="Trading not configured (missing Polymarket env vars)",
        )

    builder_code = get_builder_code() or ""
    notional = round(body.price * body.size, 6)
    cap = max_order_usdc()
    if notional > cap:
        raise HTTPException(
            status_code=400,
            detail=f"Order notional ${notional:.4f} exceeds cap ${cap:.2f}",
        )

    db = await get_db()
    try:
        row_id = await record_builder_order_attempt(
            db,
            token_id=body.token_id,
            side=body.side,
            price=body.price,
            size=body.size,
            order_type=body.order_type,
            builder_code=builder_code,
            market_id=body.market_id,
        )
    finally:
        await db.close()

    try:
        resp = place_attributed_order(
            token_id=body.token_id,
            side=body.side,
            price=body.price,
            size=body.size,
            order_type=body.order_type,
            tick_size=body.tick_size,
            neg_risk=body.neg_risk,
        )
    except OrderCapExceeded as e:
        await _finalize_order(row_id, "rejected", error=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except TradingConfigError as e:
        await _finalize_order(row_id, "rejected", error=str(e))
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:  # CLOB/network errors
        logger.warning(
            "CLOB order placement failed for builder order %s",
            row_id,
            exc_info=True,
        )
        await _finalize_order(row_id, "failed", error=f"{type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail="CLOB order placement failed")

    clob_id = resp.get("orderID") or resp.get("order_id") or resp.get("id") or None
    await _finalize_order(
        row_id,
        "submitted",
        clob_order_id=clob_id,
        raw_response=_json.dumps(resp, default=str)[:8000],
    )
    return {
        "row_id": row_id,
        "clob_order_id": clob_id,
        "status": "submitted",
        "notional_usdc": notional,
        "builder_code": builder_code,
        "response": resp,
    }


async def _finalize_order(row_id: int, status: str, **kwargs):
    async def _op(db):
        await update_builder_order_result(db, row_id, status=status, **kwargs)
        return None

    await _retry_on_locked("finalize_order", _op)


@app.get("/api/orders/recent")
async def recent_orders(
    limit: int = Query(default=20, ge=1, le=100),
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
):
    """List recent attributed orders. Admin-gated."""
    _require_admin(x_admin_token)
    db = await get_db()
    try:
        rows = await list_builder_orders(db, limit=limit)
    finally:
        await db.close()
    return {"orders": rows, "count": len(rows)}


@app.get("/api/orders/config")
async def orders_config():
    """Public, non-sensitive trading config — useful for dashboards."""
    return {
        "trading_configured": is_trading_configured(),
        "max_order_usdc": max_order_usdc(),
        "builder_code": get_builder_code(),
    }


@app.get("/api/wss/live-prices")
async def wss_live_prices():
    """Latest WSS-cached prices for subscribed assets.

    Returns the live cache from the Polymarket market-channel stream
    (gated on ``POLYSCOPE_WSS_ENABLED``). Useful for ops monitoring
    and as a backing endpoint for future frontend live-odds widgets.
    """
    stream = wss_runtime.get_stream()
    if stream is None:
        return {
            "enabled": wss_runtime.is_enabled(),
            "connected": False,
            "subscribed": 0,
            "prices": {},
        }
    prices: dict[str, dict] = {}
    for aid in stream.asset_ids:
        snap = stream.snapshot(aid)
        if snap is None:
            continue
        prices[aid] = {**snap, "current_price": stream.current_price(aid)}
    return {
        "enabled": True,
        "connected": stream.is_connected,
        "subscribed": len(stream.asset_ids),
        "prices": prices,
    }


@app.get("/api/builder/trades/public")
async def builder_trades_public(limit: int = Query(default=50, ge=1, le=200)):
    """Public: trades attributed to our Builder Code on-chain.

    Populated by the ``sync_attributed_trades_job`` scheduler, which polls
    Polymarket's ``get_builder_trades`` endpoint every few minutes.
    """
    db = await get_db()
    try:
        trades = await list_builder_trades(db, limit=limit)
        stats = await builder_trades_stats(db)
    finally:
        await db.close()

    redacted: list[dict] = []
    for t in trades:
        owner = t.get("owner") or ""
        redacted.append(
            {
                "trade_id": t.get("trade_id"),
                "market_id": t.get("market_id"),
                "side": t.get("side"),
                "size": t.get("size"),
                "price": t.get("price"),
                "notional_usdc": t.get("notional_usdc"),
                "status": t.get("status"),
                "outcome": t.get("outcome"),
                # Short-form owner for display; full addr is on-chain anyway
                "owner_short": (owner[:6] + "…" + owner[-4:]) if len(owner) > 10 else owner,
                "transaction_hash": t.get("transaction_hash"),
                "match_time": t.get("match_time"),
            }
        )
    return {"trades": redacted, "stats": stats}


@app.get("/api/orders/public")
async def orders_public(limit: int = Query(default=20, ge=1, le=100)):
    """Public read-only view of attributed orders.

    Orders include the builder code on-chain, so their existence is
    already public. This endpoint omits the raw CLOB response (may
    contain internal wallet addresses) and the raw error messages.
    """
    db = await get_db()
    try:
        rows = await list_builder_orders(db, limit=limit)
    finally:
        await db.close()

    stats = {
        "total": len(rows),
        "by_status": {},
        "total_notional_usdc": 0.0,
    }
    redacted: list[dict] = []
    for r in rows:
        status = r.get("status") or "unknown"
        stats["by_status"][status] = stats["by_status"].get(status, 0) + 1
        if status not in {"rejected", "failed"}:
            stats["total_notional_usdc"] += float(r.get("notional_usdc") or 0)
        redacted.append(
            {
                "id": r["id"],
                "market_id": r["market_id"],
                "token_id": r["token_id"],
                "side": r["side"],
                "price": r["price"],
                "size": r["size"],
                "notional_usdc": r["notional_usdc"],
                "order_type": r["order_type"],
                "status": r["status"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
        )
    stats["total_notional_usdc"] = round(stats["total_notional_usdc"], 4)
    return {"orders": redacted, "stats": stats}


# ── Instrumentation ────────────────────────────────────────


_EVENT_PATH_RE = r"^/[^\s<>\"'`\\]{0,255}$"
_EVENT_REFERRER_RE = r"^(https?://[^\s<>\"'`\\]{1,500}|/[^\s<>\"'`\\]{0,511})$"


class EventRequest(BaseModel):
    event_type: str = Field(min_length=1, max_length=64)
    client_id: str | None = Field(default=None, max_length=64)
    properties: dict | None = None
    path: str | None = Field(default=None, max_length=256, pattern=_EVENT_PATH_RE)
    referrer: str | None = Field(
        default=None,
        max_length=512,
        pattern=_EVENT_REFERRER_RE,
    )


@app.post("/api/events")
async def events_ingest(body: EventRequest):
    db = await get_low_priority_write_db(500)
    try:
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
        except _sqlite3.OperationalError as e:
            if "locked" not in str(e).lower():
                raise
            await db.rollback()
            logger.info("events_ingest dropped event while database was locked")
            return {"ok": False, "dropped": True}
    finally:
        await db.close()
    return {"ok": True}


@app.get("/api/admin/metrics")
async def admin_metrics(
    days: int = Query(7, ge=1, le=90),
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
):
    """Admin metrics dashboard. Requires POLYSCOPE_ADMIN_TOKEN env match."""
    _require_admin(x_admin_token)
    db = await get_db()
    try:
        return await get_metrics_summary(db, days=days)
    finally:
        await db.close()
