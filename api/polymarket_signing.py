"""Polymarket builder-attribution primitives.

Two separate paths live here:

1. **Builder Code** — a public ``bytes32`` identifier attached to CLOB
   orders via the ``builder_code`` field in ``OrderArgs``. No HMAC, no
   headers. Volume attributes to the registered builder profile. Env:

     POLYMARKET_BUILDER_CODE   (e.g. 0x + 64 hex chars)

2. **Builder API Key signing** — HMAC-signed headers used for
   authenticated Relayer/builder-scoped endpoints. Separate from
   attribution. Env:

     POLYMARKET_BUILDER_API_KEY       (client key, sent as header)
     POLYMARKET_BUILDER_API_SECRET    (server-only, used for HMAC)
     POLYMARKET_BUILDER_PASSPHRASE    (sent as header)

   Header set:

     POLY_BUILDER_API_KEY
     POLY_BUILDER_TIMESTAMP
     POLY_BUILDER_PASSPHRASE
     POLY_BUILDER_SIGNATURE

   Signature scheme:

     message   = timestamp + METHOD + path + body
     signature = base64_urlsafe( HMAC_SHA256(api_secret, message) )

When HMAC creds are absent, ``sign_request`` returns a stub so the
UI/endpoint flow stays functional without pausing for credentials.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
from dataclasses import dataclass

_BUILDER_CODE_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")


@dataclass(frozen=True)
class SignedRequest:
    """The four headers to attach to an attributed Polymarket request."""

    api_key: str
    timestamp: str
    passphrase: str
    signature: str
    mode: str  # "live" | "stub"

    def to_headers(self) -> dict[str, str]:
        return {
            "POLY_BUILDER_API_KEY": self.api_key,
            "POLY_BUILDER_TIMESTAMP": self.timestamp,
            "POLY_BUILDER_PASSPHRASE": self.passphrase,
            "POLY_BUILDER_SIGNATURE": self.signature,
        }


def _load_creds() -> tuple[str | None, str | None, str | None]:
    return (
        os.getenv("POLYMARKET_BUILDER_API_KEY"),
        os.getenv("POLYMARKET_BUILDER_API_SECRET"),
        os.getenv("POLYMARKET_BUILDER_PASSPHRASE"),
    )


def _hmac_signature(secret: str, message: str) -> str:
    """Base64-url-safe HMAC-SHA256 over `message` with `secret`.

    Polymarket's SDK uses base64 URL-safe encoding (not standard base64)
    to keep signatures header-safe without additional escaping.
    """
    digest = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest).decode("utf-8")


def sign_request(
    method: str,
    path: str,
    body: str = "",
    *,
    timestamp: str | None = None,
) -> SignedRequest:
    """Produce builder-attribution headers for a CLOB request.

    `method` is the HTTP method (e.g. "POST").
    `path` is the request path starting with "/" (e.g. "/order").
    `body` is the exact JSON body string that will be sent (order matters).

    If any of the three required env vars are missing, returns a stub
    with mode="stub" — callers MUST check `.mode == "live"` before
    actually sending the request to Polymarket.
    """
    api_key, api_secret, passphrase = _load_creds()
    ts = timestamp if timestamp is not None else str(int(time.time()))

    if not (api_key and api_secret and passphrase):
        return SignedRequest(
            api_key="stub",
            timestamp=ts,
            passphrase="stub",
            signature="stub",
            mode="stub",
        )

    message = f"{ts}{method.upper()}{path}{body}"
    signature = _hmac_signature(api_secret, message)
    return SignedRequest(
        api_key=api_key,
        timestamp=ts,
        passphrase=passphrase,
        signature=signature,
        mode="live",
    )


def is_configured() -> bool:
    """True when all three builder-attribution secrets are present."""
    return all(_load_creds())


# ── Builder Code (public, CLOB order attribution) ──────────


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
