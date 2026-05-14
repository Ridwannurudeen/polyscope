"""Tests for FastAPI endpoints."""

import os
import time

import pytest
from httpx import ASGITransport, AsyncClient

# Patch scheduler to not run during tests
import api.scheduler as sched

sched._client = None

# Tests sign wallet-link payloads with `domain: "testserver"` (the default
# host header from httpx's ASGI transport). Production rejects that domain
# unless POLYSCOPE_ALLOW_DEV_DOMAINS is set, so opt in for the test session.
os.environ.setdefault("POLYSCOPE_ALLOW_DEV_DOMAINS", "1")


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


def _signed_wallet_link_payload(client_id: str):
    from eth_account import Account
    from eth_account.messages import encode_defunct

    account = Account.create()
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
    if not signature.startswith("0x"):
        signature = f"0x{signature}"

    return wallet, {
        "client_id": client_id,
        "wallet_address": wallet,
        "domain": domain,
        "issued_at": issued_at,
        "signature": signature,
    }


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
async def test_markets_returns_stale_cache(client):
    from api.cache import cache
    from polyscope.models import Market

    market = Market(
        condition_id="stale-market",
        question="Stale market?",
        slug="stale-market",
        category="crypto",
        price_yes=0.52,
        price_no=0.48,
    )
    cache.clear()
    cache.set("markets", [market], ttl_seconds=-1)

    try:
        resp = await client.get("/api/markets?limit=5")
    finally:
        cache.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "stale_cache"
    assert data["stale"] is True
    assert data["total"] == 1
    assert data["markets"][0]["condition_id"] == "stale-market"


@pytest.mark.anyio
async def test_movers_returns_stale_cache(client):
    from api.cache import cache
    from polyscope.models import MarketMover

    mover = MarketMover(
        market_id="stale-mover",
        question="Stale mover?",
        category="crypto",
        price_now=0.61,
        price_before=0.49,
        change_pct=0.12,
        timeframe="24h",
        volume_24h=1000,
    )
    cache.clear()
    cache.set("movers", {"24h": [mover]}, ttl_seconds=-1)

    try:
        resp = await client.get("/api/movers?timeframe=24h")
    finally:
        cache.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "stale_cache"
    assert data["stale"] is True
    assert data["count"] == 1
    assert data["movers"][0]["market_id"] == "stale-mover"


@pytest.mark.anyio
async def test_scan_latest_exposes_component_sources(client):
    from api.cache import cache
    from polyscope.models import DivergenceSignal, Market, MarketMover

    signal = DivergenceSignal(
        market_id="stale-signal",
        question="Stale signal?",
        market_price=0.42,
        sm_consensus=0.68,
        divergence_pct=0.26,
        score=72.0,
        sm_trader_count=3,
        sm_direction="YES",
    )
    market = Market(
        condition_id="stale-signal",
        question="Stale signal?",
        slug="stale-signal",
    )
    mover = MarketMover(
        market_id="stale-signal",
        question="Stale signal?",
        category="",
        price_now=0.58,
        price_before=0.42,
        change_pct=0.16,
        timeframe="24h",
    )
    cache.clear()
    cache.set("divergences", [signal], ttl_seconds=-1)
    cache.set("markets", [market], ttl_seconds=-1)
    cache.set("movers", {"24h": [mover]}, ttl_seconds=-1)

    try:
        resp = await client.get("/api/scan/latest")
    finally:
        cache.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["stale"] is True
    assert data["sources"] == {
        "divergences": "stale_cache",
        "movers": "stale_cache",
        "markets": "stale_cache",
    }
    assert data["total_markets"] == 1
    assert data["total_divergences"] == 1


@pytest.mark.anyio
async def test_events_accepts_db_warmed_divergence_dicts(client):
    from api.cache import cache
    from polyscope.models import Market

    markets = [
        Market(
            condition_id="m-event-1",
            question="Will the event cluster resolve before June yes?",
            slug="event-1",
            category="crypto",
            price_yes=0.52,
            price_no=0.48,
            volume_24h=1000,
        ),
        Market(
            condition_id="m-event-2",
            question="Will the event cluster resolve before June no?",
            slug="event-2",
            category="crypto",
            price_yes=0.42,
            price_no=0.58,
            volume_24h=2000,
        ),
    ]
    cache.clear()
    cache.set("markets", markets, ttl_seconds=60)
    cache.set(
        "divergences",
        [{"market_id": "m-event-1", "divergence_pct": 0.31}],
        ttl_seconds=60,
    )

    try:
        resp = await client.get("/api/events?limit=5")
    finally:
        cache.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["events"][0]["divergence_signals"] == 1
    assert data["events"][0]["avg_divergence"] == 0.31


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
async def test_trade_market_detail_falls_back_to_gamma_on_cache_miss(client, monkeypatch):
    """A market backing a live signal can rotate out of the top-N "markets"
    cache; the trade endpoint must still serve it from Gamma, not 404."""
    from api.cache import cache
    import api.main as main

    cache.set("markets", [], ttl_seconds=60)  # market deliberately absent

    async def fake_fetch_gamma_market(condition_id: str):
        assert condition_id == "0xdef456"
        return {
            "conditionId": "0xdef456",
            "question": "Uncached market?",
            "slug": "uncached-market",
            "clobTokenIds": '["yes-tok","no-tok"]',
            "outcomePrices": '["0.73","0.27"]',
            "orderPriceMinTickSize": 0.01,
            "negRisk": True,
            "acceptingOrders": True,
            "enableOrderBook": True,
            "closed": False,
        }

    monkeypatch.setattr(main, "_fetch_gamma_market", fake_fetch_gamma_market)
    try:
        resp = await client.get("/api/market/0xdef456/trade")
    finally:
        cache.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["tokens"] == {"YES": "yes-tok", "NO": "no-tok"}
    assert data["tick_size"] == "0.01"
    assert data["neg_risk"] is True
    assert data["market"]["price_yes"] == 0.73
    assert data["market"]["condition_id"] == "0xdef456"


@pytest.mark.anyio
async def test_trade_market_detail_closed_market_returns_409(client, monkeypatch):
    """Gamma's condition_ids filter hides closed markets unless closed=true is
    passed. _fetch_gamma_market must fall back to the closed set, so a closed
    market surfaces as a clear 409 instead of a misleading 404."""
    import httpx

    import api.main as main
    from api.cache import cache

    cache.set("markets", [], ttl_seconds=60)
    calls: list[dict] = []

    class FakeAsyncClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, params=None, headers=None):
            params = params or {}
            calls.append(params)
            body = (
                [{"conditionId": "0xclosed1", "closed": True}]
                if params.get("closed") == "true"
                else []
            )
            return httpx.Response(200, json=body, request=httpx.Request("GET", url))

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
    try:
        resp = await client.get("/api/market/0xclosed1/trade")
    finally:
        cache.clear()

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Market is closed"
    # open-set query first, then the closed-set fallback
    assert len(calls) == 2
    assert "closed" not in calls[0]
    assert calls[1]["closed"] == "true"


@pytest.mark.anyio
async def test_trade_market_detail_truly_absent_returns_404(client, monkeypatch):
    """When neither the open nor the closed Gamma query has the market, the
    trade endpoint returns a 404."""
    import httpx

    import api.main as main
    from api.cache import cache

    cache.set("markets", [], ttl_seconds=60)

    class FakeAsyncClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, params=None, headers=None):
            return httpx.Response(200, json=[], request=httpx.Request("GET", url))

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
    try:
        resp = await client.get("/api/market/0xabsent9/trade")
    finally:
        cache.clear()

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Market not found on Polymarket"


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


# ── /api/polymarket/builder/sign ────────────────────────────


def _set_builder_api_env(monkeypatch):
    from api.polymarket_signing import reset_builder_signer_cache

    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", "019e1672-test")
    # base64-shaped secret (URL-safe, length 44, alphabet [A-Za-z0-9_-])
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", "a" * 44)
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", "pass-" + "y" * 20)
    reset_builder_signer_cache()


@pytest.mark.anyio
async def test_builder_sign_returns_503_when_unconfigured(client, monkeypatch):
    from api.polymarket_signing import reset_builder_signer_cache

    monkeypatch.delenv("POLYMARKET_BUILDER_API_KEY", raising=False)
    monkeypatch.delenv("POLYMARKET_BUILDER_API_SECRET", raising=False)
    monkeypatch.delenv("POLYMARKET_BUILDER_PASSPHRASE", raising=False)
    reset_builder_signer_cache()

    resp = await client.post(
        "/api/polymarket/builder/sign",
        json={"method": "POST", "path": "/order", "body": "{}"},
    )
    assert resp.status_code == 503
    assert "Builder API credentials not configured" in resp.json()["detail"]


@pytest.mark.anyio
async def test_builder_sign_returns_422_on_missing_method(client, monkeypatch):
    _set_builder_api_env(monkeypatch)
    resp = await client.post(
        "/api/polymarket/builder/sign",
        json={"path": "/order", "body": "{}"},
    )
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_builder_sign_returns_422_on_lowercase_method(client, monkeypatch):
    """Method must match ^[A-Z]+$ — guards against HTTP smuggling shapes."""
    _set_builder_api_env(monkeypatch)
    resp = await client.post(
        "/api/polymarket/builder/sign",
        json={"method": "post", "path": "/order", "body": "{}"},
    )
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_builder_sign_returns_all_four_headers(client, monkeypatch):
    _set_builder_api_env(monkeypatch)
    resp = await client.post(
        "/api/polymarket/builder/sign",
        json={"method": "POST", "path": "/order", "body": '{"a":1}'},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {
        "POLY_BUILDER_API_KEY",
        "POLY_BUILDER_PASSPHRASE",
        "POLY_BUILDER_SIGNATURE",
        "POLY_BUILDER_TIMESTAMP",
    }
    assert body["POLY_BUILDER_API_KEY"] == "019e1672-test"
    assert body["POLY_BUILDER_PASSPHRASE"].startswith("pass-")
    assert len(body["POLY_BUILDER_SIGNATURE"]) > 16
    assert body["POLY_BUILDER_TIMESTAMP"].isdigit()


@pytest.mark.anyio
async def test_builder_sign_accepts_empty_body_for_get_requests(client, monkeypatch):
    """GET requests have no payload but still need HMAC headers."""
    _set_builder_api_env(monkeypatch)
    resp = await client.post(
        "/api/polymarket/builder/sign",
        json={"method": "GET", "path": "/trades", "body": ""},
    )
    assert resp.status_code == 200


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
    client_id = "test-client-123"
    wallet, payload = _signed_wallet_link_payload(client_id)

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
        json=payload,
    )
    assert signed_resp.status_code == 200
    assert signed_resp.json()["wallet_address"] == wallet
    linked_resp = await client.get(
        f"/api/watchlist?client_id={client_id}&wallet_address={wallet}",
    )
    assert linked_resp.status_code == 200


@pytest.mark.anyio
async def test_wallet_link_rejects_signature_without_eip191_shape(client):
    client_id = "test-client-sig-shape"
    _wallet, payload = _signed_wallet_link_payload(client_id)
    payload["signature"] = payload["signature"][2:]

    resp = await client.post("/api/wallet/link", json=payload)

    assert resp.status_code == 422


@pytest.mark.anyio
async def test_wallet_scoped_routes_reject_unlinked_wallet(client):
    client_id = "test-client-456"
    wallet, payload = _signed_wallet_link_payload(client_id)
    trader = "0x" + "1" * 40

    guarded_requests = [
        ("GET", f"/api/watchlist?client_id={client_id}&wallet_address={wallet}", None),
        (
            "POST",
            "/api/watchlist/add",
            {
                "client_id": client_id,
                "market_id": "market-wallet-auth",
                "wallet_address": wallet,
            },
        ),
        (
            "DELETE",
            f"/api/watchlist/999?client_id={client_id}&wallet_address={wallet}",
            None,
        ),
        ("GET", f"/api/portfolio?client_id={client_id}&wallet_address={wallet}", None),
        (
            "POST",
            "/api/portfolio/act",
            {
                "client_id": client_id,
                "market_id": "market-wallet-auth",
                "action_direction": "YES",
                "size": 1,
                "price": 0.5,
                "wallet_address": wallet,
            },
        ),
        (
            "POST",
            "/api/follow/trader",
            {
                "client_id": client_id,
                "trader_address": trader,
                "wallet_address": wallet,
            },
        ),
        (
            "DELETE",
            f"/api/follow/trader/{trader}?client_id={client_id}&wallet_address={wallet}",
            None,
        ),
        ("GET", f"/api/follow/list?client_id={client_id}&wallet_address={wallet}", None),
        (
            "GET",
            f"/api/follow/is-following/{trader}?client_id={client_id}&wallet_address={wallet}",
            None,
        ),
        ("GET", f"/api/follow/alerts?client_id={client_id}&wallet_address={wallet}", None),
        (
            "POST",
            f"/api/follow/alerts/mark-seen?client_id={client_id}&wallet_address={wallet}",
            None,
        ),
    ]

    for method, path, json_body in guarded_requests:
        if json_body is None:
            response = await client.request(method, path)
        else:
            response = await client.request(method, path, json=json_body)
        assert response.status_code == 401, path

    link_resp = await client.post("/api/wallet/link", json=payload)
    assert link_resp.status_code == 200

    for method, path, json_body in guarded_requests:
        if json_body is None:
            response = await client.request(method, path)
        else:
            response = await client.request(method, path, json=json_body)
        assert response.status_code != 401, path

    replay_resp = await client.get(
        f"/api/portfolio?client_id=attacker-client-456&wallet_address={wallet}",
    )
    assert replay_resp.status_code == 401


@pytest.mark.anyio
async def test_linked_client_id_without_wallet_address_is_rejected(client):
    """Once a client_id has linked a wallet, the legacy client_id-only path
    is sealed off — leaking the client_id alone must not grant access."""
    import uuid

    # Tests share a persistent SQLite DB; uniquify so prior runs don't
    # poison this assertion.
    client_id = f"test-client-sealed-{uuid.uuid4().hex[:12]}"
    wallet, payload = _signed_wallet_link_payload(client_id)

    pre_link = await client.get(f"/api/watchlist?client_id={client_id}")
    assert pre_link.status_code == 200

    link_resp = await client.post("/api/wallet/link", json=payload)
    assert link_resp.status_code == 200

    sealed_off = [
        ("GET", f"/api/watchlist?client_id={client_id}", None),
        ("GET", f"/api/portfolio?client_id={client_id}", None),
        ("GET", f"/api/follow/list?client_id={client_id}", None),
        ("GET", f"/api/follow/alerts?client_id={client_id}", None),
        (
            "POST",
            "/api/watchlist/add",
            {"client_id": client_id, "market_id": "market-sealed"},
        ),
        (
            "POST",
            "/api/portfolio/act",
            {
                "client_id": client_id,
                "market_id": "market-sealed",
                "action_direction": "YES",
                "size": 1,
                "price": 0.5,
            },
        ),
    ]
    for method, path, json_body in sealed_off:
        if json_body is None:
            response = await client.request(method, path)
        else:
            response = await client.request(method, path, json=json_body)
        assert response.status_code == 401, path


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
async def test_divergences_db_fallback_enriches_predictive_contributor(client, monkeypatch):
    from api.cache import cache
    import api.main as main

    async def fake_load_from_db():
        return (
            [
                {
                    "market_id": "m-db-predictive",
                    "question": "DB market?",
                    "market_price": 0.41,
                    "sm_consensus": 0.72,
                    "divergence_pct": 0.31,
                    "score": 81.0,
                    "sm_trader_count": 4,
                    "sm_direction": "YES",
                    "category": "crypto",
                }
            ],
            0,
        )

    async def fake_predictive(_db, market_ids):
        assert market_ids == ["m-db-predictive"]
        return {
            "m-db-predictive": {
                "trader_address": "0x" + "a" * 40,
                "pct": 76.4,
                "ci_lo": 61.2,
                "ci_hi": 84.8,
                "n": 80,
            }
        }

    cache.clear()
    monkeypatch.setattr(main, "_load_divergences_from_db", fake_load_from_db)
    monkeypatch.setattr(
        main,
        "get_predictive_contributors_for_markets",
        fake_predictive,
    )

    try:
        resp = await client.get("/api/divergences")
    finally:
        cache.clear()

    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "db_fallback"
    assert data["signals"][0]["predictive_contributor"]["n"] == 80


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


@pytest.mark.anyio
async def test_events_rejects_unsafe_path_and_referrer(client):
    valid = await client.post(
        "/api/events",
        json={
            "event_type": "page_view",
            "client_id": "test-client-events",
            "path": "/smart-money?market=%3Cencoded%3E",
            "referrer": "https://polymarket.com/markets?tag=crypto",
        },
    )
    assert valid.status_code == 200

    bad_path = await client.post(
        "/api/events",
        json={
            "event_type": "page_view",
            "path": "/smart-money?<script>alert(1)</script>",
        },
    )
    assert bad_path.status_code == 422

    bad_referrer = await client.post(
        "/api/events",
        json={
            "event_type": "page_view",
            "path": "/smart-money",
            "referrer": "javascript:alert(1)",
        },
    )
    assert bad_referrer.status_code == 422


@pytest.mark.anyio
async def test_events_drops_analytics_event_when_database_is_locked(client, monkeypatch):
    import sqlite3

    import api.main as main

    async def locked_record_event(*_args, **_kwargs):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(main, "record_event", locked_record_event)

    resp = await client.post(
        "/api/events",
        json={
            "event_type": "page_view",
            "client_id": "test-client-events",
            "path": "/",
        },
    )

    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "dropped": True}


@pytest.mark.anyio
async def test_place_order_hides_raw_clob_error_from_response(client, monkeypatch):
    import api.main as main

    monkeypatch.setenv("POLYSCOPE_ADMIN_TOKEN", "secret-token")
    monkeypatch.setattr(main, "is_trading_configured", lambda: True)
    monkeypatch.setattr(main, "max_order_usdc", lambda: 1_000.0)
    monkeypatch.setattr(main, "get_builder_code", lambda: "0x" + "1" * 64)

    def fail_order(**_kwargs):
        raise RuntimeError("funder 0xdeadbeefdeadbeef leaked")

    monkeypatch.setattr(main, "place_attributed_order", fail_order)

    resp = await client.post(
        "/api/orders/place",
        headers={"X-Admin-Token": "secret-token"},
        json={
            "token_id": "token-test",
            "side": "BUY",
            "price": 0.5,
            "size": 1.0,
            "market_id": "market-test",
        },
    )

    assert resp.status_code == 502
    assert resp.json()["detail"] == "CLOB order placement failed"
    assert "deadbeef" not in resp.text


# ── /api/safe/{address}/owners ──────────────────────────────


def _abi_encode_address_array(addresses: list[str]) -> str:
    """Encode `address[]` ABI return for tests.

    Layout: 0x + 32-byte offset (0x20) + 32-byte length + N×32-byte addresses.
    """
    body = "0" * 62 + "20"  # offset = 0x20
    body += format(len(addresses), "064x")  # length
    for a in addresses:
        body += "0" * 24 + a.lower().replace("0x", "")
    return "0x" + body


@pytest.mark.anyio
async def test_safe_owners_invalid_address(client):
    resp = await client.get("/api/safe/notanaddress/owners")
    assert resp.status_code == 400
    assert "invalid address" in resp.json()["detail"].lower()


@pytest.mark.anyio
async def test_safe_owners_no_contract(client, monkeypatch):
    import api.main as main

    async def fake_rpc(method, params):
        assert method == "eth_getCode"
        return "0x"

    monkeypatch.setattr(main, "_polygon_rpc_call", fake_rpc)

    resp = await client.get("/api/safe/0x68c274fd46c9f1fd70f89d8231c6cd74f0661c5b/owners")
    assert resp.status_code == 404
    assert "no contract" in resp.json()["detail"].lower()


@pytest.mark.anyio
async def test_safe_owners_not_a_safe(client, monkeypatch):
    """A contract that exists but doesn't expose getOwners() returns 400."""
    import api.main as main

    calls: list[str] = []

    async def fake_rpc(method, params):
        calls.append(method)
        if method == "eth_getCode":
            return "0x6080604052"  # any non-empty bytecode
        return "0x"  # getOwners returns empty -> decoder yields []

    monkeypatch.setattr(main, "_polygon_rpc_call", fake_rpc)

    resp = await client.get("/api/safe/0x68c274fd46c9f1fd70f89d8231c6cd74f0661c5b/owners")
    assert resp.status_code == 400
    assert "getOwners" in resp.json()["detail"]
    assert calls == ["eth_getCode", "eth_call"]


@pytest.mark.anyio
async def test_safe_owners_valid_safe(client, monkeypatch):
    """A Safe with one EOA owner returns the owner list lowercased."""
    import api.main as main

    owner = "0xE558169047963411C2A9F46cF7d68Aa01e94c946"
    encoded = _abi_encode_address_array([owner])

    async def fake_rpc(method, params):
        if method == "eth_getCode":
            return "0x6080604052"
        return encoded

    monkeypatch.setattr(main, "_polygon_rpc_call", fake_rpc)

    resp = await client.get("/api/safe/0x68c274fd46c9f1fd70f89d8231c6cd74f0661c5b/owners")
    assert resp.status_code == 200
    body = resp.json()
    assert body["address"] == "0x68c274fd46c9f1fd70f89d8231c6cd74f0661c5b"
    assert body["owners"] == [owner.lower()]


def test_decode_owner_list_handles_empty():
    from api.main import _decode_owner_list

    assert _decode_owner_list("0x") == []
    assert _decode_owner_list("") == []


def test_decode_owner_list_decodes_two_owners():
    from api.main import _decode_owner_list

    encoded = _abi_encode_address_array(
        [
            "0x1111111111111111111111111111111111111111",
            "0x2222222222222222222222222222222222222222",
        ]
    )
    assert _decode_owner_list(encoded) == [
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
    ]


# ── /api/polymarket-wallet/{address}/owner ──────────────────


def _abi_encode_address(addr: str) -> str:
    """Encode a single address as a 32-byte ABI return value."""
    return "0x" + "0" * 24 + addr.lower().replace("0x", "")


@pytest.mark.anyio
async def test_polymarket_wallet_owner_invalid_address(client):
    resp = await client.get("/api/polymarket-wallet/notanaddress/owner")
    assert resp.status_code == 400
    assert "invalid address" in resp.json()["detail"].lower()


@pytest.mark.anyio
async def test_polymarket_wallet_owner_no_contract(client, monkeypatch):
    import api.main as main

    async def fake_rpc(method, params):
        assert method == "eth_getCode"
        return "0x"

    monkeypatch.setattr(main, "_polygon_rpc_call", fake_rpc)

    resp = await client.get(
        "/api/polymarket-wallet/0xb9feda4010d2594335c926a71d6ad72646410a03/owner"
    )
    assert resp.status_code == 404
    assert "no contract" in resp.json()["detail"].lower()


@pytest.mark.anyio
async def test_polymarket_wallet_owner_not_ownable(client, monkeypatch):
    """A contract that exists but doesn't expose owner() returns 400."""
    import api.main as main

    async def fake_rpc(method, params):
        if method == "eth_getCode":
            return "0x6080604052"
        return "0x"  # owner() returns empty

    monkeypatch.setattr(main, "_polygon_rpc_call", fake_rpc)

    resp = await client.get(
        "/api/polymarket-wallet/0xb9feda4010d2594335c926a71d6ad72646410a03/owner"
    )
    assert resp.status_code == 400
    assert "owner()" in resp.json()["detail"]


@pytest.mark.anyio
async def test_polymarket_wallet_owner_zero_address(client, monkeypatch):
    """An uninitialized DepositWallet (owner==0x0) returns 400."""
    import api.main as main

    async def fake_rpc(method, params):
        if method == "eth_getCode":
            return "0x6080604052"
        return _abi_encode_address("0x0000000000000000000000000000000000000000")

    monkeypatch.setattr(main, "_polygon_rpc_call", fake_rpc)

    resp = await client.get(
        "/api/polymarket-wallet/0xb9feda4010d2594335c926a71d6ad72646410a03/owner"
    )
    assert resp.status_code == 400
    assert "zero address" in resp.json()["detail"].lower()


@pytest.mark.anyio
async def test_polymarket_wallet_owner_valid(client, monkeypatch):
    """A DepositWallet with a real owner returns it lowercased."""
    import api.main as main

    owner = "0xB2Fae83De08b285CB3D6A77FF520F6aD669D5F33"

    async def fake_rpc(method, params):
        if method == "eth_getCode":
            return "0x6080604052"
        return _abi_encode_address(owner)

    monkeypatch.setattr(main, "_polygon_rpc_call", fake_rpc)

    resp = await client.get(
        "/api/polymarket-wallet/0xb9feda4010d2594335c926a71d6ad72646410a03/owner"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["address"] == "0xb9feda4010d2594335c926a71d6ad72646410a03"
    assert body["owner"] == owner.lower()
