"""Tests for DB accuracy functions."""

import pytest

import aiosqlite

from api.database import (
    init_db,
    get_signal_accuracy,
    save_divergence_signal,
    save_resolved_market,
    update_signal_outcomes,
    DB_PATH,
    SCHEMA,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def db(tmp_path, monkeypatch):
    """Create a temporary database for testing."""
    test_db = tmp_path / "test.db"
    monkeypatch.setattr("api.database.DB_PATH", test_db)

    conn = await aiosqlite.connect(str(test_db))
    await conn.executescript(SCHEMA)
    await conn.commit()
    conn.row_factory = aiosqlite.Row
    yield conn
    await conn.close()


@pytest.mark.anyio
async def test_save_resolved_market_roundtrip(db):
    market = {
        "market_id": "test-123",
        "question": "Will X happen?",
        "category": "politics",
        "final_price": 0.99,
        "outcome": 1,
        "resolved_at": "2026-03-30T00:00:00Z",
        "brier_score": 0.0001,
    }
    await save_resolved_market(db, market)
    await db.commit()

    cursor = await db.execute("SELECT * FROM resolved_markets WHERE market_id = ?", ("test-123",))
    row = await cursor.fetchone()
    assert row is not None
    assert dict(row)["outcome"] == 1
    assert dict(row)["question"] == "Will X happen?"


@pytest.mark.anyio
async def test_save_resolved_market_idempotent(db):
    market = {
        "market_id": "test-456",
        "question": "Test?",
        "category": "crypto",
        "final_price": 0.01,
        "outcome": 0,
        "resolved_at": "2026-03-30T00:00:00Z",
        "brier_score": 0.02,
    }
    await save_resolved_market(db, market)
    await save_resolved_market(db, market)  # Should not raise
    await db.commit()

    cursor = await db.execute("SELECT COUNT(*) FROM resolved_markets WHERE market_id = ?", ("test-456",))
    row = await cursor.fetchone()
    assert row[0] == 1


@pytest.mark.anyio
async def test_update_signal_outcomes_correct(db):
    """SM said YES, outcome was YES → correct."""
    signal = {
        "market_id": "m1",
        "timestamp": "2026-03-29T12:00:00Z",
        "market_price": 0.50,
        "sm_consensus": 0.80,
        "divergence_pct": 0.30,
        "score": 75.0,
        "sm_trader_count": 5,
        "sm_direction": "YES",
        "question": "Test?",
        "category": "crypto",
    }
    await save_divergence_signal(db, signal)
    await db.commit()

    await update_signal_outcomes(db, "m1", outcome=1)
    await db.commit()

    cursor = await db.execute(
        "SELECT resolved, outcome_correct FROM divergence_signals WHERE market_id = ?",
        ("m1",),
    )
    row = await cursor.fetchone()
    assert row[0] == 1  # resolved
    assert row[1] == 1  # correct


@pytest.mark.anyio
async def test_update_signal_outcomes_incorrect(db):
    """SM said YES, outcome was NO → incorrect."""
    signal = {
        "market_id": "m2",
        "timestamp": "2026-03-29T12:00:00Z",
        "market_price": 0.50,
        "sm_consensus": 0.80,
        "divergence_pct": 0.30,
        "score": 60.0,
        "sm_trader_count": 3,
        "sm_direction": "YES",
        "question": "Test?",
        "category": "crypto",
    }
    await save_divergence_signal(db, signal)
    await db.commit()

    await update_signal_outcomes(db, "m2", outcome=0)
    await db.commit()

    cursor = await db.execute(
        "SELECT resolved, outcome_correct FROM divergence_signals WHERE market_id = ?",
        ("m2",),
    )
    row = await cursor.fetchone()
    assert row[0] == 1
    assert row[1] == 0  # incorrect


@pytest.mark.anyio
async def test_update_signal_outcomes_no_direction_correct(db):
    """SM said NO, outcome was NO → correct."""
    signal = {
        "market_id": "m3",
        "timestamp": "2026-03-29T12:00:00Z",
        "market_price": 0.70,
        "sm_consensus": 0.30,
        "divergence_pct": 0.40,
        "score": 80.0,
        "sm_trader_count": 4,
        "sm_direction": "NO",
        "question": "Test?",
        "category": "sports",
    }
    await save_divergence_signal(db, signal)
    await db.commit()

    await update_signal_outcomes(db, "m3", outcome=0)
    await db.commit()

    cursor = await db.execute(
        "SELECT outcome_correct FROM divergence_signals WHERE market_id = ?",
        ("m3",),
    )
    row = await cursor.fetchone()
    assert row[0] == 1


@pytest.mark.anyio
async def test_get_signal_accuracy_empty(db):
    stats = await get_signal_accuracy(db)
    assert stats["overall"]["total_signals"] == 0
    assert stats["overall"]["win_rate"] == 0.0
    assert stats["by_tier"]["high"]["total"] == 0
    assert stats["rolling_30d"]["total"] == 0


@pytest.mark.anyio
async def test_get_signal_accuracy_populated(db):
    """Insert several resolved signals and check accuracy aggregation."""
    signals = [
        ("m1", 75.0, "YES", 1),   # high tier, correct
        ("m2", 50.0, "YES", 0),   # medium tier, incorrect
        ("m3", 80.0, "NO", 1),    # high tier, incorrect (SM said NO but YES won)
        ("m4", 30.0, "NO", 0),    # low tier, correct
    ]
    for mid, score, direction, outcome in signals:
        correct = 1 if (direction == "YES" and outcome == 1) or (direction == "NO" and outcome == 0) else 0
        await db.execute(
            """INSERT INTO divergence_signals
               (market_id, timestamp, market_price, sm_consensus, divergence_pct,
                signal_strength, sm_trader_count, sm_direction, question, category,
                resolved, outcome_correct)
               VALUES (?, datetime('now'), 0.5, 0.8, 0.3, ?, 3, ?, 'Test', 'crypto', 1, ?)""",
            (mid, score, direction, correct),
        )
    await db.commit()

    stats = await get_signal_accuracy(db)
    assert stats["overall"]["total_signals"] == 4
    assert stats["overall"]["correct"] == 2
    assert stats["overall"]["win_rate"] == 0.5

    assert stats["by_tier"]["high"]["total"] == 2
    assert stats["by_tier"]["high"]["correct"] == 1
    assert stats["by_tier"]["medium"]["total"] == 1
    assert stats["by_tier"]["medium"]["correct"] == 0
    assert stats["by_tier"]["low"]["total"] == 1
    assert stats["by_tier"]["low"]["correct"] == 1
