"""SQLite database with WAL mode for concurrent reads."""

from __future__ import annotations

import logging
from pathlib import Path

import aiosqlite

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent.parent / "data" / "polyscope.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS market_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    question TEXT,
    category TEXT,
    price_yes REAL,
    volume_24h REAL,
    open_interest REAL,
    sm_yes_pct REAL,
    sm_trader_count INTEGER,
    divergence_score REAL
);

CREATE TABLE IF NOT EXISTS resolved_markets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT UNIQUE,
    question TEXT,
    category TEXT,
    final_price REAL,
    outcome INTEGER,
    resolved_at TEXT,
    brier_score REAL
);

CREATE TABLE IF NOT EXISTS sm_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trader_address TEXT,
    market_id TEXT,
    timestamp TEXT,
    position_side TEXT,
    position_size REAL,
    trader_rank INTEGER,
    trader_profit REAL
);

CREATE TABLE IF NOT EXISTS divergence_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT,
    timestamp TEXT,
    market_price REAL,
    sm_consensus REAL,
    divergence_pct REAL,
    signal_strength REAL,
    sm_trader_count INTEGER,
    sm_direction TEXT,
    question TEXT,
    category TEXT,
    resolved INTEGER DEFAULT 0,
    outcome_correct INTEGER
);

CREATE INDEX IF NOT EXISTS idx_snapshots_market_ts ON market_snapshots(market_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON market_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_signals_ts ON divergence_signals(timestamp);
CREATE INDEX IF NOT EXISTS idx_signals_market ON divergence_signals(market_id);
CREATE INDEX IF NOT EXISTS idx_sm_market ON sm_positions(market_id);
CREATE INDEX IF NOT EXISTS idx_sm_trader ON sm_positions(trader_address);
"""


async def get_db() -> aiosqlite.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(DB_PATH))
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA busy_timeout=5000")
    await db.execute("PRAGMA synchronous=NORMAL")
    await db.execute("PRAGMA cache_size=-64000")
    db.row_factory = aiosqlite.Row
    return db


async def init_db():
    db = await get_db()
    try:
        await db.executescript(SCHEMA)
        await db.commit()
        logger.info("Database initialized at %s", DB_PATH)
    finally:
        await db.close()


async def save_snapshot(db: aiosqlite.Connection, snapshot: dict):
    await db.execute(
        """INSERT INTO market_snapshots
           (market_id, timestamp, question, category, price_yes, volume_24h,
            open_interest, sm_yes_pct, sm_trader_count, divergence_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            snapshot["market_id"],
            snapshot["timestamp"],
            snapshot.get("question"),
            snapshot.get("category"),
            snapshot.get("price_yes"),
            snapshot.get("volume_24h"),
            snapshot.get("open_interest"),
            snapshot.get("sm_yes_pct"),
            snapshot.get("sm_trader_count"),
            snapshot.get("divergence_score"),
        ),
    )


async def save_divergence_signal(db: aiosqlite.Connection, signal: dict):
    await db.execute(
        """INSERT INTO divergence_signals
           (market_id, timestamp, market_price, sm_consensus, divergence_pct,
            signal_strength, sm_trader_count, sm_direction, question, category)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            signal["market_id"],
            signal["timestamp"],
            signal["market_price"],
            signal["sm_consensus"],
            signal["divergence_pct"],
            signal["score"],
            signal["sm_trader_count"],
            signal["sm_direction"],
            signal.get("question"),
            signal.get("category"),
        ),
    )


async def get_latest_snapshots(db: aiosqlite.Connection, hours: int = 168) -> list[dict]:
    """Get snapshots from the last N hours."""
    cursor = await db.execute(
        """SELECT * FROM market_snapshots
           WHERE timestamp >= datetime('now', ?)
           ORDER BY timestamp DESC""",
        (f"-{hours} hours",),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def get_divergence_signals(
    db: aiosqlite.Connection, limit: int = 50, hours: int | None = None
) -> list[dict]:
    if hours:
        cursor = await db.execute(
            """SELECT * FROM divergence_signals
               WHERE timestamp >= datetime('now', ?)
               ORDER BY signal_strength DESC LIMIT ?""",
            (f"-{hours} hours", limit),
        )
    else:
        cursor = await db.execute(
            """SELECT * FROM divergence_signals
               ORDER BY timestamp DESC LIMIT ?""",
            (limit,),
        )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def get_divergence_history(
    db: aiosqlite.Connection, limit: int = 100
) -> list[dict]:
    cursor = await db.execute(
        """SELECT * FROM divergence_signals
           WHERE resolved = 1
           ORDER BY timestamp DESC LIMIT ?""",
        (limit,),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def get_resolved_markets(db: aiosqlite.Connection) -> list[dict]:
    cursor = await db.execute(
        "SELECT * FROM resolved_markets ORDER BY resolved_at DESC"
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def cleanup_old_snapshots(db: aiosqlite.Connection, days: int = 30):
    """Remove snapshots older than N days to control DB size."""
    await db.execute(
        "DELETE FROM market_snapshots WHERE timestamp < datetime('now', ?)",
        (f"-{days} days",),
    )
    await db.commit()


async def save_resolved_market(db: aiosqlite.Connection, market: dict):
    """Insert a resolved market (idempotent via INSERT OR IGNORE on unique market_id)."""
    await db.execute(
        """INSERT OR IGNORE INTO resolved_markets
           (market_id, question, category, final_price, outcome, resolved_at, brier_score)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            market["market_id"],
            market.get("question"),
            market.get("category"),
            market["final_price"],
            market["outcome"],
            market["resolved_at"],
            market["brier_score"],
        ),
    )


async def update_signal_outcomes(
    db: aiosqlite.Connection, market_id: str, outcome: int
):
    """Mark all divergence signals for a market as resolved and score correctness.

    SM was correct if:
      sm_direction='YES' AND outcome=1
      sm_direction='NO'  AND outcome=0
    """
    await db.execute(
        """UPDATE divergence_signals
           SET resolved = 1,
               outcome_correct = CASE
                   WHEN (sm_direction = 'YES' AND ? = 1) THEN 1
                   WHEN (sm_direction = 'NO'  AND ? = 0) THEN 1
                   ELSE 0
               END
           WHERE market_id = ? AND resolved = 0""",
        (outcome, outcome, market_id),
    )


async def get_signal_accuracy(db: aiosqlite.Connection) -> dict:
    """Aggregate signal accuracy stats."""
    # Overall
    cursor = await db.execute(
        """SELECT
               COUNT(*) as total,
               SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) as correct,
               AVG(signal_strength) as avg_score
           FROM divergence_signals
           WHERE resolved = 1 AND outcome_correct IS NOT NULL"""
    )
    row = await cursor.fetchone()
    total = row[0] or 0
    correct = row[1] or 0
    avg_score = row[2] or 0.0

    overall = {
        "total_signals": total,
        "correct": correct,
        "win_rate": round(correct / total, 4) if total > 0 else 0.0,
        "avg_score": round(avg_score, 2),
    }

    # By tier (high >= 70, medium 40-70, low < 40)
    by_tier = {}
    for tier, low, high in [("high", 70, 101), ("medium", 40, 70), ("low", 0, 40)]:
        cursor = await db.execute(
            """SELECT
                   COUNT(*) as total,
                   SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) as correct
               FROM divergence_signals
               WHERE resolved = 1 AND outcome_correct IS NOT NULL
                 AND signal_strength >= ? AND signal_strength < ?""",
            (low, high),
        )
        r = await cursor.fetchone()
        t = r[0] or 0
        c = r[1] or 0
        by_tier[tier] = {
            "total": t,
            "correct": c,
            "win_rate": round(c / t, 4) if t > 0 else 0.0,
        }

    # Rolling 30-day
    cursor = await db.execute(
        """SELECT
               COUNT(*) as total,
               SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) as correct
           FROM divergence_signals
           WHERE resolved = 1 AND outcome_correct IS NOT NULL
             AND timestamp >= datetime('now', '-30 days')"""
    )
    r30 = await cursor.fetchone()
    t30 = r30[0] or 0
    c30 = r30[1] or 0

    rolling_30d = {
        "total": t30,
        "correct": c30,
        "win_rate": round(c30 / t30, 4) if t30 > 0 else 0.0,
    }

    return {"overall": overall, "by_tier": by_tier, "rolling_30d": rolling_30d}
