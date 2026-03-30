"""PolyScope Telegram Bot — divergence alerts and market intelligence."""

from __future__ import annotations

import logging
import os

import httpx
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_BASE = os.getenv("POLYSCOPE_API_URL", "http://localhost:8020")
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

DISCLAIMER = (
    "\n\n_PolyScope provides market intelligence only. "
    "It does not facilitate, recommend, or enable participation in prediction markets._"
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


async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "*Welcome to PolyScope*\n\n"
        "Counter-consensus intelligence for Polymarket.\n\n"
        "Commands:\n"
        "/divergences — Current counter-consensus signals\n"
        "/movers — Biggest probability shifts (24h)\n"
        "/market <query> — Search market details\n"
        "/calibration — Polymarket accuracy summary\n"
        "/help — Command list"
        + DISCLAIMER,
        parse_mode="Markdown",
    )


async def divergences(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    data = await _api_get("/api/divergences")
    if not data or not data.get("signals"):
        await update.message.reply_text("No divergence signals right now." + DISCLAIMER)
        return

    lines = ["*Counter-Consensus Signals*\n"]
    for s in data["signals"][:10]:
        direction = s["sm_direction"]
        arrow = "↑" if direction == "YES" else "↓"
        lines.append(
            f"{arrow} *{s['question'][:60]}*\n"
            f"  Market: {s['market_price']:.0%} YES\n"
            f"  Smart Money: {s['sm_consensus']:.0%} (favors {direction})\n"
            f"  Divergence: {s['divergence_pct']:.0%} | Score: {s['score']:.0f}/100\n"
            f"  Traders: {s['sm_trader_count']}\n"
        )

    await update.message.reply_text("\n".join(lines) + DISCLAIMER, parse_mode="Markdown")


async def movers(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    data = await _api_get("/api/movers?timeframe=24h")
    if not data or not data.get("movers"):
        await update.message.reply_text("No significant movers right now." + DISCLAIMER)
        return

    lines = ["*Biggest Movers (24h)*\n"]
    for m in data["movers"][:10]:
        arrow = "↑" if m["change_pct"] > 0 else "↓"
        lines.append(
            f"{arrow} *{m['question'][:60]}*\n"
            f"  {m['price_before']:.0%} → {m['price_now']:.0%} "
            f"({m['change_pct']:+.0%})\n"
        )

    await update.message.reply_text("\n".join(lines) + DISCLAIMER, parse_mode="Markdown")


async def market_search(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = " ".join(ctx.args) if ctx.args else ""
    if not query:
        await update.message.reply_text("Usage: /market <search query>")
        return

    data = await _api_get(f"/api/markets?limit=5")
    if not data or not data.get("markets"):
        await update.message.reply_text("No markets found.")
        return

    # Simple client-side filter
    matches = [
        m for m in data["markets"] if query.lower() in m.get("question", "").lower()
    ]
    if not matches:
        await update.message.reply_text(f"No markets matching '{query}'.")
        return

    lines = [f"*Markets matching '{query}':*\n"]
    for m in matches[:5]:
        lines.append(
            f"*{m['question'][:70]}*\n"
            f"  YES: {m['price_yes']:.0%} | Vol 24h: ${m['volume_24h']:,.0f}\n"
        )

    await update.message.reply_text("\n".join(lines) + DISCLAIMER, parse_mode="Markdown")


async def calibration(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    data = await _api_get("/api/calibration")
    if not data:
        await update.message.reply_text("Calibration data not available yet." + DISCLAIMER)
        return

    lines = [
        f"*Polymarket Calibration*\n",
        f"Overall Brier Score: {data['overall_brier']:.4f}",
        f"Total Resolved Markets: {data['total_resolved']}\n",
    ]

    if data.get("by_category"):
        lines.append("*By Category:*")
        for cat, info in list(data["by_category"].items())[:8]:
            lines.append(f"  {cat}: {info['brier_score']:.4f} ({info['count']} markets)")

    await update.message.reply_text("\n".join(lines) + DISCLAIMER, parse_mode="Markdown")


async def help_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "*PolyScope Commands*\n\n"
        "/divergences — Counter-consensus signals\n"
        "/movers — Biggest probability shifts\n"
        "/market <query> — Search markets\n"
        "/calibration — Accuracy dashboard\n"
        "/help — This message"
        + DISCLAIMER,
        parse_mode="Markdown",
    )


def main():
    if not BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not set")
        return

    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("divergences", divergences))
    app.add_handler(CommandHandler("movers", movers))
    app.add_handler(CommandHandler("market", market_search))
    app.add_handler(CommandHandler("calibration", calibration))
    app.add_handler(CommandHandler("help", help_cmd))

    logger.info("PolyScope bot starting...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
