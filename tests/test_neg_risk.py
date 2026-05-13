"""Tests for the neg_risk plumbing — Market parsing through DB persistence."""

from __future__ import annotations

import aiosqlite

from polyscope.divergence import compute_divergence
from polyscope.models import Market, Position, Trader
from polyscope.polymarket import PolymarketClient


# ── Parse from Gamma payload ──────────────────────────────


def test_parse_market_captures_neg_risk_true():
    raw = {
        "conditionId": "0xabc",
        "question": "Who wins the 2028 election?",
        "slug": "election-2028",
        "negRisk": True,
        "clobTokenIds": ["tok-a", "tok-b"],
        "outcomePrices": ["0.4", "0.6"],
        "volume24hr": 200000,
    }
    market = PolymarketClient._parse_market(raw)
    assert market.neg_risk is True


def test_parse_market_captures_neg_risk_false_default():
    raw = {
        "conditionId": "0xdef",
        "question": "Will it rain tomorrow?",
        "slug": "rain",
        "clobTokenIds": ["tok-c", "tok-d"],
        "outcomePrices": ["0.3", "0.7"],
        "volume24hr": 50000,
    }
    market = PolymarketClient._parse_market(raw)
    assert market.neg_risk is False


def test_parse_market_accepts_snake_case_fallback():
    raw = {
        "conditionId": "0xghi",
        "question": "Will Mars colonization start by 2035?",
        "slug": "mars",
        "neg_risk": True,
        "clobTokenIds": ["tok-e", "tok-f"],
        "outcomePrices": ["0.1", "0.9"],
        "volume24hr": 100000,
    }
    market = PolymarketClient._parse_market(raw)
    assert market.neg_risk is True


# ── Signal forwards neg_risk from Market ──────────────────


def _make_traders(n: int) -> dict[str, Trader]:
    return {f"0xaddr{i}": Trader(address=f"0xaddr{i}", rank=i + 1) for i in range(n)}


def _make_positions(market_id: str, n: int) -> list[Position]:
    return [
        Position(trader_address=f"0xaddr{i}", market_id=market_id, side="YES", size=1000)
        for i in range(n)
    ]


def test_divergence_signal_carries_neg_risk_true():
    market = Market(
        condition_id="0xneg",
        question="Multi-outcome event",
        slug="multi",
        price_yes=0.3,
        price_no=0.7,
        volume_24h=200000,
        open_interest=200000,
        neg_risk=True,
    )
    sig = compute_divergence(market, _make_positions("0xneg", 5), _make_traders(5))
    # Strong divergence between market_price 0.3 and SM consensus near 1.0
    # should produce a signal.
    assert sig is not None
    assert sig.neg_risk is True


def test_divergence_signal_defaults_neg_risk_false():
    market = Market(
        condition_id="0xbin",
        question="Binary event",
        slug="binary",
        price_yes=0.3,
        price_no=0.7,
        volume_24h=200000,
        open_interest=200000,
        # neg_risk defaults to False
    )
    sig = compute_divergence(market, _make_positions("0xbin", 5), _make_traders(5))
    assert sig is not None
    assert sig.neg_risk is False


# ── DB persistence round-trips neg_risk ───────────────────


async def test_save_divergence_signal_persists_neg_risk(tmp_path):
    """Round-trip via the actual save path + raw SELECT to confirm column is written."""
    from api.database import save_divergence_signal

    db_path = tmp_path / "test.db"
    async with aiosqlite.connect(str(db_path)) as db:
        db.row_factory = aiosqlite.Row
        await db.executescript(
            """
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
                open_interest REAL,
                volume_24h REAL,
                signal_source TEXT,
                expired INTEGER DEFAULT 0,
                expired_at TEXT,
                neg_risk INTEGER DEFAULT 0
            );
            """
        )
        await db.commit()

        signal_id = await save_divergence_signal(
            db,
            {
                "market_id": "0xneg",
                "timestamp": "2026-05-13T12:00:00Z",
                "market_price": 0.30,
                "sm_consensus": 0.70,
                "divergence_pct": 0.40,
                "score": 60.0,
                "sm_trader_count": 5,
                "sm_direction": "YES",
                "question": "Q",
                "category": "politics",
                "open_interest": 200000,
                "volume_24h": 200000,
                "neg_risk": True,
            },
        )
        await db.commit()
        assert signal_id > 0

        cursor = await db.execute(
            "SELECT neg_risk FROM divergence_signals WHERE id = ?", (signal_id,)
        )
        row = await cursor.fetchone()
        assert row["neg_risk"] == 1


async def test_save_divergence_signal_defaults_neg_risk_false(tmp_path):
    from api.database import save_divergence_signal

    db_path = tmp_path / "test.db"
    async with aiosqlite.connect(str(db_path)) as db:
        db.row_factory = aiosqlite.Row
        await db.executescript(
            """
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
                open_interest REAL,
                volume_24h REAL,
                signal_source TEXT,
                expired INTEGER DEFAULT 0,
                expired_at TEXT,
                neg_risk INTEGER DEFAULT 0
            );
            """
        )
        await db.commit()

        # No neg_risk key in the dict — should default to 0
        signal_id = await save_divergence_signal(
            db,
            {
                "market_id": "0xbin",
                "timestamp": "2026-05-13T12:00:00Z",
                "market_price": 0.30,
                "sm_consensus": 0.70,
                "divergence_pct": 0.40,
                "score": 60.0,
                "sm_trader_count": 5,
                "sm_direction": "YES",
                "question": "Q",
                "category": "weather",
                "open_interest": 200000,
                "volume_24h": 200000,
            },
        )
        await db.commit()
        cursor = await db.execute(
            "SELECT neg_risk FROM divergence_signals WHERE id = ?", (signal_id,)
        )
        row = await cursor.fetchone()
        assert row["neg_risk"] == 0
