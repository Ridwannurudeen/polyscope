"""Simulate the follow_alert_loop data path end-to-end.

Seeds a synthetic bot_identity_link + follow_alert pair tied to a real
trader that has real scored accuracy, runs the same query
`get_pending_follow_alerts_with_chat` the loop uses, composes the
MarkdownV2 DM text using the loop's exact formatting rules, prints it
for inspection, then cleans up the synthetic rows. Does NOT call
Telegram.
"""

from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, "/app")

from api.database import (  # noqa: E402
    emit_follow_alerts_for_signal,
    follow_trader,
    get_db,
    get_pending_follow_alerts_with_chat,
    link_bot_identity,
    unlink_bot_identity,
)

TEST_CHAT = -999001
TEST_CLIENT = "tg_smoke_client_xyz12345"
TEST_TRADER = "0x2a2c53bd278c04da9962fcf96490e17f3dfb9bc1"

_MD_ESCAPE = str.maketrans(
    {
        "_": r"\_",
        "*": r"\*",
        "[": r"\[",
        "]": r"\]",
        "(": r"\(",
        ")": r"\)",
        "~": r"\~",
        "`": r"\`",
        ">": r"\>",
        "#": r"\#",
        "+": r"\+",
        "-": r"\-",
        "=": r"\=",
        "|": r"\|",
        "{": r"\{",
        "}": r"\}",
        ".": r"\.",
        "!": r"\!",
    }
)


def esc(s: str) -> str:
    return s.translate(_MD_ESCAPE)


async def main() -> None:
    db = await get_db()
    try:
        await follow_trader(db, TEST_TRADER, TEST_CLIENT)
        await link_bot_identity(db, TEST_CHAT, client_id=TEST_CLIENT)

        cursor = await db.execute(
            """SELECT ds.id, ds.market_id FROM divergence_signals ds
               JOIN signal_trader_positions stp ON stp.signal_id = ds.id
               WHERE stp.trader_address = ?
               ORDER BY ds.timestamp DESC LIMIT 1""",
            (TEST_TRADER,),
        )
        row = await cursor.fetchone()
        if not row:
            print("NO_SIGNAL_FOUND_FOR_TRADER")
            return
        signal_id = row["id"]
        market_id = row["market_id"]

        await emit_follow_alerts_for_signal(
            db,
            signal_id,
            market_id,
            [{"trader_address": TEST_TRADER, "position_direction": "YES"}],
        )
        await db.commit()

        pending = await get_pending_follow_alerts_with_chat(db)
        ours = [p for p in pending if p["chat_id"] == TEST_CHAT]
        print(f"pending_for_test_chat={len(ours)}")
        if not ours:
            print("FAIL: link + alert did not produce a pending row")
            return
        a = ours[0]

        trader = a["trader_address"] or ""
        addr_short = (
            (trader[:6] + "..." + trader[-4:]) if len(trader) >= 10 else trader
        )
        side_emoji = "\u2705" if a.get("position_direction") == "YES" else "\u274c"
        question = esc(str(a.get("question") or "")[:60])
        direction = a.get("position_direction") or "-"
        price = a.get("market_price")
        price_str = esc(f"{price:.0%}") if price is not None else "?"
        div = a.get("divergence_pct")
        div_str = esc(f"{div:.0%}") if div is not None else "?"
        acc = a.get("accuracy_pct")
        total = a.get("total_divergent_signals") or 0
        if acc is not None and total >= 10:
            acc_str = (
                f"\n  Trader accuracy: {esc(str(round(acc)))}%"
                f" over {esc(str(total))} signals"
            )
        else:
            acc_str = ""

        msg = (
            f"{side_emoji} *Followed trader signal*\n"
            f"`{esc(addr_short)}` just went *{esc(direction)}* on\n"
            f"*{question}*\n"
            f"Market: {price_str} YES | Divergence: {div_str}"
            f"{acc_str}"
        )
        print("--- COMPOSED DM (MarkdownV2) ---")
        print(msg)
        print("--- END ---")
    finally:
        await db.execute(
            "DELETE FROM follow_alerts WHERE follower_client_id = ?",
            (TEST_CLIENT,),
        )
        await db.execute(
            "DELETE FROM trader_follows WHERE follower_client_id = ?",
            (TEST_CLIENT,),
        )
        await unlink_bot_identity(db, TEST_CHAT)
        await db.commit()
        await db.close()


asyncio.run(main())
