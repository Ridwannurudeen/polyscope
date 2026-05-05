"""Tests for FastAPI endpoints."""

import time

import pytest
from httpx import ASGITransport, AsyncClient

# Patch scheduler to not run during tests
import api.scheduler as sched

sched._client = None


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    from api.database import init_db
    from api.main import app

    # Init DB so endpoints that query it don't fail
    await init_db()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.anyio
async def test_root(client):
    resp = await client.get("/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "PolyScope"
    assert "disclaimer" in data


@pytest.mark.anyio
async def test_lifespan_can_disable_scheduler(monkeypatch):
    import api.main as main

    calls = []

    async def fake_init_db():
        calls.append("init_db")

    async def fake_close_client():
        calls.append("close_client")

    class FailScheduler:
        running = False

        def add_job(self, *args, **kwargs):
            raise AssertionError("scheduler should be disabled")

        def start(self):
            raise AssertionError("scheduler should be disabled")

        def shutdown(self, wait=False):
            raise AssertionError("scheduler should not be running")

    monkeypatch.setenv("POLYSCOPE_DISABLE_SCHEDULER", "1")
    monkeypatch.setattr(main, "init_db", fake_init_db)
    monkeypatch.setattr(main, "close_client", fake_close_client)
    monkeypatch.setattr(main, "scheduler", FailScheduler())

    async with main.lifespan(main.app):
        calls.append("inside")

    assert calls == ["init_db", "inside", "close_client"]


@pytest.mark.anyio
async def test_divergences_empty(client):
    resp = await client.get("/api/divergences")
    assert resp.status_code == 200
    data = resp.json()
    assert "signals" in data
    assert "disclaimer" in data


@pytest.mark.anyio
async def test_movers_valid_timeframe(client):
    resp = await client.get("/api/movers?timeframe=24h")
    assert resp.status_code == 200
    data = resp.json()
    assert data["timeframe"] == "24h"


@pytest.mark.anyio
async def test_movers_invalid_timeframe(client):
    resp = await client.get("/api/movers?timeframe=3h")
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_markets_list(client):
    resp = await client.get("/api/markets")
    assert resp.status_code == 200
    data = resp.json()
    assert "markets" in data
    assert "total" in data


@pytest.mark.anyio
async def test_trade_market_detail_validates_gamma_tokens(client, monkeypatch):
    from api.cache import cache
    import api.main as main
    from polyscope.models import Market

    market = Market(
        condition_id="0xabc123",
        question="Test market?",
        slug="test-market",
        token_id_yes="yes-token",
        token_id_no="no-token",
        price_yes=0.62,
        price_no=0.38,
    )
    cache.set("markets", [market], ttl_seconds=60)

    async def fake_fetch_gamma_market(condition_id: str):
        assert condition_id == "0xabc123"
        return {
            "conditionId": "0xabc123",
            "clobTokenIds": '["yes-token","no-token"]',
            "orderPriceMinTickSize": 0.001,
            "negRisk": False,
            "acceptingOrders": True,
            "enableOrderBook": True,
            "closed": False,
        }

    monkeypatch.setattr(main, "_fetch_gamma_market", fake_fetch_gamma_market)
    try:
        resp = await client.get("/api/market/0xabc123/trade")
    finally:
        cache.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["tokens"] == {"YES": "yes-token", "NO": "no-token"}
    assert data["tick_size"] == "0.001"
    assert data["market"]["price_yes"] == 0.62


@pytest.mark.anyio
async def test_public_signing_oracle_is_removed(client):
    resp = await client.post(
        "/api/sign",
        json={"method": "POST", "path": "/order", "body": "{}"},
    )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_builder_status_uses_public_builder_code(client, monkeypatch):
    monkeypatch.delenv("POLYMARKET_BUILDER_API_KEY", raising=False)
    monkeypatch.delenv("POLYMARKET_BUILDER_API_SECRET", raising=False)
    monkeypatch.delenv("POLYMARKET_BUILDER_PASSPHRASE", raising=False)
    monkeypatch.setenv("POLYMARKET_BUILDER_CODE", "0x" + "1" * 64)

    resp = await client.get("/api/builder/status")
    assert resp.status_code == 200
    assert resp.json() == {"configured": True}


@pytest.mark.anyio
async def test_admin_metrics_requires_header_not_query_token(client, monkeypatch):
    monkeypatch.setenv("POLYSCOPE_ADMIN_TOKEN", "secret-token")

    query_resp = await client.get("/api/admin/metrics?token=secret-token")
    assert query_resp.status_code == 401

    header_resp = await client.get(
        "/api/admin/metrics?days=1",
        headers={"X-Admin-Token": "secret-token"},
    )
    assert header_resp.status_code == 200


@pytest.mark.anyio
async def test_wallet_link_requires_valid_wallet_signature(client):
    from eth_account import Account
    from eth_account.messages import encode_defunct

    account = Account.create()
    client_id = "test-client-123"
    domain = "testserver"
    issued_at = int(time.time())
    wallet = account.address.lower()
    message = "\n".join(
        [
            "PolyScope wallet link",
            f"Domain: {domain}",
            f"Client ID: {client_id}",
            f"Wallet: {wallet}",
            f"Issued At: {issued_at}",
        ]
    )
    signature = Account.sign_message(
        encode_defunct(text=message),
        account.key,
    ).signature.hex()

    unsigned_resp = await client.post(
        "/api/wallet/link",
        json={"client_id": client_id, "wallet_address": wallet},
    )
    assert unsigned_resp.status_code == 422
    unlinked_resp = await client.get(
        f"/api/watchlist?client_id={client_id}&wallet_address={wallet}",
    )
    assert unlinked_resp.status_code == 401

    signed_resp = await client.post(
        "/api/wallet/link",
        json={
            "client_id": client_id,
            "wallet_address": wallet,
            "domain": domain,
            "issued_at": issued_at,
            "signature": signature,
        },
    )
    assert signed_resp.status_code == 200
    assert signed_resp.json()["wallet_address"] == wallet
    linked_resp = await client.get(
        f"/api/watchlist?client_id={client_id}&wallet_address={wallet}",
    )
    assert linked_resp.status_code == 200


@pytest.mark.anyio
async def test_smart_money_feed(client):
    resp = await client.get("/api/smart-money/feed")
    assert resp.status_code == 200
    data = resp.json()
    assert "disclaimer" in data


@pytest.mark.anyio
async def test_calibration(client):
    resp = await client.get("/api/calibration")
    assert resp.status_code == 200
    data = resp.json()
    assert "overall_brier" in data
    assert "calibration" in data


@pytest.mark.anyio
async def test_signals_accuracy(client):
    resp = await client.get("/api/signals/accuracy")
    assert resp.status_code == 200
    data = resp.json()
    assert "overall" in data
    assert "by_tier" in data
    assert "rolling_30d" in data
    assert "total_signals" in data["overall"]
    assert "win_rate" in data["overall"]
    for tier in ("high", "medium", "low"):
        assert tier in data["by_tier"]


def test_cache_get_stale_returns_expired_entry():
    from api.cache import MemoryCache

    local_cache = MemoryCache()
    payload = {"signals": {"total": 12}}
    local_cache.set("stats", payload, ttl_seconds=-1)

    assert local_cache.get("stats") is None
    assert local_cache.get_stale("stats") == payload


@pytest.mark.anyio
async def test_divergences_cache_hit_skips_predictive_enrichment(client, monkeypatch):
    from api.cache import cache
    import api.main as main
    from polyscope.models import DivergenceSignal

    signal = DivergenceSignal(
        market_id="m-cache",
        question="Cached market?",
        market_price=0.41,
        sm_consensus=0.72,
        divergence_pct=0.31,
        score=81.0,
        sm_trader_count=4,
        sm_direction="YES",
        category="crypto",
    )

    async def fail_expired_count(*_args, **_kwargs):
        raise AssertionError("expired count DB query should not run on cache hit")

    cache.clear()
    cache.set("divergences", [signal], ttl_seconds=60)
    monkeypatch.setattr(main, "get_expired_signal_count", fail_expired_count)

    try:
        resp = await client.get("/api/divergences")
    finally:
        cache.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "cache"
    assert data["stale"] is False
    assert data["expired_count"] is None
    assert data["signals"][0]["market_id"] == "m-cache"
    assert data["signals"][0]["predictive_contributor"] is None


@pytest.mark.anyio
async def test_methodology_stats_returns_marked_stale_cache(client, monkeypatch):
    from api.cache import cache
    import api.main as main

    stale_payload = {
        "signals": {
            "total": 123,
            "resolved": 45,
            "correct": 30,
            "overall_win_rate_pct": 66.7,
            "first_captured": "2026-05-01T00:00:00Z",
            "latest_captured": "2026-05-02T00:00:00Z",
        },
        "skew_breakdown": {},
        "resolved_markets": 40,
        "per_trader": {
            "records_captured": 500,
            "traders_scored": 25,
            "avg_accuracy_pct": 52.5,
        },
    }
    refreshes = []

    def fake_refresh(cache_key, loader, ttl_seconds):
        refreshes.append((cache_key, ttl_seconds))

    cache.clear()
    cache.set("methodology_stats", stale_payload, ttl_seconds=-1)
    monkeypatch.setattr(main, "_ensure_public_cache_refresh", fake_refresh)

    try:
        resp = await client.get("/api/methodology/stats")
    finally:
        cache.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "stale_cache"
    assert data["stale"] is True
    assert data["signals"]["total"] == 123
    assert refreshes == [("methodology_stats", 600)]


@pytest.mark.anyio
async def test_signals_accuracy_cold_partial_keeps_shape(client, monkeypatch):
    from api.cache import cache
    import api.main as main

    async def fake_accuracy(_db):
        return {
            "overall": {"total_signals": 7, "correct": 4, "win_rate": 0.5714, "avg_score": 62.1},
            "by_tier": {
                "high": {"total": 2, "correct": 1, "win_rate": 0.5},
                "medium": {"total": 3, "correct": 2, "win_rate": 0.6667},
                "low": {"total": 2, "correct": 1, "win_rate": 0.5},
            },
            "by_skew": {
                "very_lopsided": {"total": 1, "correct": 1, "win_rate": 1.0},
                "lopsided": {"total": 1, "correct": 0, "win_rate": 0.0},
                "moderate": {"total": 2, "correct": 1, "win_rate": 0.5},
                "tight": {"total": 3, "correct": 2, "win_rate": 0.6667},
            },
            "rolling_30d": {"total": 3, "correct": 2, "win_rate": 0.6667},
        }

    async def fail_simulation(_db):
        raise AssertionError("partial cold response should skip simulation")

    def fake_refresh(_cache_key, _loader, _ttl_seconds):
        return None

    cache.clear()
    monkeypatch.setattr(main, "_ensure_public_cache_refresh", fake_refresh)
    monkeypatch.setattr(main, "get_signal_accuracy", fake_accuracy)
    monkeypatch.setattr(main, "get_signal_pnl_simulation", fail_simulation)

    try:
        resp = await client.get("/api/signals/accuracy")
    finally:
        cache.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "db_partial"
    assert data["stale"] is False
    assert data["partial"] is True
    assert "simulation" not in data
    assert data["overall"]["total_signals"] == 7
    for tier in ("high", "medium", "low"):
        assert tier in data["by_tier"]
