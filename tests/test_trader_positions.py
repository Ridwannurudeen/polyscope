"""Tests for get_trader_recent_positions — the trader-detail recent-activity feed."""

import pytest

import aiosqlite

from api.database import (
    SCHEMA,
    get_trader_recent_positions,
    save_divergence_signal,
    save_resolved_market,
    save_signal_trader_positions,
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
    await conn.execute("ALTER TABLE divergence_signals ADD COLUMN expired INTEGER DEFAULT 0")
    await conn.execute("ALTER TABLE divergence_signals ADD COLUMN expired_at TEXT")
    await conn.execute(
        "ALTER TABLE divergence_signals ADD COLUMN signal_source TEXT DEFAULT 'positions'"
    )
    await conn.commit()
    conn.row_factory = aiosqlite.Row
    yield conn
    await conn.close()


async def _signal(db, *, market_id, ts, price=0.30, sm=0.80, direction="YES", resolved=0):
    sid = await save_divergence_signal(
        db,
        {
            "market_id": market_id,
            "timestamp": ts,
            "market_price": price,
            "sm_consensus": sm,
            "divergence_pct": abs(sm - price),
            "score": 70.0,
            "sm_trader_count": 3,
            "sm_direction": direction,
            "question": f"Question about {market_id}?",
            "category": "crypto",
            "signal_source": "positions",
            "neg_risk": 0,
        },
    )
    if resolved:
        await db.execute(
            "UPDATE divergence_signals SET resolved = 1 WHERE id = ?",
            (sid,),
        )
    return sid


@pytest.mark.anyio
async def test_empty_returns_empty_list(db):
    out = await get_trader_recent_positions(db, "0xabc", limit=10)
    assert out == []


@pytest.mark.anyio
async def test_returns_position_with_market_metadata(db):
    sid = await _signal(db, market_id="m1", ts="2026-05-10T12:00:00Z")
    await save_signal_trader_positions(
        db,
        [
            {
                "signal_id": sid,
                "market_id": "m1",
                "trader_address": "0xtrader",
                "trader_rank": 1,
                "position_direction": "NO",
                "position_size": 5_000.0,
                "avg_price": 0.18,
                "weight_in_consensus": 0.4,
                "timestamp": "2026-05-10T12:00:00Z",
            }
        ],
    )
    await db.commit()

    out = await get_trader_recent_positions(db, "0xtrader", limit=10)
    assert len(out) == 1
    row = out[0]
    assert row["market_id"] == "m1"
    assert row["position_direction"] == "NO"
    assert row["position_size"] == 5_000.0
    assert row["avg_price"] == 0.18
    assert row["question"] == "Question about m1?"
    assert row["category"] == "crypto"
    assert row["sm_direction"] == "YES"
    assert row["market_price_at_signal"] == pytest.approx(0.30)
    assert row["sm_consensus"] == pytest.approx(0.80)
    assert row["resolved"] is False
    assert row["correct"] is None
    assert row["outcome"] is None


@pytest.mark.anyio
async def test_dedupes_per_market_keeping_earliest(db):
    """Same trader holding the same position across re-scans appears once."""
    s1 = await _signal(db, market_id="m1", ts="2026-05-10T12:00:00Z")
    s2 = await _signal(db, market_id="m1", ts="2026-05-10T13:00:00Z")
    await save_signal_trader_positions(
        db,
        [
            {
                "signal_id": s1,
                "market_id": "m1",
                "trader_address": "0xtrader",
                "position_direction": "NO",
                "position_size": 5_000.0,
                "avg_price": 0.18,
                "timestamp": "2026-05-10T12:00:00Z",
            },
            {
                "signal_id": s2,
                "market_id": "m1",
                "trader_address": "0xtrader",
                "position_direction": "NO",
                "position_size": 5_500.0,
                "avg_price": 0.19,
                "timestamp": "2026-05-10T13:00:00Z",
            },
        ],
    )
    await db.commit()

    out = await get_trader_recent_positions(db, "0xtrader", limit=10)
    assert len(out) == 1
    # earliest stp row wins
    assert out[0]["signal_id"] == s1
    assert out[0]["avg_price"] == 0.18


@pytest.mark.anyio
async def test_orders_newest_signal_first_across_markets(db):
    s_old = await _signal(db, market_id="m_old", ts="2026-05-01T00:00:00Z")
    s_new = await _signal(db, market_id="m_new", ts="2026-05-10T00:00:00Z")
    s_mid = await _signal(db, market_id="m_mid", ts="2026-05-05T00:00:00Z")
    await save_signal_trader_positions(
        db,
        [
            {
                "signal_id": s_old,
                "market_id": "m_old",
                "trader_address": "0xt",
                "position_direction": "YES",
                "position_size": 1,
                "avg_price": 0.5,
                "timestamp": "2026-05-01T00:00:00Z",
            },
            {
                "signal_id": s_new,
                "market_id": "m_new",
                "trader_address": "0xt",
                "position_direction": "YES",
                "position_size": 1,
                "avg_price": 0.5,
                "timestamp": "2026-05-10T00:00:00Z",
            },
            {
                "signal_id": s_mid,
                "market_id": "m_mid",
                "trader_address": "0xt",
                "position_direction": "YES",
                "position_size": 1,
                "avg_price": 0.5,
                "timestamp": "2026-05-05T00:00:00Z",
            },
        ],
    )
    await db.commit()

    out = await get_trader_recent_positions(db, "0xt", limit=10)
    assert [r["market_id"] for r in out] == ["m_new", "m_mid", "m_old"]


@pytest.mark.anyio
async def test_correct_flag_when_resolved(db):
    """Resolved markets: correct = trader_direction matches outcome."""
    s_yes_win = await _signal(db, market_id="m_yw", ts="2026-05-10T12:00:00Z", resolved=1)
    s_no_win = await _signal(db, market_id="m_nw", ts="2026-05-10T13:00:00Z", resolved=1)
    s_yes_lose = await _signal(db, market_id="m_yl", ts="2026-05-10T14:00:00Z", resolved=1)

    await save_resolved_market(
        db,
        {
            "market_id": "m_yw",
            "question": "q",
            "category": "crypto",
            "final_price": 0.95,
            "outcome": 1,
            "resolved_at": "2026-05-11T00:00:00Z",
            "brier_score": 0.01,
        },
    )
    await save_resolved_market(
        db,
        {
            "market_id": "m_nw",
            "question": "q",
            "category": "crypto",
            "final_price": 0.05,
            "outcome": 0,
            "resolved_at": "2026-05-11T00:00:00Z",
            "brier_score": 0.01,
        },
    )
    await save_resolved_market(
        db,
        {
            "market_id": "m_yl",
            "question": "q",
            "category": "crypto",
            "final_price": 0.05,
            "outcome": 0,
            "resolved_at": "2026-05-11T00:00:00Z",
            "brier_score": 0.81,
        },
    )

    await save_signal_trader_positions(
        db,
        [
            {
                "signal_id": s_yes_win,
                "market_id": "m_yw",
                "trader_address": "0xt",
                "position_direction": "YES",
                "position_size": 1,
                "avg_price": 0.5,
                "timestamp": "2026-05-10T12:00:00Z",
            },
            {
                "signal_id": s_no_win,
                "market_id": "m_nw",
                "trader_address": "0xt",
                "position_direction": "NO",
                "position_size": 1,
                "avg_price": 0.5,
                "timestamp": "2026-05-10T13:00:00Z",
            },
            {
                "signal_id": s_yes_lose,
                "market_id": "m_yl",
                "trader_address": "0xt",
                "position_direction": "YES",
                "position_size": 1,
                "avg_price": 0.5,
                "timestamp": "2026-05-10T14:00:00Z",
            },
        ],
    )
    await db.commit()

    out = await get_trader_recent_positions(db, "0xt", limit=10)
    by_market = {r["market_id"]: r for r in out}
    assert by_market["m_yw"]["resolved"] is True
    assert by_market["m_yw"]["correct"] is True
    assert by_market["m_nw"]["resolved"] is True
    assert by_market["m_nw"]["correct"] is True
    assert by_market["m_yl"]["resolved"] is True
    assert by_market["m_yl"]["correct"] is False


@pytest.mark.anyio
async def test_limit_caps_results(db):
    for i in range(5):
        sid = await _signal(db, market_id=f"m{i}", ts=f"2026-05-{10 + i:02d}T00:00:00Z")
        await save_signal_trader_positions(
            db,
            [
                {
                    "signal_id": sid,
                    "market_id": f"m{i}",
                    "trader_address": "0xt",
                    "position_direction": "YES",
                    "position_size": 1,
                    "avg_price": 0.5,
                    "timestamp": f"2026-05-{10 + i:02d}T00:00:00Z",
                }
            ],
        )
    await db.commit()

    out = await get_trader_recent_positions(db, "0xt", limit=2)
    assert len(out) == 2
    # newest two
    assert [r["market_id"] for r in out] == ["m4", "m3"]


@pytest.mark.anyio
async def test_does_not_return_other_traders_positions(db):
    sid = await _signal(db, market_id="m1", ts="2026-05-10T12:00:00Z")
    await save_signal_trader_positions(
        db,
        [
            {
                "signal_id": sid,
                "market_id": "m1",
                "trader_address": "0xother",
                "position_direction": "YES",
                "position_size": 1,
                "avg_price": 0.5,
                "timestamp": "2026-05-10T12:00:00Z",
            }
        ],
    )
    await db.commit()
    out = await get_trader_recent_positions(db, "0xtrader", limit=10)
    assert out == []
