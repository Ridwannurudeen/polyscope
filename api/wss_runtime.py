"""WSS stream lifecycle management — module-level singleton.

Owns ONE PolymarketWSStream and its background asyncio task. Gated on
``POLYSCOPE_WSS_ENABLED`` (default off) so this is safe to deploy
without activating the stream until the env var is flipped.

Public surface:

  is_enabled()            — env-gated on/off
  top_n()                 — POLYSCOPE_WSS_TOP_N (default 100)
  get_stream()            — current PolymarketWSStream or None
  await refresh_subscription(asset_ids)
                          — create the stream the first time, then
                            subscribe/unsubscribe to match the delta
  await stop_stream()     — clean shutdown, 5s timeout

Crashes inside ``stream.run()`` are swallowed so they cannot kill the
FastAPI app. Recovery on next ``refresh_subscription`` call.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from polyscope.wss_stream import PolymarketWSStream

logger = logging.getLogger(__name__)

_DEFAULT_TOP_N = 100
_DEFAULT_LEVEL = 1
_SHUTDOWN_TIMEOUT_S = 5.0
_ENABLED_VALUES = {"1", "true", "yes", "on"}

_stream: PolymarketWSStream | None = None
_stop_event: asyncio.Event | None = None
_run_task: asyncio.Task[Any] | None = None


def is_enabled() -> bool:
    return os.getenv("POLYSCOPE_WSS_ENABLED", "").strip().lower() in _ENABLED_VALUES


def top_n() -> int:
    try:
        return int(os.getenv("POLYSCOPE_WSS_TOP_N", str(_DEFAULT_TOP_N)))
    except ValueError:
        return _DEFAULT_TOP_N


def get_stream() -> PolymarketWSStream | None:
    return _stream


async def refresh_subscription(asset_ids: list[str]) -> None:
    """Start the stream first time, then subscribe/unsubscribe on delta."""
    global _stream, _stop_event, _run_task

    if not asset_ids:
        logger.debug("WSS refresh skipped: no asset_ids")
        return

    if _stream is None:
        _stop_event = asyncio.Event()
        _stream = PolymarketWSStream(asset_ids, level=_DEFAULT_LEVEL)
        _run_task = asyncio.create_task(_safe_run(_stream, _stop_event))
        logger.info("WSS stream started with %d assets", len(asset_ids))
        return

    current = _stream.asset_ids
    new_set = set(asset_ids)
    to_add = sorted(new_set - current)
    to_remove = sorted(current - new_set)
    if to_add:
        await _stream.subscribe(to_add)
    if to_remove:
        await _stream.unsubscribe(to_remove)
    if to_add or to_remove:
        logger.info(
            "WSS subscription updated: +%d / -%d (now %d)",
            len(to_add),
            len(to_remove),
            len(_stream.asset_ids),
        )


async def stop_stream() -> None:
    """Clean shutdown — signals stop, awaits the task, cancels on timeout."""
    global _stream, _stop_event, _run_task

    if _stop_event is not None:
        _stop_event.set()
    if _run_task is not None:
        try:
            await asyncio.wait_for(_run_task, timeout=_SHUTDOWN_TIMEOUT_S)
        except asyncio.TimeoutError:
            logger.warning("WSS shutdown timed out — cancelling task")
            _run_task.cancel()

    _stream = None
    _stop_event = None
    _run_task = None


def _reset_for_tests() -> None:
    """Test helper — clear the module-level singletons between tests."""
    global _stream, _stop_event, _run_task
    _stream = None
    _stop_event = None
    _run_task = None


async def _safe_run(stream: PolymarketWSStream, stop_event: asyncio.Event) -> None:
    """Top-level wrapper so a stream crash doesn't propagate to the app."""
    try:
        await stream.run(stop_event=stop_event)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("WSS stream crashed — disabled for this session")
