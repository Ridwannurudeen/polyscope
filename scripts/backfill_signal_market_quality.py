"""Backfill divergence_signals.open_interest and volume_24h from market_snapshots.

Run once after deploying the schema migration. New signals are populated at
creation time; this fills in historical rows so the methodology query can
drop the 4M-row aggregate.

Strategy: do the aggregate once into a temp table (the same scan the old
methodology query used to do on every call), then UPDATE divergence_signals
via JOIN. One slow scan beats N small queries.
"""
import asyncio
import sys
import time

import aiosqlite

sys.path.insert(0, "/app")
from api.database import DB_PATH


async def main():
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=300000")

        cursor = await db.execute(
            """SELECT COUNT(*) FROM divergence_signals
               WHERE open_interest IS NULL AND resolved = 1
                     AND outcome_correct IS NOT NULL"""
        )
        pending = (await cursor.fetchone())[0]
        print(f"pending resolved signals to backfill: {pending}")
        if pending == 0:
            print("nothing to do")
            return

        cursor = await db.execute(
            """SELECT COUNT(DISTINCT market_id) FROM divergence_signals
               WHERE open_interest IS NULL AND resolved = 1
                     AND outcome_correct IS NOT NULL"""
        )
        distinct_markets = (await cursor.fetchone())[0]
        print(f"distinct markets to aggregate: {distinct_markets}")

        t0 = time.time()
        print("step 1/3: aggregating market_snapshots into temp table...")
        await db.execute(
            """CREATE TEMP TABLE _market_quality AS
               SELECT market_id,
                      MAX(open_interest) AS open_interest,
                      MAX(volume_24h) AS volume_24h
               FROM market_snapshots
               WHERE market_id IN (
                   SELECT DISTINCT market_id FROM divergence_signals
                   WHERE open_interest IS NULL AND resolved = 1
                         AND outcome_correct IS NOT NULL
               )
               GROUP BY market_id"""
        )
        await db.execute(
            "CREATE INDEX _idx_mq_mid ON _market_quality(market_id)"
        )
        cursor = await db.execute("SELECT COUNT(*) FROM _market_quality")
        agg_rows = (await cursor.fetchone())[0]
        print(f"  aggregated {agg_rows} markets in {time.time()-t0:.1f}s")

        t1 = time.time()
        print("step 2/3: updating divergence_signals via join...")
        cursor = await db.execute(
            """UPDATE divergence_signals
               SET open_interest = (
                       SELECT open_interest FROM _market_quality
                       WHERE _market_quality.market_id = divergence_signals.market_id
                   ),
                   volume_24h = (
                       SELECT volume_24h FROM _market_quality
                       WHERE _market_quality.market_id = divergence_signals.market_id
                   )
               WHERE open_interest IS NULL AND resolved = 1
                     AND outcome_correct IS NOT NULL
                     AND market_id IN (SELECT market_id FROM _market_quality)"""
        )
        updated = cursor.rowcount or 0
        await db.commit()
        print(f"  updated {updated} signals in {time.time()-t1:.1f}s")

        t2 = time.time()
        print("step 3/3: backfilling signals whose markets have no snapshot...")
        cursor = await db.execute(
            """UPDATE divergence_signals
               SET open_interest = 0, volume_24h = 0
               WHERE open_interest IS NULL AND resolved = 1
                     AND outcome_correct IS NOT NULL"""
        )
        zeroed = cursor.rowcount or 0
        await db.commit()
        print(f"  zeroed {zeroed} orphan signals in {time.time()-t2:.1f}s")

        print(f"done. total {time.time()-t0:.1f}s")


if __name__ == "__main__":
    asyncio.run(main())
