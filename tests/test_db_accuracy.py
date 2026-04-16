"""Tests for DB accuracy functions."""

import pytest

import aiosqlite

from api.database import (
    add_to_watchlist,
    emit_follow_alerts_for_signal,
    expire_converged_signals,
    follow_trader,
    get_expired_signal_count,
    get_follow_alerts,
    get_followed_traders,
    get_metrics_summary,
    get_portfolio,
    get_signal_accuracy,
    get_signal_evidence,
    get_trader_accuracy_leaderboard,
    get_trader_profile,
    get_watchlist,
    init_db,
    is_following,
    link_wallet_to_client,
    mark_alerts_seen,
    rebuild_trader_accuracy,
    record_event,
    record_user_action,
    remove_from_watchlist,
    save_divergence_signal,
    save_resolved_market,
    save_signal_trader_positions,
    unfollow_trader,
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
    # Add migration columns
    await conn.execute("ALTER TABLE divergence_signals ADD COLUMN expired INTEGER DEFAULT 0")
    await conn.execute("ALTER TABLE divergence_signals ADD COLUMN expired_at TEXT")
    await conn.execute("ALTER TABLE divergence_signals ADD COLUMN signal_source TEXT DEFAULT 'positions'")
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
        "signal_source": "positions",
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
        "signal_source": "positions",
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
        "signal_source": "positions",
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
                resolved, outcome_correct, expired, signal_source)
               VALUES (?, datetime('now'), 0.5, 0.8, 0.3, ?, 3, ?, 'Test', 'crypto', 1, ?, 0, 'positions')""",
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

    # All 4 test signals have market_price = 0.5 → tight band
    assert "by_skew" in stats
    assert stats["by_skew"]["tight"]["total"] == 4
    assert stats["by_skew"]["tight"]["correct"] == 2
    assert stats["by_skew"]["very_lopsided"]["total"] == 0


@pytest.mark.anyio
async def test_get_signal_accuracy_skew_breakdown(db):
    """Signals across skew bands are bucketed correctly."""
    cases = [
        ("s1", 0.05, "YES", 1),  # very_lopsided (YES won, market was 5%)
        ("s2", 0.95, "YES", 1),  # very_lopsided
        ("s3", 0.80, "NO", 0),   # lopsided
        ("s4", 0.65, "YES", 1),  # moderate
        ("s5", 0.50, "YES", 1),  # tight
        ("s6", 0.45, "NO", 0),   # tight
    ]
    for mid, price, direction, outcome in cases:
        correct = 1 if (direction == "YES" and outcome == 1) or (direction == "NO" and outcome == 0) else 0
        await db.execute(
            """INSERT INTO divergence_signals
               (market_id, timestamp, market_price, sm_consensus, divergence_pct,
                signal_strength, sm_trader_count, sm_direction, question, category,
                resolved, outcome_correct, expired, signal_source)
               VALUES (?, datetime('now'), ?, 0.8, 0.3, 60, 3, ?, 'Test', 'crypto', 1, ?, 0, 'positions')""",
            (mid, price, direction, correct),
        )
    await db.commit()

    stats = await get_signal_accuracy(db)
    assert stats["by_skew"]["very_lopsided"]["total"] == 2
    assert stats["by_skew"]["lopsided"]["total"] == 1
    assert stats["by_skew"]["moderate"]["total"] == 1
    assert stats["by_skew"]["tight"]["total"] == 2
    assert stats["by_skew"]["tight"]["correct"] == 2
    assert stats["by_skew"]["tight"]["win_rate"] == 1.0


@pytest.mark.anyio
async def test_expire_converged_signals(db):
    """Signals should be expired when divergence drops below threshold."""
    # Insert an active unresolved signal
    signal = {
        "market_id": "m-expire",
        "timestamp": "2026-03-29T12:00:00Z",
        "market_price": 0.50,
        "sm_consensus": 0.80,
        "divergence_pct": 0.30,
        "score": 70.0,
        "sm_trader_count": 5,
        "sm_direction": "YES",
        "question": "Expire test?",
        "category": "crypto",
        "signal_source": "positions",
    }
    await save_divergence_signal(db, signal)
    await db.commit()

    # Current divergence is below threshold — should expire
    await expire_converged_signals(db, {"m-expire": 0.03}, threshold=0.05)
    await db.commit()

    cursor = await db.execute(
        "SELECT expired, expired_at FROM divergence_signals WHERE market_id = ?",
        ("m-expire",),
    )
    row = await cursor.fetchone()
    assert row[0] == 1  # expired
    assert row[1] is not None  # expired_at set


@pytest.mark.anyio
async def test_expire_does_not_touch_resolved(db):
    """Already resolved signals should not be expired."""
    await db.execute(
        """INSERT INTO divergence_signals
           (market_id, timestamp, market_price, sm_consensus, divergence_pct,
            signal_strength, sm_trader_count, sm_direction, question, category,
            resolved, outcome_correct, expired, signal_source)
           VALUES ('m-resolved', datetime('now'), 0.5, 0.8, 0.3, 70, 3, 'YES',
                   'Test', 'crypto', 1, 1, 0, 'positions')""",
    )
    await db.commit()

    await expire_converged_signals(db, {"m-resolved": 0.02}, threshold=0.05)
    await db.commit()

    cursor = await db.execute(
        "SELECT expired FROM divergence_signals WHERE market_id = ?",
        ("m-resolved",),
    )
    row = await cursor.fetchone()
    assert row[0] == 0  # should NOT be expired (already resolved)


@pytest.mark.anyio
async def test_expired_signals_excluded_from_accuracy(db):
    """Expired signals should not count toward accuracy stats."""
    # Insert a correct expired signal and a correct non-expired signal
    for mid, expired in [("m-exp", 1), ("m-active", 0)]:
        await db.execute(
            """INSERT INTO divergence_signals
               (market_id, timestamp, market_price, sm_consensus, divergence_pct,
                signal_strength, sm_trader_count, sm_direction, question, category,
                resolved, outcome_correct, expired, signal_source)
               VALUES (?, datetime('now'), 0.5, 0.8, 0.3, 70, 3, 'YES',
                       'Test', 'crypto', 1, 1, ?, 'positions')""",
            (mid, expired),
        )
    await db.commit()

    stats = await get_signal_accuracy(db)
    # Only m-active should count
    assert stats["overall"]["total_signals"] == 1
    assert stats["overall"]["correct"] == 1


@pytest.mark.anyio
async def test_get_expired_signal_count(db):
    for mid, expired in [("e1", 1), ("e2", 1), ("e3", 0)]:
        await db.execute(
            """INSERT INTO divergence_signals
               (market_id, timestamp, market_price, sm_consensus, divergence_pct,
                signal_strength, sm_trader_count, sm_direction, question, category,
                expired, signal_source)
               VALUES (?, datetime('now'), 0.5, 0.8, 0.3, 50, 3, 'YES',
                       'Test', 'crypto', ?, 'positions')""",
            (mid, expired),
        )
    await db.commit()

    count = await get_expired_signal_count(db)
    assert count == 2


@pytest.mark.anyio
async def test_save_divergence_signal_returns_id(db):
    signal = {
        "market_id": "m1",
        "timestamp": "2026-04-12T00:00:00+00:00",
        "market_price": 0.6,
        "sm_consensus": 0.8,
        "divergence_pct": 0.2,
        "score": 75.0,
        "sm_trader_count": 3,
        "sm_direction": "NO",
        "question": "Test?",
        "category": "crypto",
        "signal_source": "positions",
    }
    signal_id = await save_divergence_signal(db, signal)
    await db.commit()
    assert signal_id > 0


@pytest.mark.anyio
async def test_save_signal_trader_positions_roundtrip(db):
    signal = {
        "market_id": "m1",
        "timestamp": "2026-04-12T00:00:00+00:00",
        "market_price": 0.6,
        "sm_consensus": 0.8,
        "divergence_pct": 0.2,
        "score": 75.0,
        "sm_trader_count": 2,
        "sm_direction": "NO",
        "question": "Test?",
        "category": "crypto",
        "signal_source": "positions",
    }
    signal_id = await save_divergence_signal(db, signal)
    records = [
        {
            "signal_id": signal_id,
            "market_id": "m1",
            "trader_address": "0xaaa",
            "trader_rank": 1,
            "position_direction": "YES",
            "position_size": 5000.0,
            "avg_price": 0.7,
            "weight_in_consensus": 1.5,
            "timestamp": "2026-04-12T00:00:00+00:00",
        },
        {
            "signal_id": signal_id,
            "market_id": "m1",
            "trader_address": "0xbbb",
            "trader_rank": 5,
            "position_direction": "NO",
            "position_size": 2000.0,
            "avg_price": 0.3,
            "weight_in_consensus": 0.4,
            "timestamp": "2026-04-12T00:00:00+00:00",
        },
    ]
    await save_signal_trader_positions(db, records)
    await db.commit()

    cursor = await db.execute(
        "SELECT trader_address, position_direction, position_size FROM signal_trader_positions WHERE signal_id = ?",
        (signal_id,),
    )
    rows = await cursor.fetchall()
    assert len(rows) == 2
    by_addr = {r[0]: r for r in rows}
    assert by_addr["0xaaa"][1] == "YES"
    assert by_addr["0xaaa"][2] == 5000.0
    assert by_addr["0xbbb"][1] == "NO"


@pytest.mark.anyio
async def test_save_signal_trader_positions_empty_is_noop(db):
    await save_signal_trader_positions(db, [])
    cursor = await db.execute("SELECT COUNT(*) FROM signal_trader_positions")
    row = await cursor.fetchone()
    assert row[0] == 0


async def _seed_signal_with_traders(
    db, market_id: str, market_price: float, category: str,
    trader_directions: list[tuple[str, str]],  # (address, YES|NO)
):
    """Helper: insert a signal + resolved market + per-trader rows."""
    signal = {
        "market_id": market_id,
        "timestamp": "2026-04-12T00:00:00+00:00",
        "market_price": market_price,
        "sm_consensus": 0.8 if market_price < 0.5 else 0.2,
        "divergence_pct": 0.2,
        "score": 75.0,
        "sm_trader_count": len(trader_directions),
        "sm_direction": "NO",
        "question": "Test?",
        "category": category,
        "signal_source": "positions",
    }
    signal_id = await save_divergence_signal(db, signal)
    await save_signal_trader_positions(
        db,
        [
            {
                "signal_id": signal_id,
                "market_id": market_id,
                "trader_address": addr,
                "trader_rank": 1,
                "position_direction": direction,
                "position_size": 5000.0,
                "avg_price": 0.5,
                "weight_in_consensus": 1.0,
                "timestamp": "2026-04-12T00:00:00+00:00",
            }
            for addr, direction in trader_directions
        ],
    )
    # Mark signal resolved so rebuild picks it up
    await db.execute(
        "UPDATE divergence_signals SET resolved = 1 WHERE id = ?",
        (signal_id,),
    )
    return signal_id


@pytest.mark.anyio
async def test_rebuild_trader_accuracy_basic(db):
    # Seed: 2 signals, 2 traders.
    # 0xaaa: always picks YES on markets that resolve YES → 100% accurate
    # 0xbbb: always picks NO on markets that resolve YES → 0% accurate
    await _seed_signal_with_traders(
        db, "m1", 0.6, "crypto",
        [("0xaaa", "YES"), ("0xbbb", "NO")],
    )
    await _seed_signal_with_traders(
        db, "m2", 0.6, "crypto",
        [("0xaaa", "YES"), ("0xbbb", "NO")],
    )
    await save_resolved_market(db, {
        "market_id": "m1", "question": "", "category": "crypto",
        "final_price": 0.99, "outcome": 1, "resolved_at": "", "brier_score": 0,
    })
    await save_resolved_market(db, {
        "market_id": "m2", "question": "", "category": "crypto",
        "final_price": 0.99, "outcome": 1, "resolved_at": "", "brier_score": 0,
    })
    await db.commit()

    updated = await rebuild_trader_accuracy(db)
    assert updated == 2
    await db.commit()

    profile_a = await get_trader_profile(db, "0xaaa")
    profile_b = await get_trader_profile(db, "0xbbb")
    assert profile_a["accuracy_pct"] == 100.0
    assert profile_a["correct_predictions"] == 2
    assert profile_b["accuracy_pct"] == 0.0
    assert profile_b["wrong_predictions"] == 2


@pytest.mark.anyio
async def test_rebuild_trader_accuracy_dedupes_repeat_signals(db):
    """Same (trader, market) across many scan cycles counts once, not N times."""
    # One market, one trader, but 5 signals over time (same divergent position).
    for _ in range(5):
        await _seed_signal_with_traders(
            db, "m1", 0.6, "crypto", [("0xrepeat", "YES")],
        )
    await save_resolved_market(db, {
        "market_id": "m1", "question": "", "category": "crypto",
        "final_price": 0.99, "outcome": 1, "resolved_at": "", "brier_score": 0,
    })
    await db.commit()

    await rebuild_trader_accuracy(db)
    await db.commit()

    profile = await get_trader_profile(db, "0xrepeat")
    # 5 re-signals of the same divergent position → 1 prediction
    assert profile["total_divergent_signals"] == 1
    assert profile["correct_predictions"] == 1
    assert profile["accuracy_pct"] == 100.0


@pytest.mark.anyio
async def test_trader_leaderboard_ordering(db):
    # High accuracy trader
    for i in range(10):
        await _seed_signal_with_traders(
            db, f"m{i}", 0.6, "crypto", [("0xgood", "YES")],
        )
        await save_resolved_market(db, {
            "market_id": f"m{i}", "question": "", "category": "crypto",
            "final_price": 0.99, "outcome": 1, "resolved_at": "", "brier_score": 0,
        })
    # Low accuracy trader
    for i in range(10, 20):
        await _seed_signal_with_traders(
            db, f"m{i}", 0.6, "crypto", [("0xbad", "NO")],
        )
        await save_resolved_market(db, {
            "market_id": f"m{i}", "question": "", "category": "crypto",
            "final_price": 0.99, "outcome": 1, "resolved_at": "", "brier_score": 0,
        })
    await db.commit()

    await rebuild_trader_accuracy(db)
    await db.commit()

    predictive = await get_trader_accuracy_leaderboard(db, order="predictive", min_signals=5)
    anti = await get_trader_accuracy_leaderboard(db, order="anti-predictive", min_signals=5)

    assert predictive[0]["trader_address"] == "0xgood"
    assert predictive[0]["accuracy_pct"] == 100.0
    assert anti[0]["trader_address"] == "0xbad"
    assert anti[0]["accuracy_pct"] == 0.0


@pytest.mark.anyio
async def test_trader_leaderboard_respects_min_signals(db):
    # Trader with only 2 signals should not appear when min_signals=5
    await _seed_signal_with_traders(db, "m1", 0.6, "crypto", [("0xlow", "YES")])
    await _seed_signal_with_traders(db, "m2", 0.6, "crypto", [("0xlow", "YES")])
    await save_resolved_market(db, {
        "market_id": "m1", "question": "", "category": "crypto",
        "final_price": 0.99, "outcome": 1, "resolved_at": "", "brier_score": 0,
    })
    await save_resolved_market(db, {
        "market_id": "m2", "question": "", "category": "crypto",
        "final_price": 0.99, "outcome": 1, "resolved_at": "", "brier_score": 0,
    })
    await db.commit()

    await rebuild_trader_accuracy(db)
    await db.commit()

    result = await get_trader_accuracy_leaderboard(db, min_signals=5)
    assert len(result) == 0


@pytest.mark.anyio
async def test_rebuild_returns_zero_without_data(db):
    updated = await rebuild_trader_accuracy(db)
    assert updated == 0


@pytest.mark.anyio
async def test_get_signal_evidence_returns_none_for_missing_market(db):
    result = await get_signal_evidence(db, "nonexistent")
    assert result is None


@pytest.mark.anyio
async def test_get_signal_evidence_full_trail(db):
    # Seed a signal with traders + resolved market
    signal_id = await _seed_signal_with_traders(
        db, "mev1", 0.65, "crypto",
        [("0xaaa", "YES"), ("0xbbb", "NO")],
    )
    await save_resolved_market(db, {
        "market_id": "mev1", "question": "Test?", "category": "crypto",
        "final_price": 0.99, "outcome": 1, "resolved_at": "", "brier_score": 0,
    })
    # Seed a sibling category signal so we have category stats
    signal2_id = await _seed_signal_with_traders(
        db, "mev2", 0.7, "crypto", [("0xaaa", "YES")],
    )
    await save_resolved_market(db, {
        "market_id": "mev2", "question": "Test?", "category": "crypto",
        "final_price": 0.99, "outcome": 1, "resolved_at": "", "brier_score": 0,
    })
    # Score the resolved signals' outcomes
    await db.execute(
        "UPDATE divergence_signals SET outcome_correct = 1 WHERE id IN (?, ?)",
        (signal_id, signal2_id),
    )
    await db.commit()

    evidence = await get_signal_evidence(db, "mev1")
    assert evidence is not None
    assert evidence["signal"]["market_id"] == "mev1"
    assert len(evidence["contributors"]) == 2
    # skew: 0.65 falls into moderate (0.6-0.75)
    assert evidence["skew"]["band"] == "moderate"
    assert evidence["category"]["name"] == "crypto"


@pytest.mark.anyio
async def test_watchlist_add_returns_none_without_signal(db):
    result = await add_to_watchlist(db, "client1", "no-such-market")
    assert result is None


@pytest.mark.anyio
async def test_watchlist_add_and_list(db):
    # Seed a signal
    await _seed_signal_with_traders(
        db, "mw1", 0.6, "crypto", [("0xaaa", "YES")]
    )
    await db.commit()

    result = await add_to_watchlist(db, "client1", "mw1")
    await db.commit()
    assert result is not None
    assert result["market_id"] == "mw1"

    items = await get_watchlist(db, "client1")
    assert len(items) == 1
    assert items[0]["market_id"] == "mw1"
    assert items[0]["sm_direction_at_add"] is not None


@pytest.mark.anyio
async def test_watchlist_idempotent(db):
    await _seed_signal_with_traders(
        db, "mw2", 0.6, "crypto", [("0xaaa", "YES")]
    )
    await db.commit()

    first = await add_to_watchlist(db, "client1", "mw2")
    await db.commit()
    second = await add_to_watchlist(db, "client1", "mw2")
    await db.commit()

    items = await get_watchlist(db, "client1")
    assert len(items) == 1
    assert first["id"] == second["id"]


@pytest.mark.anyio
async def test_watchlist_scoped_by_client(db):
    await _seed_signal_with_traders(
        db, "mw3", 0.6, "crypto", [("0xaaa", "YES")]
    )
    await db.commit()

    await add_to_watchlist(db, "alice", "mw3")
    await db.commit()

    alice_items = await get_watchlist(db, "alice")
    bob_items = await get_watchlist(db, "bob")
    assert len(alice_items) == 1
    assert len(bob_items) == 0


@pytest.mark.anyio
async def test_link_wallet_migrates_history(db):
    """Linking a wallet backfills wallet_address on prior anonymous rows."""
    wallet = "0x" + "a" * 40
    # Pre-link actions
    await _seed_signal_with_traders(
        db, "lm1", 0.6, "crypto", [("0xfff", "YES")]
    )
    await db.commit()
    await add_to_watchlist(db, "client-xyz", "lm1")
    await record_user_action(
        db, "client-xyz", "lm1", "YES", size=50, price=0.6
    )
    await db.commit()

    result = await link_wallet_to_client(db, "client-xyz", wallet)
    await db.commit()

    assert result["wallet_address"] == wallet.lower()
    assert result["watchlist_migrated"] == 1
    assert result["user_actions_migrated"] == 1

    # Second link is idempotent — no new migrations
    result2 = await link_wallet_to_client(db, "client-xyz", wallet)
    await db.commit()
    assert result2["watchlist_migrated"] == 0
    assert result2["user_actions_migrated"] == 0


@pytest.mark.anyio
async def test_get_watchlist_resolves_by_wallet_after_link(db):
    wallet = "0x" + "b" * 40
    await _seed_signal_with_traders(
        db, "lm2", 0.6, "crypto", [("0xfff", "YES")]
    )
    await db.commit()
    await add_to_watchlist(db, "client-old", "lm2")
    await db.commit()
    await link_wallet_to_client(db, "client-old", wallet)
    await db.commit()

    # A new device with a different client_id but the same wallet sees the
    # migrated history
    items = await get_watchlist(db, "client-new", wallet_address=wallet)
    assert len(items) == 1
    assert items[0]["market_id"] == "lm2"


@pytest.mark.anyio
async def test_watchlist_remove_only_own(db):
    await _seed_signal_with_traders(
        db, "mw4", 0.6, "crypto", [("0xaaa", "YES")]
    )
    await db.commit()
    result = await add_to_watchlist(db, "alice", "mw4")
    await db.commit()

    # Bob can't remove Alice's
    ok = await remove_from_watchlist(db, "bob", result["id"])
    await db.commit()
    assert ok is False

    # Alice can
    ok = await remove_from_watchlist(db, "alice", result["id"])
    await db.commit()
    assert ok is True


@pytest.mark.anyio
async def test_portfolio_scores_resolved_actions(db):
    # Seed resolved market
    await _seed_signal_with_traders(
        db, "pf1", 0.6, "crypto", [("0xaaa", "YES")]
    )
    await save_resolved_market(db, {
        "market_id": "pf1", "question": "", "category": "crypto",
        "final_price": 0.99, "outcome": 1, "resolved_at": "", "brier_score": 0,
    })
    await db.commit()

    # User bought YES at 0.5 for 100 shares — correct call
    await record_user_action(
        db, "client1", "pf1", "YES", size=100.0, price=0.5
    )
    await db.commit()

    port = await get_portfolio(db, "client1")
    assert port["stats"]["total_actions"] == 1
    assert port["stats"]["resolved_actions"] == 1
    assert port["stats"]["correct"] == 1
    assert port["stats"]["win_rate_pct"] == 100.0
    # $100 @ $0.5 → win $0.5/share → $50 profit
    assert port["stats"]["pnl_estimate_usd"] == 50.0


@pytest.mark.anyio
async def test_record_event_roundtrip(db):
    await record_event(
        db,
        event_type="page_view",
        client_id="c1",
        properties={"section": "home"},
        path="/",
        referrer=None,
    )
    await db.commit()

    cursor = await db.execute(
        "SELECT client_id, event_type, path, properties FROM events"
    )
    row = await cursor.fetchone()
    assert row is not None
    assert row[0] == "c1"
    assert row[1] == "page_view"
    assert row[2] == "/"
    assert "home" in (row[3] or "")


@pytest.mark.anyio
async def test_record_event_accepts_anonymous(db):
    await record_event(db, event_type="page_view", path="/methodology")
    await db.commit()
    cursor = await db.execute("SELECT COUNT(*) FROM events")
    assert (await cursor.fetchone())[0] == 1


@pytest.mark.anyio
async def test_metrics_summary_aggregates_events(db):
    for i in range(3):
        await record_event(
            db, event_type="page_view", client_id=f"c{i}", path="/"
        )
        await record_event(
            db, event_type="evidence_opened", client_id=f"c{i}",
            properties={"market_id": f"m{i}"},
        )
    await db.commit()

    summary = await get_metrics_summary(db, days=7)
    assert summary["actives"]["all_time"] == 3
    assert summary["actives"]["total_events"] == 6
    # Top events should surface our two types
    types = {e["event_type"] for e in summary["top_events"]}
    assert "page_view" in types
    assert "evidence_opened" in types


@pytest.mark.anyio
async def test_metrics_portfolio_counts(db):
    await _seed_signal_with_traders(
        db, "ms1", 0.6, "crypto", [("0xaaa", "YES")]
    )
    await db.commit()
    await add_to_watchlist(db, "alice", "ms1")
    await record_user_action(db, "alice", "ms1", "YES", size=10, price=0.5)
    await db.commit()

    summary = await get_metrics_summary(db, days=7)
    assert summary["portfolio"]["watchlist_total"] == 1
    assert summary["portfolio"]["watchlist_clients"] == 1
    assert summary["portfolio"]["actions_total"] == 1
    assert summary["portfolio"]["actions_clients"] == 1


async def _insert_signal(
    db, market_id, market_price, sm_consensus, divergence_pct,
    sm_direction, *, offset_seconds=0, resolved=0, expired=0,
):
    """Insert a raw divergence_signals row with exact control over fields."""
    await db.execute(
        """INSERT INTO divergence_signals
           (market_id, timestamp, market_price, sm_consensus, divergence_pct,
            signal_strength, sm_trader_count, sm_direction, question, category,
            resolved, expired, signal_source)
           VALUES (?, datetime('now', ?), ?, ?, ?, 60, 3, ?, 'Test?', 'crypto',
                   ?, ?, 'positions')""",
        (market_id, f"+{offset_seconds} seconds", market_price, sm_consensus,
         divergence_pct, sm_direction, resolved, expired),
    )


@pytest.mark.anyio
async def test_invalidation_converged(db):
    """Divergence fading below 5% (same direction) marks as converged."""
    await _insert_signal(db, "mv1", 0.60, 0.80, 0.20, "YES")
    await db.commit()
    await add_to_watchlist(db, "c1", "mv1")
    await _insert_signal(
        db, "mv1", 0.60, 0.62, 0.02, "YES", offset_seconds=3600
    )
    await db.commit()

    items = await get_watchlist(db, "c1")
    assert len(items) == 1
    assert items[0]["invalidation"] is not None
    assert items[0]["invalidation"]["reason"] == "converged"


@pytest.mark.anyio
async def test_invalidation_direction_flipped(db):
    """When latest sm_direction differs from at-add direction, flag flipped."""
    await _insert_signal(db, "mf1", 0.55, 0.80, 0.25, "YES")
    await db.commit()
    await add_to_watchlist(db, "c2", "mf1")
    await _insert_signal(
        db, "mf1", 0.55, 0.20, 0.35, "NO", offset_seconds=7200
    )
    await db.commit()

    items = await get_watchlist(db, "c2")
    assert items[0]["invalidation"]["reason"] == "direction_flipped"


@pytest.mark.anyio
async def test_invalidation_resolved_wrong(db):
    """Resolved markets where at-add direction lost flag as resolved_wrong."""
    await _insert_signal(db, "mr1", 0.40, 0.70, 0.30, "YES")
    await db.commit()
    await add_to_watchlist(db, "c3", "mr1")
    await save_resolved_market(db, {
        "market_id": "mr1", "question": "", "category": "crypto",
        "final_price": 0.02, "outcome": 0, "resolved_at": "", "brier_score": 0,
    })
    await db.commit()

    items = await get_watchlist(db, "c3")
    assert items[0]["invalidation"]["reason"] == "resolved_wrong"
    assert items[0]["outcome_matched_direction"] is False


@pytest.mark.anyio
async def test_invalidation_none_when_healthy(db):
    """Fresh unresolved signal with active divergence returns no invalidation."""
    await _insert_signal(db, "mh1", 0.55, 0.80, 0.25, "YES")
    await db.commit()
    await add_to_watchlist(db, "c4", "mh1")
    await db.commit()

    items = await get_watchlist(db, "c4")
    assert items[0]["invalidation"] is None


@pytest.mark.anyio
async def test_follow_unfollow_roundtrip(db):
    trader = "0x" + "c" * 40
    client = "client-follower"

    assert await is_following(db, trader, client) is False

    await follow_trader(db, trader, client)
    await db.commit()

    assert await is_following(db, trader, client) is True

    # Idempotent — calling follow again shouldn't duplicate
    await follow_trader(db, trader, client)
    await db.commit()

    items = await get_followed_traders(db, client)
    assert len(items) == 1
    assert items[0]["trader_address"] == trader

    # Unfollow
    removed = await unfollow_trader(db, trader, client)
    await db.commit()
    assert removed is True
    assert await is_following(db, trader, client) is False


@pytest.mark.anyio
async def test_follow_survives_wallet_link(db):
    """Follows created under client_id should remain attached after linking."""
    trader = "0x" + "d" * 40
    wallet = "0x" + "e" * 40

    await follow_trader(db, trader, "client-early")
    await db.commit()

    # Link wallet → should backfill the follow row
    result = await link_wallet_to_client(db, "client-early", wallet)
    await db.commit()
    assert result["follows_migrated"] == 1

    # Verify follow still resolves via wallet on a new client_id
    assert (
        await is_following(db, trader, "client-new", wallet_address=wallet)
        is True
    )


@pytest.mark.anyio
async def test_follow_alerts_fan_out_and_dedup(db):
    trader = "0x" + "f" * 40
    client = "client-alert-watch"

    await follow_trader(db, trader, client)
    await db.commit()

    # Seed a signal with that trader as a contributor
    signal_id = await _seed_signal_with_traders(
        db, "fm1", 0.6, "crypto", [(trader, "YES"), ("0xother", "NO")]
    )
    await db.commit()

    # Emit alerts — should create one alert for the follower on (fm1, trader)
    contributions = [
        {"trader_address": trader, "position_direction": "YES"},
        {"trader_address": "0xother", "position_direction": "NO"},
    ]
    created = await emit_follow_alerts_for_signal(
        db, signal_id, "fm1", contributions
    )
    await db.commit()
    assert created == 1

    # Re-emit for same market — dedup by (follower, market, trader)
    signal_id_2 = await _seed_signal_with_traders(
        db, "fm1", 0.6, "crypto", [(trader, "YES")]
    )
    await db.commit()
    created = await emit_follow_alerts_for_signal(
        db, signal_id_2, "fm1", [{"trader_address": trader, "position_direction": "YES"}]
    )
    await db.commit()
    assert created == 0

    items = await get_follow_alerts(db, client)
    assert len(items) == 1
    assert items[0]["trader_address"] == trader
    assert items[0]["market_id"] == "fm1"
    assert items[0]["seen_at"] is None


@pytest.mark.anyio
async def test_follow_alerts_mark_seen(db):
    trader = "0x" + "1" * 40
    client = "client-seen"
    await follow_trader(db, trader, client)
    signal_id = await _seed_signal_with_traders(
        db, "sn1", 0.55, "crypto", [(trader, "YES")]
    )
    await emit_follow_alerts_for_signal(
        db, signal_id, "sn1", [{"trader_address": trader, "position_direction": "YES"}]
    )
    await db.commit()

    unseen = await get_follow_alerts(db, client, unseen_only=True)
    assert len(unseen) == 1

    marked = await mark_alerts_seen(db, client)
    await db.commit()
    assert marked == 1

    unseen_after = await get_follow_alerts(db, client, unseen_only=True)
    assert len(unseen_after) == 0


@pytest.mark.anyio
async def test_portfolio_handles_wrong_call(db):
    await _seed_signal_with_traders(
        db, "pf2", 0.4, "crypto", [("0xaaa", "NO")]
    )
    await save_resolved_market(db, {
        "market_id": "pf2", "question": "", "category": "crypto",
        "final_price": 0.99, "outcome": 1, "resolved_at": "", "brier_score": 0,
    })
    await db.commit()

    # User bought NO at 0.6 for 100 shares — wrong call, market resolved YES
    await record_user_action(
        db, "client2", "pf2", "NO", size=100.0, price=0.6
    )
    await db.commit()

    port = await get_portfolio(db, "client2")
    assert port["stats"]["correct"] == 0
    assert port["stats"]["win_rate_pct"] == 0.0
    # Paid 100 * 0.6 = 60, lost it all
    assert port["stats"]["pnl_estimate_usd"] == -60.0


@pytest.mark.anyio
async def test_get_signal_evidence_contributors_ordered_by_weight(db):
    signal_id = await _seed_signal_with_traders(
        db, "mev3", 0.65, "crypto",
        [("0xlow", "YES"), ("0xhigh", "NO")],
    )
    # Manually override weights to have clear ordering
    await db.execute(
        "UPDATE signal_trader_positions SET weight_in_consensus = 0.1 WHERE trader_address = '0xlow'",
    )
    await db.execute(
        "UPDATE signal_trader_positions SET weight_in_consensus = 5.0 WHERE trader_address = '0xhigh'",
    )
    await db.commit()

    evidence = await get_signal_evidence(db, "mev3")
    assert evidence["contributors"][0]["trader_address"] == "0xhigh"
    assert evidence["contributors"][1]["trader_address"] == "0xlow"
