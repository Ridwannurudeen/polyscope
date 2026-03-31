"""Backtest harness — compare signal quality across different configs."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class BacktestConfig:
    min_oi: float = 50000
    min_volume_24h: float = 10000
    min_sm_traders: int = 2
    min_divergence_pct: float = 0.10
    min_score: float = 25
    label: str = ""


def run_backtest(db_path: str | Path, configs: list[BacktestConfig]) -> list[dict]:
    """Run backtest against resolved signals in the database.

    For each config: filter the best-per-market resolved signals that meet the
    config's thresholds, then compute hit rate and simulated ROI.
    """
    db = sqlite3.connect(str(db_path))
    db.row_factory = sqlite3.Row

    # Load all resolved signals with their snapshot context
    rows = db.execute(
        """SELECT ds.market_id, ds.signal_strength, ds.market_price,
                  ds.sm_consensus, ds.sm_direction, ds.outcome_correct,
                  ds.sm_trader_count, ds.divergence_pct,
                  ms.open_interest, ms.volume_24h
           FROM divergence_signals ds
           LEFT JOIN (
               SELECT market_id, MAX(open_interest) as open_interest,
                      MAX(volume_24h) as volume_24h
               FROM market_snapshots
               GROUP BY market_id
           ) ms ON ms.market_id = ds.market_id
           WHERE ds.resolved = 1 AND ds.outcome_correct IS NOT NULL
                 AND (ds.expired = 0 OR ds.expired IS NULL)"""
    ).fetchall()

    db.close()

    if not rows:
        return [{"label": c.label, "signals": 0, "hits": 0, "win_pct": 0, "roi_pct": 0}
                for c in configs]

    # Group by market_id, keep strongest signal per market
    best_by_market: dict[str, dict] = {}
    for r in rows:
        r_dict = dict(r)
        mid = r_dict["market_id"]
        if mid not in best_by_market or r_dict["signal_strength"] > best_by_market[mid]["signal_strength"]:
            best_by_market[mid] = r_dict

    results = []
    for cfg in configs:
        filtered = []
        for s in best_by_market.values():
            oi = s.get("open_interest") or 0
            vol = s.get("volume_24h") or 0
            quality = max(oi, vol)
            if quality < cfg.min_oi:
                continue
            if vol < cfg.min_volume_24h:
                continue
            if (s.get("sm_trader_count") or 0) < cfg.min_sm_traders:
                continue
            if (s.get("divergence_pct") or 0) < cfg.min_divergence_pct:
                continue
            if (s.get("signal_strength") or 0) < cfg.min_score:
                continue
            filtered.append(s)

        hits = sum(1 for s in filtered if s["outcome_correct"] == 1)
        total = len(filtered)
        win_pct = (hits / total * 100) if total > 0 else 0

        # ROI simulation: $100 per signal
        total_wagered = total * 100
        total_return = 0.0
        for s in filtered:
            if s["outcome_correct"] == 1:
                direction = s["sm_direction"]
                price = s["market_price"]
                buy_price = max(price, 0.01) if direction == "YES" else max(1.0 - price, 0.01)
                total_return += (1.0 / buy_price) * 100

        roi_pct = ((total_return - total_wagered) / max(total_wagered, 1)) * 100 if total_wagered > 0 else 0

        results.append({
            "label": cfg.label or f"OI>={cfg.min_oi/1000:.0f}K,SM>={cfg.min_sm_traders}",
            "signals": total,
            "hits": hits,
            "win_pct": round(win_pct, 1),
            "roi_pct": round(roi_pct, 1),
        })

    return results


def print_backtest_table(results: list[dict]):
    """Print results as a formatted comparison table."""
    header = f"{'Config':<30} | {'Signals':>7} | {'Hits':>4} | {'Win%':>6} | {'ROI%':>7}"
    sep = "-" * len(header)
    print(sep)
    print(header)
    print(sep)
    for r in results:
        print(
            f"{r['label']:<30} | {r['signals']:>7} | {r['hits']:>4} | "
            f"{r['win_pct']:>5.1f}% | {r['roi_pct']:>6.1f}%"
        )
    print(sep)


if __name__ == "__main__":
    import sys

    db_path = Path(__file__).parent.parent.parent / "data" / "polyscope.db"

    if len(sys.argv) > 1:
        db_path = Path(sys.argv[1])

    if not db_path.exists():
        print(f"Database not found: {db_path}")
        sys.exit(1)

    configs = [
        BacktestConfig(min_oi=1000, min_volume_24h=0, min_sm_traders=1, min_score=0, label="Old baseline (OI>=$1K)"),
        BacktestConfig(min_oi=50000, min_volume_24h=10000, min_sm_traders=1, min_score=25, label="New defaults"),
        BacktestConfig(min_oi=50000, min_volume_24h=10000, min_sm_traders=2, min_score=25, label="New + 2 SM traders"),
        BacktestConfig(min_oi=50000, min_volume_24h=10000, min_sm_traders=3, min_score=25, label="New + 3 SM traders"),
        BacktestConfig(min_oi=100000, min_volume_24h=25000, min_sm_traders=2, min_score=40, label="High quality only"),
    ]

    results = run_backtest(db_path, configs)
    print_backtest_table(results)
