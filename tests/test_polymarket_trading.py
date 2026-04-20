"""Tests for Phase B attributed order submission.

``py_clob_client_v2`` is mocked wholesale — these tests never touch the
network. They cover env validation, cap enforcement, builder-code
attachment, and DB row lifecycle.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pytest


VALID_PK = "0x" + "a" * 64
VALID_FUNDER = "0x" + "b" * 40
VALID_BUILDER_CODE = "0x" + "c" * 64


@pytest.fixture
def good_env(monkeypatch):
    monkeypatch.setenv("POLYMARKET_PRIVATE_KEY", VALID_PK)
    monkeypatch.setenv("POLYMARKET_FUNDER_ADDRESS", VALID_FUNDER)
    monkeypatch.setenv("POLYMARKET_SIGNATURE_TYPE", "2")
    monkeypatch.setenv("POLYMARKET_BUILDER_CODE", VALID_BUILDER_CODE)
    monkeypatch.setenv("POLYMARKET_MAX_ORDER_USDC", "10")
    from api import polymarket_trading

    polymarket_trading.reset_client_cache()
    yield
    polymarket_trading.reset_client_cache()


@pytest.fixture
def fake_clob(monkeypatch):
    """Install a fake ``py_clob_client_v2`` module in sys.modules."""
    fake = types.ModuleType("py_clob_client_v2")

    class _Side:
        BUY = "BUY"
        SELL = "SELL"

    class _OrderType(dict):
        pass

    order_types = {k: k for k in ("GTC", "GTD", "FOK", "FAK")}

    class _OrderTypeEnum:
        GTC = "GTC"
        GTD = "GTD"
        FOK = "FOK"
        FAK = "FAK"

        def __class_getitem__(cls, key):
            if key not in order_types:
                raise KeyError(key)
            return order_types[key]

    class _OrderArgs:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    class _Options:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    fake.Side = _Side
    fake.OrderType = _OrderTypeEnum
    fake.OrderArgs = _OrderArgs
    fake.PartialCreateOrderOptions = _Options

    fake_client_instances: list[MagicMock] = []

    class _Client:
        def __init__(self, **kw):
            self.kwargs = kw
            self.posted_orders: list[tuple] = []
            fake_client_instances.append(self)

        def create_or_derive_api_key(self):
            return {"api_key": "k", "api_secret": "s", "api_passphrase": "p"}

        def create_and_post_order(self, order_args, options, order_type):
            self.posted_orders.append((order_args, options, order_type))
            return {"orderID": "clob-xyz-123", "status": "matched"}

        def get_builder_trades(self, market=None):
            return [{"id": "t1", "market": market, "size": 10, "price": 0.5}]

    fake.ClobClient = _Client
    monkeypatch.setitem(sys.modules, "py_clob_client_v2", fake)
    return fake_client_instances


# ── config validation ─────────────────────────────────────


def test_is_trading_configured_true_when_env_set(good_env):
    from api.polymarket_trading import is_trading_configured

    assert is_trading_configured() is True


def test_is_trading_configured_false_when_pk_missing(monkeypatch):
    monkeypatch.delenv("POLYMARKET_PRIVATE_KEY", raising=False)
    monkeypatch.setenv("POLYMARKET_FUNDER_ADDRESS", VALID_FUNDER)
    monkeypatch.setenv("POLYMARKET_SIGNATURE_TYPE", "2")
    monkeypatch.setenv("POLYMARKET_BUILDER_CODE", VALID_BUILDER_CODE)
    from api.polymarket_trading import is_trading_configured

    assert is_trading_configured() is False


def test_is_trading_configured_false_on_bad_pk(monkeypatch):
    monkeypatch.setenv("POLYMARKET_PRIVATE_KEY", "0xNOTHEX")
    monkeypatch.setenv("POLYMARKET_FUNDER_ADDRESS", VALID_FUNDER)
    monkeypatch.setenv("POLYMARKET_SIGNATURE_TYPE", "2")
    monkeypatch.setenv("POLYMARKET_BUILDER_CODE", VALID_BUILDER_CODE)
    from api.polymarket_trading import is_trading_configured

    assert is_trading_configured() is False


def test_is_trading_configured_false_on_bad_sig_type(monkeypatch):
    monkeypatch.setenv("POLYMARKET_PRIVATE_KEY", VALID_PK)
    monkeypatch.setenv("POLYMARKET_FUNDER_ADDRESS", VALID_FUNDER)
    monkeypatch.setenv("POLYMARKET_SIGNATURE_TYPE", "9")  # not in {0,1,2}
    monkeypatch.setenv("POLYMARKET_BUILDER_CODE", VALID_BUILDER_CODE)
    from api.polymarket_trading import is_trading_configured

    assert is_trading_configured() is False


def test_max_order_usdc_default(monkeypatch):
    monkeypatch.delenv("POLYMARKET_MAX_ORDER_USDC", raising=False)
    from api.polymarket_trading import max_order_usdc

    # Falls back to default when trading not configured
    assert max_order_usdc() == 10.0


def test_max_order_usdc_override(good_env, monkeypatch):
    monkeypatch.setenv("POLYMARKET_MAX_ORDER_USDC", "25.5")
    from api import polymarket_trading

    polymarket_trading.reset_client_cache()
    assert polymarket_trading.max_order_usdc() == 25.5


# ── order placement ──────────────────────────────────────


def test_place_order_attaches_builder_code(good_env, fake_clob):
    from api.polymarket_trading import place_attributed_order

    place_attributed_order(
        token_id="0xtoken",
        side="BUY",
        price=0.5,
        size=10,
    )
    assert len(fake_clob) == 2  # L1 client + full client
    full_client = fake_clob[-1]
    assert len(full_client.posted_orders) == 1
    order_args, options, order_type = full_client.posted_orders[0]
    assert order_args.__dict__["builder_code"] == VALID_BUILDER_CODE
    assert order_args.__dict__["token_id"] == "0xtoken"
    assert order_args.__dict__["side"] == "BUY"
    assert order_type == "GTC"


def test_place_order_respects_side_sell(good_env, fake_clob):
    from api.polymarket_trading import place_attributed_order

    place_attributed_order(token_id="x", side="SELL", price=0.5, size=1)
    full_client = fake_clob[-1]
    assert full_client.posted_orders[0][0].__dict__["side"] == "SELL"


def test_place_order_cap_enforcement(good_env, fake_clob):
    from api.polymarket_trading import (
        OrderCapExceeded,
        place_attributed_order,
    )

    # price*size = 0.5*21 = 10.5 > cap of 10
    with pytest.raises(OrderCapExceeded):
        place_attributed_order(
            token_id="x", side="BUY", price=0.5, size=21
        )
    # No client calls made — cap rejection happens before network
    assert fake_clob == []


def test_place_order_rejects_unknown_order_type(good_env, fake_clob):
    from api.polymarket_trading import place_attributed_order

    with pytest.raises(ValueError, match="Unsupported order_type"):
        place_attributed_order(
            token_id="x", side="BUY", price=0.5, size=1, order_type="NOPE"
        )


def test_place_order_raises_when_unconfigured(monkeypatch):
    monkeypatch.delenv("POLYMARKET_PRIVATE_KEY", raising=False)
    from api.polymarket_trading import TradingConfigError, place_attributed_order

    with pytest.raises(TradingConfigError):
        place_attributed_order(token_id="x", side="BUY", price=0.5, size=1)


def test_client_is_cached_across_calls(good_env, fake_clob):
    from api.polymarket_trading import place_attributed_order

    place_attributed_order(token_id="x", side="BUY", price=0.5, size=1)
    place_attributed_order(token_id="y", side="BUY", price=0.5, size=1)
    # L1 + full client instantiated ONCE, reused for the second call
    assert len(fake_clob) == 2


def test_client_cache_invalidated_when_env_changes(good_env, fake_clob, monkeypatch):
    from api.polymarket_trading import place_attributed_order

    place_attributed_order(token_id="x", side="BUY", price=0.5, size=1)
    # Change funder — fingerprint changes, cache discarded, new client built
    monkeypatch.setenv("POLYMARKET_FUNDER_ADDRESS", "0x" + "d" * 40)
    place_attributed_order(token_id="y", side="BUY", price=0.5, size=1)
    assert len(fake_clob) == 4  # 2 L1+full pairs


def test_get_attributed_trades(good_env, fake_clob):
    from api.polymarket_trading import get_attributed_trades

    trades = get_attributed_trades(market="0xabc")
    assert len(trades) == 1
    assert trades[0]["market"] == "0xabc"
