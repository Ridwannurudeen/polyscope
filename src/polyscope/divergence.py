"""Counter-consensus divergence scoring engine."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from polyscope.models import DivergenceSignal, Market, Position, Trader

logger = logging.getLogger(__name__)

# Minimum thresholds to generate a signal
MIN_SM_TRADERS = 1
MIN_DIVERGENCE_SCORE = 25
MIN_MARKET_OI = 1000  # $1K minimum open interest


@dataclass
class DivergenceConfig:
    top_n_traders: int = 50
    weight_magnitude: float = 0.50
    weight_trader_count: float = 0.25
    weight_volume: float = 0.15
    weight_liquidity: float = 0.10
    min_divergence_pct: float = 0.10  # 10% minimum divergence to even consider
    min_sm_traders: int = MIN_SM_TRADERS
    min_score: float = MIN_DIVERGENCE_SCORE
    min_oi: float = MIN_MARKET_OI


def compute_divergence(
    market: Market,
    positions: list[Position],
    traders: dict[str, Trader],
    config: DivergenceConfig | None = None,
) -> DivergenceSignal | None:
    """Compute divergence between smart money consensus and market price.

    Algorithm:
    1. Filter positions to only those from ranked traders
    2. Compute weighted SM consensus (weight by inverse rank → top trader has more weight)
    3. Divergence = |market_price - sm_consensus|
    4. Score (0-100) from 4 weighted components:
       - divergence magnitude (50%)
       - SM trader count (25%)
       - SM volume (15%)
       - market liquidity as quality gate (10%)
    """
    cfg = config or DivergenceConfig()

    if market.price_yes <= 0:
        return None
    # Use volume or OI as quality gate (Gamma API doesn't always provide OI)
    quality_metric = max(market.open_interest, market.volume_24h)
    if quality_metric < cfg.min_oi:
        return None

    # Filter to positions from known top traders
    sm_positions = [p for p in positions if p.trader_address in traders]
    if len(sm_positions) < cfg.min_sm_traders:
        return None

    # Compute weighted SM consensus
    sm_consensus = _weighted_consensus(sm_positions, traders)
    if sm_consensus is None:
        return None

    market_price = market.price_yes
    divergence_pct = abs(market_price - sm_consensus)

    if divergence_pct < cfg.min_divergence_pct:
        return None

    # Determine what smart money favors
    sm_direction = "YES" if sm_consensus > market_price else "NO"

    # Score components
    magnitude_score = _score_magnitude(divergence_pct)
    count_score = _score_trader_count(len(sm_positions), cfg.top_n_traders)
    volume_score = _score_sm_volume(sm_positions)
    liquidity_score = _score_liquidity(max(market.open_interest, market.volume_24h))

    score = (
        cfg.weight_magnitude * magnitude_score
        + cfg.weight_trader_count * count_score
        + cfg.weight_volume * volume_score
        + cfg.weight_liquidity * liquidity_score
    )

    if score < cfg.min_score:
        return None

    return DivergenceSignal(
        market_id=market.condition_id,
        question=market.question,
        market_price=round(market_price, 4),
        sm_consensus=round(sm_consensus, 4),
        divergence_pct=round(divergence_pct, 4),
        score=round(score, 1),
        sm_trader_count=len(sm_positions),
        sm_direction=sm_direction,
        category=market.category,
    )


def _weighted_consensus(
    positions: list[Position], traders: dict[str, Trader]
) -> float | None:
    """Weighted average of YES probability as seen by smart money.

    Each trader's position is weighted by inverse rank:
      weight = 1 / rank (rank 1 trader has highest weight)

    A YES position implies the trader thinks YES probability should be higher.
    A NO position implies the trader thinks YES probability should be lower.
    We estimate their implied YES probability:
      - YES position: implied_yes = avg_price (they bought YES at this price, think it's worth more)
        If no avg_price, use 0.8 as default (they're bullish)
      - NO position: implied_yes = 1 - avg_price (they bought NO, bearish on YES)
        If no avg_price, use 0.2 as default (they're bearish)
    """
    total_weight = 0.0
    weighted_sum = 0.0

    for pos in positions:
        trader = traders.get(pos.trader_address)
        if not trader or trader.rank <= 0:
            continue

        weight = 1.0 / trader.rank
        # Scale weight by position size (log scale to avoid one whale dominating)
        if pos.size > 0:
            import math

            size_factor = 1.0 + math.log10(max(pos.size, 1))
            weight *= size_factor

        if pos.side == "YES":
            implied_yes = pos.avg_price if pos.avg_price > 0 else 0.8
        else:
            implied_yes = (1 - pos.avg_price) if pos.avg_price > 0 else 0.2

        # Clamp to valid probability range
        implied_yes = max(0.01, min(0.99, implied_yes))

        weighted_sum += weight * implied_yes
        total_weight += weight

    if total_weight == 0:
        return None

    return weighted_sum / total_weight


def _score_magnitude(divergence_pct: float) -> float:
    """Score divergence magnitude 0-100. 50%+ divergence = 100."""
    # Linear scale: 10% = 20, 25% = 50, 50% = 100
    return min(100, divergence_pct * 200)


def _score_trader_count(count: int, max_traders: int) -> float:
    """Score how many top traders are positioned. More = stronger signal."""
    # 1 trader = 30, 2 = 50, 5 = 75, 10+ = 100
    import math

    if count <= 0:
        return 0
    return min(100, 30 + 70 * math.log2(count) / math.log2(max(max_traders, 2)))


def _score_sm_volume(positions: list[Position]) -> float:
    """Score total SM volume. $100K+ = 100."""
    total = sum(p.size for p in positions)
    if total <= 0:
        return 0
    # $1K = 10, $10K = 50, $100K = 100
    import math

    return min(100, math.log10(max(total, 1)) * 25)


def _score_liquidity(open_interest: float) -> float:
    """Score market liquidity as quality gate. $100K+ OI = 100."""
    if open_interest <= 0:
        return 0
    import math

    return min(100, math.log10(max(open_interest, 1)) * 20)
