"""Tests for the Polymarket WSS market stream.

Pure-logic tests run without any network. The integration test spins
up a local websockets.serve mock server and verifies the subscribe
payload + cache-update flow end-to-end.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from typing import Any

import pytest
import websockets

from polyscope.wss_stream import (
    SPREAD_THRESHOLD,
    PolymarketWSStream,
)


# ── Pure parsing tests ────────────────────────────────────


def test_book_event_updates_top_of_book():
    s = PolymarketWSStream(["tok-a"])
    s._apply_event(
        {
            "event_type": "book",
            "asset_id": "tok-a",
            "bids": [{"price": "0.49", "size": "100"}, {"price": "0.48", "size": "50"}],
            "asks": [{"price": "0.51", "size": "100"}, {"price": "0.52", "size": "50"}],
        }
    )
    snap = s.snapshot("tok-a")
    assert snap["best_bid"] == 0.49
    assert snap["best_ask"] == 0.51
    assert "ts" in snap


def test_price_change_with_best_bid_ask_updates_directly():
    s = PolymarketWSStream(["tok-a"])
    s._apply_event(
        {
            "event_type": "price_change",
            "asset_id": "tok-a",
            "best_bid": "0.50",
            "best_ask": "0.52",
        }
    )
    snap = s.snapshot("tok-a")
    assert snap["best_bid"] == 0.50
    assert snap["best_ask"] == 0.52


def test_last_trade_price_event_recorded():
    s = PolymarketWSStream(["tok-a"])
    s._apply_event(
        {
            "event_type": "last_trade_price",
            "asset_id": "tok-a",
            "price": "0.515",
        }
    )
    snap = s.snapshot("tok-a")
    assert snap["last_trade"] == 0.515


def test_tick_size_change_recorded():
    s = PolymarketWSStream(["tok-a"])
    s._apply_event(
        {
            "event_type": "tick_size_change",
            "asset_id": "tok-a",
            "old_tick_size": "0.01",
            "new_tick_size": "0.001",
        }
    )
    snap = s.snapshot("tok-a")
    assert snap["tick_size"] == 0.001


def test_unknown_event_type_ignored_safely():
    s = PolymarketWSStream(["tok-a"])
    # custom_feature-gated events shouldn't break level=1 subscribers
    s._apply_event({"event_type": "best_bid_ask", "asset_id": "tok-a", "best_bid": "0.5"})
    snap = s.snapshot("tok-a")
    # Snapshot exists with just the ts; no best_bid set because we
    # didn't claim to handle this event type at level=1.
    assert snap is not None
    assert "best_bid" not in snap


def test_event_without_asset_id_ignored():
    s = PolymarketWSStream(["tok-a"])
    s._apply_event({"event_type": "book", "bids": [], "asks": []})
    assert s.snapshot("tok-a") is None


def test_event_without_event_type_ignored():
    s = PolymarketWSStream(["tok-a"])
    s._apply_event({"asset_id": "tok-a", "best_bid": "0.5"})
    assert s.snapshot("tok-a") is None


# ── Display-rule (current_price) ──────────────────────────


def test_current_price_returns_midpoint_when_spread_is_narrow():
    s = PolymarketWSStream(["tok-a"])
    s._apply_event(
        {
            "event_type": "price_change",
            "asset_id": "tok-a",
            "best_bid": "0.49",
            "best_ask": "0.51",  # spread = 0.02
        }
    )
    s._apply_event({"event_type": "last_trade_price", "asset_id": "tok-a", "price": "0.499"})
    # Spread 0.02 < SPREAD_THRESHOLD 0.10 → midpoint wins
    assert s.current_price("tok-a") == pytest.approx(0.50)


def test_current_price_falls_back_to_last_trade_on_wide_spread():
    s = PolymarketWSStream(["tok-a"])
    s._apply_event(
        {
            "event_type": "price_change",
            "asset_id": "tok-a",
            "best_bid": "0.30",
            "best_ask": "0.70",  # spread = 0.40 > SPREAD_THRESHOLD
        }
    )
    s._apply_event({"event_type": "last_trade_price", "asset_id": "tok-a", "price": "0.45"})
    assert s.current_price("tok-a") == 0.45


def test_current_price_no_book_falls_back_to_last_trade():
    s = PolymarketWSStream(["tok-a"])
    s._apply_event({"event_type": "last_trade_price", "asset_id": "tok-a", "price": "0.62"})
    assert s.current_price("tok-a") == 0.62


def test_current_price_no_data_returns_none():
    s = PolymarketWSStream(["tok-a"])
    assert s.current_price("tok-a") is None


def test_spread_threshold_is_polymarket_documented():
    # Polymarket's display rule cites 0.10 as the spread cutoff.
    assert SPREAD_THRESHOLD == 0.10


# ── Message dispatch (single vs list payload) ─────────────


def test_handle_message_accepts_list_of_events():
    s = PolymarketWSStream(["a", "b"])
    s._handle_message(
        json.dumps(
            [
                {"event_type": "last_trade_price", "asset_id": "a", "price": "0.1"},
                {"event_type": "last_trade_price", "asset_id": "b", "price": "0.9"},
            ]
        )
    )
    assert s.snapshot("a")["last_trade"] == 0.1
    assert s.snapshot("b")["last_trade"] == 0.9


def test_handle_message_ignores_pong():
    s = PolymarketWSStream(["a"])
    s._handle_message("PONG")
    assert s.snapshot("a") is None


def test_handle_message_ignores_non_json():
    s = PolymarketWSStream(["a"])
    s._handle_message("not-json-at-all")
    assert s.snapshot("a") is None


def test_handle_message_ignores_empty():
    s = PolymarketWSStream(["a"])
    s._handle_message("")
    assert s.snapshot("a") is None


# ── Subscription set bookkeeping ──────────────────────────


async def test_subscribe_adds_to_asset_set_offline():
    s = PolymarketWSStream(["a"])
    await s.subscribe(["b", "c"])
    assert s.asset_ids == {"a", "b", "c"}


async def test_unsubscribe_clears_snapshot_and_set():
    s = PolymarketWSStream(["a", "b"])
    s._snapshots["a"] = {"best_bid": 0.5, "ts": time.time()}
    await s.unsubscribe(["a"])
    assert "a" not in s.asset_ids
    assert s.snapshot("a") is None


async def test_subscribe_is_idempotent():
    s = PolymarketWSStream(["a"])
    await s.subscribe(["a", "a", "b"])
    assert s.asset_ids == {"a", "b"}


# ── Integration with a mocked WSS server ──────────────────


async def _serve_one_message_then_close(server_msgs: list[str]):
    """Returns (handler, received_subscribe_holder) wired to capture client subscribe."""
    received: dict[str, Any] = {"subscribe": None, "ping_count": 0}

    async def handler(ws):
        # First frame from client = initial subscribe
        first = await ws.recv()
        try:
            received["subscribe"] = json.loads(first)
        except json.JSONDecodeError:
            received["subscribe"] = {"raw": first}
        # Reply with the canned messages, then keep the connection open
        # long enough for the client to process them.
        for msg in server_msgs:
            await ws.send(msg)
        # Wait briefly for any PING from client
        try:
            await asyncio.wait_for(_count_pings(ws, received), timeout=0.3)
        except asyncio.TimeoutError:
            pass

    return handler, received


async def _count_pings(ws, received: dict[str, Any]):
    async for msg in ws:
        if isinstance(msg, str) and msg.strip() == "PING":
            received["ping_count"] += 1
            await ws.send("PONG")


async def test_integration_subscribes_and_processes_book_event():
    """Full path: connect → send subscribe payload → receive book event → cache populated."""
    server_msgs = [
        json.dumps(
            {
                "event_type": "book",
                "asset_id": "asset-a",
                "bids": [{"price": "0.49", "size": "100"}],
                "asks": [{"price": "0.51", "size": "100"}],
            }
        )
    ]
    handler, received = await _serve_one_message_then_close(server_msgs)

    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        url = f"ws://127.0.0.1:{port}"
        stream = PolymarketWSStream(
            ["asset-a"],
            url=url,
            ping_interval=0.05,
            initial_backoff=0.05,
            max_backoff=0.05,
        )

        stop_event = asyncio.Event()
        run_task = asyncio.create_task(stream.run(stop_event=stop_event))
        try:
            # Poll briefly for the cache to populate.
            for _ in range(50):
                if stream.snapshot("asset-a") is not None:
                    break
                await asyncio.sleep(0.02)

            snap = stream.snapshot("asset-a")
            assert snap is not None
            assert snap["best_bid"] == 0.49
            assert snap["best_ask"] == 0.51

            # Subscribe payload sanity-check
            assert received["subscribe"] == {
                "assets_ids": ["asset-a"],
                "type": "market",
                "initial_dump": True,
                "level": 1,
            }
        finally:
            stop_event.set()
            run_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await run_task


async def test_integration_pings_at_configured_interval():
    """The ping loop should send literal 'PING' frames on the configured interval."""
    handler, received = await _serve_one_message_then_close([])

    async with websockets.serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        url = f"ws://127.0.0.1:{port}"
        stream = PolymarketWSStream(
            ["asset-a"],
            url=url,
            ping_interval=0.05,
            initial_backoff=0.05,
            max_backoff=0.05,
        )

        stop_event = asyncio.Event()
        run_task = asyncio.create_task(stream.run(stop_event=stop_event))
        try:
            # Server's _count_pings loop reads frames for ~0.3s. With our
            # 50ms ping interval the client should send several PINGs in
            # that window; assert at least one to keep this from being
            # flaky on slow CI.
            await asyncio.sleep(0.35)
            assert received["ping_count"] >= 1
        finally:
            stop_event.set()
            run_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await run_task
