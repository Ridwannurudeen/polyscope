"""Backtest harness — compare signal quality across different configs."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path


@dataclass
class BacktestConfig:
    min_oi: float = 50000
    min_volume_24h: float = 10000
    min_sm_traders: int = 2
    min_divergence_pct: float = 0.10
    min_score: float = 25
    label: str = ""
    # Per-trader accuracy filter. When min_contributor_accuracy is set, a
    # signal passes only if the average of its contributors' accuracy_pct
    # (across traders with >=min_contributor_signals observations) is at
    # or above the threshold.
    min_contributor_accuracy: float | None = None
    min_contributor_signals: int = 10
    # Strategy simulation. The DB stores the live strategy (fade-SM
    # everywhere). This flips sm_direction + outcome_correct on bands
    # listed here so we can see what a different strategy would score.
    # Valid bands: "tight", "moderate", "lopsided", "very_lopsided".
    follow_sm_bands: tuple[str, ...] = ()


def _skew_band(price: float) -> str:
    if price >= 0.9 or price <= 0.1:
        return "very_lopsided"
    if price >= 0.75 or price <= 0.25:
        return "lopsided"
    if price >= 0.6 or price <= 0.4:
        return "moderate"
    return "tight"


def _signal_roi(signal: dict) -> float:
    """Return per $100 wagered on the signal's recommended side."""
    if signal["outcome_correct"] != 1:
        return 0.0
    direction = signal["sm_direction"]
    price = signal["market_price"]
    buy_price = max(price, 0.01) if direction == "YES" else max(1.0 - price, 0.01)
    return (1.0 / buy_price) * 100


def _load_contributor_accuracy(
    db: sqlite3.Connection, min_signals: int
) -> dict[str, dict[str, float]]:
    """Map best-per-market signal_id -> {avg_acc, n_contributors, n_scored}.

    Uses first-observed signal per (trader, market) pair to avoid
    duplicating a trader's prediction across re-scans. Traders below
    min_signals are treated as unscored.
    """
    rows = db.execute(
        """
        WITH first_pos AS (
            SELECT stp.signal_id, stp.trader_address
            FROM signal_trader_positions stp
            JOIN (
                SELECT trader_address, market_id, MIN(id) AS first_id
                FROM signal_trader_positions
                GROUP BY trader_address, market_id
            ) f ON f.first_id = stp.id
        )
        SELECT fp.signal_id, fp.trader_address, ta.accuracy_pct,
               ta.total_divergent_signals
        FROM first_pos fp
        LEFT JOIN trader_accuracy ta ON ta.trader_address = fp.trader_address
        """
    ).fetchall()

    buckets: dict[int, list[float]] = {}
    counts: dict[int, int] = {}
    for signal_id, _trader, acc, total in rows:
        counts[signal_id] = counts.get(signal_id, 0) + 1
        if (
            acc is not None
            and total is not None
            and total >= min_signals
        ):
            buckets.setdefault(signal_id, []).append(acc)

    out: dict[int, dict[str, float]] = {}
    for sid, n in counts.items():
        scored = buckets.get(sid, [])
        out[sid] = {
            "avg_acc": sum(scored) / len(scored) if scored else -1.0,
            "n_contributors": float(n),
            "n_scored": float(len(scored)),
        }
    return out


def run_backtest(db_path: str | Path, configs: list[BacktestConfig]) -> list[dict]:
    """Run backtest against resolved signals in the database.

    For each config: filter the best-per-market resolved signals that meet the
    config's thresholds, then compute hit rate and simulated ROI.
    """
    db = sqlite3.connect(str(db_path))
    db.row_factory = sqlite3.Row

    rows = db.execute(
        """SELECT ds.id, ds.market_id, ds.signal_strength, ds.market_price,
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

    if not rows:
        db.close()
        return [
            {"label": c.label, "signals": 0, "hits": 0, "win_pct": 0, "roi_pct": 0}
            for c in configs
        ]

    # Keep strongest signal per market (by signal_strength).
    best_by_market: dict[str, dict] = {}
    for r in rows:
        r_dict = dict(r)
        mid = r_dict["market_id"]
        if (
            mid not in best_by_market
            or r_dict["signal_strength"] > best_by_market[mid]["signal_strength"]
        ):
            best_by_market[mid] = r_dict

    # Only load contributor accuracy if any config needs it.
    needs_contrib = any(c.min_contributor_accuracy is not None for c in configs)
    contrib_map = (
        _load_contributor_accuracy(db, min(c.min_contributor_signals for c in configs))
        if needs_contrib
        else {}
    )
    db.close()

    def _apply_strategy(s: dict, follow_bands: tuple[str, ...]) -> dict:
        """Flip sm_direction + outcome_correct for signals in follow_bands.

        DB holds the live fade-SM strategy. Flipping inverts to pro-SM on
        the given bands so we can measure counterfactual performance.
        """
        if not follow_bands:
            return s
        if _skew_band(s["market_price"]) not in follow_bands:
            return s
        s2 = dict(s)
        s2["sm_direction"] = "NO" if s["sm_direction"] == "YES" else "YES"
        if s["outcome_correct"] is not None:
            s2["outcome_correct"] = 1 - s["outcome_correct"]
        return s2

    results = []
    for cfg in configs:
        filtered: list[dict] = []
        for raw in best_by_market.values():
            s = _apply_strategy(raw, cfg.follow_sm_bands)
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
            if cfg.min_contributor_accuracy is not None:
                c = contrib_map.get(s["id"])
                if not c or c["n_scored"] == 0:
                    continue
                if c["avg_acc"] < cfg.min_contributor_accuracy:
                    continue
            filtered.append(s)

        hits = sum(1 for s in filtered if s["outcome_correct"] == 1)
        total = len(filtered)
        win_pct = (hits / total * 100) if total > 0 else 0

        total_wagered = total * 100
        total_return = sum(_signal_roi(s) for s in filtered)
        roi_pct = (
            ((total_return - total_wagered) / max(total_wagered, 1)) * 100
            if total_wagered > 0
            else 0
        )

        # Stratify by skew band so composition effects are visible.
        by_band: dict[str, dict[str, float]] = {
            b: {"n": 0, "hits": 0, "wagered": 0.0, "returned": 0.0}
            for b in ("very_lopsided", "lopsided", "moderate", "tight")
        }
        for s in filtered:
            band = _skew_band(s["market_price"])
            b = by_band[band]
            b["n"] += 1
            b["hits"] += 1 if s["outcome_correct"] == 1 else 0
            b["wagered"] += 100
            b["returned"] += _signal_roi(s)

        band_summary = {}
        for band, b in by_band.items():
            n = int(b["n"])
            if n == 0:
                continue
            band_summary[band] = {
                "n": n,
                "win_pct": round(b["hits"] / n * 100, 1),
                "roi_pct": round(
                    (b["returned"] - b["wagered"]) / max(b["wagered"], 1) * 100, 1
                ),
            }

        results.append(
            {
                "label": cfg.label
                or f"OI>={cfg.min_oi/1000:.0f}K,SM>={cfg.min_sm_traders}",
                "signals": total,
                "hits": hits,
                "win_pct": round(win_pct, 1),
                "roi_pct": round(roi_pct, 1),
                "by_band": band_summary,
            }
        )

    return results


def print_backtest_table(results: list[dict]):
    """Print results as a formatted comparison table."""
    header = f"{'Config':<40} | {'Signals':>7} | {'Hits':>5} | {'Win%':>6} | {'ROI%':>7}"
    sep = "-" * len(header)
    print(sep)
    print(header)
    print(sep)
    for r in results:
        print(
            f"{r['label']:<40} | {r['signals']:>7} | {r['hits']:>5} | "
            f"{r['win_pct']:>5.1f}% | {r['roi_pct']:>6.1f}%"
        )
    print(sep)

    # Per-skew breakdown
    for r in results:
        if not r.get("by_band"):
            continue
        print(f"\n  {r['label']}  — by skew band:")
        for band in ("tight", "moderate", "lopsided", "very_lopsided"):
            b = r["by_band"].get(band)
            if not b:
                continue
            print(
                f"    {band:<15} n={b['n']:>5}  win={b['win_pct']:>5.1f}%  roi={b['roi_pct']:>6.1f}%"
            )


if __name__ == "__main__":
    import sys

    db_path = Path(__file__).parent.parent.parent / "data" / "polyscope.db"

    if len(sys.argv) > 1:
        db_path = Path(sys.argv[1])

    if not db_path.exists():
        print(f"Database not found: {db_path}")
        sys.exit(1)

    configs = [
        BacktestConfig(
            min_oi=1000,
            min_volume_24h=0,
            min_sm_traders=1,
            min_score=0,
            label="Old baseline (OI>=$1K)",
        ),
        BacktestConfig(
            min_oi=50000,
            min_volume_24h=10000,
            min_sm_traders=1,
            min_score=25,
            label="New defaults",
        ),
        BacktestConfig(
            min_oi=50000,
            min_volume_24h=10000,
            min_sm_traders=2,
            min_score=25,
            label="New + 2 SM traders",
        ),
        BacktestConfig(
            min_oi=50000,
            min_volume_24h=10000,
            min_sm_traders=3,
            min_score=25,
            label="New + 3 SM traders",
        ),
        BacktestConfig(
            min_oi=100000,
            min_volume_24h=25000,
            min_sm_traders=2,
            min_score=40,
            label="High quality only",
        ),
        BacktestConfig(
            min_oi=50000,
            min_volume_24h=10000,
            min_sm_traders=1,
            min_score=25,
            min_contributor_accuracy=70.0,
            min_contributor_signals=10,
            label="Contributors avg acc >= 70%",
        ),
        BacktestConfig(
            min_oi=50000,
            min_volume_24h=10000,
            min_sm_traders=1,
            min_score=25,
            min_contributor_accuracy=80.0,
            min_contributor_signals=10,
            label="Contributors avg acc >= 80%",
        ),
        BacktestConfig(
            min_oi=50000,
            min_volume_24h=10000,
            min_sm_traders=1,
            min_score=25,
            min_contributor_accuracy=90.0,
            min_contributor_signals=10,
            label="Contributors avg acc >= 90%",
        ),
        BacktestConfig(
            min_oi=50000,
            min_volume_24h=10000,
            min_sm_traders=1,
            min_score=25,
            follow_sm_bands=("tight", "moderate"),
            label="Follow-SM on tight+moderate",
        ),
        BacktestConfig(
            min_oi=50000,
            min_volume_24h=10000,
            min_sm_traders=1,
            min_score=25,
            follow_sm_bands=("tight", "moderate", "lopsided"),
            label="Follow-SM on tight+moderate+lopsided",
        ),
        BacktestConfig(
            min_oi=50000,
            min_volume_24h=10000,
            min_sm_traders=1,
            min_score=25,
            follow_sm_bands=("tight", "moderate", "lopsided", "very_lopsided"),
            label="Follow-SM everywhere",
        ),
    ]

    results = run_backtest(db_path, configs)
    print_backtest_table(results)
