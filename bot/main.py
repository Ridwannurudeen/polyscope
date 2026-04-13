"""PolyScope Telegram Bot — divergence alerts, whale flow, and market intelligence."""

from __future__ import annotations

import asyncio
import logging
import os

import httpx
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_BASE = os.getenv("POLYSCOPE_API_URL", "http://localhost:8020")
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

_MD_ESCAPE = str.maketrans({
    "_": r"\_", "*": r"\*", "[": r"\[", "]": r"\]",
    "(": r"\(", ")": r"\)", "~": r"\~", "`": r"\`",
    ">": r"\>", "#": r"\#", "+": r"\+", "-": r"\-",
    "=": r"\=", "|": r"\|", "{": r"\{", "}": r"\}",
    ".": r"\.", "!": r"\!",
})


def _esc(text: str) -> str:
    """Escape Markdown V2 metacharacters in untrusted text."""
    return text.translate(_MD_ESCAPE)

DISCLAIMER = (
    "\n\n_PolyScope provides market intelligence only\\. "
    "It does not facilitate, recommend, or enable participation in prediction markets\\._"
)


async def _api_get(path: str) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{API_BASE}{path}")
            resp.raise_for_status()
            return resp.json()
    except Exception:
        logger.exception("API call failed: %s", path)
        return None


async def _api_post(path: str, json: dict | None = None) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{API_BASE}{path}", json=json or {})
            resp.raise_for_status()
            return resp.json()
    except Exception:
        logger.exception("API POST failed: %s", path)
        return None


async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "*Welcome to PolyScope*\n\n"
        "Counter\\-consensus intelligence for Polymarket\\.\n\n"
        "Commands:\n"
        "/divergences — Current counter\\-consensus signals\n"
        "/movers — Biggest probability shifts \\(24h\\)\n"
        "/market <query> — Search market details\n"
        "/whales — Recent whale trades\n"
        "/digest — Weekly\\-style summary now\n"
        "/subscribe — Whale alerts \\+ weekly digest\n"
        "/unsubscribe — Stop alerts and digest\n"
        "/threshold <amount> — Set min trade size filter\n"
        "/calibration — Polymarket accuracy summary\n"
        "/accuracy — Signal track record\n"
        "/help — Command list"
        + DISCLAIMER,
        parse_mode="MarkdownV2",
    )


async def divergences(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    data = await _api_get("/api/divergences")
    if not data or not data.get("signals"):
        await update.message.reply_text("No divergence signals right now\\." + DISCLAIMER, parse_mode="MarkdownV2")
        return

    lines = ["*Counter\\-Consensus Signals*\n"]
    for s in data["signals"][:10]:
        direction = s["sm_direction"]
        arrow = "↑" if direction == "YES" else "↓"
        q = _esc(s["question"][:60])
        mp = _esc(f"{s['market_price']:.0%}")
        sc = _esc(f"{s['sm_consensus']:.0%}")
        dp = _esc(f"{s['divergence_pct']:.0%}")
        score = _esc(f"{s['score']:.0f}")
        lines.append(
            f"{arrow} *{q}*\n"
            f"  Market: {mp} YES\n"
            f"  Smart Money: {sc} \\(favors {direction}\\)\n"
            f"  Divergence: {dp} \\| Score: {score}/100\n"
            f"  Traders: {s['sm_trader_count']}\n"
        )

    await update.message.reply_text("\n".join(lines) + DISCLAIMER, parse_mode="MarkdownV2")


async def movers(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    data = await _api_get("/api/movers?timeframe=24h")
    if not data or not data.get("movers"):
        await update.message.reply_text("No significant movers right now\\." + DISCLAIMER, parse_mode="MarkdownV2")
        return

    lines = ["*Biggest Movers \\(24h\\)*\n"]
    for m in data["movers"][:10]:
        arrow = "↑" if m["change_pct"] > 0 else "↓"
        q = _esc(m["question"][:60])
        before = _esc(f"{m['price_before']:.0%}")
        now = _esc(f"{m['price_now']:.0%}")
        change = _esc(f"{m['change_pct']:+.0%}")
        lines.append(
            f"{arrow} *{q}*\n"
            f"  {before} → {now} \\({change}\\)\n"
        )

    await update.message.reply_text("\n".join(lines) + DISCLAIMER, parse_mode="MarkdownV2")


async def market_search(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = " ".join(ctx.args) if ctx.args else ""
    if not query:
        await update.message.reply_text("Usage: /market <search query>")
        return

    data = await _api_get("/api/markets?limit=100")
    if not data or not data.get("markets"):
        await update.message.reply_text("No markets found\\.", parse_mode="MarkdownV2")
        return

    # Simple client-side filter
    matches = [
        m for m in data["markets"] if query.lower() in m.get("question", "").lower()
    ]
    if not matches:
        await update.message.reply_text(f"No markets matching '{_esc(query)}'\\.", parse_mode="MarkdownV2")
        return

    eq = _esc(query)
    lines = [f"*Markets matching '{eq}':*\n"]
    for m in matches[:5]:
        q = _esc(m["question"][:70])
        price = _esc(f"{m['price_yes']:.0%}")
        vol = _esc(f"${m['volume_24h']:,.0f}")
        lines.append(
            f"*{q}*\n"
            f"  YES: {price} \\| Vol 24h: {vol}\n"
        )

    await update.message.reply_text("\n".join(lines) + DISCLAIMER, parse_mode="MarkdownV2")


async def whales_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Show recent whale trades."""
    data = await _api_get("/api/whale-flow?hours=24&min_size=10000")
    if not data or not data.get("alerts"):
        await update.message.reply_text("No whale trades in the last 24h\\." + DISCLAIMER, parse_mode="MarkdownV2")
        return

    lines = ["*Recent Whale Trades*\n"]
    for a in data["alerts"][:10]:
        side_emoji = "🟢" if a["side"] == "YES" else "🔴"
        q = _esc(str(a.get("question", ""))[:50])
        size = _esc(f"${a['size']:,.0f}")
        rank = _esc(f"#{a['trader_rank']}")
        price = _esc(f"{a['price']:.0%}")
        lines.append(
            f"{side_emoji} Trader {rank} bought {size} {a['side']}\n"
            f"  *{q}*\n"
            f"  Price: {price}\n"
        )

    await update.message.reply_text("\n".join(lines) + DISCLAIMER, parse_mode="MarkdownV2")


async def subscribe_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Subscribe to whale alerts."""
    chat_id = update.effective_chat.id
    # Store subscription via direct DB access (bot runs in same container)
    try:
        from api.database import get_db, save_subscription

        db = await get_db()
        try:
            await save_subscription(db, chat_id)
            await db.commit()
        finally:
            await db.close()
        await update.message.reply_text(
            "Subscribed to whale alerts\\! You'll get notified when SM traders make large trades\\." + DISCLAIMER,
            parse_mode="MarkdownV2",
        )
    except Exception:
        logger.exception("subscribe failed")
        await update.message.reply_text("Failed to subscribe\\. Try again later\\.", parse_mode="MarkdownV2")


async def unsubscribe_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Unsubscribe from whale alerts."""
    chat_id = update.effective_chat.id
    try:
        from api.database import get_db, remove_subscription

        db = await get_db()
        try:
            await remove_subscription(db, chat_id)
            await db.commit()
        finally:
            await db.close()
        await update.message.reply_text(
            "Unsubscribed from whale alerts\\." + DISCLAIMER,
            parse_mode="MarkdownV2",
        )
    except Exception:
        logger.exception("unsubscribe failed")
        await update.message.reply_text("Failed to unsubscribe\\. Try again later\\.", parse_mode="MarkdownV2")


async def threshold_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Set minimum trade size filter for whale alerts."""
    if not ctx.args:
        await update.message.reply_text("Usage: /threshold <amount>\nExample: /threshold 25000")
        return

    try:
        amount = float(ctx.args[0])
        if amount < 0:
            raise ValueError
    except (ValueError, IndexError):
        await update.message.reply_text("Please provide a valid positive number\\.", parse_mode="MarkdownV2")
        return

    chat_id = update.effective_chat.id
    try:
        from api.database import get_db

        db = await get_db()
        try:
            await db.execute(
                "UPDATE bot_subscriptions SET min_trade_size = ? WHERE chat_id = ?",
                (amount, chat_id),
            )
            await db.commit()
        finally:
            await db.close()
        await update.message.reply_text(
            f"Threshold set to ${_esc(f'{amount:,.0f}')}\\. "
            f"You'll only get alerts for trades above this size\\." + DISCLAIMER,
            parse_mode="MarkdownV2",
        )
    except Exception:
        logger.exception("threshold update failed")
        await update.message.reply_text("Failed to update threshold\\.", parse_mode="MarkdownV2")


async def calibration(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    data = await _api_get("/api/calibration")
    if not data:
        await update.message.reply_text("Calibration data not available yet\\." + DISCLAIMER, parse_mode="MarkdownV2")
        return

    brier = _esc(f"{data['overall_brier']:.4f}")
    total = _esc(str(data["total_resolved"]))
    lines = [
        "*Polymarket Calibration*\n",
        f"Overall Brier Score: {brier}",
        f"Total Resolved Markets: {total}\n",
    ]

    if data.get("by_category"):
        lines.append("*By Category:*")
        for cat, info in list(data["by_category"].items())[:8]:
            c = _esc(cat)
            bs = _esc(f"{info['brier_score']:.4f}")
            cnt = _esc(str(info["count"]))
            lines.append(f"  {c}: {bs} \\({cnt} markets\\)")

    await update.message.reply_text("\n".join(lines) + DISCLAIMER, parse_mode="MarkdownV2")


async def accuracy(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    data = await _api_get("/api/signals/accuracy")
    if not data or not data.get("overall"):
        await update.message.reply_text(
            "No accuracy data yet\\. Signals will be scored as markets resolve\\." + DISCLAIMER,
            parse_mode="MarkdownV2",
        )
        return

    o = data["overall"]
    tiers = data.get("by_tier", {})
    r30 = data.get("rolling_30d", {})

    wr = _esc(f"{o['win_rate'] * 100:.1f}%")
    total = _esc(str(o["total_signals"]))
    correct = _esc(str(o["correct"]))

    lines = [
        "*Signal Track Record*\n",
        f"Win Rate: {wr}",
        f"Signals Tracked: {total}",
        f"Correct Calls: {correct}\n",
    ]

    if tiers:
        lines.append("*By Confidence Tier:*")
        for tier in ("high", "medium", "low"):
            t = tiers.get(tier, {})
            if t.get("total", 0) > 0:
                twr = _esc(f"{t['win_rate'] * 100:.0f}%")
                tc = _esc(str(t["total"]))
                lines.append(f"  {_esc(tier.title())}: {twr} \\({tc} signals\\)")

    if r30.get("total", 0) > 0:
        rwr = _esc(f"{r30['win_rate'] * 100:.1f}%")
        rc = _esc(str(r30["correct"]))
        rt = _esc(str(r30["total"]))
        lines.append(f"\n*30\\-Day Rolling:* {rwr} \\({rc}/{rt}\\)")

    await update.message.reply_text("\n".join(lines) + DISCLAIMER, parse_mode="MarkdownV2")


async def _build_digest() -> str:
    """Compose the weekly digest message body."""
    divs = await _api_get("/api/divergences")
    predictive = await _api_get("/api/traders/leaderboard?order=predictive&min_signals=5&limit=3")
    fade = await _api_get("/api/traders/leaderboard?order=anti-predictive&min_signals=5&limit=3")
    meth = await _api_get("/api/methodology/stats")

    lines: list[str] = ["*PolyScope Weekly Digest*\n"]

    # Top signals
    lines.append("*Top Active Signals*")
    if divs and divs.get("signals"):
        for s in divs["signals"][:5]:
            arrow = "↑" if s["sm_direction"] == "YES" else "↓"
            q = _esc(s["question"][:55])
            mp = _esc(f"{s['market_price']:.0%}")
            sc = _esc(f"{s['sm_consensus']:.0%}")
            score = _esc(f"{s['score']:.0f}")
            lines.append(
                f"{arrow} *{q}*\n"
                f"  Crowd {mp} \\| PolyScope {s['sm_direction']} \\({sc}\\) \\| Score {score}"
            )
    else:
        lines.append("_No active signals right now\\._")

    # Predictive traders
    lines.append("\n*Top Predictive Traders*")
    if predictive and predictive.get("traders"):
        for t in predictive["traders"]:
            addr = _esc(t["trader_address"][:6] + "…" + t["trader_address"][-4:])
            acc = _esc(f"{t['accuracy_pct']:.0f}%")
            ratio = _esc(f"{t['correct_predictions']}/{t['total_divergent_signals']}")
            lines.append(f"  `{addr}` — {acc} \\({ratio}\\)")
    else:
        lines.append("_Building leaderboard\\._")

    # Fade traders
    lines.append("\n*Top Traders to Fade*")
    if fade and fade.get("traders"):
        for t in fade["traders"]:
            addr = _esc(t["trader_address"][:6] + "…" + t["trader_address"][-4:])
            acc = _esc(f"{t['accuracy_pct']:.0f}%")
            ratio = _esc(f"{t['correct_predictions']}/{t['total_divergent_signals']}")
            lines.append(f"  `{addr}` — {acc} \\({ratio}\\)")
    else:
        lines.append("_Building leaderboard\\._")

    # Dataset stats
    if meth and meth.get("signals"):
        s = meth["signals"]
        total = _esc(f"{s.get('total', 0):,}")
        resolved = _esc(f"{s.get('resolved', 0):,}")
        lines.append(
            f"\n*Dataset:* {total} signals tracked, {resolved} resolved\\."
        )

    lines.append(
        "\n[See live signals →](https://polyscope.gudman.xyz/smart-money) "
        "\\| [Trader leaderboard →](https://polyscope.gudman.xyz/traders) "
        "\\| [Methodology →](https://polyscope.gudman.xyz/methodology)"
    )

    return "\n".join(lines) + DISCLAIMER


async def digest_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """On-demand weekly-style digest."""
    msg = await _build_digest()
    await update.message.reply_text(
        msg, parse_mode="MarkdownV2", disable_web_page_preview=True
    )


async def help_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "*PolyScope Commands*\n\n"
        "/divergences — Counter\\-consensus signals\n"
        "/movers — Biggest probability shifts\n"
        "/market <query> — Search markets\n"
        "/whales — Recent whale trades\n"
        "/digest — Weekly\\-style summary now\n"
        "/subscribe — Whale alerts \\+ weekly digest\n"
        "/unsubscribe — Stop alerts and digest\n"
        "/threshold <amount> — Min trade size filter\n"
        "/calibration — Accuracy dashboard\n"
        "/accuracy — Signal track record\n"
        "/help — This message"
        + DISCLAIMER,
        parse_mode="MarkdownV2",
    )


async def digest_loop(app: Application):
    """Background task: push weekly digest to subscribers every 168h."""
    # Wait briefly so the bot is fully up before the first push window check
    await asyncio.sleep(60)
    week_seconds = 7 * 24 * 60 * 60

    while True:
        try:
            from api.database import get_active_subscriptions, get_db

            db = await get_db()
            try:
                subs = await get_active_subscriptions(db)
            finally:
                await db.close()

            if subs:
                msg = await _build_digest()
                for sub in subs:
                    try:
                        await app.bot.send_message(
                            chat_id=sub["chat_id"],
                            text=msg,
                            parse_mode="MarkdownV2",
                            disable_web_page_preview=True,
                        )
                    except Exception:
                        logger.warning(
                            "Failed to send digest to chat %s", sub["chat_id"]
                        )
                logger.info("Weekly digest sent to %d subscribers", len(subs))
        except Exception:
            logger.exception("digest_loop error")

        await asyncio.sleep(week_seconds)


async def alert_loop(app: Application):
    """Background task: push whale alerts to subscribed chats."""
    while True:
        try:
            data = await _api_get("/api/whale-flow/pending")
            if data and data.get("alerts"):
                from api.database import get_active_subscriptions, get_db, mark_alerts_notified

                db = await get_db()
                try:
                    subs = await get_active_subscriptions(db)
                    if subs:
                        for alert in data["alerts"]:
                            side_emoji = "🟢" if alert["side"] == "YES" else "🔴"
                            size_str = _esc(f"${alert['size']:,.0f}")
                            price_str = _esc(f"{alert['price']:.0%}")
                            rank_str = _esc(str(alert["trader_rank"]))
                            q_str = _esc(str(alert.get("question", ""))[:60])
                            msg = (
                                f"{side_emoji} *Whale Alert*\n"
                                f"Trader \\#{rank_str} bought "
                                f"{size_str} {alert['side']} on\n"
                                f"*{q_str}*\n"
                                f"Price: {price_str}"
                            )
                            for sub in subs:
                                if alert["size"] >= sub.get("min_trade_size", 10000):
                                    try:
                                        await app.bot.send_message(
                                            chat_id=sub["chat_id"],
                                            text=msg + DISCLAIMER,
                                            parse_mode="MarkdownV2",
                                        )
                                    except Exception:
                                        logger.warning("Failed to send alert to chat %s", sub["chat_id"])

                        alert_ids = [a["id"] for a in data["alerts"]]
                        await mark_alerts_notified(db, alert_ids)
                        await db.commit()
                finally:
                    await db.close()
        except Exception:
            logger.exception("alert_loop error")

        await asyncio.sleep(60)


def main():
    if not BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not set")
        return

    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("divergences", divergences))
    app.add_handler(CommandHandler("movers", movers))
    app.add_handler(CommandHandler("market", market_search))
    app.add_handler(CommandHandler("whales", whales_cmd))
    app.add_handler(CommandHandler("subscribe", subscribe_cmd))
    app.add_handler(CommandHandler("unsubscribe", unsubscribe_cmd))
    app.add_handler(CommandHandler("threshold", threshold_cmd))
    app.add_handler(CommandHandler("calibration", calibration))
    app.add_handler(CommandHandler("accuracy", accuracy))
    app.add_handler(CommandHandler("digest", digest_cmd))
    app.add_handler(CommandHandler("help", help_cmd))

    # Start background loops as post_init
    async def post_init(application: Application):
        asyncio.create_task(alert_loop(application))
        asyncio.create_task(digest_loop(application))

    app.post_init = post_init

    logger.info("PolyScope bot starting...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
