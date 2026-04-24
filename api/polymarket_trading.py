"""Polymarket CLOB trading — attributed order submission (Phase B).

Wraps ``py_clob_client_v2`` with PolyScope's Builder Code auto-attached to
every order. The client is lazily initialized once per process and cached;
L2 API credentials are derived on first use from the configured private
key and stored in-process.

Env contract (all four required, or ``is_trading_configured`` is False):

  POLYMARKET_PRIVATE_KEY      (0x + 64 hex, EOA signer)
  POLYMARKET_FUNDER_ADDRESS   (0x + 40 hex, Safe/proxy holding pUSD)
  POLYMARKET_SIGNATURE_TYPE   (integer; 2 for Magic/Safe, 0 for EOA, 1 for Magic)
  POLYMARKET_BUILDER_CODE     (0x + 64 hex, reused from builder-identity path)

Optional:

  POLYMARKET_MAX_ORDER_USDC   (default 10.0; hard cap on notional)
  POLYMARKET_CLOB_HOST        (default https://clob.polymarket.com)

This module makes NO CLOB calls at import time — initialization is
deferred to ``get_client()``. Tests can mock the client wholesale.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

from .polymarket_signing import get_builder_code

logger = logging.getLogger(__name__)

_PK_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")
_ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")

DEFAULT_CLOB_HOST = "https://clob.polymarket.com"
DEFAULT_CHAIN_ID = 137  # Polygon PoS
DEFAULT_MAX_ORDER_USDC = 10.0


class TradingConfigError(RuntimeError):
    """Raised when trading is requested but env is missing or invalid."""


class OrderCapExceeded(ValueError):
    """Order notional exceeds POLYMARKET_MAX_ORDER_USDC."""


def _load_config() -> dict[str, Any] | None:
    """Return a dict of validated trading config, or None if incomplete."""
    pk = (os.getenv("POLYMARKET_PRIVATE_KEY") or "").strip()
    funder = (os.getenv("POLYMARKET_FUNDER_ADDRESS") or "").strip()
    sig_type_raw = (os.getenv("POLYMARKET_SIGNATURE_TYPE") or "").strip()
    builder_code = get_builder_code()

    if not pk or not _PK_RE.match(pk):
        return None
    if not funder or not _ADDR_RE.match(funder):
        return None
    try:
        sig_type = int(sig_type_raw)
    except ValueError:
        return None
    if sig_type not in (0, 1, 2):
        return None
    if builder_code is None:
        return None

    try:
        max_usdc = float(os.getenv("POLYMARKET_MAX_ORDER_USDC", DEFAULT_MAX_ORDER_USDC))
    except ValueError:
        max_usdc = DEFAULT_MAX_ORDER_USDC

    return {
        "private_key": pk,
        "funder": funder.lower(),
        "signature_type": sig_type,
        "builder_code": builder_code,
        "max_order_usdc": max_usdc,
        "host": os.getenv("POLYMARKET_CLOB_HOST", DEFAULT_CLOB_HOST),
        "chain_id": DEFAULT_CHAIN_ID,
    }


def is_trading_configured() -> bool:
    """True when all required trading env vars are present and valid."""
    return _load_config() is not None


def max_order_usdc() -> float:
    cfg = _load_config()
    return cfg["max_order_usdc"] if cfg else DEFAULT_MAX_ORDER_USDC


# ── Client cache ───────────────────────────────────────────

_client_cache: Any = None
_client_config_fingerprint: tuple | None = None


def _fingerprint(cfg: dict[str, Any]) -> tuple:
    """Invalidation key — if config changes, cached client is discarded."""
    return (
        cfg["host"],
        cfg["chain_id"],
        cfg["funder"],
        cfg["signature_type"],
        cfg["private_key"][-8:],  # suffix only; avoids logging full key
    )


def get_client():
    """Return a cached, L1+L2-authenticated ClobClient. Derives L2 creds
    on first call. Raises ``TradingConfigError`` if env is not configured.
    """
    global _client_cache, _client_config_fingerprint

    cfg = _load_config()
    if cfg is None:
        raise TradingConfigError(
            "Trading env incomplete: set POLYMARKET_PRIVATE_KEY, "
            "POLYMARKET_FUNDER_ADDRESS, POLYMARKET_SIGNATURE_TYPE, "
            "POLYMARKET_BUILDER_CODE"
        )

    fp = _fingerprint(cfg)
    if _client_cache is not None and _client_config_fingerprint == fp:
        return _client_cache

    from py_clob_client_v2 import ClobClient

    # Step 1: L1 client (wallet-only) to derive L2 creds
    l1 = ClobClient(
        host=cfg["host"],
        chain_id=cfg["chain_id"],
        key=cfg["private_key"],
    )
    creds = l1.create_or_derive_api_key()

    # Step 2: full L1+L2 client with Safe/proxy config
    client = ClobClient(
        host=cfg["host"],
        chain_id=cfg["chain_id"],
        key=cfg["private_key"],
        creds=creds,
        signature_type=cfg["signature_type"],
        funder=cfg["funder"],
    )

    _client_cache = client
    _client_config_fingerprint = fp
    logger.info("Polymarket ClobClient initialized (funder=%s, sig_type=%d)",
                cfg["funder"], cfg["signature_type"])
    return client


def reset_client_cache():
    """For tests + env-reload scenarios."""
    global _client_cache, _client_config_fingerprint
    _client_cache = None
    _client_config_fingerprint = None


# ── Order placement ────────────────────────────────────────


def place_attributed_order(
    *,
    token_id: str,
    side: str,
    price: float,
    size: float,
    order_type: str = "GTC",
    tick_size: str = "0.01",
    neg_risk: bool = False,
) -> dict[str, Any]:
    """Create and post a limit order with our Builder Code attached.

    ``side`` is "BUY" or "SELL". ``order_type`` is "GTC" | "FOK" | "GTD" | "FAK".
    Returns the CLOB response as a dict.

    Enforces ``POLYMARKET_MAX_ORDER_USDC`` as a hard cap on ``price * size``
    before any network call. Raises ``OrderCapExceeded`` on violation.
    """
    cfg = _load_config()
    if cfg is None:
        raise TradingConfigError("Trading not configured")

    notional = round(price * size, 6)
    if notional > cfg["max_order_usdc"]:
        raise OrderCapExceeded(
            f"Order notional ${notional:.4f} exceeds cap "
            f"${cfg['max_order_usdc']:.2f}"
        )

    from py_clob_client_v2 import (
        OrderArgs,
        OrderType,
        PartialCreateOrderOptions,
        Side,
    )

    side_enum = Side.BUY if side.upper() == "BUY" else Side.SELL
    order_type_upper = order_type.upper()
    if not hasattr(OrderType, order_type_upper):
        raise ValueError(f"Unsupported order_type: {order_type}")
    ot = getattr(OrderType, order_type_upper)

    client = get_client()
    resp = client.create_and_post_order(
        order_args=OrderArgs(
            token_id=token_id,
            price=price,
            size=size,
            side=side_enum,
            builder_code=cfg["builder_code"],
        ),
        options=PartialCreateOrderOptions(
            tick_size=tick_size,
            neg_risk=neg_risk,
        ),
        order_type=ot,
    )
    # Normalize: CLOB SDK may return dataclass, pydantic model, or dict.
    if hasattr(resp, "model_dump"):
        return resp.model_dump()
    if hasattr(resp, "__dict__"):
        return dict(resp.__dict__)
    if isinstance(resp, dict):
        return resp
    return {"raw": str(resp)}


def get_attributed_trades(market: str | None = None) -> list[dict[str, Any]]:
    """Fetch builder-attributed trades for this deployment's builder code."""
    client = get_client()
    kwargs = {"market": market} if market else {}
    trades = client.get_builder_trades(**kwargs)
    return [
        t.__dict__ if hasattr(t, "__dict__") else dict(t)
        for t in (trades or [])
    ]
