"""Polymarket Builder Relayer — gasless Safe deployment and
attributed order submission.

The Relayer is the path Polymarket itself recommends for new Builder apps.
The ``py-builder-relayer-client`` v0.0.1 on PyPI supports the Safe flow:
each user's EOA owns a Gnosis Safe, the Safe is deployed gas-free via the
relayer, and Safe-signed transactions (orders, approvals) are submitted
through ``https://relayer-v2.polymarket.com/`` with Builder Code attached
to every order. This matches the architecture of Polymarket's own
``magic-safe-builder-example`` reference app.

DepositWallet support is on GitHub ``main`` but unreleased on PyPI; the
Safe flow is the v1 target. Bumping the dep gets DepositWallet later.

This module is the foundation: a lazily-initialized, fingerprint-cached
``RelayClient`` plus configuration validation. It does NOT yet expose
deploy/derive/execute endpoints — those land in the next commit.

Env contract:

  POLYMARKET_BUILDER_API_KEY        (required; HMAC key triple identifier)
  POLYMARKET_BUILDER_API_SECRET     (required)
  POLYMARKET_BUILDER_PASSPHRASE     (required)

Optional:

  POLYMARKET_RELAYER_URL            (default https://relayer-v2.polymarket.com/)
  POLYMARKET_PRIVATE_KEY            (optional; only needed for server-initiated
                                     ops. User-signed flows do not require it.)

No HTTP calls happen at import time — initialization is deferred to
``get_relay_client()``. Tests mock both ``py_builder_relayer_client`` and
``py_builder_signing_sdk`` at the ``sys.modules`` level.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

_PK_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")

DEFAULT_RELAYER_URL = "https://relayer-v2.polymarket.com/"
DEFAULT_CHAIN_ID = 137  # Polygon PoS


class RelayerConfigError(RuntimeError):
    """Raised when the relayer is requested but env is missing or invalid."""


def _load_config() -> dict[str, Any] | None:
    """Return a dict of validated relayer config, or None if incomplete.

    Required: Builder API key triple. Optional: private key (for
    server-initiated ops), relayer URL, tx type. Returns None on any
    required-field failure so ``is_relayer_configured()`` can be a cheap
    boolean probe.
    """
    api_key = (os.getenv("POLYMARKET_BUILDER_API_KEY") or "").strip()
    api_secret = (os.getenv("POLYMARKET_BUILDER_API_SECRET") or "").strip()
    passphrase = (os.getenv("POLYMARKET_BUILDER_PASSPHRASE") or "").strip()

    if not api_key or not api_secret or not passphrase:
        return None

    pk = (os.getenv("POLYMARKET_PRIVATE_KEY") or "").strip() or None
    if pk is not None and not _PK_RE.match(pk):
        return None

    return {
        "relayer_url": os.getenv("POLYMARKET_RELAYER_URL", DEFAULT_RELAYER_URL),
        "chain_id": DEFAULT_CHAIN_ID,
        "private_key": pk,
        "builder_api_key": api_key,
        "builder_api_secret": api_secret,
        "builder_passphrase": passphrase,
    }


def is_relayer_configured() -> bool:
    """True when all required relayer env vars are present and valid."""
    return _load_config() is not None


# ── Client cache ───────────────────────────────────────────

_client_cache: Any = None
_client_config_fingerprint: tuple | None = None


def _fingerprint(cfg: dict[str, Any]) -> tuple:
    """Invalidation key — if config changes, cached client is discarded.

    Builder secret and passphrase are reduced to suffixes to avoid surfacing
    them in logs or debug dumps if the tuple is ever printed.
    """
    pk_suffix = cfg["private_key"][-8:] if cfg["private_key"] else None
    return (
        cfg["relayer_url"],
        cfg["chain_id"],
        cfg["builder_api_key"],
        cfg["builder_api_secret"][-8:],
        cfg["builder_passphrase"][-8:],
        pk_suffix,
    )


def get_relay_client():
    """Return a cached, builder-authenticated ``RelayClient``.

    Raises ``RelayerConfigError`` if env is not configured. The client may
    be constructed without a private key — read-only ops (derive, deployed
    check, transaction lookup) work either way. Write ops will raise from
    the SDK's ``assert_signer_needed()`` if no key is set.
    """
    global _client_cache, _client_config_fingerprint

    cfg = _load_config()
    if cfg is None:
        raise RelayerConfigError(
            "Relayer env incomplete: set POLYMARKET_BUILDER_API_KEY, "
            "POLYMARKET_BUILDER_API_SECRET, POLYMARKET_BUILDER_PASSPHRASE"
        )

    fp = _fingerprint(cfg)
    if _client_cache is not None and _client_config_fingerprint == fp:
        return _client_cache

    from py_builder_relayer_client.client import RelayClient
    from py_builder_signing_sdk.config import BuilderApiKeyCreds, BuilderConfig

    builder_config = BuilderConfig(
        local_builder_creds=BuilderApiKeyCreds(
            key=cfg["builder_api_key"],
            secret=cfg["builder_api_secret"],
            passphrase=cfg["builder_passphrase"],
        )
    )

    client = RelayClient(
        relayer_url=cfg["relayer_url"],
        chain_id=cfg["chain_id"],
        private_key=cfg["private_key"],
        builder_config=builder_config,
    )

    _client_cache = client
    _client_config_fingerprint = fp
    logger.info(
        "Polymarket RelayClient initialized (url=%s, chain=%d, signer=%s)",
        cfg["relayer_url"],
        cfg["chain_id"],
        "set" if cfg["private_key"] else "absent",
    )
    return client


def reset_relay_client_cache():
    """For tests + env-reload scenarios."""
    global _client_cache, _client_config_fingerprint
    _client_cache = None
    _client_config_fingerprint = None
