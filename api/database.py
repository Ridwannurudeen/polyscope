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

-- Links a Telegram chat to a web identity (client_id + optional wallet)
-- so the bot can DM follow-trader alerts to the right user.
CREATE TABLE IF NOT EXISTS bot_identity_links (
    chat_id INTEGER PRIMARY KEY,
    client_id TEXT,
    wallet_address TEXT,
    created_at TEXT,
    last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS trader_category_stats (
    trader_address TEXT,
    category TEXT,
    total_signals INTEGER,
    correct_signals INTEGER,
    PRIMARY KEY (trader_address, category)
);

CREATE TABLE IF NOT EXISTS signal_trader_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id INTEGER NOT NULL,
    market_id TEXT NOT NULL,
    trader_address TEXT NOT NULL,
    trader_rank INTEGER,
    position_direction TEXT,
    position_size REAL,
    avg_price REAL,
    weight_in_consensus REAL,
    timestamp TEXT,
    FOREIGN KEY (signal_id) REFERENCES divergence_signals(id)
);

CREATE TABLE IF NOT EXISTS trader_accuracy (
    trader_address TEXT PRIMARY KEY,
    total_divergent_signals INTEGER DEFAULT 0,
    correct_predictions INTEGER DEFAULT 0,
    wrong_predictions INTEGER DEFAULT 0,
    accuracy_pct REAL,
    accuracy_by_skew TEXT,
    accuracy_by_category TEXT,
    last_updated TEXT
);

CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    signal_id_at_add INTEGER,
    sm_direction_at_add TEXT,
    market_price_at_add REAL,
    sm_consensus_at_add REAL,
    divergence_pct_at_add REAL,
    question TEXT,
    category TEXT,
    added_at TEXT,
    wallet_address TEXT,
    UNIQUE(client_id, market_id)
);

CREATE TABLE IF NOT EXISTS user_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    watchlist_id INTEGER,
    action_direction TEXT,
    size REAL,
    price REAL,
    acted_at TEXT,
    wallet_address TEXT,
    FOREIGN KEY (watchlist_id) REFERENCES watchlist(id)
);

CREATE TABLE IF NOT EXISTS wallets (
    wallet_address TEXT PRIMARY KEY,
    client_id TEXT,
    first_seen_at TEXT,
    last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS trader_follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_wallet TEXT,
    follower_client_id TEXT,
    trader_address TEXT NOT NULL,
    followed_at TEXT NOT NULL,
    UNIQUE(follower_wallet, trader_address),
    UNIQUE(follower_client_id, trader_address)
);

-- Notifications sent to followers when their followed trader enters a
-- new divergent position. Deduped by (follower, trader, market) so the
-- scheduler's ~50× re-signals of the same position don't spam alerts.
-- seen_at marks whether the follower has acknowledged it.
CREATE TABLE IF NOT EXISTS follow_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_wallet TEXT,
    follower_client_id TEXT,
    trader_address TEXT NOT NULL,
    signal_id INTEGER NOT NULL,
    market_id TEXT NOT NULL,
    position_direction TEXT,
    created_at TEXT NOT NULL,
    seen_at TEXT,
    UNIQUE(follower_wallet, market_id, trader_address),
    UNIQUE(follower_client_id, market_id, trader_address)
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT,
    event_type TEXT NOT NULL,
    properties TEXT,
    path TEXT,
    referrer TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS builder_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clob_order_id TEXT,
    market_id TEXT,
    token_id TEXT NOT NULL,
    side TEXT NOT NULL,
    price REAL NOT NULL,
    size REAL NOT NULL,
    notional_usdc REAL NOT NULL,
    order_type TEXT NOT NULL,
    builder_code TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    raw_response TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS builder_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT UNIQUE NOT NULL,
    market_id TEXT,
    token_id TEXT,
    side TEXT,
    size REAL,
    price REAL,
    notional_usdc REAL,
    status TEXT,
    outcome TEXT,
    owner TEXT,
    maker TEXT,
    builder_code TEXT,
    transaction_hash TEXT,
    match_time TEXT,
    fee TEXT,
    fee_usdc REAL,
    raw TEXT,
    first_seen_at TEXT NOT NULL,
    last_synced_at TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_stp_signal ON signal_trader_positions(signal_id);
CREATE INDEX IF NOT EXISTS idx_stp_trader ON signal_trader_positions(trader_address);
CREATE INDEX IF NOT EXISTS idx_stp_market ON signal_trader_positions(market_id);
CREATE INDEX IF NOT EXISTS idx_trader_accuracy_pct ON trader_accuracy(accuracy_pct);
CREATE INDEX IF NOT EXISTS idx_watchlist_client ON watchlist(client_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_market ON watchlist(market_id);
CREATE INDEX IF NOT EXISTS idx_user_actions_client ON user_actions(client_id);
CREATE INDEX IF NOT EXISTS idx_user_actions_market ON user_actions(market_id);
CREATE INDEX IF NOT EXISTS idx_events_client ON events(client_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_builder_orders_created ON builder_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_builder_orders_status ON builder_orders(status);
CREATE INDEX IF NOT EXISTS idx_builder_orders_clob_id ON builder_orders(clob_order_id);
CREATE INDEX IF NOT EXISTS idx_builder_trades_match_time ON builder_trades(match_time);
CREATE INDEX IF NOT EXISTS idx_builder_trades_market ON builder_trades(market_id);
CREATE INDEX IF NOT EXISTS idx_builder_trades_owner ON builder_trades(owner);
-- Wallet-linked indexes created in migrate_db AFTER ALTER TABLE runs on
-- existing DBs (otherwise SCHEMA fails on prod restarts where the column
-- hasn't been added yet).
"""


async def get_db() -> aiosqlite.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(DB_PATH))
    await db.execute("PRAGMA journal_mode=WAL")
    # Heavy scheduled scans can hold the write lock for several seconds.
    # 30s gives user-facing endpoints (portfolio, wallet-link, watchlist)
    # enough room to wait instead of 500-ing on contention.
    await db.execute("PRAGMA busy_timeout=30000")
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

    # Wallet-linked identity — watchlist + user_actions get wallet_address.
    # client_id stays for anonymous fallback and as the merge key when a
    # wallet first connects.
    cursor = await db.execute("PRAGMA table_info(watchlist)")
    w_cols = {row[1] for row in await cursor.fetchall()}
    if "wallet_address" not in w_cols:
        await db.execute("ALTER TABLE watchlist ADD COLUMN wallet_address TEXT")

    cursor = await db.execute("PRAGMA table_info(user_actions)")
    ua_cols = {row[1] for row in await cursor.fetchall()}
    if "wallet_address" not in ua_cols:
        await db.execute("ALTER TABLE user_actions ADD COLUMN wallet_address TEXT")

    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_watchlist_wallet ON watchlist(wallet_address)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_actions_wallet ON user_actions(wallet_address)"
    )

    # Wallet registry — lets us look up the owning wallet by client_id and
    # vice-versa. One row per wallet; client_id optional (for legacy merge).
    await db.execute(
        """CREATE TABLE IF NOT EXISTS wallets (
            wallet_address TEXT PRIMARY KEY,
            client_id TEXT,
            first_seen_at TEXT,
            last_seen_at TEXT
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_wallets_client ON wallets(client_id)"
    )

    # Follow-trader tables (created if missing on pre-existing DBs).
    await db.execute(
        """CREATE TABLE IF NOT EXISTS trader_follows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            follower_wallet TEXT,
            follower_client_id TEXT,
            trader_address TEXT NOT NULL,
            followed_at TEXT NOT NULL,
            UNIQUE(follower_wallet, trader_address),
            UNIQUE(follower_client_id, trader_address)
        )"""
    )
    await db.execute(
        """CREATE TABLE IF NOT EXISTS follow_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            follower_wallet TEXT,
            follower_client_id TEXT,
            trader_address TEXT NOT NULL,
            signal_id INTEGER NOT NULL,
            market_id TEXT NOT NULL,
            position_direction TEXT,
            created_at TEXT NOT NULL,
            seen_at TEXT,
            UNIQUE(follower_wallet, market_id, trader_address),
            UNIQUE(follower_client_id, market_id, trader_address)
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_follows_follower ON trader_follows(follower_wallet, follower_client_id)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_follows_trader ON trader_follows(trader_address)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_follow_alerts_follower ON follow_alerts(follower_wallet, follower_client_id, seen_at)"
    )

    # Telegram identity link + tg_notified_at so the bot can push
    # follow-trader alerts to linked chats.
    await db.execute(
        """CREATE TABLE IF NOT EXISTS bot_identity_links (
            chat_id INTEGER PRIMARY KEY,
            client_id TEXT,
            wallet_address TEXT,
            created_at TEXT,
            last_seen_at TEXT
        )"""
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_bot_links_client ON bot_identity_links(client_id)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_bot_links_wallet ON bot_identity_links(wallet_address)"
    )
    cursor = await db.execute("PRAGMA table_info(follow_alerts)")
    fa_cols = {row[1] for row in await cursor.fetchall()}
    if "tg_notified_at" not in fa_cols:
        await db.execute("ALTER TABLE follow_alerts ADD COLUMN tg_notified_at TEXT")
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_follow_alerts_tg ON follow_alerts(tg_notified_at)"
    )

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


async def save_divergence_signal(db: aiosqlite.Connection, signal: dict) -> int:
    cursor = await db.execute(
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
    return cursor.lastrowid or 0


async def save_signal_trader_positions(
    db: aiosqlite.Connection, records: list[dict]
):
    """Persist per-trader position records for a signal."""
    if not records:
        return
    await db.executemany(
        """INSERT INTO signal_trader_positions
           (signal_id, market_id, trader_address, trader_rank,
            position_direction, position_size, avg_price,
            weight_in_consensus, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                r["signal_id"],
                r["market_id"],
                r["trader_address"],
                r.get("trader_rank"),
                r.get("position_direction"),
                r.get("position_size"),
                r.get("avg_price"),
                r.get("weight_in_consensus"),
                r.get("timestamp"),
            )
            for r in records
        ],
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


def _normalize_signal(row: dict) -> dict:
    """Normalize DB signal rows so field names match the DivergenceSignal dataclass."""
    d = dict(row)
    if "signal_strength" in d and "score" not in d:
        d["score"] = d["signal_strength"]
    return d


def _wilson_lower_pct(correct: int, total: int) -> float:
    """Wilson 95% CI lower bound on accuracy as a percentage."""
    import math as _math

    if total <= 0:
        return 0.0
    z = 1.959963984540054
    p = correct / total
    denom = 1 + (z * z) / total
    center = (p + (z * z) / (2 * total)) / denom
    half = (
        z * _math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))
    ) / denom
    return max(0.0, center - half) * 100.0


# Contributor must have at least this many resolved observations to count.
PREDICTIVE_MIN_N = 30
# Contributor's Wilson-CI lower bound must meet this (pct).
PREDICTIVE_MIN_WILSON_LO = 40.0
# Contributor's point accuracy must be above coin flip. Without this, any
# high-volume trader whose true accuracy hovers near 45-48% will pass the
# CI-lo gate (wide intervals on small-from-50 deviations) and appear on
# nearly every signal — defeating the purpose.
PREDICTIVE_MIN_PCT = 50.0


async def get_predictive_contributors_for_markets(
    db: aiosqlite.Connection, market_ids: list[str]
) -> dict[str, dict]:
    """Return {market_id: {trader_address, pct, ci_lo, ci_hi, n}} for markets
    where at least one contributor crosses the predictive threshold.

    "Contributor" = any trader whose position on this market was captured
    in signal_trader_positions. Picks the contributor with the highest
    Wilson-CI lower bound per market (most credible single backing).
    """
    if not market_ids:
        return {}
    placeholders = ",".join("?" for _ in market_ids)
    cursor = await db.execute(
        f"""
        SELECT DISTINCT stp.market_id, stp.trader_address,
               ta.correct_predictions, ta.total_divergent_signals,
               ta.accuracy_pct
        FROM signal_trader_positions stp
        JOIN trader_accuracy ta ON ta.trader_address = stp.trader_address
        WHERE stp.market_id IN ({placeholders})
          AND ta.total_divergent_signals >= ?
        """,
        (*market_ids, PREDICTIVE_MIN_N),
    )
    rows = await cursor.fetchall()

    best: dict[str, dict] = {}
    for r in rows:
        mid = r["market_id"]
        correct = int(r["correct_predictions"] or 0)
        total = int(r["total_divergent_signals"] or 0)
        pct = float(r["accuracy_pct"] or 0.0)
        if pct < PREDICTIVE_MIN_PCT:
            continue
        lo = _wilson_lower_pct(correct, total)
        if lo < PREDICTIVE_MIN_WILSON_LO:
            continue
        current = best.get(mid)
        if current is None or lo > current["ci_lo"]:
            z = 1.959963984540054
            import math as _math

            p = correct / total if total else 0.0
            denom = 1 + (z * z) / total if total else 1
            center = (p + (z * z) / (2 * total)) / denom if total else 0.0
            half = (
                (
                    z
                    * _math.sqrt(
                        (p * (1 - p)) / total + (z * z) / (4 * total * total)
                    )
                )
                / denom
                if total
                else 0.0
            )
            hi = min(1.0, center + half) * 100.0
            best[mid] = {
                "trader_address": r["trader_address"],
                "pct": round(float(r["accuracy_pct"] or 0.0), 1),
                "ci_lo": round(lo, 1),
                "ci_hi": round(hi, 1),
                "n": total,
            }
    return best


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
    return [_normalize_signal(r) for r in rows]


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
    return [_normalize_signal(r) for r in rows]


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


# ── Per-Trader Accuracy ────────────────────────────────────


async def rebuild_trader_accuracy(db: aiosqlite.Connection) -> int:
    """Recompute per-trader predictive accuracy from resolved signals.

    A trader's prediction for a signal is their own position direction
    (YES/NO), NOT the aggregate consensus. A trader is "correct" when
    their position direction matches the market outcome.

    Each (trader, market) pair counts once — the earliest attributed
    signal. Re-signals of the same divergent position across scan
    cycles are not independent observations.

    Returns the number of trader rows updated.
    """
    import json as _json
    from datetime import datetime, timezone

    # Dedup: one row per (trader_address, market_id), picking the earliest
    # signal_trader_positions row (MIN(id)). Same trader holding the same
    # divergent position across many scan cycles is one prediction, not N.
    cursor = await db.execute(
        """
        WITH first_position AS (
            SELECT MIN(stp.id) AS stp_id
            FROM signal_trader_positions stp
            JOIN divergence_signals ds ON ds.id = stp.signal_id
            WHERE ds.resolved = 1
            GROUP BY stp.trader_address, stp.market_id
        )
        SELECT stp.trader_address,
               stp.position_direction,
               ds.market_price,
               COALESCE(ds.category, '') AS category,
               rm.outcome
        FROM first_position fp
        JOIN signal_trader_positions stp ON stp.id = fp.stp_id
        JOIN divergence_signals ds ON ds.id = stp.signal_id
        JOIN resolved_markets rm ON rm.market_id = stp.market_id
        WHERE rm.outcome IN (0, 1)
        """
    )
    rows = await cursor.fetchall()

    if not rows:
        return 0

    overall: dict[str, dict[str, int]] = {}
    skew_map: dict[str, dict[str, dict[str, int]]] = {}
    cat_map: dict[str, dict[str, dict[str, int]]] = {}

    for r in rows:
        trader, direction, price, category, outcome = r[0], r[1], r[2], r[3], r[4]
        correct = (
            1
            if (direction == "YES" and outcome == 1)
            or (direction == "NO" and outcome == 0)
            else 0
        )

        o = overall.setdefault(trader, {"total": 0, "correct": 0})
        o["total"] += 1
        o["correct"] += correct

        if price >= 0.9 or price <= 0.1:
            band = "very_lopsided"
        elif price >= 0.75 or price <= 0.25:
            band = "lopsided"
        elif price >= 0.6 or price <= 0.4:
            band = "moderate"
        else:
            band = "tight"
        s = skew_map.setdefault(trader, {}).setdefault(
            band, {"total": 0, "correct": 0}
        )
        s["total"] += 1
        s["correct"] += correct

        c = cat_map.setdefault(trader, {}).setdefault(
            category, {"total": 0, "correct": 0}
        )
        c["total"] += 1
        c["correct"] += correct

    now = datetime.now(timezone.utc).isoformat()
    updated = 0
    for trader_address, stats in overall.items():
        total = stats["total"]
        correct = stats["correct"]
        wrong = total - correct
        accuracy_pct = (correct / total * 100) if total > 0 else 0.0
        accuracy_by_skew = _json.dumps(skew_map.get(trader_address, {}))
        accuracy_by_category = _json.dumps(cat_map.get(trader_address, {}))

        await db.execute(
            """INSERT INTO trader_accuracy
               (trader_address, total_divergent_signals, correct_predictions,
                wrong_predictions, accuracy_pct, accuracy_by_skew,
                accuracy_by_category, last_updated)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(trader_address) DO UPDATE SET
                   total_divergent_signals = excluded.total_divergent_signals,
                   correct_predictions = excluded.correct_predictions,
                   wrong_predictions = excluded.wrong_predictions,
                   accuracy_pct = excluded.accuracy_pct,
                   accuracy_by_skew = excluded.accuracy_by_skew,
                   accuracy_by_category = excluded.accuracy_by_category,
                   last_updated = excluded.last_updated""",
            (
                trader_address,
                total,
                correct,
                wrong,
                accuracy_pct,
                accuracy_by_skew,
                accuracy_by_category,
                now,
            ),
        )
        updated += 1

    return updated


async def get_trader_accuracy_leaderboard(
    db: aiosqlite.Connection,
    order: str = "predictive",
    limit: int = 100,
    min_signals: int = 10,
) -> list[dict]:
    """Return top traders by predictive accuracy with Wilson 95% CI.

    order='predictive': highest accuracy first
    order='anti-predictive': lowest accuracy first (fade list)
    """
    from polyscope.stats import accuracy_bounds

    direction = "DESC" if order == "predictive" else "ASC"
    cursor = await db.execute(
        f"""SELECT trader_address, total_divergent_signals, correct_predictions,
                   wrong_predictions, accuracy_pct, accuracy_by_skew,
                   accuracy_by_category, last_updated
            FROM trader_accuracy
            WHERE total_divergent_signals >= ?
            ORDER BY accuracy_pct {direction}, total_divergent_signals DESC
            LIMIT ?""",
        (min_signals, limit),
    )
    rows = await cursor.fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["ci"] = accuracy_bounds(
            d["correct_predictions"], d["total_divergent_signals"]
        )
        result.append(d)
    return result


async def record_event(
    db: aiosqlite.Connection,
    event_type: str,
    client_id: str | None = None,
    properties: dict | None = None,
    path: str | None = None,
    referrer: str | None = None,
) -> None:
    """Record a lightweight product event. No PII, no IP, no user agent."""
    import json as _json
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    props_json = _json.dumps(properties) if properties else None
    await db.execute(
        """INSERT INTO events (client_id, event_type, properties, path, referrer, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (client_id, event_type, props_json, path, referrer, now),
    )


async def get_metrics_summary(
    db: aiosqlite.Connection, days: int = 7
) -> dict:
    """Aggregate product metrics for admin dashboard.

    Returns DAU/WAU/MAU-ish counts, top events, top routes, conversion
    rates — all computed from the events table + portfolio tables.
    """
    # Active client counts by window
    cursor = await db.execute(
        """SELECT
               COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-1 day')  THEN client_id END) AS d1,
               COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-7 days') THEN client_id END) AS d7,
               COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-30 days') THEN client_id END) AS d30,
               COUNT(DISTINCT client_id) AS all_time,
               COUNT(*) AS total_events
           FROM events
           WHERE client_id IS NOT NULL AND client_id != ''"""
    )
    row = await cursor.fetchone()
    actives = dict(row) if row else {}

    # Top event types over requested window
    cursor = await db.execute(
        """SELECT event_type, COUNT(*) AS n
           FROM events
           WHERE created_at >= datetime('now', ?)
           GROUP BY event_type
           ORDER BY n DESC
           LIMIT 20""",
        (f"-{days} days",),
    )
    top_events = [dict(r) for r in await cursor.fetchall()]

    # Top pages
    cursor = await db.execute(
        """SELECT path, COUNT(*) AS n
           FROM events
           WHERE event_type = 'page_view'
             AND created_at >= datetime('now', ?)
             AND path IS NOT NULL
           GROUP BY path
           ORDER BY n DESC
           LIMIT 20""",
        (f"-{days} days",),
    )
    top_pages = [dict(r) for r in await cursor.fetchall()]

    # Daily event counts (last N days)
    cursor = await db.execute(
        """SELECT DATE(created_at) AS day, COUNT(*) AS events,
                  COUNT(DISTINCT client_id) AS clients
           FROM events
           WHERE created_at >= datetime('now', ?)
             AND client_id IS NOT NULL AND client_id != ''
           GROUP BY day
           ORDER BY day DESC""",
        (f"-{days} days",),
    )
    daily = [dict(r) for r in await cursor.fetchall()]

    # Portfolio funnel counts
    cursor = await db.execute("SELECT COUNT(*) FROM watchlist")
    watchlist_total = (await cursor.fetchone())[0] or 0
    cursor = await db.execute(
        "SELECT COUNT(DISTINCT client_id) FROM watchlist"
    )
    watchlist_clients = (await cursor.fetchone())[0] or 0
    cursor = await db.execute("SELECT COUNT(*) FROM user_actions")
    actions_total = (await cursor.fetchone())[0] or 0
    cursor = await db.execute(
        "SELECT COUNT(DISTINCT client_id) FROM user_actions"
    )
    actions_clients = (await cursor.fetchone())[0] or 0

    return {
        "window_days": days,
        "actives": {
            "dau": actives.get("d1") or 0,
            "wau": actives.get("d7") or 0,
            "mau": actives.get("d30") or 0,
            "all_time": actives.get("all_time") or 0,
            "total_events": actives.get("total_events") or 0,
        },
        "top_events": top_events,
        "top_pages": top_pages,
        "daily": daily,
        "portfolio": {
            "watchlist_total": watchlist_total,
            "watchlist_clients": watchlist_clients,
            "actions_total": actions_total,
            "actions_clients": actions_clients,
        },
    }


async def add_to_watchlist(
    db: aiosqlite.Connection,
    client_id: str,
    market_id: str,
    wallet_address: str | None = None,
) -> dict | None:
    """Add the latest signal for market_id to a client's watchlist.

    Returns the new row as dict, or None if no signal exists for the market.
    Idempotent per (client_id, market_id). wallet_address, if given, is
    stored alongside for cross-device continuity after wallet link.
    """
    from datetime import datetime, timezone

    cursor = await db.execute(
        """SELECT id, sm_direction, market_price, sm_consensus, divergence_pct,
                  question, category
           FROM divergence_signals
           WHERE market_id = ?
           ORDER BY timestamp DESC
           LIMIT 1""",
        (market_id,),
    )
    sig = await cursor.fetchone()
    if not sig:
        return None

    now = datetime.now(timezone.utc).isoformat()
    try:
        cursor = await db.execute(
            """INSERT INTO watchlist
               (client_id, market_id, signal_id_at_add, sm_direction_at_add,
                market_price_at_add, sm_consensus_at_add, divergence_pct_at_add,
                question, category, added_at, wallet_address)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                client_id, market_id, sig["id"], sig["sm_direction"],
                sig["market_price"], sig["sm_consensus"],
                sig["divergence_pct"], sig["question"], sig["category"], now,
                wallet_address,
            ),
        )
        row_id = cursor.lastrowid
    except Exception:
        # Likely UNIQUE constraint — already watchlisted
        cursor = await db.execute(
            "SELECT id FROM watchlist WHERE client_id = ? AND market_id = ?",
            (client_id, market_id),
        )
        existing = await cursor.fetchone()
        row_id = existing["id"] if existing else None

    return {"id": row_id, "market_id": market_id}


async def remove_from_watchlist(
    db: aiosqlite.Connection, client_id: str, watchlist_id: int
) -> bool:
    cursor = await db.execute(
        "DELETE FROM watchlist WHERE id = ? AND client_id = ?",
        (watchlist_id, client_id),
    )
    return (cursor.rowcount or 0) > 0


async def get_watchlist(
    db: aiosqlite.Connection,
    client_id: str,
    wallet_address: str | None = None,
) -> list[dict]:
    """Watchlist items with current signal state and resolved outcome if any.

    If wallet_address is provided, matches rows owned by the wallet across
    any device (including rows still tagged only with the original
    client_id — those remain accessible via the client_id branch).
    """
    cursor = await db.execute(
        """SELECT
               w.id, w.market_id, w.sm_direction_at_add,
               w.market_price_at_add, w.sm_consensus_at_add,
               w.divergence_pct_at_add, w.question, w.category, w.added_at,
               (SELECT market_price FROM divergence_signals
                  WHERE market_id = w.market_id
                  ORDER BY timestamp DESC LIMIT 1) AS current_market_price,
               (SELECT sm_direction FROM divergence_signals
                  WHERE market_id = w.market_id
                  ORDER BY timestamp DESC LIMIT 1) AS current_sm_direction,
               (SELECT sm_consensus FROM divergence_signals
                  WHERE market_id = w.market_id
                  ORDER BY timestamp DESC LIMIT 1) AS current_sm_consensus,
               (SELECT divergence_pct FROM divergence_signals
                  WHERE market_id = w.market_id
                  ORDER BY timestamp DESC LIMIT 1) AS current_divergence_pct,
               (SELECT expired FROM divergence_signals
                  WHERE market_id = w.market_id
                  ORDER BY timestamp DESC LIMIT 1) AS latest_expired,
               rm.outcome AS resolved_outcome,
               rm.final_price AS resolved_final_price
           FROM watchlist w
           LEFT JOIN resolved_markets rm ON rm.market_id = w.market_id
           WHERE w.client_id = ? OR (? IS NOT NULL AND w.wallet_address = ?)
           ORDER BY w.added_at DESC""",
        (client_id, wallet_address, wallet_address),
    )
    rows = await cursor.fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["outcome_matched_direction"] = _outcome_matched(d)
        d["invalidation"] = _invalidation_state(d)
        result.append(d)
    return result


def _outcome_matched(d: dict) -> bool | None:
    """Did the at-add direction match the resolved outcome?"""
    if d.get("resolved_outcome") is None or not d.get("sm_direction_at_add"):
        return None
    direction = d["sm_direction_at_add"]
    outcome = d["resolved_outcome"]
    return (direction == "YES" and outcome == 1) or (
        direction == "NO" and outcome == 0
    )


def _invalidation_state(d: dict) -> dict | None:
    """Compute thesis-invalidation reason for a watched signal.

    Rules (priority order):
      resolved_wrong   — market resolved and at-add direction lost
      resolved_right   — market resolved and at-add direction won
      direction_flipped — top-trader consensus side changed vs at-add
      converged        — divergence_pct < 5% (thesis faded back)
      expired          — scheduler marked latest signal expired
      None             — still active, thesis intact
    """
    if d.get("resolved_outcome") is not None and d.get("sm_direction_at_add"):
        return {
            "reason": "resolved_right"
            if _outcome_matched(d)
            else "resolved_wrong",
            "label": "Resolved — called it"
            if _outcome_matched(d)
            else "Resolved — wrong direction",
            "severity": "info" if _outcome_matched(d) else "warn",
        }

    original_dir = d.get("sm_direction_at_add")
    current_dir = d.get("current_sm_direction")
    if original_dir and current_dir and original_dir != current_dir:
        return {
            "reason": "direction_flipped",
            "label": f"Direction flipped: {original_dir} → {current_dir}",
            "severity": "warn",
        }

    current_div = d.get("current_divergence_pct")
    if current_div is not None and current_div < 0.05:
        return {
            "reason": "converged",
            "label": "Divergence converged below 5% — thesis faded",
            "severity": "warn",
        }

    if d.get("latest_expired") == 1:
        return {
            "reason": "expired",
            "label": "Signal expired — scheduler marked it inactive",
            "severity": "warn",
        }

    return None


async def link_wallet_to_client(
    db: aiosqlite.Connection, client_id: str, wallet_address: str
) -> dict:
    """Link an anonymous client_id to a wallet address and migrate history.

    On first wallet connect, backfills wallet_address on all existing
    watchlist + user_action rows owned by client_id. Idempotent.

    Returns counts of migrated rows.
    """
    from datetime import datetime, timezone

    wallet = wallet_address.lower()
    now = datetime.now(timezone.utc).isoformat()

    await db.execute(
        """INSERT INTO wallets (wallet_address, client_id, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(wallet_address) DO UPDATE SET
               last_seen_at = excluded.last_seen_at,
               client_id = COALESCE(wallets.client_id, excluded.client_id)""",
        (wallet, client_id, now, now),
    )

    cursor = await db.execute(
        """UPDATE watchlist SET wallet_address = ?
           WHERE client_id = ? AND (wallet_address IS NULL OR wallet_address = '')""",
        (wallet, client_id),
    )
    w_migrated = cursor.rowcount or 0

    cursor = await db.execute(
        """UPDATE user_actions SET wallet_address = ?
           WHERE client_id = ? AND (wallet_address IS NULL OR wallet_address = '')""",
        (wallet, client_id),
    )
    ua_migrated = cursor.rowcount or 0

    # Also migrate any anonymous follows to this wallet.
    cursor = await db.execute(
        """UPDATE trader_follows SET follower_wallet = ?
           WHERE follower_client_id = ?
             AND (follower_wallet IS NULL OR follower_wallet = '')""",
        (wallet, client_id),
    )
    follows_migrated = cursor.rowcount or 0

    return {
        "wallet_address": wallet,
        "watchlist_migrated": w_migrated,
        "user_actions_migrated": ua_migrated,
        "follows_migrated": follows_migrated,
    }


# ── Follow-trader ──────────────────────────────────────────


async def follow_trader(
    db: aiosqlite.Connection,
    trader_address: str,
    client_id: str,
    wallet_address: str | None = None,
) -> dict:
    """Subscribe a follower to a trader. Idempotent per (follower, trader).

    Identity rule: if wallet is known, store both wallet + client_id;
    otherwise client_id only. link_wallet_to_client backfills wallet
    onto existing rows so the user's follows survive wallet linking.
    """
    from datetime import datetime, timezone

    trader = trader_address.lower()
    wallet = wallet_address.lower() if wallet_address else None
    now = datetime.now(timezone.utc).isoformat()

    await db.execute(
        """INSERT INTO trader_follows
           (follower_wallet, follower_client_id, trader_address, followed_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT DO NOTHING""",
        (wallet, client_id, trader, now),
    )
    return {
        "trader_address": trader,
        "follower_wallet": wallet,
        "follower_client_id": client_id,
        "followed_at": now,
    }


async def unfollow_trader(
    db: aiosqlite.Connection,
    trader_address: str,
    client_id: str,
    wallet_address: str | None = None,
) -> bool:
    """Remove a follow. Matches rows owned by either identity."""
    trader = trader_address.lower()
    wallet = wallet_address.lower() if wallet_address else None
    cursor = await db.execute(
        """DELETE FROM trader_follows
           WHERE trader_address = ?
             AND (follower_client_id = ?
                  OR (? IS NOT NULL AND follower_wallet = ?))""",
        (trader, client_id, wallet, wallet),
    )
    return (cursor.rowcount or 0) > 0


async def get_followed_traders(
    db: aiosqlite.Connection,
    client_id: str,
    wallet_address: str | None = None,
) -> list[dict]:
    """Return traders this follower subscribes to, joined with their
    current accuracy + CI.
    """
    from polyscope.stats import accuracy_bounds

    wallet = wallet_address.lower() if wallet_address else None
    cursor = await db.execute(
        """SELECT DISTINCT tf.trader_address, tf.followed_at,
                  ta.total_divergent_signals, ta.correct_predictions,
                  ta.accuracy_pct
           FROM trader_follows tf
           LEFT JOIN trader_accuracy ta
             ON ta.trader_address = tf.trader_address
           WHERE tf.follower_client_id = ?
              OR (? IS NOT NULL AND tf.follower_wallet = ?)
           ORDER BY tf.followed_at DESC""",
        (client_id, wallet, wallet),
    )
    rows = await cursor.fetchall()
    out = []
    for r in rows:
        d = dict(r)
        total = d.get("total_divergent_signals") or 0
        correct = d.get("correct_predictions") or 0
        d["ci"] = accuracy_bounds(correct, total)
        out.append(d)
    return out


async def is_following(
    db: aiosqlite.Connection,
    trader_address: str,
    client_id: str,
    wallet_address: str | None = None,
) -> bool:
    trader = trader_address.lower()
    wallet = wallet_address.lower() if wallet_address else None
    cursor = await db.execute(
        """SELECT 1 FROM trader_follows
           WHERE trader_address = ?
             AND (follower_client_id = ?
                  OR (? IS NOT NULL AND follower_wallet = ?))
           LIMIT 1""",
        (trader, client_id, wallet, wallet),
    )
    return await cursor.fetchone() is not None


async def emit_follow_alerts_for_signal(
    db: aiosqlite.Connection,
    signal_id: int,
    market_id: str,
    contributors: list[dict],
) -> int:
    """After a new divergence signal + contributors are saved, create a
    follow_alert for every follower subscribed to any of the contributor
    addresses. Idempotent per (follower, signal, trader).

    Returns the number of alert rows created.
    """
    from datetime import datetime, timezone

    if not contributors:
        return 0

    now = datetime.now(timezone.utc).isoformat()
    created = 0
    for c in contributors:
        trader = (c.get("trader_address") or "").lower()
        direction = c.get("position_direction")
        if not trader:
            continue
        cursor = await db.execute(
            "SELECT follower_wallet, follower_client_id FROM trader_follows WHERE trader_address = ?",
            (trader,),
        )
        followers = await cursor.fetchall()
        for f in followers:
            try:
                await db.execute(
                    """INSERT INTO follow_alerts
                       (follower_wallet, follower_client_id, trader_address,
                        signal_id, market_id, position_direction, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        f["follower_wallet"],
                        f["follower_client_id"],
                        trader,
                        signal_id,
                        market_id,
                        direction,
                        now,
                    ),
                )
                created += 1
            except Exception:
                # UNIQUE constraint — already alerted
                pass
    return created


async def get_follow_alerts(
    db: aiosqlite.Connection,
    client_id: str,
    wallet_address: str | None = None,
    unseen_only: bool = False,
    limit: int = 50,
) -> list[dict]:
    """Fetch recent follow_alerts for a follower, joined with market +
    signal metadata."""
    wallet = wallet_address.lower() if wallet_address else None
    sql = """
        SELECT fa.id, fa.trader_address, fa.signal_id, fa.market_id,
               fa.position_direction, fa.created_at, fa.seen_at,
               ds.question, ds.market_price, ds.sm_consensus,
               ds.divergence_pct, ds.signal_strength, ds.sm_direction,
               ta.accuracy_pct, ta.total_divergent_signals
        FROM follow_alerts fa
        LEFT JOIN divergence_signals ds ON ds.id = fa.signal_id
        LEFT JOIN trader_accuracy ta ON ta.trader_address = fa.trader_address
        WHERE (fa.follower_client_id = ?
               OR (? IS NOT NULL AND fa.follower_wallet = ?))
    """
    if unseen_only:
        sql += " AND fa.seen_at IS NULL"
    sql += " ORDER BY fa.created_at DESC LIMIT ?"

    cursor = await db.execute(sql, (client_id, wallet, wallet, limit))
    return [dict(r) for r in await cursor.fetchall()]


async def mark_alerts_seen(
    db: aiosqlite.Connection,
    client_id: str,
    wallet_address: str | None = None,
) -> int:
    """Mark all unseen follow_alerts as seen for this follower."""
    from datetime import datetime, timezone

    wallet = wallet_address.lower() if wallet_address else None
    now = datetime.now(timezone.utc).isoformat()
    cursor = await db.execute(
        """UPDATE follow_alerts SET seen_at = ?
           WHERE seen_at IS NULL
             AND (follower_client_id = ?
                  OR (? IS NOT NULL AND follower_wallet = ?))""",
        (now, client_id, wallet, wallet),
    )
    return cursor.rowcount or 0


async def record_user_action(
    db: aiosqlite.Connection,
    client_id: str,
    market_id: str,
    action_direction: str,
    size: float,
    price: float,
    watchlist_id: int | None = None,
    wallet_address: str | None = None,
) -> int:
    """Record that a user manually acted on a signal."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    cursor = await db.execute(
        """INSERT INTO user_actions
           (client_id, market_id, watchlist_id, action_direction, size, price,
            acted_at, wallet_address)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (client_id, market_id, watchlist_id, action_direction, size, price, now,
         wallet_address),
    )
    return cursor.lastrowid or 0


async def get_portfolio(
    db: aiosqlite.Connection,
    client_id: str,
    wallet_address: str | None = None,
) -> dict:
    """Portfolio summary: all user actions with outcomes + aggregate stats.

    Matches by client_id OR wallet_address so a user's history follows
    them across devices after linking a wallet.
    """
    cursor = await db.execute(
        """SELECT
               ua.id, ua.market_id, ua.action_direction, ua.size, ua.price, ua.acted_at,
               w.question, w.category,
               rm.outcome AS resolved_outcome,
               rm.final_price AS resolved_final_price,
               rm.resolved_at
           FROM user_actions ua
           LEFT JOIN watchlist w ON w.id = ua.watchlist_id
           LEFT JOIN resolved_markets rm ON rm.market_id = ua.market_id
           WHERE ua.client_id = ?
              OR (? IS NOT NULL AND ua.wallet_address = ?)
           ORDER BY ua.acted_at DESC""",
        (client_id, wallet_address, wallet_address),
    )
    actions_rows = await cursor.fetchall()
    actions = []
    total = 0
    correct = 0
    pnl_estimate = 0.0
    resolved_actions = 0

    for r in actions_rows:
        d = dict(r)
        if d["resolved_outcome"] is not None:
            resolved_actions += 1
            total += 1
            was_correct = (
                (d["action_direction"] == "YES" and d["resolved_outcome"] == 1)
                or (d["action_direction"] == "NO" and d["resolved_outcome"] == 0)
            )
            d["action_correct"] = was_correct
            if was_correct:
                correct += 1
                # Profit: paid price, won $1 per share
                pnl_estimate += (d["size"] or 0) * (1.0 - (d["price"] or 0))
            else:
                # Loss: paid price, got $0
                pnl_estimate -= (d["size"] or 0) * (d["price"] or 0)
        else:
            d["action_correct"] = None
        actions.append(d)

    win_rate = (correct / total * 100) if total > 0 else None

    return {
        "actions": actions,
        "stats": {
            "total_actions": len(actions),
            "resolved_actions": resolved_actions,
            "correct": correct,
            "win_rate_pct": win_rate,
            "pnl_estimate_usd": round(pnl_estimate, 2),
        },
    }


async def search_universal(
    db: aiosqlite.Connection, query: str, limit: int = 8
) -> dict:
    """Search markets (by question) and traders (by address prefix).

    Returns up to `limit` of each. Case-insensitive substring match
    on question; case-insensitive prefix match on trader_address.
    """
    q = query.strip()
    if not q:
        return {"markets": [], "traders": []}

    # Markets — pick the latest signal row per matching market
    cursor = await db.execute(
        """SELECT market_id, question, category, sm_direction,
                  market_price, sm_consensus, divergence_pct, signal_strength,
                  MAX(timestamp) AS latest_ts
           FROM divergence_signals
           WHERE question LIKE ? COLLATE NOCASE
           GROUP BY market_id
           ORDER BY latest_ts DESC
           LIMIT ?""",
        (f"%{q}%", limit),
    )
    markets = [dict(r) for r in await cursor.fetchall()]

    # Traders — prefix match on address
    cursor = await db.execute(
        """SELECT trader_address, accuracy_pct, total_divergent_signals,
                  correct_predictions
           FROM trader_accuracy
           WHERE trader_address LIKE ? COLLATE NOCASE
           ORDER BY accuracy_pct DESC, total_divergent_signals DESC
           LIMIT ?""",
        (f"{q.lower()}%", limit),
    )
    traders = [dict(r) for r in await cursor.fetchall()]

    return {"markets": markets, "traders": traders}


async def get_leaderboard_comparison(
    db: aiosqlite.Connection, limit: int = 25, min_signals: int = 5
) -> dict:
    """Return PolyScope-accuracy ranking with overlap classification.

    The Polymarket P&L leaderboard is fetched live via the cache layer,
    not from this DB, so the API endpoint composes the two. This helper
    just returns the accuracy-side data needed by that composition.
    """
    cursor = await db.execute(
        """SELECT trader_address, accuracy_pct, correct_predictions,
                  total_divergent_signals
           FROM trader_accuracy
           WHERE total_divergent_signals >= ?
           ORDER BY accuracy_pct DESC, total_divergent_signals DESC
           LIMIT ?""",
        (min_signals, limit),
    )
    accurate = [dict(r) for r in await cursor.fetchall()]

    cursor = await db.execute(
        """SELECT trader_address, accuracy_pct, correct_predictions,
                  total_divergent_signals
           FROM trader_accuracy
           WHERE total_divergent_signals >= ?
           ORDER BY accuracy_pct ASC, total_divergent_signals DESC
           LIMIT ?""",
        (min_signals, limit),
    )
    fade = [dict(r) for r in await cursor.fetchall()]

    return {
        "accuracy_top": accurate,
        "accuracy_fade": fade,
        "min_signals": min_signals,
        "limit": limit,
    }


async def _compute_predictive_filter_stats(db: aiosqlite.Connection) -> dict:
    """Backtested performance of the predictive-contributor filter on resolved
    signals. Mirrors the gates and ROI math in src/polyscope/backtest.py:
    qualifies if at least one contributor on the signal has total>=30,
    accuracy_pct>=50, and Wilson-95% lower bound>=40.

    Returns:
        {qualifying_traders, signals, hits, win_pct, roi_pct, by_band}
    """
    # Resolved signals (best per market by signal_strength to mirror backtest).
    # Joins market_snapshots so we can apply the same OI/volume gate the
    # backtest uses — without it, thin markets with prices near 0 pollute
    # the ROI tally with returns that wouldn't be fillable in reality.
    cursor = await db.execute(
        """SELECT ds.id, ds.market_id, ds.market_price, ds.sm_direction,
                  ds.outcome_correct, ds.signal_strength,
                  COALESCE(ms.open_interest, 0) AS open_interest,
                  COALESCE(ms.volume_24h, 0) AS volume_24h
           FROM divergence_signals ds
           LEFT JOIN (
               SELECT market_id,
                      MAX(open_interest) AS open_interest,
                      MAX(volume_24h) AS volume_24h
               FROM market_snapshots
               GROUP BY market_id
           ) ms ON ms.market_id = ds.market_id
           WHERE ds.resolved = 1 AND ds.outcome_correct IS NOT NULL
                 AND (ds.expired = 0 OR ds.expired IS NULL)"""
    )
    raw = await cursor.fetchall()
    if not raw:
        return {
            "qualifying_traders": 0,
            "signals": 0,
            "hits": 0,
            "win_pct": None,
            "roi_pct": None,
            "by_band": {},
            "baseline": {
                "signals": 0,
                "hits": 0,
                "win_pct": None,
                "roi_pct": None,
            },
        }

    # Match backtest "New defaults" gate: max(OI, 24h vol) >= $50K and
    # 24h vol >= $10K. Citation parity with the backtest matters more than
    # surfacing every resolved signal.
    MIN_QUALITY = 50_000.0
    MIN_VOLUME_24H = 10_000.0
    best: dict[str, dict] = {}
    for r in raw:
        d = dict(r)
        oi = d["open_interest"] or 0
        vol = d["volume_24h"] or 0
        if max(oi, vol) < MIN_QUALITY or vol < MIN_VOLUME_24H:
            continue
        mid = d["market_id"]
        cur = best.get(mid)
        if cur is None or (d["signal_strength"] or 0) > (cur["signal_strength"] or 0):
            best[mid] = d

    # First-observed (trader, market) → trader_accuracy join, applying the gates
    cursor = await db.execute(
        f"""
        WITH first_pos AS (
            SELECT stp.signal_id, stp.trader_address
            FROM signal_trader_positions stp
            JOIN (
                SELECT trader_address, market_id, MIN(id) AS first_id
                FROM signal_trader_positions
                GROUP BY trader_address, market_id
            ) f ON f.first_id = stp.id
        )
        SELECT fp.signal_id, ta.accuracy_pct, ta.correct_predictions,
               ta.total_divergent_signals
        FROM first_pos fp
        JOIN trader_accuracy ta ON ta.trader_address = fp.trader_address
        WHERE ta.total_divergent_signals >= ?
              AND ta.accuracy_pct >= ?
        """,
        (PREDICTIVE_MIN_N, PREDICTIVE_MIN_PCT),
    )
    contrib_rows = await cursor.fetchall()

    qualifying_signal_ids: set[int] = set()
    for r in contrib_rows:
        lo = _wilson_lower_pct(int(r[2] or 0), int(r[3] or 0))
        if lo >= PREDICTIVE_MIN_WILSON_LO:
            qualifying_signal_ids.add(int(r[0]))

    # Qualifying-trader population
    cursor = await db.execute(
        """SELECT correct_predictions, total_divergent_signals, accuracy_pct
           FROM trader_accuracy
           WHERE total_divergent_signals >= ? AND accuracy_pct >= ?""",
        (PREDICTIVE_MIN_N, PREDICTIVE_MIN_PCT),
    )
    qualifying_traders = 0
    for r in await cursor.fetchall():
        if _wilson_lower_pct(int(r[0] or 0), int(r[1] or 0)) >= PREDICTIVE_MIN_WILSON_LO:
            qualifying_traders += 1

    by_band: dict[str, dict[str, float]] = {
        b: {"n": 0, "hits": 0, "wagered": 0.0, "returned": 0.0}
        for b in ("very_lopsided", "lopsided", "moderate", "tight")
    }
    total_n = 0
    total_hits = 0
    total_wagered = 0.0
    total_returned = 0.0
    base_n = 0
    base_hits = 0
    base_wagered = 0.0
    base_returned = 0.0
    for s in best.values():
        price = s["market_price"] or 0.0
        if price >= 0.9 or price <= 0.1:
            band = "very_lopsided"
        elif price >= 0.75 or price <= 0.25:
            band = "lopsided"
        elif price >= 0.6 or price <= 0.4:
            band = "moderate"
        else:
            band = "tight"
        hit = 1 if s["outcome_correct"] == 1 else 0
        # sm_direction in DB is the bet direction (post-flip strategy).
        # Buying YES costs `price`; buying NO costs `1 - price`. Clamp at
        # $0.01 to match backtest convention (avoids ROI explosion on
        # near-resolved sports markets at 0.001/0.999).
        if s["sm_direction"] == "YES":
            buy_price = max(price, 0.01)
        else:
            buy_price = max(1.0 - price, 0.01)
        returned = (100.0 / buy_price) if hit else 0.0
        base_n += 1
        base_hits += hit
        base_wagered += 100.0
        base_returned += returned
        if s["id"] not in qualifying_signal_ids:
            continue
        total_n += 1
        total_hits += hit
        total_wagered += 100.0
        total_returned += returned
        b = by_band[band]
        b["n"] += 1
        b["hits"] += hit
        b["wagered"] += 100.0
        b["returned"] += returned

    band_summary = {}
    for band, b in by_band.items():
        if b["n"] == 0:
            continue
        band_summary[band] = {
            "n": int(b["n"]),
            "hits": int(b["hits"]),
            "win_pct": round(b["hits"] / b["n"] * 100, 1),
            "roi_pct": round(
                (b["returned"] - b["wagered"]) / max(b["wagered"], 1) * 100, 1
            ),
        }

    return {
        "qualifying_traders": qualifying_traders,
        "signals": total_n,
        "hits": total_hits,
        "win_pct": round(total_hits / total_n * 100, 1) if total_n else None,
        "roi_pct": (
            round((total_returned - total_wagered) / max(total_wagered, 1) * 100, 1)
            if total_n
            else None
        ),
        "by_band": band_summary,
        "baseline": {
            "signals": base_n,
            "hits": base_hits,
            "win_pct": round(base_hits / base_n * 100, 1) if base_n else None,
            "roi_pct": (
                round(
                    (base_returned - base_wagered) / max(base_wagered, 1) * 100, 1
                )
                if base_n
                else None
            ),
        },
    }


async def get_methodology_stats(db: aiosqlite.Connection) -> dict:
    """Live dataset stats for the public methodology page."""
    # Signal counts and time range
    cursor = await db.execute(
        """SELECT COUNT(*),
                  SUM(CASE WHEN resolved = 1 THEN 1 ELSE 0 END),
                  SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END),
                  MIN(timestamp), MAX(timestamp)
           FROM divergence_signals"""
    )
    row = await cursor.fetchone()
    total, resolved, correct, min_ts, max_ts = row

    resolved = resolved or 0
    correct = correct or 0
    win_rate = (correct / resolved * 100) if resolved > 0 else None

    # Win rate by market skew (the honest breakdown)
    cursor = await db.execute(
        """
        SELECT
            CASE
                WHEN market_price >= 0.9 OR market_price <= 0.1 THEN 'very_lopsided'
                WHEN market_price >= 0.75 OR market_price <= 0.25 THEN 'lopsided'
                WHEN market_price >= 0.6  OR market_price <= 0.4  THEN 'moderate'
                ELSE 'tight'
            END AS skew,
            COUNT(*) AS total,
            SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) AS correct
        FROM divergence_signals
        WHERE resolved = 1
        GROUP BY skew
        """
    )
    skew_rows = await cursor.fetchall()
    skew_breakdown = {}
    for r in skew_rows:
        t = r[1] or 0
        c = r[2] or 0
        skew_breakdown[r[0]] = {
            "total": t,
            "correct": c,
            "win_rate_pct": (c / t * 100) if t > 0 else None,
        }

    # Resolved markets tracked
    cursor = await db.execute("SELECT COUNT(*) FROM resolved_markets")
    resolved_markets = (await cursor.fetchone())[0] or 0

    # Traders scored
    cursor = await db.execute(
        "SELECT COUNT(*), AVG(accuracy_pct) FROM trader_accuracy WHERE total_divergent_signals >= 1"
    )
    tr_row = await cursor.fetchone()
    traders_scored = tr_row[0] or 0
    avg_trader_accuracy = tr_row[1]

    # Per-trader records captured
    cursor = await db.execute("SELECT COUNT(*) FROM signal_trader_positions")
    trader_records = (await cursor.fetchone())[0] or 0

    predictive_filter = await _compute_predictive_filter_stats(db)

    return {
        "signals": {
            "total": total or 0,
            "resolved": resolved,
            "correct": correct,
            "overall_win_rate_pct": win_rate,
            "first_captured": min_ts,
            "latest_captured": max_ts,
        },
        "skew_breakdown": skew_breakdown,
        "resolved_markets": resolved_markets,
        "per_trader": {
            "records_captured": trader_records,
            "traders_scored": traders_scored,
            "avg_accuracy_pct": avg_trader_accuracy,
        },
        "predictive_filter": predictive_filter,
    }


async def get_signal_evidence(
    db: aiosqlite.Connection, market_id: str
) -> dict | None:
    """Return full evidence trail for the most recent signal on a market.

    Includes:
    - signal metadata (direction, score, source, freshness)
    - per-trader contributions (who, rank, direction, size, their accuracy)
    - category hit rate (historical win rate in this category)
    - skew-band hit rate (historical win rate at this price skew)
    """
    # Latest signal for this market
    cursor = await db.execute(
        """SELECT id, market_id, timestamp, market_price, sm_consensus,
                  divergence_pct, signal_strength, sm_trader_count,
                  sm_direction, question, category, resolved,
                  outcome_correct, signal_source
           FROM divergence_signals
           WHERE market_id = ?
           ORDER BY timestamp DESC
           LIMIT 1""",
        (market_id,),
    )
    signal_row = await cursor.fetchone()
    if not signal_row:
        return None

    signal = dict(signal_row)
    signal_id = signal["id"]
    market_price = signal["market_price"] or 0.0
    category = signal.get("category") or ""

    # Per-trader contributions with their own accuracy stats
    cursor = await db.execute(
        """SELECT stp.trader_address, stp.trader_rank, stp.position_direction,
                  stp.position_size, stp.avg_price, stp.weight_in_consensus,
                  ta.accuracy_pct, ta.total_divergent_signals, ta.correct_predictions
           FROM signal_trader_positions stp
           LEFT JOIN trader_accuracy ta ON ta.trader_address = stp.trader_address
           WHERE stp.signal_id = ?
           ORDER BY stp.weight_in_consensus DESC""",
        (signal_id,),
    )
    contributors = [dict(r) for r in await cursor.fetchall()]

    # Skew band for this signal
    if market_price >= 0.9 or market_price <= 0.1:
        skew = "very_lopsided"
        skew_label = "Very lopsided (≥90% or ≤10%)"
    elif market_price >= 0.75 or market_price <= 0.25:
        skew = "lopsided"
        skew_label = "Lopsided (75-90% or 10-25%)"
    elif market_price >= 0.6 or market_price <= 0.4:
        skew = "moderate"
        skew_label = "Moderate (60-75% or 25-40%)"
    else:
        skew = "tight"
        skew_label = "Tight (40-60%)"

    # Historical hit rate at this skew band
    cursor = await db.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) AS correct
           FROM divergence_signals
           WHERE resolved = 1
             AND CASE
                 WHEN market_price >= 0.9 OR market_price <= 0.1 THEN 'very_lopsided'
                 WHEN market_price >= 0.75 OR market_price <= 0.25 THEN 'lopsided'
                 WHEN market_price >= 0.6 OR market_price <= 0.4 THEN 'moderate'
                 ELSE 'tight'
             END = ?""",
        (skew,),
    )
    skew_row = await cursor.fetchone()
    skew_total = skew_row[0] or 0
    skew_correct = skew_row[1] or 0
    skew_hit_rate = (skew_correct / skew_total * 100) if skew_total > 0 else None

    # Historical hit rate for this category
    cat_hit_rate = None
    cat_total = 0
    cat_correct = 0
    if category:
        cursor = await db.execute(
            """SELECT COUNT(*) AS total,
                      SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) AS correct
               FROM divergence_signals
               WHERE resolved = 1 AND category = ?""",
            (category,),
        )
        cat_row = await cursor.fetchone()
        cat_total = cat_row[0] or 0
        cat_correct = cat_row[1] or 0
        cat_hit_rate = (cat_correct / cat_total * 100) if cat_total > 0 else None

    return {
        "signal": signal,
        "contributors": contributors,
        "skew": {
            "band": skew,
            "label": skew_label,
            "total_resolved": skew_total,
            "correct": skew_correct,
            "hit_rate_pct": skew_hit_rate,
        },
        "category": {
            "name": category,
            "total_resolved": cat_total,
            "correct": cat_correct,
            "hit_rate_pct": cat_hit_rate,
        },
    }


async def get_trader_profile(
    db: aiosqlite.Connection, trader_address: str
) -> dict | None:
    from polyscope.stats import accuracy_bounds

    cursor = await db.execute(
        """SELECT trader_address, total_divergent_signals, correct_predictions,
                  wrong_predictions, accuracy_pct, accuracy_by_skew,
                  accuracy_by_category, last_updated
           FROM trader_accuracy
           WHERE trader_address = ?""",
        (trader_address,),
    )
    row = await cursor.fetchone()
    if not row:
        return None
    d = dict(row)
    d["ci"] = accuracy_bounds(d["correct_predictions"], d["total_divergent_signals"])
    # Per-skew-band CIs (parse stored JSON, enrich each band)
    import json as _json

    try:
        skew = _json.loads(d.get("accuracy_by_skew") or "{}")
    except (ValueError, TypeError):
        skew = {}
    d["skew_ci"] = {
        band: accuracy_bounds(stats.get("correct", 0), stats.get("total", 0))
        for band, stats in skew.items()
    }
    return d


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
                   market_price,
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

    # By skew band — the honest breakdown. Composite win rate hides
    # composition effect (lopsided markets dominate). Tight-band accuracy
    # is the real test of edge.
    cursor = await db.execute(
        _BEST_PER_MARKET +
        """SELECT
               CASE
                   WHEN market_price >= 0.9 OR market_price <= 0.1 THEN 'very_lopsided'
                   WHEN market_price >= 0.75 OR market_price <= 0.25 THEN 'lopsided'
                   WHEN market_price >= 0.6 OR market_price <= 0.4  THEN 'moderate'
                   ELSE 'tight'
               END AS band,
               COUNT(*) AS total,
               SUM(CASE WHEN outcome_correct = 1 THEN 1 ELSE 0 END) AS correct
           FROM best
           GROUP BY band"""
    )
    skew_rows = await cursor.fetchall()
    by_skew: dict[str, dict[str, float | int]] = {
        "very_lopsided": {"total": 0, "correct": 0, "win_rate": 0.0},
        "lopsided": {"total": 0, "correct": 0, "win_rate": 0.0},
        "moderate": {"total": 0, "correct": 0, "win_rate": 0.0},
        "tight": {"total": 0, "correct": 0, "win_rate": 0.0},
    }
    for r in skew_rows:
        band, t, c = r[0], r[1] or 0, r[2] or 0
        by_skew[band] = {
            "total": t,
            "correct": c,
            "win_rate": round(c / t, 4) if t > 0 else 0.0,
        }

    return {
        "overall": overall,
        "by_tier": by_tier,
        "by_skew": by_skew,
        "rolling_30d": rolling_30d,
    }


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


# ── Telegram Identity Linking ──────────────────────────────


async def link_bot_identity(
    db: aiosqlite.Connection,
    chat_id: int,
    client_id: str | None = None,
    wallet_address: str | None = None,
) -> None:
    """Associate a Telegram chat with a web identity (client_id + optional
    wallet). Upsert keyed on chat_id."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    wallet = wallet_address.lower() if wallet_address else None
    await db.execute(
        """INSERT INTO bot_identity_links
               (chat_id, client_id, wallet_address, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(chat_id) DO UPDATE SET
               client_id = excluded.client_id,
               wallet_address = excluded.wallet_address,
               last_seen_at = excluded.last_seen_at""",
        (chat_id, client_id, wallet, now, now),
    )


async def unlink_bot_identity(db: aiosqlite.Connection, chat_id: int) -> bool:
    cursor = await db.execute(
        "DELETE FROM bot_identity_links WHERE chat_id = ?", (chat_id,)
    )
    return (cursor.rowcount or 0) > 0


async def get_bot_identity(
    db: aiosqlite.Connection, chat_id: int
) -> dict | None:
    cursor = await db.execute(
        "SELECT * FROM bot_identity_links WHERE chat_id = ?", (chat_id,)
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


async def get_pending_follow_alerts_with_chat(
    db: aiosqlite.Connection, limit: int = 200
) -> list[dict]:
    """Fetch follow_alerts not yet DM'd, joined with the follower's
    chat_id (if linked) and market/signal/trader context needed to
    render the alert message.
    """
    sql = """
        SELECT fa.id, fa.trader_address, fa.signal_id, fa.market_id,
               fa.position_direction, fa.created_at,
               bil.chat_id,
               ds.question, ds.market_price, ds.sm_consensus,
               ds.divergence_pct, ds.signal_strength, ds.sm_direction,
               ta.accuracy_pct, ta.total_divergent_signals
        FROM follow_alerts fa
        JOIN bot_identity_links bil
          ON (fa.follower_client_id IS NOT NULL
              AND bil.client_id = fa.follower_client_id)
             OR (fa.follower_wallet IS NOT NULL
                 AND bil.wallet_address = fa.follower_wallet)
        LEFT JOIN divergence_signals ds ON ds.id = fa.signal_id
        LEFT JOIN trader_accuracy ta ON ta.trader_address = fa.trader_address
        WHERE fa.tg_notified_at IS NULL
        ORDER BY fa.created_at ASC
        LIMIT ?
    """
    cursor = await db.execute(sql, (limit,))
    return [dict(r) for r in await cursor.fetchall()]


async def mark_follow_alerts_tg_notified(
    db: aiosqlite.Connection, alert_ids: list[int]
) -> int:
    if not alert_ids:
        return 0
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    placeholders = ",".join("?" for _ in alert_ids)
    cursor = await db.execute(
        f"UPDATE follow_alerts SET tg_notified_at = ? WHERE id IN ({placeholders})",
        (now, *alert_ids),
    )
    return cursor.rowcount or 0


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


# ── Builder Orders (Phase B) ───────────────────────────────


async def record_builder_order_attempt(
    db: aiosqlite.Connection,
    *,
    token_id: str,
    side: str,
    price: float,
    size: float,
    order_type: str,
    builder_code: str,
    market_id: str | None = None,
) -> int:
    """Insert a pending builder_orders row before calling CLOB. Returns row id."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    notional = round(price * size, 6)
    cursor = await db.execute(
        """INSERT INTO builder_orders
           (market_id, token_id, side, price, size, notional_usdc,
            order_type, builder_code, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
        (market_id, token_id, side, price, size, notional,
         order_type, builder_code, now, now),
    )
    await db.commit()
    return cursor.lastrowid


async def update_builder_order_result(
    db: aiosqlite.Connection,
    row_id: int,
    *,
    status: str,
    clob_order_id: str | None = None,
    error: str | None = None,
    raw_response: str | None = None,
):
    """Update a builder_orders row after CLOB call returns."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """UPDATE builder_orders
           SET status = ?, clob_order_id = ?, error = ?,
               raw_response = ?, updated_at = ?
           WHERE id = ?""",
        (status, clob_order_id, error, raw_response, now, row_id),
    )
    await db.commit()


async def list_builder_orders(
    db: aiosqlite.Connection, limit: int = 50
) -> list[dict]:
    """Return recent builder_orders rows, newest first."""
    cursor = await db.execute(
        """SELECT id, clob_order_id, market_id, token_id, side, price, size,
                  notional_usdc, order_type, builder_code, status, error,
                  created_at, updated_at
           FROM builder_orders
           ORDER BY id DESC
           LIMIT ?""",
        (limit,),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def get_pending_builder_orders(
    db: aiosqlite.Connection, limit: int = 50
) -> list[dict]:
    """Orders that still need CLOB status sync.

    ``submitted`` rows with a clob_order_id are candidates. Terminal
    statuses (``filled``, ``canceled``, ``rejected``, ``failed``,
    ``expired``) are excluded.
    """
    cursor = await db.execute(
        """SELECT id, clob_order_id, market_id, token_id, status
           FROM builder_orders
           WHERE status = 'submitted'
             AND clob_order_id IS NOT NULL
             AND clob_order_id != ''
           ORDER BY id ASC
           LIMIT ?""",
        (limit,),
    )
    return [dict(r) for r in await cursor.fetchall()]


async def apply_builder_order_sync(
    db: aiosqlite.Connection,
    row_id: int,
    *,
    status: str,
    raw_response: str | None = None,
):
    """Update only status + raw_response + updated_at (no error overwrite)."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """UPDATE builder_orders
           SET status = ?, raw_response = COALESCE(?, raw_response), updated_at = ?
           WHERE id = ?""",
        (status, raw_response, now, row_id),
    )
    await db.commit()


async def upsert_builder_trade(
    db: aiosqlite.Connection, trade: dict, raw_json: str
) -> bool:
    """Insert-or-update a builder_trade row keyed by trade_id.

    Returns True when a new row was inserted, False on update.
    """
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    trade_id = (
        trade.get("id")
        or trade.get("trade_id")
        or trade.get("tradeID")
    )
    if not trade_id:
        return False
    size = float(trade.get("size") or 0)
    price = float(trade.get("price") or 0)
    notional = round(size * price, 6)

    cursor = await db.execute(
        "SELECT id FROM builder_trades WHERE trade_id = ?", (trade_id,)
    )
    existing = await cursor.fetchone()

    if existing:
        await db.execute(
            """UPDATE builder_trades SET
                status = ?, outcome = ?, raw = ?, last_synced_at = ?
               WHERE trade_id = ?""",
            (
                trade.get("status"),
                trade.get("outcome"),
                raw_json,
                now,
                trade_id,
            ),
        )
        await db.commit()
        return False

    await db.execute(
        """INSERT INTO builder_trades (
            trade_id, market_id, token_id, side, size, price,
            notional_usdc, status, outcome, owner, maker,
            builder_code, transaction_hash, match_time, fee, fee_usdc,
            raw, first_seen_at, last_synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            trade_id,
            trade.get("market"),
            trade.get("asset_id") or trade.get("assetId"),
            trade.get("side"),
            size,
            price,
            notional,
            trade.get("status"),
            trade.get("outcome"),
            trade.get("owner"),
            trade.get("maker"),
            trade.get("builder"),
            trade.get("transaction_hash") or trade.get("transactionHash"),
            trade.get("match_time") or trade.get("matchTime"),
            str(trade.get("fee")) if trade.get("fee") is not None else None,
            float(trade.get("fee_usdc") or trade.get("feeUsdc") or 0) or None,
            raw_json,
            now,
            now,
        ),
    )
    await db.commit()
    return True


async def list_builder_trades(
    db: aiosqlite.Connection, limit: int = 50
) -> list[dict]:
    """Return recent builder_trades, newest by match_time first."""
    cursor = await db.execute(
        """SELECT id, trade_id, market_id, token_id, side, size, price,
                  notional_usdc, status, outcome, owner, maker,
                  transaction_hash, match_time, fee_usdc,
                  first_seen_at, last_synced_at
           FROM builder_trades
           ORDER BY COALESCE(match_time, first_seen_at) DESC
           LIMIT ?""",
        (limit,),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def builder_trades_stats(db: aiosqlite.Connection) -> dict:
    """Aggregate attribution stats across all builder_trades."""
    cursor = await db.execute(
        """SELECT COUNT(*) AS total,
                  COALESCE(SUM(notional_usdc), 0) AS total_notional,
                  COALESCE(SUM(fee_usdc), 0) AS total_fees,
                  COUNT(DISTINCT owner) AS unique_owners
           FROM builder_trades"""
    )
    row = await cursor.fetchone()
    return {
        "total_trades": row[0] or 0,
        "total_notional_usdc": round(float(row[1] or 0), 4),
        "total_fees_usdc": round(float(row[2] or 0), 6),
        "unique_owners": row[3] or 0,
    }
