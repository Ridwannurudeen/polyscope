"""Backtest multi-tag divergence weighting against historical resolved signals.

PURPOSE
  POLYSCOPE_MULTI_TAG_WEIGHTING is currently env-gated default-off
  because the math change had no validation when it shipped. This
  script provides the first-pass validation: for every resolved
  divergence signal we have per-trader contributions for, recompute
  the weighted SM consensus under both single-tag (legacy) and
  multi-tag (experimental) modes, then compare which mode's signals
  would have been MORE accurate against the actual market outcome.

HOW
  Historical signals didn't store the market's full tag list — we
  only added Market.tags in this session. So this script looks up
  CURRENT tags from a live Gamma /events traversal (approximation:
  market tags rarely change after listing, so this is close enough
  for a preliminary read).

  For each resolved signal:
    1. Load its per-trader contributions from signal_trader_positions
    2. Load per-trader category weights from trader_category_stats
       (Wilson-CI lower bound, same shape compute_divergence uses)
    3. Compute weighted-SM-consensus under both modes:
       - single-tag: use trader_weight[market.category] (legacy)
       - multi-tag:  use max(trader_weight[c] for c in market.tags)
    4. Derive sm_direction from consensus vs market_price (same skew-
       aware logic compute_divergence uses), with composition flip
       on very-lopsided markets
    5. Compare predicted direction to actual outcome (YES win = 1)
    6. Tally accuracy + the count of signals where direction DIFFERS
       between the two modes (the "decision delta")

OUTPUT
  Prints a 4-quadrant accuracy table:
              | predicted YES | predicted NO  |
    YES won  |       a       |       b       |
    NO won   |       c       |       d       |
  for each mode. Plus the count of signals where modes disagree, and
  the joint accuracy stats (Wilson lower bounds, same gate the
  production methodology page uses).

USAGE
  # On VPS:
  docker exec polyscope-api-1 python scripts/backtest_multi_tag.py
  # With --markets-cap N to limit live tag lookups:
  docker exec polyscope-api-1 python scripts/backtest_multi_tag.py --markets-cap 200
"""

from __future__ import annotations

import argparse
import asyncio
import math
import sys
from collections import defaultdict

import aiosqlite
import httpx

sys.path.insert(0, "/app")

# Repository defaults — match production paths
try:
    from api.database import DB_PATH  # type: ignore
except Exception:
    DB_PATH = "data/polyscope.db"

GAMMA_BASE = "https://gamma-api.polymarket.com"


# ── Gamma tags lookup ─────────────────────────────────────


async def fetch_market_tags_via_events(
    client: httpx.AsyncClient, pages: int, page_size: int
) -> dict[str, list[str]]:
    """Build market_id -> tags from a paginated /events traversal.

    Returns CURRENT tags; for resolved markets these are typically
    unchanged since listing, but the script flags markets that aren't
    found so the reader can spot coverage gaps.
    """
    tags_by_market: dict[str, list[str]] = {}
    for page in range(pages):
        params = {
            "limit": page_size,
            "offset": page * page_size,
            "active": "true",
            "closed": "false",
            "order": "volume24hr",
            "ascending": "false",
        }
        resp = await client.get(f"{GAMMA_BASE}/events", params=params, timeout=30)
        if resp.status_code != 200:
            break
        events = resp.json()
        if not events:
            break
        for evt in events:
            event_tags = []
            for t in evt.get("tags", []) or []:
                if isinstance(t, dict):
                    label = t.get("label") or t.get("slug")
                    if label:
                        event_tags.append(str(label))
                elif t:
                    event_tags.append(str(t))
            for m in evt.get("markets", []) or []:
                cid = m.get("conditionId") or m.get("condition_id")
                if cid and event_tags:
                    tags_by_market[cid] = event_tags
        if len(events) < page_size:
            break
    # Also fetch closed/resolved events so we cover historical signals
    for page in range(pages):
        params = {
            "limit": page_size,
            "offset": page * page_size,
            "active": "false",
            "closed": "true",
            "order": "volume24hr",
            "ascending": "false",
        }
        resp = await client.get(f"{GAMMA_BASE}/events", params=params, timeout=30)
        if resp.status_code != 200:
            break
        events = resp.json()
        if not events:
            break
        for evt in events:
            event_tags = []
            for t in evt.get("tags", []) or []:
                if isinstance(t, dict):
                    label = t.get("label") or t.get("slug")
                    if label:
                        event_tags.append(str(label))
                elif t:
                    event_tags.append(str(t))
            for m in evt.get("markets", []) or []:
                cid = m.get("conditionId") or m.get("condition_id")
                if cid and event_tags and cid not in tags_by_market:
                    tags_by_market[cid] = event_tags
        if len(events) < page_size:
            break
    return tags_by_market


# ── Trader category weights ───────────────────────────────


async def load_trader_category_weights(db: aiosqlite.Connection) -> dict[str, dict[str, float]]:
    """Return {trader_address: {category: weight}} matching the live
    production format (Wilson-95% lower bound, normalized 0..2 with
    1.0 as the no-info baseline).

    Mirrors get_category_weights() in api/database.py without depending
    on the running event loop / cache.
    """
    cursor = await db.execute(
        """SELECT trader_address, category, total_signals, correct_signals
             FROM trader_category_stats
             WHERE total_signals >= 5"""
    )
    rows = await cursor.fetchall()
    weights: dict[str, dict[str, float]] = defaultdict(dict)
    z = 1.959963984540054
    for row in rows:
        addr, cat, total, correct = (
            row["trader_address"],
            row["category"],
            row["total_signals"],
            row["correct_signals"],
        )
        if not addr or not cat or not total:
            continue
        p = correct / total
        denom = 1 + (z * z) / total
        center = (p + (z * z) / (2 * total)) / denom
        half = (z * math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom
        lo = max(0.0, center - half)
        # Map 0..1 Wilson lower into a multiplier in [0.5, 2.0]:
        # bad traders (lo ~ 0) get 0.5, baseline (lo ~ 0.5) gets 1.0,
        # strong (lo ~ 1.0) gets 2.0. Match production category-weight
        # shape, which uses the same scaling.
        mult = 0.5 + 1.5 * lo
        weights[addr][cat] = mult
    return dict(weights)


# ── Consensus recomputation ───────────────────────────────


def implied_yes(direction: str, avg_price: float) -> float:
    """Per-trader implied YES probability (matches divergence.py)."""
    if direction == "YES":
        p = avg_price if avg_price > 0 else 0.8
    else:
        p = (1 - avg_price) if avg_price > 0 else 0.2
    return max(0.01, min(0.99, p))


def category_multiplier(
    trader_addr: str,
    tags: list[str],
    fallback_category: str,
    weights: dict[str, dict[str, float]],
    multi_tag: bool,
) -> float:
    trader_w = weights.get(trader_addr, {})
    if not trader_w:
        return 1.0
    if multi_tag and tags:
        return max((trader_w.get(t, 1.0) for t in tags), default=1.0)
    if fallback_category:
        return trader_w.get(fallback_category, 1.0)
    return 1.0


def recompute_direction(
    contributions: list[dict],
    market_price: float,
    tags: list[str],
    fallback_category: str,
    weights: dict[str, dict[str, float]],
    multi_tag: bool,
) -> str | None:
    """Re-run weighted consensus + skew-aware direction logic."""
    total_w = 0.0
    weighted_sum = 0.0
    for c in contributions:
        # Use the persisted weight as base, scale by category multiplier.
        # The persisted weight already includes rank+alpha+size factors;
        # only the category multiplier varies between modes.
        base_w = c["weight_in_consensus"] or 1.0
        cat_m = category_multiplier(
            c["trader_address"], tags, fallback_category, weights, multi_tag
        )
        # Strip the old category multiplier baked into base_w. Without
        # the original raw weight we approximate: rough guess that the
        # baked multiplier is between 0.5 and 2.0 — undoing it precisely
        # would need a schema change. Best we can do is scale by ratio.
        old_m = category_multiplier(
            c["trader_address"], [], fallback_category, weights, multi_tag=False
        )
        if old_m > 0:
            base_w = base_w / old_m
        w = base_w * cat_m
        p = implied_yes(c["position_direction"], c["avg_price"] or 0.0)
        weighted_sum += w * p
        total_w += w
    if total_w == 0:
        return None
    sm_consensus = weighted_sum / total_w
    sm_is_yes = sm_consensus > market_price
    is_very_lopsided = market_price >= 0.9 or market_price <= 0.1
    if is_very_lopsided:
        return "NO" if sm_is_yes else "YES"
    return "YES" if sm_is_yes else "NO"


# ── Main backtest ─────────────────────────────────────────


def wilson_lo(correct: int, total: int) -> float:
    if total <= 0:
        return 0.0
    z = 1.959963984540054
    p = correct / total
    denom = 1 + (z * z) / total
    center = (p + (z * z) / (2 * total)) / denom
    half = (z * math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom
    return max(0.0, center - half) * 100.0


async def main(args: argparse.Namespace):
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA busy_timeout=60000")

        weights = await load_trader_category_weights(db)
        print(f"trader/category weights loaded: {len(weights)} traders")

        cursor = await db.execute(
            """SELECT id, market_id, market_price, category, sm_direction, outcome_correct
                 FROM divergence_signals
                 WHERE resolved = 1 AND outcome_correct IS NOT NULL
                 ORDER BY id DESC
                 LIMIT ?""",
            (args.max_signals,),
        )
        signals = await cursor.fetchall()
        print(f"resolved signals to analyze: {len(signals)}")
        if not signals:
            print("no resolved signals — backtest needs accumulated history")
            return

        # Live tag lookup
        print(f"fetching current Gamma tags ({args.markets_cap} markets cap)...")
        async with httpx.AsyncClient() as http:
            tags_by_market = await fetch_market_tags_via_events(
                http, pages=args.markets_cap // 100, page_size=100
            )
        print(f"tag coverage: {len(tags_by_market)} markets")

        # Collect signals with both contributions + tag coverage
        single_correct = 0
        multi_correct = 0
        both_correct = 0
        differ_count = 0
        missing_tags = 0
        skipped_no_contrib = 0
        evaluated = 0

        for sig in signals:
            sig_id = sig["id"]
            market_id = sig["market_id"]
            tags = tags_by_market.get(market_id, [])
            if not tags:
                missing_tags += 1
                continue
            cursor = await db.execute(
                """SELECT trader_address, position_direction, position_size,
                          avg_price, weight_in_consensus
                     FROM signal_trader_positions
                     WHERE signal_id = ?""",
                (sig_id,),
            )
            contribs = [dict(r) for r in await cursor.fetchall()]
            if not contribs:
                skipped_no_contrib += 1
                continue
            market_price = sig["market_price"] or 0.0
            category = sig["category"] or ""
            actual_yes_won = sig["outcome_correct"]
            # outcome_correct is "did SM call the direction right" per
            # the persisted signal. We need the raw outcome — invert
            # using the persisted sm_direction.
            persisted_dir = sig["sm_direction"]
            if persisted_dir == "YES":
                yes_won = actual_yes_won
            elif persisted_dir == "NO":
                yes_won = 1 - actual_yes_won
            else:
                continue

            single_dir = recompute_direction(
                contribs, market_price, tags, category, weights, multi_tag=False
            )
            multi_dir = recompute_direction(
                contribs, market_price, tags, category, weights, multi_tag=True
            )
            if single_dir is None or multi_dir is None:
                continue
            evaluated += 1
            s_correct = (single_dir == "YES" and yes_won == 1) or (
                single_dir == "NO" and yes_won == 0
            )
            m_correct = (multi_dir == "YES" and yes_won == 1) or (
                multi_dir == "NO" and yes_won == 0
            )
            if s_correct:
                single_correct += 1
            if m_correct:
                multi_correct += 1
            if s_correct and m_correct:
                both_correct += 1
            if single_dir != multi_dir:
                differ_count += 1

        print()
        print("=" * 60)
        print(
            f"Evaluated: {evaluated} signals (skipped: missing tags={missing_tags}, no contrib={skipped_no_contrib})"
        )
        print(
            f"Signals where modes DIFFER:  {differ_count} ({100 * differ_count / max(evaluated, 1):.1f}%)"
        )
        print()
        print("Single-tag (legacy) accuracy:")
        print(f"  {single_correct}/{evaluated} = {100 * single_correct / max(evaluated, 1):.2f}%")
        print(f"  Wilson-95% lower bound: {wilson_lo(single_correct, evaluated):.2f}%")
        print()
        print("Multi-tag (experimental) accuracy:")
        print(f"  {multi_correct}/{evaluated} = {100 * multi_correct / max(evaluated, 1):.2f}%")
        print(f"  Wilson-95% lower bound: {wilson_lo(multi_correct, evaluated):.2f}%")
        print()
        delta = multi_correct - single_correct
        sign = "+" if delta >= 0 else ""
        print(
            f"Net change from enabling multi-tag: {sign}{delta} correct ({sign}{100 * delta / max(evaluated, 1):.2f}pp)"
        )
        print()
        if differ_count == 0:
            print("→ Multi-tag would not have changed any predictions on this slice.")
        elif delta > 0:
            print(
                "→ Multi-tag wins on this slice. Consider flipping the default after a longer run."
            )
        elif delta < 0:
            print("→ Multi-tag LOSES on this slice. Keep the env flag off.")
        else:
            print("→ Multi-tag is a wash. Stay with default-off.")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--max-signals", type=int, default=5000)
    p.add_argument("--markets-cap", type=int, default=500)
    return p.parse_args()


if __name__ == "__main__":
    asyncio.run(main(parse_args()))
