"""Tests for the WSS runtime singleton (api/wss_runtime.py).

Covers env-gating, idempotent start, delta-driven subscribe/unsubscribe,
and clean shutdown. The PolymarketWSStream itself is replaced with a
fake so these tests don't open real sockets.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from api import wss_runtime


# ── Fixtures ──────────────────────────────────────────────


class _FakeStream:
    """Stand-in for PolymarketWSStream used in wss_runtime tests."""

    def __init__(self, asset_ids: list[str], *, level: int = 1):
        self._asset_ids: set[str] = set(asset_ids)
        self._level = level
        self.subscribe = AsyncMock(side_effect=self._subscribe)
        self.unsubscribe = AsyncMock(side_effect=self._unsubscribe)
        self.run_started = asyncio.Event()
        self.stop_event_seen: asyncio.Event | None = None

    @property
    def asset_ids(self) -> set[str]:
        return set(self._asset_ids)

    @property
    def is_connected(self) -> bool:
        return self.run_started.is_set()

    def snapshot(self, _asset_id: str):
        return None

    def current_price(self, _asset_id: str):
        return None

    async def _subscribe(self, ids):
        self._asset_ids.update(ids)

    async def _unsubscribe(self, ids):
        for aid in ids:
            self._asset_ids.discard(aid)

    async def run(self, stop_event: asyncio.Event | None = None):
        self.stop_event_seen = stop_event or asyncio.Event()
        self.run_started.set()
        await self.stop_event_seen.wait()


@pytest.fixture(autouse=True)
def _reset_runtime():
    wss_runtime._reset_for_tests()
    yield
    wss_runtime._reset_for_tests()


@pytest.fixture
def fake_stream_cls(monkeypatch):
    """Replace PolymarketWSStream inside wss_runtime with the fake."""
    instances: list[_FakeStream] = []

    def factory(*args, **kwargs):
        inst = _FakeStream(*args, **kwargs)
        instances.append(inst)
        return inst

    monkeypatch.setattr(wss_runtime, "PolymarketWSStream", factory)
    return instances


# ── Env gating ────────────────────────────────────────────


def test_is_enabled_default_false(monkeypatch):
    monkeypatch.delenv("POLYSCOPE_WSS_ENABLED", raising=False)
    assert wss_runtime.is_enabled() is False


@pytest.mark.parametrize("val", ["1", "true", "TRUE", "yes", "on"])
def test_is_enabled_accepts_truthy_strings(monkeypatch, val):
    monkeypatch.setenv("POLYSCOPE_WSS_ENABLED", val)
    assert wss_runtime.is_enabled() is True


@pytest.mark.parametrize("val", ["", "0", "false", "no", "off", "junk"])
def test_is_enabled_rejects_other_strings(monkeypatch, val):
    monkeypatch.setenv("POLYSCOPE_WSS_ENABLED", val)
    assert wss_runtime.is_enabled() is False


def test_top_n_default(monkeypatch):
    monkeypatch.delenv("POLYSCOPE_WSS_TOP_N", raising=False)
    assert wss_runtime.top_n() == 100


def test_top_n_env_override(monkeypatch):
    monkeypatch.setenv("POLYSCOPE_WSS_TOP_N", "250")
    assert wss_runtime.top_n() == 250


def test_top_n_invalid_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("POLYSCOPE_WSS_TOP_N", "not-a-number")
    assert wss_runtime.top_n() == 100


# ── Lifecycle ─────────────────────────────────────────────


async def test_refresh_creates_stream_first_time(fake_stream_cls):
    assert wss_runtime.get_stream() is None
    await wss_runtime.refresh_subscription(["a", "b", "c"])
    assert wss_runtime.get_stream() is not None
    assert len(fake_stream_cls) == 1
    assert fake_stream_cls[0].asset_ids == {"a", "b", "c"}
    # Stream task should have actually started
    await asyncio.wait_for(fake_stream_cls[0].run_started.wait(), timeout=1.0)


async def test_refresh_empty_asset_ids_is_no_op(fake_stream_cls):
    await wss_runtime.refresh_subscription([])
    assert wss_runtime.get_stream() is None
    assert fake_stream_cls == []


async def test_refresh_delta_subscribe_unsubscribe(fake_stream_cls):
    await wss_runtime.refresh_subscription(["a", "b", "c"])
    stream = fake_stream_cls[0]
    # Wait for run() to actually start so subscribe calls are meaningful
    await asyncio.wait_for(stream.run_started.wait(), timeout=1.0)

    # New set drops "a", keeps "b" and "c", adds "d" and "e"
    await wss_runtime.refresh_subscription(["b", "c", "d", "e"])
    stream.subscribe.assert_awaited_once_with(["d", "e"])
    stream.unsubscribe.assert_awaited_once_with(["a"])

    # Same set again -> no further subscribe/unsubscribe calls
    stream.subscribe.reset_mock()
    stream.unsubscribe.reset_mock()
    await wss_runtime.refresh_subscription(["b", "c", "d", "e"])
    stream.subscribe.assert_not_awaited()
    stream.unsubscribe.assert_not_awaited()


async def test_stop_stream_clears_singleton(fake_stream_cls):
    await wss_runtime.refresh_subscription(["a"])
    await asyncio.wait_for(fake_stream_cls[0].run_started.wait(), timeout=1.0)

    await wss_runtime.stop_stream()
    assert wss_runtime.get_stream() is None


async def test_stop_stream_is_safe_when_no_stream():
    # No exception even when stream was never started
    await wss_runtime.stop_stream()
    assert wss_runtime.get_stream() is None


async def test_safe_run_swallows_stream_crashes(monkeypatch, caplog):
    """If stream.run() raises, the task ends cleanly and the app survives."""

    class _CrashingStream:
        def __init__(self, *_a, **_kw):
            pass

        @property
        def asset_ids(self):
            return set()

        async def run(self, stop_event=None):
            raise RuntimeError("simulated crash")

    monkeypatch.setattr(wss_runtime, "PolymarketWSStream", _CrashingStream)

    with caplog.at_level("ERROR", logger="api.wss_runtime"):
        await wss_runtime.refresh_subscription(["a"])
        # Let the background task surface the crash
        for _ in range(20):
            await asyncio.sleep(0.01)
            if any("WSS stream crashed" in r.message for r in caplog.records):
                break

    assert any("WSS stream crashed" in r.message for r in caplog.records)
    # No exception propagated to us
