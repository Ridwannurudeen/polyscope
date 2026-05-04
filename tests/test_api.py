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
