"""Tests for FastAPI endpoints."""

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
