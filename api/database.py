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

CREATE TABLE IF NOT EXISTS sm_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trader_address TEXT,
    market_id TEXT,
    side TEXT,
    size REAL,
    price REAL,
    trade_timestamp TEXT,
    fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS whale_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trader_address TEXT,
    trader_rank INTEGER,
    market_id TEXT,
    question TEXT,
    side TEXT,
    size REAL,
    price REAL,
    trade_timestamp TEXT,
    detected_at TEXT,
    notified INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bot_subscriptions (
    chat_id INTEGER PRIMARY KEY,
    subscribed_at TEXT,
    min_trade_size REAL DEFAULT 10000,
    active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS trader_category_stats (
    trader_address TEXT,
    category TEXT,
    total_signals INTEGER,
    correct_signals INTEGER,
    PRIMARY KEY (trader_address, category)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_market_ts ON market_snapshots(market_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON market_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_signals_ts ON divergence_signals(timestamp);
CREATE INDEX IF NOT EXISTS idx_signals_market ON divergence_signals(market_id);
CREATE INDEX IF NOT EXISTS idx_sm_market ON sm_positions(market_id);
CREATE INDEX IF NOT EXISTS idx_sm_trader ON sm_positions(trader_address);
CREATE INDEX IF NOT EXISTS idx_sm_trades_market ON sm_trades(market_id);
CREATE INDEX IF NOT EXISTS idx_whale_alerts_detected ON whale_alerts(detected_at);
CREATE INDEX IF NOT EXISTS idx_whale_alerts_notified ON whale_alerts(notified);
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


async def migrate_db(db: aiosqlite.Connection):
    """Run schema migrations for new columns on existing tables."""
    # Check existing columns in divergence_signals
    cursor = await db.execute("PRAGMA table_info(divergence_signals)")
    cols = {row[1] for row in await cursor.fetchall()}

    if "expired" not in cols:
        await db.execute("ALTER TABLE divergence_signals ADD COLUMN expired INTEGER DEFAULT 0")
    if "expired_at" not in cols:
        await db.execute("ALTER TABLE divergence_signals ADD COLUMN expired_at TEXT")
    if "signal_source" not in cols:
        await db.execute("ALTER TABLE divergence_signals ADD COLUMN signal_source TEXT DEFAULT 'positions'")

    await db.commit()


async def init_db():
    db = await get_db()
    try:
        await db.executescript(SCHEMA)
        await db.commit()
        await migrate_db(db)
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
            signal_strength, sm_trader_count, sm_direction, question, category,
            signal_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
            signal.get("signal_source", "positions"),
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
    """Upsert a resolved market (updates brier_score on re-run)."""
    await db.execute(
        """INSERT INTO resolved_markets
           (market_id, question, category, final_price, outcome, resolved_at, brier_score)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(market_id) DO UPDATE SET
               final_price = excluded.final_price,
               brier_score = excluded.brier_score""",
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


# ── Signal Expiration ──────────────────────────────────────


async def expire_converged_signals(
    db: aiosqlite.Connection,
    market_divergences: dict[str, float],
    threshold: float = 0.05,
):
    """Expire active signals where SM consensus has converged back to market price."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()

    for market_id, current_div in market_divergences.items():
        if current_div < threshold:
            await db.execute(
                """UPDATE divergence_signals
                   SET expired = 1, expired_at = ?
                   WHERE market_id = ? AND resolved = 0 AND (expired = 0 OR expired IS NULL)""",
                (now, market_id),
            )


# ── Signal Accuracy (excludes expired) ─────────────────────


async def get_signal_accuracy(db: aiosqlite.Connection) -> dict:
    """Aggregate signal accuracy stats.

    Deduplicates by market_id -- keeps the strongest signal per market so that
    a market scanned 100 times counts as 1 signal, not 100.  This gives an
    honest per-market win rate rather than an inflated/deflated per-row rate.
    Excludes expired signals.
    """
    _BEST_PER_MARKET = """
        WITH best AS (
            SELECT market_id,
                   MAX(signal_strength) AS signal_strength,
                   outcome_correct,
                   sm_direction,
                   timestamp
            FROM divergence_signals
            WHERE resolved = 1 AND outcome_correct IS NOT NULL
                  AND (expired = 0 OR expired IS NULL)
            GROUP BY market_id
        )
    """

    # Overall
    cursor = await db.execute(
        _BEST_PER_MARKET +
        """SELECT
               COUNT(*) as total,
               SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) as correct,
               AVG(signal_strength) as avg_score
           FROM best"""
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
            _BEST_PER_MARKET +
            """SELECT
                   COUNT(*) as total,
                   SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) as correct
               FROM best
               WHERE signal_strength >= ? AND signal_strength < ?""",
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
        _BEST_PER_MARKET.replace(
            "WHERE resolved = 1",
            "WHERE resolved = 1 AND timestamp >= datetime('now', '-30 days')",
        ) +
        """SELECT
               COUNT(*) as total,
               SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) as correct
           FROM best"""
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


async def get_signal_pnl_simulation(db: aiosqlite.Connection) -> dict:
    """Simulate P&L if $100 was bet on each best-per-market signal.

    If SM said YES at market price 30% and outcome=YES: profit = (1/0.30 - 1) * 100
    If wrong: loss = -100
    Excludes expired signals.
    """
    cursor = await db.execute(
        """WITH best AS (
               SELECT market_id,
                      MAX(signal_strength) AS signal_strength,
                      market_price,
                      sm_consensus,
                      sm_direction,
                      outcome_correct
               FROM divergence_signals
               WHERE resolved = 1 AND outcome_correct IS NOT NULL
                     AND (expired = 0 OR expired IS NULL)
               GROUP BY market_id
           )
           SELECT market_price, sm_direction, outcome_correct
           FROM best"""
    )
    rows = await cursor.fetchall()
    if not rows:
        return {"total_wagered": 0, "total_return": 0, "roi_pct": 0, "avg_odds_on_hits": 0}

    total_wagered = 0.0
    total_return = 0.0
    hit_odds = []
    for r in rows:
        price = r[0]
        direction = r[1]
        correct = r[2]
        total_wagered += 100

        # Odds based on buying the SM-favored side
        if direction == "YES":
            buy_price = max(price, 0.01)
        else:
            buy_price = max(1.0 - price, 0.01)

        if correct == 1:
            payout = (1.0 / buy_price) * 100
            total_return += payout
            hit_odds.append(1.0 / buy_price)
        else:
            total_return += 0  # total loss

    roi_pct = ((total_return - total_wagered) / max(total_wagered, 1)) * 100
    avg_odds = sum(hit_odds) / len(hit_odds) if hit_odds else 0

    return {
        "total_wagered": round(total_wagered, 2),
        "total_return": round(total_return, 2),
        "roi_pct": round(roi_pct, 2),
        "avg_odds_on_hits": round(avg_odds, 2),
    }


async def get_signal_history_for_market(
    db: aiosqlite.Connection, market_id: str, limit: int = 10
) -> list[dict]:
    """Get recent divergence signals for a specific market."""
    cursor = await db.execute(
        """SELECT timestamp, market_price, sm_consensus, divergence_pct,
                  signal_strength, sm_trader_count, sm_direction,
                  resolved, outcome_correct
           FROM divergence_signals
           WHERE market_id = ?
           ORDER BY timestamp DESC LIMIT ?""",
        (market_id, limit),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


# ── SM Trades ──────────────────────────────────────────────


async def save_sm_trades(db: aiosqlite.Connection, trades: list[dict]):
    """Save SM trades to the sm_trades table."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    for t in trades:
        await db.execute(
            """INSERT INTO sm_trades
               (trader_address, market_id, side, size, price, trade_timestamp, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                t["trader_address"],
                t["market_id"],
                t["side"],
                t["size"],
                t["price"],
                t["trade_timestamp"],
                now,
            ),
        )


async def get_recent_sm_trades(
    db: aiosqlite.Connection, market_id: str, hours: int = 48
) -> list[dict]:
    """Get recent SM trades for a market."""
    cursor = await db.execute(
        """SELECT * FROM sm_trades
           WHERE market_id = ? AND fetched_at >= datetime('now', ?)
           ORDER BY trade_timestamp DESC""",
        (market_id, f"-{hours} hours"),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


# ── Whale Alerts ───────────────────────────────────────────


async def save_whale_alert(db: aiosqlite.Connection, alert: dict):
    """Save a whale trade alert."""
    await db.execute(
        """INSERT INTO whale_alerts
           (trader_address, trader_rank, market_id, question, side, size, price,
            trade_timestamp, detected_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            alert["trader_address"],
            alert["trader_rank"],
            alert["market_id"],
            alert.get("question", ""),
            alert["side"],
            alert["size"],
            alert["price"],
            alert["trade_timestamp"],
            alert["detected_at"],
        ),
    )


async def get_whale_alerts(
    db: aiosqlite.Connection, hours: int = 24, min_size: float = 10000
) -> list[dict]:
    """Get recent whale alerts."""
    cursor = await db.execute(
        """SELECT * FROM whale_alerts
           WHERE detected_at >= datetime('now', ?)
                 AND size >= ?
           ORDER BY detected_at DESC""",
        (f"-{hours} hours", min_size),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def get_pending_whale_alerts(db: aiosqlite.Connection) -> list[dict]:
    """Get unnotified whale alerts."""
    cursor = await db.execute(
        """SELECT * FROM whale_alerts
           WHERE notified = 0
           ORDER BY detected_at DESC"""
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def mark_alerts_notified(db: aiosqlite.Connection, alert_ids: list[int]):
    """Mark whale alerts as notified."""
    if not alert_ids:
        return
    placeholders = ",".join("?" * len(alert_ids))
    await db.execute(
        f"UPDATE whale_alerts SET notified = 1 WHERE id IN ({placeholders})",
        alert_ids,
    )


# ── Bot Subscriptions ──────────────────────────────────────


async def save_subscription(db: aiosqlite.Connection, chat_id: int):
    """Subscribe a chat to whale alerts."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """INSERT INTO bot_subscriptions (chat_id, subscribed_at, active)
           VALUES (?, ?, 1)
           ON CONFLICT(chat_id) DO UPDATE SET active = 1, subscribed_at = ?""",
        (chat_id, now, now),
    )


async def remove_subscription(db: aiosqlite.Connection, chat_id: int):
    """Unsubscribe a chat from whale alerts."""
    await db.execute(
        "UPDATE bot_subscriptions SET active = 0 WHERE chat_id = ?",
        (chat_id,),
    )


async def get_active_subscriptions(db: aiosqlite.Connection) -> list[dict]:
    """Get all active bot subscriptions."""
    cursor = await db.execute(
        "SELECT * FROM bot_subscriptions WHERE active = 1"
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


# ── Category Stats ─────────────────────────────────────────


async def rebuild_trader_category_stats(db: aiosqlite.Connection):
    """Rebuild trader accuracy stats per category from resolved signals."""
    await db.execute("DELETE FROM trader_category_stats")

    await db.execute(
        """INSERT INTO trader_category_stats (trader_address, category, total_signals, correct_signals)
           SELECT sp.trader_address, ds.category,
                  COUNT(*) as total_signals,
                  SUM(CASE WHEN ds.outcome_correct = 1 THEN 1 ELSE 0 END) as correct_signals
           FROM divergence_signals ds
           JOIN sm_positions sp ON sp.market_id = ds.market_id
           WHERE ds.resolved = 1 AND ds.outcome_correct IS NOT NULL
                 AND ds.category IS NOT NULL AND ds.category != ''
           GROUP BY sp.trader_address, ds.category"""
    )
    await db.commit()


async def get_category_weights(db: aiosqlite.Connection) -> dict[str, dict[str, float]]:
    """Get category-aware weights for traders.

    Returns {address: {category: weight}} where weight = (correct/total) * 2
    for traders with >= 5 signals in a category, else 1.0 (neutral).
    """
    cursor = await db.execute(
        "SELECT trader_address, category, total_signals, correct_signals FROM trader_category_stats"
    )
    rows = await cursor.fetchall()

    weights: dict[str, dict[str, float]] = {}
    for r in rows:
        addr = r[0]
        cat = r[1]
        total = r[2]
        correct = r[3]

        if addr not in weights:
            weights[addr] = {}

        if total >= 5:
            weights[addr][cat] = (correct / total) * 2
        else:
            weights[addr][cat] = 1.0

    return weights


async def get_expired_signal_count(db: aiosqlite.Connection) -> int:
    """Count expired signals."""
    cursor = await db.execute(
        "SELECT COUNT(*) FROM divergence_signals WHERE expired = 1"
    )
    row = await cursor.fetchone()
    return row[0] or 0
