"""Tests for the WSS live-divergence recompute job.

Verifies the no-op gates (WSS disabled, no stream, no markets cached,
no positions cached, no live price) and the happy path: subscribed
asset with cached positions + live price produces a signal in the
``live_divergences`` cache.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from api import wss_runtime
from api.cache import cache
from api.scheduler import compute_live_divergences_job
from polyscope.models import Market, Position, Trader


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    """Clean cache + runtime + scheduler globals between tests."""
    cache.clear()
    wss_runtime._reset_for_tests()
    # Reset module-level globals on api.scheduler so previous tests
    # don't leak _traders / _category_weights into the assertion path.
    from api import scheduler as sched

    monkeypatch.setattr(sched, "_traders", {}, raising=False)
    monkeypatch.setattr(sched, "_category_weights", {}, raising=False)
    yield
    cache.clear()
    wss_runtime._reset_for_tests()


def _market(condition_id: str, token_yes: str, *, price_yes: float, vol: float = 250_000) -> Market:
    return Market(
        condition_id=condition_id,
        question=f"Will {condition_id}?",
        slug=condition_id,
        category="politics",
        token_id_yes=token_yes,
        token_id_no=token_yes + "_no",
        price_yes=price_yes,
        price_no=1 - price_yes,
        volume_24h=vol,
        open_interest=vol,
        liquidity=vol,
    )


def _trader(addr: str, rank: int) -> Trader:
    return Trader(address=addr, rank=rank, profit=10000, volume=100000, markets_traded=20)


def _positions_long_yes(n: int, market_id: str) -> list[Position]:
    """n traders with strong long-YES positions, so SM consensus ≈ 1.0."""
    return [
        Position(
            trader_address=f"0xaddr{i}",
            market_id=market_id,
            side="YES",
            size=1000.0,
            avg_price=0.7,
        )
        for i in range(n)
    ]


# ── No-op gates ──────────────────────────────────────────


async def test_no_op_when_wss_disabled(monkeypatch):
    monkeypatch.delenv("POLYSCOPE_WSS_ENABLED", raising=False)
    await compute_live_divergences_job()
    assert cache.get("live_divergences") is None


async def test_no_op_when_stream_missing(monkeypatch):
    monkeypatch.setenv("POLYSCOPE_WSS_ENABLED", "true")
    # No stream started — get_stream() returns None
    await compute_live_divergences_job()
    assert cache.get("live_divergences") is None


async def test_no_op_when_markets_cache_empty(monkeypatch):
    monkeypatch.setenv("POLYSCOPE_WSS_ENABLED", "true")
    stream = MagicMock()
    stream.asset_ids = {"tok-a"}
    monkeypatch.setattr(wss_runtime, "_stream", stream)

    await compute_live_divergences_job()
    assert cache.get("live_divergences") is None


async def test_no_op_when_positions_cache_empty(monkeypatch):
    monkeypatch.setenv("POLYSCOPE_WSS_ENABLED", "true")
    stream = MagicMock()
    stream.asset_ids = {"tok-a"}
    monkeypatch.setattr(wss_runtime, "_stream", stream)

    cache.set("markets", [_market("c1", "tok-a", price_yes=0.5)], ttl_seconds=600)
    # No positions_by_market in cache
    await compute_live_divergences_job()
    assert cache.get("live_divergences") is None


async def test_no_op_when_no_live_price(monkeypatch):
    monkeypatch.setenv("POLYSCOPE_WSS_ENABLED", "true")
    stream = MagicMock()
    stream.asset_ids = {"tok-a"}
    stream.current_price = MagicMock(return_value=None)
    monkeypatch.setattr(wss_runtime, "_stream", stream)

    cache.set("markets", [_market("c1", "tok-a", price_yes=0.5)], ttl_seconds=600)
    cache.set("positions_by_market", {"c1": _positions_long_yes(2, "c1")}, ttl_seconds=600)

    from api import scheduler as sched

    monkeypatch.setattr(
        sched,
        "_traders",
        {f"0xaddr{i}": _trader(f"0xaddr{i}", rank=i + 1) for i in range(2)},
        raising=False,
    )

    await compute_live_divergences_job()
    # Job populated the cache with an (empty) signals dict — distinct from None
    assert cache.get("live_divergences") == {}


# ── Happy path ───────────────────────────────────────────


async def test_live_signal_produced_on_fresh_price(monkeypatch):
    """Market price has diverged from cached price; live recompute finds the signal."""
    monkeypatch.setenv("POLYSCOPE_WSS_ENABLED", "true")

    stream = MagicMock()
    stream.asset_ids = {"tok-a"}
    # Live price 0.30 vs SM consensus ~0.70 → strong divergence
    stream.current_price = MagicMock(return_value=0.30)
    monkeypatch.setattr(wss_runtime, "_stream", stream)

    # Cached market with stale price 0.50; live price 0.30
    cache.set("markets", [_market("c1", "tok-a", price_yes=0.50)], ttl_seconds=600)
    cache.set("positions_by_market", {"c1": _positions_long_yes(5, "c1")}, ttl_seconds=600)

    from api import scheduler as sched

    monkeypatch.setattr(
        sched,
        "_traders",
        {f"0xaddr{i}": _trader(f"0xaddr{i}", rank=i + 1) for i in range(5)},
        raising=False,
    )

    await compute_live_divergences_job()

    live = cache.get("live_divergences")
    assert live is not None
    assert "c1" in live
    sig = live["c1"]
    # Live price 0.30 was used (not the cached 0.50)
    assert sig.market_price == 0.30


async def test_live_signal_subscribed_asset_without_market_skipped(monkeypatch):
    """Asset_id present in stream but not in markets cache should not raise."""
    monkeypatch.setenv("POLYSCOPE_WSS_ENABLED", "true")

    stream = MagicMock()
    stream.asset_ids = {"tok-a", "tok-orphan"}
    stream.current_price = MagicMock(return_value=0.30)
    monkeypatch.setattr(wss_runtime, "_stream", stream)

    cache.set("markets", [_market("c1", "tok-a", price_yes=0.50)], ttl_seconds=600)
    cache.set("positions_by_market", {"c1": _positions_long_yes(5, "c1")}, ttl_seconds=600)

    from api import scheduler as sched

    monkeypatch.setattr(
        sched,
        "_traders",
        {f"0xaddr{i}": _trader(f"0xaddr{i}", rank=i + 1) for i in range(5)},
        raising=False,
    )

    await compute_live_divergences_job()
    live = cache.get("live_divergences")
    # tok-orphan has no market — silently skipped, c1 still produces a signal
    assert "c1" in live
    assert "tok-orphan" not in live
