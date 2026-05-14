"""Tests for the events-based markets traversal.

Verifies that ``get_active_markets_via_events`` correctly extracts
event-level tags and negRisk into each Market it yields.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from polyscope.polymarket import PolymarketClient


def _event(
    tags: list[dict],
    *,
    neg_risk: bool = False,
    markets: list[dict] | None = None,
) -> dict:
    return {
        "id": "evt-1",
        "title": "Test Event",
        "negRisk": neg_risk,
        "tags": tags,
        "markets": markets or [_market("0xmkt-1", "tok-y", "tok-n")],
    }


def _market(condition_id: str, tok_y: str, tok_n: str) -> dict:
    return {
        "conditionId": condition_id,
        "question": "Q?",
        "slug": condition_id,
        "clobTokenIds": [tok_y, tok_n],
        "outcomePrices": ["0.5", "0.5"],
        "volume24hr": 100000,
    }


@pytest.fixture
def client():
    return PolymarketClient(http_client=AsyncMock())


async def test_events_traversal_propagates_event_tags_to_markets(client, monkeypatch):
    payload = [
        _event(
            tags=[{"label": "Politics"}, {"label": "Elections"}],
            markets=[
                _market("0xa", "ta-y", "ta-n"),
                _market("0xb", "tb-y", "tb-n"),
            ],
        )
    ]

    async def fake_get(_url, _params=None):
        return payload

    monkeypatch.setattr(client, "_get", fake_get)

    markets = await client.get_active_markets_via_events(limit=10, offset=0)
    assert len(markets) == 2
    for m in markets:
        assert m.tags == ["Politics", "Elections"]
        # category falls back to tags[0] when market-level category is empty
        assert m.category == "Politics"


async def test_events_traversal_propagates_event_neg_risk(client, monkeypatch):
    payload = [
        _event(
            tags=[{"label": "Sports"}],
            neg_risk=True,
            markets=[_market("0xc", "tc-y", "tc-n")],
        )
    ]

    async def fake_get(_url, _params=None):
        return payload

    monkeypatch.setattr(client, "_get", fake_get)

    markets = await client.get_active_markets_via_events()
    assert len(markets) == 1
    assert markets[0].neg_risk is True


async def test_events_traversal_market_level_neg_risk_wins(client, monkeypatch):
    """If the market dict already has negRisk=True, the event-level
    value (False) shouldn't downgrade it."""
    market_dict = _market("0xd", "td-y", "td-n")
    market_dict["negRisk"] = True
    payload = [
        _event(
            tags=[{"label": "Tech"}],
            neg_risk=False,
            markets=[market_dict],
        )
    ]

    async def fake_get(_url, _params=None):
        return payload

    monkeypatch.setattr(client, "_get", fake_get)

    markets = await client.get_active_markets_via_events()
    assert markets[0].neg_risk is True


async def test_events_traversal_handles_empty_response(client, monkeypatch):
    async def fake_get(_url, _params=None):
        return []

    monkeypatch.setattr(client, "_get", fake_get)
    assert await client.get_active_markets_via_events() == []


async def test_events_traversal_handles_event_without_markets(client, monkeypatch):
    payload = [
        {"id": "evt-empty", "tags": [{"label": "Crypto"}], "markets": []},
        _event(tags=[{"label": "Politics"}]),
    ]

    async def fake_get(_url, _params=None):
        return payload

    monkeypatch.setattr(client, "_get", fake_get)

    markets = await client.get_active_markets_via_events()
    assert len(markets) == 1
    assert markets[0].tags == ["Politics"]


async def test_events_traversal_skips_non_dict_events_and_markets(client, monkeypatch):
    payload = [
        "not-an-event",
        _event(tags=[{"label": "X"}], markets=["not-a-market", _market("0xok", "ty", "tn")]),
        None,
    ]

    async def fake_get(_url, _params=None):
        return payload

    monkeypatch.setattr(client, "_get", fake_get)

    markets = await client.get_active_markets_via_events()
    assert len(markets) == 1
    assert markets[0].condition_id == "0xok"
    assert markets[0].tags == ["X"]


async def test_events_traversal_skips_closed_and_inactive_child_markets(client, monkeypatch):
    """A live event keeps carrying child markets that have already closed
    (e.g. a finished match inside an ongoing tournament). The event-level
    active=true/closed=false query filter does not catch those — they must
    be filtered per-market."""
    open_market = _market("0xopen", "to-y", "to-n")
    closed_market = {**_market("0xclosed", "tc-y", "tc-n"), "closed": True}
    inactive_market = {**_market("0xinactive", "ti-y", "ti-n"), "active": False}
    payload = [
        _event(
            tags=[{"label": "Sports"}],
            markets=[open_market, closed_market, inactive_market],
        )
    ]

    async def fake_get(_url, _params=None):
        return payload

    monkeypatch.setattr(client, "_get", fake_get)

    markets = await client.get_active_markets_via_events()
    assert [m.condition_id for m in markets] == ["0xopen"]


async def test_events_traversal_does_not_overwrite_existing_category(client, monkeypatch):
    """If a market dict has its own category/groupItemTitle, the event
    tags are still added BUT category isn't forced to tags[0]."""
    market_dict = _market("0xe", "te-y", "te-n")
    market_dict["groupItemTitle"] = "Bracket A"
    payload = [
        _event(
            tags=[{"label": "Sports"}],
            markets=[market_dict],
        )
    ]

    async def fake_get(_url, _params=None):
        return payload

    monkeypatch.setattr(client, "_get", fake_get)

    markets = await client.get_active_markets_via_events()
    assert markets[0].category == "Bracket A"  # market-level wins
    assert markets[0].tags == ["Sports"]
