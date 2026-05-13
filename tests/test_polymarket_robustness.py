"""Robustness tests — _get retry/backoff, scheduler pagination cap, CORS env.

Covers behaviors introduced when PolyScope started hitting Cloudflare-throttled
Polymarket endpoints and silently dropping markets past the first 500.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import httpx


# ── _backoff_for ──────────────────────────────────────────


def test_backoff_for_exponential():
    from polyscope.polymarket import _BACKOFF_BASE, _backoff_for

    assert _backoff_for(0, None) == _BACKOFF_BASE
    assert _backoff_for(1, None) == _BACKOFF_BASE * 2
    assert _backoff_for(2, None) == _BACKOFF_BASE * 4


def test_backoff_for_honors_retry_after():
    from polyscope.polymarket import _RETRY_AFTER_CAP, _backoff_for

    assert _backoff_for(0, "7") == 7.0
    # Header beyond the cap is clamped — protects against a rogue value
    # pinning a worker for minutes.
    assert _backoff_for(0, "9999") == _RETRY_AFTER_CAP


def test_backoff_for_invalid_retry_after_falls_back():
    from polyscope.polymarket import _BACKOFF_BASE, _backoff_for

    # HTTP-date variant of Retry-After is not parsed — falls back to
    # exponential backoff rather than raising.
    assert _backoff_for(0, "Wed, 21 Oct 2025 07:28:00 GMT") == _BACKOFF_BASE


# ── _get retry ────────────────────────────────────────────


def _httpx_response(status: int, headers: dict | None = None, json_data: Any = None):
    """Build a real httpx.Response so raise_for_status + json() work."""
    return httpx.Response(
        status_code=status,
        headers=headers or {},
        json=json_data if json_data is not None else {},
        request=httpx.Request("GET", "https://example.test/x"),
    )


async def test_get_retries_on_429_with_retry_after(monkeypatch):
    from polyscope import polymarket as pm

    sleeps: list[float] = []

    async def fake_sleep(s):
        sleeps.append(s)

    monkeypatch.setattr(pm.asyncio, "sleep", fake_sleep)

    client = pm.PolymarketClient(http_client=MagicMock())
    client._client.get = AsyncMock(
        side_effect=[
            _httpx_response(429, headers={"Retry-After": "2"}),
            _httpx_response(200, json_data={"ok": True}),
        ]
    )
    result = await client._get("https://example.test/x")
    assert result == {"ok": True}
    assert sleeps == [2.0]


async def test_get_retries_on_5xx_exponential(monkeypatch):
    from polyscope import polymarket as pm

    sleeps: list[float] = []

    async def fake_sleep(s):
        sleeps.append(s)

    monkeypatch.setattr(pm.asyncio, "sleep", fake_sleep)

    client = pm.PolymarketClient(http_client=MagicMock())
    client._client.get = AsyncMock(
        side_effect=[
            _httpx_response(500),
            _httpx_response(503),
            _httpx_response(200, json_data={"ok": True}),
        ]
    )
    result = await client._get("https://example.test/x")
    assert result == {"ok": True}
    assert sleeps == [0.5, 1.0]


async def test_get_terminal_on_4xx_non_429(monkeypatch):
    from polyscope import polymarket as pm

    sleeps: list[float] = []

    async def fake_sleep(s):
        sleeps.append(s)

    monkeypatch.setattr(pm.asyncio, "sleep", fake_sleep)

    client = pm.PolymarketClient(http_client=MagicMock())
    client._client.get = AsyncMock(return_value=_httpx_response(404))
    result = await client._get("https://example.test/x")
    assert result is None
    # 404 is terminal — no retries, no sleeps.
    assert sleeps == []
    assert client._client.get.call_count == 1


async def test_get_retries_on_transport_error(monkeypatch):
    from polyscope import polymarket as pm

    async def fake_sleep(s):
        pass

    monkeypatch.setattr(pm.asyncio, "sleep", fake_sleep)

    client = pm.PolymarketClient(http_client=MagicMock())
    client._client.get = AsyncMock(
        side_effect=[
            httpx.ConnectError("conn refused"),
            _httpx_response(200, json_data={"ok": True}),
        ]
    )
    result = await client._get("https://example.test/x")
    assert result == {"ok": True}


async def test_get_gives_up_after_max_retries(monkeypatch):
    from polyscope import polymarket as pm

    async def fake_sleep(s):
        pass

    monkeypatch.setattr(pm.asyncio, "sleep", fake_sleep)

    client = pm.PolymarketClient(http_client=MagicMock())
    client._client.get = AsyncMock(return_value=_httpx_response(500))
    result = await client._get("https://example.test/x")
    assert result is None
    # Initial attempt + _MAX_RETRIES retries
    assert client._client.get.call_count == pm._MAX_RETRIES + 1


# ── Scheduler pagination ──────────────────────────────────


async def test_fetch_markets_paginates_past_500(monkeypatch):
    """fetch_markets_job paginates until a short page, not at a hardcoded 500.

    Production path is via the /events traversal as of PR I; legacy
    /markets is the fallback when events returns empty.
    """
    from api import scheduler

    # 7 full pages of 100 + one short page of 50 = 750 markets
    pages = [[MagicMock(condition_id=f"m{p}-{i}") for i in range(100)] for p in range(7)]
    pages.append([MagicMock(condition_id=f"m7-{i}") for i in range(50)])

    fake = MagicMock()
    fake.get_active_markets_via_events = AsyncMock(side_effect=pages)
    fake.get_markets = AsyncMock(return_value=[])  # fallback not invoked
    monkeypatch.setattr(scheduler, "_client", fake)

    await scheduler.fetch_markets_job()

    assert fake.get_active_markets_via_events.call_count == 8
    assert fake.get_markets.call_count == 0
    cached = scheduler.cache.get("markets")
    assert cached is not None
    assert len(cached) == 750


async def test_fetch_markets_warns_at_page_cap(monkeypatch, caplog):
    """If Polymarket keeps returning full pages, we cap at _MAX_PAGES and log a warning."""
    from api import scheduler

    # Always-full page — break condition (`len(batch) < _PAGE_SIZE`) never fires
    full_page = [MagicMock(condition_id=f"m-{i}") for i in range(scheduler._PAGE_SIZE)]
    fake = MagicMock()
    fake.get_active_markets_via_events = AsyncMock(return_value=full_page)
    fake.get_markets = AsyncMock(return_value=[])
    monkeypatch.setattr(scheduler, "_client", fake)

    with caplog.at_level("WARNING", logger="api.scheduler"):
        await scheduler.fetch_markets_job()

    assert fake.get_active_markets_via_events.call_count == scheduler._MAX_PAGES
    assert any("page cap" in r.message for r in caplog.records)


async def test_fetch_markets_falls_back_to_markets_when_events_empty(monkeypatch):
    """If /events traversal returns empty, the fallback /markets path runs."""
    from api import scheduler

    fallback_pages = [
        [MagicMock(condition_id=f"f-{i}") for i in range(100)],
        [MagicMock(condition_id=f"f-{i}") for i in range(40)],
    ]

    fake = MagicMock()
    fake.get_active_markets_via_events = AsyncMock(return_value=[])  # empty
    fake.get_markets = AsyncMock(side_effect=fallback_pages)
    monkeypatch.setattr(scheduler, "_client", fake)

    await scheduler.fetch_markets_job()

    cached = scheduler.cache.get("markets")
    assert cached is not None
    assert len(cached) == 140
    assert fake.get_markets.call_count == 2


# ── CORS env ──────────────────────────────────────────────


def test_cors_origins_default(monkeypatch):
    monkeypatch.delenv("POLYSCOPE_CORS_ORIGINS", raising=False)
    from api.main import _cors_origins

    assert _cors_origins() == ["https://polyscope.gudman.xyz"]


def test_cors_origins_env_override(monkeypatch):
    monkeypatch.setenv(
        "POLYSCOPE_CORS_ORIGINS",
        "https://prod.example,http://localhost:3020",
    )
    from api.main import _cors_origins

    assert _cors_origins() == [
        "https://prod.example",
        "http://localhost:3020",
    ]


def test_cors_origins_strips_whitespace_and_empties(monkeypatch):
    monkeypatch.setenv(
        "POLYSCOPE_CORS_ORIGINS",
        " https://a.example , https://b.example , , ",
    )
    from api.main import _cors_origins

    assert _cors_origins() == ["https://a.example", "https://b.example"]
