"""Tests for backtest harness."""

import sqlite3

import pytest

from polyscope.backtest import BacktestConfig, run_backtest


@pytest.fixture
def backtest_db(tmp_path):
    """Create a temporary DB with resolved signals and snapshots for backtesting."""
    db_path = tmp_path / "backtest.db"
    db = sqlite3.connect(str(db_path))
    db.executescript("""
        CREATE TABLE divergence_signals (
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
            outcome_correct INTEGER,
            expired INTEGER DEFAULT 0,
            expired_at TEXT,
            signal_source TEXT DEFAULT 'positions'
        );
        CREATE TABLE market_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market_id TEXT,
            timestamp TEXT,
            question TEXT,
            category TEXT,
            price_yes REAL,
            volume_24h REAL,
            open_interest REAL,
            sm_yes_pct REAL,
            sm_trader_count INTEGER,
            divergence_score REAL
        );
    """)

    # Insert test signals — mix of correct and incorrect
    signals = [
        # market_id, score, market_price, sm_consensus, sm_direction, outcome_correct, sm_traders, div_pct
        ("m1", 75, 0.40, 0.75, "YES", 1, 5, 0.35),   # correct
        ("m2", 60, 0.60, 0.25, "NO", 1, 3, 0.35),    # correct (SM said NO, was right)
        ("m3", 50, 0.30, 0.65, "YES", 0, 2, 0.35),   # incorrect
        ("m4", 80, 0.50, 0.85, "YES", 0, 4, 0.35),   # incorrect
        ("m5", 30, 0.70, 0.30, "NO", 0, 1, 0.40),    # incorrect, low quality
        ("m6", 45, 0.55, 0.20, "NO", 1, 2, 0.35),    # correct
    ]

    for mid, score, mp, smc, smd, correct, traders, div_pct in signals:
        db.execute(
            """INSERT INTO divergence_signals
               (market_id, timestamp, market_price, sm_consensus, divergence_pct,
                signal_strength, sm_trader_count, sm_direction, question, category,
                resolved, outcome_correct, expired)
               VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, 'Test', 'crypto', 1, ?, 0)""",
            (mid, mp, smc, div_pct, score, traders, smd, correct),
        )

    # Insert matching snapshots with varying OI/volume
    snapshots = [
        ("m1", 200000, 50000),   # high OI
        ("m2", 100000, 30000),   # decent
        ("m3", 80000, 20000),    # decent
        ("m4", 150000, 60000),   # high
        ("m5", 5000, 2000),      # low — should be filtered
        ("m6", 60000, 15000),    # decent
    ]

    for mid, oi, vol in snapshots:
        db.execute(
            """INSERT INTO market_snapshots
               (market_id, timestamp, question, category, price_yes,
                volume_24h, open_interest, sm_yes_pct, sm_trader_count, divergence_score)
               VALUES (?, datetime('now'), 'Test', 'crypto', 0.5, ?, ?, NULL, 0, NULL)""",
            (mid, vol, oi),
        )

    db.commit()
    db.close()
    return db_path


class TestBacktest:
    def test_baseline_no_filter(self, backtest_db):
        configs = [
            BacktestConfig(min_oi=0, min_volume_24h=0, min_sm_traders=1, min_score=0, label="no filter"),
        ]
        results = run_backtest(backtest_db, configs)
        assert len(results) == 1
        assert results[0]["signals"] == 6
        assert results[0]["hits"] == 3

    def test_oi_filter(self, backtest_db):
        configs = [
            BacktestConfig(min_oi=50000, min_volume_24h=0, min_sm_traders=1, min_score=0, label="OI>=50K"),
        ]
        results = run_backtest(backtest_db, configs)
        # m5 has OI=5000, should be filtered
        assert results[0]["signals"] == 5

    def test_sm_trader_filter(self, backtest_db):
        configs = [
            BacktestConfig(min_oi=0, min_volume_24h=0, min_sm_traders=3, min_score=0, label="3+ SM"),
        ]
        results = run_backtest(backtest_db, configs)
        # Only m1 (5), m2 (3), m4 (4) have >= 3 SM traders
        assert results[0]["signals"] == 3

    def test_combined_filters(self, backtest_db):
        configs = [
            BacktestConfig(min_oi=50000, min_volume_24h=10000, min_sm_traders=2, min_score=40, label="combined"),
        ]
        results = run_backtest(backtest_db, configs)
        # m5 filtered by OI, then check remaining with SM>=2 and score>=40
        assert results[0]["signals"] > 0
        assert results[0]["win_pct"] >= 0

    def test_roi_calculation(self, backtest_db):
        configs = [
            BacktestConfig(min_oi=0, min_volume_24h=0, min_sm_traders=1, min_score=0, label="all"),
        ]
        results = run_backtest(backtest_db, configs)
        # 3 hits out of 6, should have some ROI calculation
        assert "roi_pct" in results[0]
        assert isinstance(results[0]["roi_pct"], float)

    def test_empty_db(self, tmp_path):
        db_path = tmp_path / "empty.db"
        db = sqlite3.connect(str(db_path))
        db.executescript("""
            CREATE TABLE divergence_signals (
                id INTEGER PRIMARY KEY, market_id TEXT, timestamp TEXT,
                market_price REAL, sm_consensus REAL, divergence_pct REAL,
                signal_strength REAL, sm_trader_count INTEGER, sm_direction TEXT,
                question TEXT, category TEXT, resolved INTEGER DEFAULT 0,
                outcome_correct INTEGER, expired INTEGER DEFAULT 0, expired_at TEXT,
                signal_source TEXT
            );
            CREATE TABLE market_snapshots (
                id INTEGER PRIMARY KEY, market_id TEXT, timestamp TEXT,
                question TEXT, category TEXT, price_yes REAL,
                volume_24h REAL, open_interest REAL, sm_yes_pct REAL,
                sm_trader_count INTEGER, divergence_score REAL
            );
        """)
        db.close()

        configs = [BacktestConfig(label="empty")]
        results = run_backtest(db_path, configs)
        assert results[0]["signals"] == 0
        assert results[0]["win_pct"] == 0

    def test_multiple_configs(self, backtest_db):
        configs = [
            BacktestConfig(min_oi=0, min_volume_24h=0, min_sm_traders=1, min_score=0, label="baseline"),
            BacktestConfig(min_oi=50000, min_volume_24h=10000, min_sm_traders=2, min_score=25, label="new"),
        ]
        results = run_backtest(backtest_db, configs)
        assert len(results) == 2
        assert results[0]["signals"] >= results[1]["signals"]
