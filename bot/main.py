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


async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "*Welcome to PolyScope*\n\n"
        "Counter\\-consensus intelligence for Polymarket\\.\n\n"
        "Commands:\n"
        "/divergences — Current counter\\-consensus signals\n"
        "/movers — Biggest probability shifts \\(24h\\)\n"
        "/market <query> — Search market details\n"
        "/calibration — Polymarket accuracy summary\n"
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


async def help_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "*PolyScope Commands*\n\n"
        "/divergences — Counter\\-consensus signals\n"
        "/movers — Biggest probability shifts\n"
        "/market <query> — Search markets\n"
        "/calibration — Accuracy dashboard\n"
        "/help — This message"
        + DISCLAIMER,
        parse_mode="MarkdownV2",
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
