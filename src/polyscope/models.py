from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class Market:
    condition_id: str
    question: str
    slug: str
    category: str = ""
    end_date: str = ""
    active: bool = True
    closed: bool = False
    # Token IDs for YES/NO outcomes
    token_id_yes: str = ""
    token_id_no: str = ""
    # Pricing
    price_yes: float = 0.0
    price_no: float = 0.0
    # Volume / liquidity
    volume_24h: float = 0.0
    open_interest: float = 0.0
    liquidity: float = 0.0


@dataclass
class Trader:
    address: str
    rank: int = 0
    profit: float = 0.0
    volume: float = 0.0
    markets_traded: int = 0
    name: str = ""


@dataclass
class Position:
    trader_address: str
    market_id: str
    side: str  # "YES" or "NO"
    size: float = 0.0
    avg_price: float = 0.0
    pnl: float = 0.0


@dataclass
class DivergenceSignal:
    market_id: str
    question: str
    market_price: float
    sm_consensus: float
    divergence_pct: float
    score: float
    sm_trader_count: int
    sm_direction: str  # "YES" or "NO" — what smart money favors
    category: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class MarketMover:
    market_id: str
    question: str
    category: str
    price_now: float
    price_before: float
    change_pct: float
    timeframe: str  # "1h", "24h", "7d"
    volume_24h: float = 0.0


@dataclass
class CalibrationBucket:
    bucket_low: float
    bucket_high: float
    predicted_avg: float
    actual_pct: float
    count: int
    brier_score: float


@dataclass
class ResolvedMarket:
    market_id: str
    question: str
    category: str
    final_price: float
    outcome: int  # 1=YES, 0=NO
    resolved_at: str
    brier_score: float
