"""Force trader_accuracy rebuild using the latest dedup logic."""
import asyncio
import aiosqlite
import sys

sys.path.insert(0, "/app")
from api.database import rebuild_trader_accuracy, DB_PATH


async def main():
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        n = await rebuild_trader_accuracy(db)
        await db.commit()
        print(f"rebuilt {n} trader rows")


asyncio.run(main())
