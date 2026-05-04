"""Polymarket Builder Code attribution primitives.

Builder Code is a public ``bytes32`` identifier attached to CLOB orders via
the ``builder_code`` field in ``OrderArgs``. Volume attributes to the
registered builder profile. Env:

  POLYMARKET_BUILDER_CODE   (e.g. 0x + 64 hex chars)
"""

from __future__ import annotations

import os
import re

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
