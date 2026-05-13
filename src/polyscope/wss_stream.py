"""Polymarket WSS market data stream.

Connects to wss://ws-subscriptions-clob.polymarket.com/ws/market and
maintains a per-asset live-price cache. Reconnects on disconnect with
exponential backoff. Sends literal "PING" every 10s per Polymarket's
WSS spec (NOT WS-protocol ping frames — server expects text "PING"
and replies with text "PONG").

Subscribed at level=1 (top-of-book only) by default. Processes:

  - ``book``: initial orderbook snapshot per asset
  - ``price_change``: delta with optional ``best_bid``/``best_ask``
  - ``last_trade_price``: most recent trade
  - ``tick_size_change``: cached for downstream consumers

Public surface:

  stream = PolymarketWSStream(asset_ids)
  asyncio.create_task(stream.run(stop_event))
  stream.snapshot(asset_id)        # latest fields dict, or None
  stream.current_price(asset_id)   # midpoint or last-trade per
                                   # Polymarket display rule
  await stream.subscribe([new_ids])
  await stream.unsubscribe([old_ids])

This module is intentionally side-effect-free at import time. The
lifespan/scheduler wiring (start at app boot, stop at shutdown, pick
the top-N markets by volume to subscribe to) is in api/main.py.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import Any

import websockets
from websockets.exceptions import WebSocketException

logger = logging.getLogger(__name__)

WSS_URL_DEFAULT = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
PING_INTERVAL = 10.0
INITIAL_BACKOFF = 0.5
MAX_BACKOFF = 30.0

# Polymarket's display rule: show midpoint unless the spread exceeds
# this threshold, in which case show last-trade-price. Replicating it
# here so PolyScope odds agree with polymarket.com.
SPREAD_THRESHOLD = 0.10


class PolymarketWSStream:
    """Persistent WSS connection to Polymarket's market channel."""

    def __init__(
        self,
        asset_ids: list[str],
        *,
        level: int = 1,
        url: str = WSS_URL_DEFAULT,
        ping_interval: float = PING_INTERVAL,
        initial_backoff: float = INITIAL_BACKOFF,
        max_backoff: float = MAX_BACKOFF,
    ):
        self._asset_ids: set[str] = set(asset_ids)
        self._level = level
        self._url = url
        self._ping_interval = ping_interval
        self._initial_backoff = initial_backoff
        self._max_backoff = max_backoff
        self._snapshots: dict[str, dict[str, Any]] = {}
        self._ws: Any = None
        self._stop_event: asyncio.Event | None = None

    @property
    def asset_ids(self) -> set[str]:
        return set(self._asset_ids)

    @property
    def is_connected(self) -> bool:
        return self._ws is not None and not getattr(self._ws, "closed", True)

    def snapshot(self, asset_id: str) -> dict[str, Any] | None:
        snap = self._snapshots.get(asset_id)
        return dict(snap) if snap is not None else None

    def current_price(self, asset_id: str) -> float | None:
        """Polymarket display rule: midpoint unless spread > 0.10 → last trade."""
        snap = self._snapshots.get(asset_id)
        if not snap:
            return None
        best_bid = snap.get("best_bid")
        best_ask = snap.get("best_ask")
        last_trade = snap.get("last_trade")
        if best_bid is not None and best_ask is not None:
            spread = best_ask - best_bid
            if spread > SPREAD_THRESHOLD and last_trade is not None:
                return last_trade
            return (best_bid + best_ask) / 2
        return last_trade

    async def subscribe(self, asset_ids: list[str]) -> None:
        """Add asset_ids to the live subscription. Idempotent."""
        new_ids = [aid for aid in asset_ids if aid not in self._asset_ids]
        self._asset_ids.update(new_ids)
        if self.is_connected and new_ids:
            await self._ws.send(
                json.dumps(
                    {
                        "operation": "subscribe",
                        "assets_ids": new_ids,
                        "level": self._level,
                    }
                )
            )

    async def unsubscribe(self, asset_ids: list[str]) -> None:
        """Remove asset_ids from the live subscription. Idempotent."""
        to_remove = [aid for aid in asset_ids if aid in self._asset_ids]
        for aid in to_remove:
            self._asset_ids.discard(aid)
            self._snapshots.pop(aid, None)
        if self.is_connected and to_remove:
            await self._ws.send(
                json.dumps(
                    {
                        "operation": "unsubscribe",
                        "assets_ids": to_remove,
                    }
                )
            )

    async def run(self, stop_event: asyncio.Event | None = None) -> None:
        """Run forever, reconnecting as needed. Returns when stop_event is set."""
        self._stop_event = stop_event if stop_event is not None else asyncio.Event()
        attempt = 0
        while not self._stop_event.is_set():
            try:
                async with websockets.connect(self._url) as ws:
                    self._ws = ws
                    attempt = 0  # reset on a successful connection
                    await self._send_initial_subscribe(ws)
                    ping_task = asyncio.create_task(self._ping_loop(ws))
                    try:
                        async for raw in ws:
                            self._handle_message(raw)
                    finally:
                        ping_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError, Exception):
                            await ping_task
            except (WebSocketException, OSError, asyncio.TimeoutError) as e:
                logger.warning("WSS disconnected: %s — will reconnect", e)
            finally:
                self._ws = None

            if self._stop_event.is_set():
                break
            backoff = min(self._initial_backoff * (2**attempt), self._max_backoff)
            attempt += 1
            logger.info("WSS reconnecting in %.2fs (attempt %d)", backoff, attempt)
            await asyncio.sleep(backoff)

    async def _send_initial_subscribe(self, ws: Any) -> None:
        if not self._asset_ids:
            return
        await ws.send(
            json.dumps(
                {
                    "assets_ids": sorted(self._asset_ids),
                    "type": "market",
                    "initial_dump": True,
                    "level": self._level,
                }
            )
        )

    async def _ping_loop(self, ws: Any) -> None:
        try:
            while True:
                await asyncio.sleep(self._ping_interval)
                await ws.send("PING")
        except (asyncio.CancelledError, WebSocketException):
            return

    def _handle_message(self, raw: Any) -> None:
        if not raw:
            return
        # PONG is a literal text reply; the rest of the protocol is JSON.
        if isinstance(raw, str) and raw.strip() == "PONG":
            return
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            logger.debug(
                "WSS received non-JSON payload: %r",
                raw[:120] if isinstance(raw, (bytes, str)) else raw,
            )
            return
        # Polymarket may send a single event dict or a list of events.
        if isinstance(payload, list):
            for event in payload:
                if isinstance(event, dict):
                    self._apply_event(event)
        elif isinstance(payload, dict):
            self._apply_event(payload)

    def _apply_event(self, event: dict[str, Any]) -> None:
        event_type = event.get("event_type")
        asset_id = event.get("asset_id")
        if not event_type or not asset_id:
            return
        snap = self._snapshots.setdefault(asset_id, {})

        if event_type == "book":
            # Full orderbook snapshot. Bids sorted descending, asks ascending —
            # top of book is the first element of each.
            bids = event.get("bids") or []
            asks = event.get("asks") or []
            if bids and isinstance(bids[0], dict):
                snap["best_bid"] = _to_float(bids[0].get("price"))
            if asks and isinstance(asks[0], dict):
                snap["best_ask"] = _to_float(asks[0].get("price"))
        elif event_type == "price_change":
            # Polymarket may include best_bid/best_ask alongside the delta.
            # At level=1 these fields carry the new top-of-book; we don't
            # need to track full-book state to keep midpoint current.
            best_bid = event.get("best_bid")
            best_ask = event.get("best_ask")
            if best_bid is not None:
                snap["best_bid"] = _to_float(best_bid)
            if best_ask is not None:
                snap["best_ask"] = _to_float(best_ask)
        elif event_type == "last_trade_price":
            price = event.get("price")
            if price is not None:
                snap["last_trade"] = _to_float(price)
        elif event_type == "tick_size_change":
            new_tick = event.get("new_tick_size")
            if new_tick is not None:
                snap["tick_size"] = _to_float(new_tick)
        # Unknown event_type values are accepted silently — Polymarket may
        # add fields like best_bid_ask (custom_feature gated) which level=1
        # subscribers don't request but shouldn't break on.

        snap["ts"] = time.time()


def _to_float(val: Any) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0
