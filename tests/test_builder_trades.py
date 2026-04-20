"""Tests for Phase C builder_trades DB helpers + sync job skip path.

Covers the table + helper functions added in commit 4f41c42. Uses the
same aiosqlite fixture pattern as test_db_accuracy.
"""

from __future__ import annotations

import pytest
import aiosqlite

from api.database import (
    SCHEMA,
    builder_trades_stats,
    list_builder_trades,
    upsert_builder_trade,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def db(tmp_path, monkeypatch):
    test_db = tmp_path / "test.db"
    monkeypatch.setattr("api.database.DB_PATH", test_db)
    conn = await aiosqlite.connect(str(test_db))
    await conn.executescript(SCHEMA)
    # Apply the same migrations the live DB carries so unrelated tables
    # don't error out during schema load.
    await conn.execute(
        "ALTER TABLE divergence_signals ADD COLUMN expired INTEGER DEFAULT 0"
    )
    await conn.execute(
        "ALTER TABLE divergence_signals ADD COLUMN expired_at TEXT"
    )
    await conn.execute(
        "ALTER TABLE divergence_signals ADD COLUMN signal_source TEXT DEFAULT 'positions'"
    )
    await conn.execute(
        "ALTER TABLE follow_alerts ADD COLUMN tg_notified_at TEXT"
    )
    await conn.commit()
    conn.row_factory = aiosqlite.Row
    yield conn
    await conn.close()


@pytest.mark.anyio
async def test_upsert_inserts_new_trade(db):
    trade = {
        "id": "trade-1",
        "market": "0xmarket",
        "asset_id": "0xtoken",
        "side": "BUY",
        "size": 10,
        "price": 0.55,
        "status": "MATCHED",
        "outcome": "YES",
        "owner": "0xabcdef0000000000000000000000000000000001",
        "maker": "0xmaker",
        "builder": "0xbuilder",
        "transactionHash": "0xtx1",
        "matchTime": "2026-04-20T12:00:00Z",
        "fee": "0.01",
        "feeUsdc": 0.01,
    }
    is_new = await upsert_builder_trade(db, trade, raw_json='{"id":"trade-1"}')
    assert is_new is True

    rows = await list_builder_trades(db)
    assert len(rows) == 1
    r = rows[0]
    assert r["trade_id"] == "trade-1"
    assert r["side"] == "BUY"
    assert r["size"] == 10
    assert r["price"] == 0.55
    assert r["notional_usdc"] == 5.5
    assert r["market_id"] == "0xmarket"
    assert r["transaction_hash"] == "0xtx1"


@pytest.mark.anyio
async def test_upsert_updates_existing_trade(db):
    trade = {
        "id": "trade-2",
        "market": "0xmarket",
        "side": "BUY",
        "size": 5,
        "price": 0.4,
        "status": "LIVE",
        "owner": "0xowner",
    }
    first = await upsert_builder_trade(db, trade, raw_json="{}")
    assert first is True

    trade["status"] = "MATCHED"
    trade["outcome"] = "YES"
    second = await upsert_builder_trade(db, trade, raw_json='{"v":2}')
    assert second is False

    rows = await list_builder_trades(db)
    assert len(rows) == 1
    assert rows[0]["status"] == "MATCHED"
    assert rows[0]["outcome"] == "YES"


@pytest.mark.anyio
async def test_upsert_rejects_when_no_trade_id(db):
    ok = await upsert_builder_trade(db, {"side": "BUY"}, raw_json="{}")
    assert ok is False
    rows = await list_builder_trades(db)
    assert rows == []


@pytest.mark.anyio
async def test_list_orders_newest_first_by_match_time(db):
    # Insert out of order; verify list returns newest match_time first
    trades = [
        {"id": "a", "side": "BUY", "size": 1, "price": 0.5,
         "matchTime": "2026-04-19T10:00:00Z", "owner": "0x1"},
        {"id": "b", "side": "BUY", "size": 1, "price": 0.5,
         "matchTime": "2026-04-20T10:00:00Z", "owner": "0x2"},
        {"id": "c", "side": "BUY", "size": 1, "price": 0.5,
         "matchTime": "2026-04-18T10:00:00Z", "owner": "0x3"},
    ]
    for t in trades:
        await upsert_builder_trade(db, t, raw_json="{}")

    rows = await list_builder_trades(db)
    ids = [r["trade_id"] for r in rows]
    assert ids == ["b", "a", "c"]


@pytest.mark.anyio
async def test_stats_aggregates_across_trades(db):
    owners = ["0x1", "0x1", "0x2", "0x3"]  # 3 unique
    for i, owner in enumerate(owners):
        await upsert_builder_trade(
            db,
            {
                "id": f"t-{i}",
                "side": "BUY",
                "size": 10,
                "price": 0.5,
                "feeUsdc": 0.05,
                "owner": owner,
                "matchTime": f"2026-04-20T12:{i:02d}:00Z",
            },
            raw_json="{}",
        )

    stats = await builder_trades_stats(db)
    assert stats["total_trades"] == 4
    assert stats["total_notional_usdc"] == 20.0  # 4 * (10 * 0.5)
    assert stats["total_fees_usdc"] == pytest.approx(0.2)
    assert stats["unique_owners"] == 3


@pytest.mark.anyio
async def test_stats_empty_db(db):
    stats = await builder_trades_stats(db)
    assert stats == {
        "total_trades": 0,
        "total_notional_usdc": 0.0,
        "total_fees_usdc": 0.0,
        "unique_owners": 0,
    }


async def test_sync_attributed_trades_skips_when_unconfigured(monkeypatch):
    """Sync is silent when trading env is missing — no import-time failure."""
    monkeypatch.delenv("POLYMARKET_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("POLYMARKET_FUNDER_ADDRESS", raising=False)
    from api.scheduler import sync_attributed_trades_job

    # Should return cleanly without touching the DB or network
    await sync_attributed_trades_job()
