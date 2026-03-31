"""Smoke tests for Telegram bot handlers — verify MarkdownV2 formatting doesn't crash."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bot.main import (
    accuracy,
    calibration,
    divergences,
    help_cmd,
    movers,
    start,
    subscribe_cmd,
    threshold_cmd,
    unsubscribe_cmd,
    whales_cmd,
)


def _make_update(chat_id: int = 12345):
    """Create a mock Telegram Update with reply_text."""
    update = MagicMock()
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    update.effective_chat = MagicMock()
    update.effective_chat.id = chat_id
    return update


def _make_context(**kwargs):
    ctx = MagicMock()
    ctx.args = kwargs.get("args", [])
    return ctx


@pytest.mark.asyncio
async def test_start_handler():
    update = _make_update()
    await start(update, _make_context())
    update.message.reply_text.assert_called_once()
    text = update.message.reply_text.call_args[0][0]
    assert "PolyScope" in text


@pytest.mark.asyncio
@patch("bot.main._api_get")
async def test_divergences_with_data(mock_api):
    mock_api.return_value = {
        "signals": [
            {
                "question": "Will BTC hit $100k?",
                "sm_direction": "YES",
                "market_price": 0.35,
                "sm_consensus": 0.65,
                "divergence_pct": 0.30,
                "score": 72,
                "sm_trader_count": 8,
            }
        ]
    }
    update = _make_update()
    await divergences(update, _make_context())
    update.message.reply_text.assert_called_once()


@pytest.mark.asyncio
@patch("bot.main._api_get")
async def test_divergences_empty(mock_api):
    mock_api.return_value = {"signals": []}
    update = _make_update()
    await divergences(update, _make_context())
    update.message.reply_text.assert_called_once()


@pytest.mark.asyncio
@patch("bot.main._api_get")
async def test_movers_with_data(mock_api):
    mock_api.return_value = {
        "movers": [
            {
                "question": "Will ETH flip BTC?",
                "change_pct": 0.15,
                "price_before": 0.10,
                "price_now": 0.25,
            }
        ]
    }
    update = _make_update()
    await movers(update, _make_context())
    update.message.reply_text.assert_called_once()


@pytest.mark.asyncio
@patch("bot.main._api_get")
async def test_calibration_handler(mock_api):
    mock_api.return_value = {
        "overall_brier": 0.0423,
        "total_resolved": 511,
        "by_category": {"Politics": {"brier_score": 0.03, "count": 120}},
    }
    update = _make_update()
    await calibration(update, _make_context())
    update.message.reply_text.assert_called_once()


@pytest.mark.asyncio
@patch("bot.main._api_get")
async def test_accuracy_handler(mock_api):
    mock_api.return_value = {
        "overall": {"win_rate": 0.029, "total_signals": 35, "correct": 1},
        "by_tier": {
            "high": {"total": 5, "correct": 1, "win_rate": 0.20},
            "medium": {"total": 15, "correct": 0, "win_rate": 0.0},
            "low": {"total": 15, "correct": 0, "win_rate": 0.0},
        },
        "rolling_30d": {"total": 10, "correct": 1, "win_rate": 0.10},
    }
    update = _make_update()
    await accuracy(update, _make_context())
    update.message.reply_text.assert_called_once()


@pytest.mark.asyncio
async def test_help_handler():
    update = _make_update()
    await help_cmd(update, _make_context())
    update.message.reply_text.assert_called_once()
    text = update.message.reply_text.call_args[0][0]
    assert "Commands" in text or "commands" in text.lower()


@pytest.mark.asyncio
@patch("bot.main._api_get")
async def test_whales_with_data(mock_api):
    mock_api.return_value = {
        "alerts": [
            {
                "trader_address": "0xabc",
                "trader_rank": 5,
                "market_id": "mkt1",
                "question": "Will X happen?",
                "side": "YES",
                "size": 25000,
                "price": 0.42,
                "trade_timestamp": "2026-03-30T12:00:00Z",
                "detected_at": "2026-03-30T12:05:00Z",
            }
        ]
    }
    update = _make_update()
    await whales_cmd(update, _make_context())
    update.message.reply_text.assert_called_once()
    text = update.message.reply_text.call_args[0][0]
    assert "Whale" in text


@pytest.mark.asyncio
@patch("bot.main._api_get")
async def test_whales_empty(mock_api):
    mock_api.return_value = {"alerts": []}
    update = _make_update()
    await whales_cmd(update, _make_context())
    update.message.reply_text.assert_called_once()


@pytest.mark.asyncio
@patch("api.database.get_db")
@patch("api.database.save_subscription")
async def test_subscribe_handler(mock_save, mock_get_db):
    mock_db = AsyncMock()
    mock_get_db.return_value = mock_db
    mock_save.return_value = None

    update = _make_update(chat_id=99999)
    await subscribe_cmd(update, _make_context())
    update.message.reply_text.assert_called_once()
    text = update.message.reply_text.call_args[0][0]
    assert "Subscribed" in text


@pytest.mark.asyncio
@patch("api.database.get_db")
@patch("api.database.remove_subscription")
async def test_unsubscribe_handler(mock_remove, mock_get_db):
    mock_db = AsyncMock()
    mock_get_db.return_value = mock_db
    mock_remove.return_value = None

    update = _make_update(chat_id=99999)
    await unsubscribe_cmd(update, _make_context())
    update.message.reply_text.assert_called_once()
    text = update.message.reply_text.call_args[0][0]
    assert "Unsubscribed" in text
