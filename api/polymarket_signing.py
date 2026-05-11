"""Polymarket Builder Code attribution + Builder API HMAC signing.

Two distinct concerns live here:

1. **Builder Code** (public ``bytes32``) — attached to CLOB orders via
   the ``builder_code`` field in ``OrderArgs``. Volume attributes to the
   registered builder profile. Public; safe to bake into the web bundle.
   Env: ``POLYMARKET_BUILDER_CODE``.

2. **Builder API HMAC signing** — authenticates the Builder identity to
   Polymarket's Relayer and authenticated CLOB endpoints. Used by the
   ``POST /api/polymarket/builder/sign`` proxy endpoint so the frontend
   RelayClient + ClobClient can authenticate without ever seeing the
   API secret. Env: ``POLYMARKET_BUILDER_API_KEY/_SECRET/_PASSPHRASE``.
"""

from __future__ import annotations

import os
import re
from typing import Any

_BUILDER_CODE_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")


def get_builder_code() -> str | None:
    """Return the configured Polymarket Builder Code, or None.

    The code is a public ``bytes32`` (``0x`` + 64 hex chars). It must
    be attached to ``OrderArgs.builder_code`` on every CLOB order to
    attribute volume to the registered builder profile.
    """
    code = os.getenv("POLYMARKET_BUILDER_CODE")
    if code is None:
        return None
    code = code.strip()
    if not _BUILDER_CODE_RE.match(code):
        return None
    return code.lower()


def is_builder_code_configured() -> bool:
    """True when POLYMARKET_BUILDER_CODE is set to a valid bytes32."""
    return get_builder_code() is not None


# ── Builder API HMAC signing ───────────────────────────────


def _load_builder_creds() -> dict[str, str] | None:
    """Return validated Builder API creds dict, or None if incomplete."""
    key = (os.getenv("POLYMARKET_BUILDER_API_KEY") or "").strip()
    secret = (os.getenv("POLYMARKET_BUILDER_API_SECRET") or "").strip()
    passphrase = (os.getenv("POLYMARKET_BUILDER_PASSPHRASE") or "").strip()
    if not key or not secret or not passphrase:
        return None
    return {"key": key, "secret": secret, "passphrase": passphrase}


def is_builder_api_configured() -> bool:
    """True when all three Builder API env vars are set."""
    return _load_builder_creds() is not None


_signer_cache: Any = None
_signer_fingerprint: tuple | None = None


def get_builder_signer():
    """Return a cached ``BuilderSigner``, or None if env is incomplete.

    The signer is a thin wrapper around the API creds — no network
    state — but the cache avoids reconstructing on every sign request.
    Cache invalidates when any cred suffix changes.
    """
    global _signer_cache, _signer_fingerprint

    cfg = _load_builder_creds()
    if cfg is None:
        return None

    fp = (cfg["key"], cfg["secret"][-8:], cfg["passphrase"][-8:])
    if _signer_cache is not None and _signer_fingerprint == fp:
        return _signer_cache

    from py_builder_signing_sdk.sdk_types import BuilderApiKeyCreds
    from py_builder_signing_sdk.signer import BuilderSigner

    signer = BuilderSigner(BuilderApiKeyCreds(**cfg))
    _signer_cache = signer
    _signer_fingerprint = fp
    return signer


def reset_builder_signer_cache():
    """For tests + env-reload scenarios."""
    global _signer_cache, _signer_fingerprint
    _signer_cache = None
    _signer_fingerprint = None
