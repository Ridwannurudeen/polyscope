"""Tests for POLYSCOPE_MULTI_TAG_WEIGHTING — env-gated max-over-tags lookup.

When the env is unset (default), category-weight lookup uses
``market.category`` only — matching legacy single-tag behavior.
When the env is on, lookup is ``max(weight[c] for c in market.tags)``
so a market tagged "crypto" + "politics" gets credit for whichever
category the trader is strongest in.

The user-visible effect: a trader strong in politics but weak in
crypto sees their contribution boosted on "crypto+politics" markets
under the new mode (vs. discounted under the default).
"""

from __future__ import annotations

import pytest

from polyscope.divergence import _category_multiplier, _multi_tag_enabled


# ── env gate ──────────────────────────────────────────────


def test_multi_tag_enabled_default_false(monkeypatch):
    monkeypatch.delenv("POLYSCOPE_MULTI_TAG_WEIGHTING", raising=False)
    assert _multi_tag_enabled() is False


@pytest.mark.parametrize("val", ["1", "true", "TRUE", "yes", "on"])
def test_multi_tag_enabled_truthy(monkeypatch, val):
    monkeypatch.setenv("POLYSCOPE_MULTI_TAG_WEIGHTING", val)
    assert _multi_tag_enabled() is True


@pytest.mark.parametrize("val", ["", "0", "false", "no", "off", "junk"])
def test_multi_tag_enabled_falsy(monkeypatch, val):
    monkeypatch.setenv("POLYSCOPE_MULTI_TAG_WEIGHTING", val)
    assert _multi_tag_enabled() is False


# ── _category_multiplier behavior ─────────────────────────


def _weights(crypto: float = 1.0, politics: float = 1.0) -> dict:
    return {"0xtrader": {"Crypto": crypto, "Politics": politics}}


def test_no_weights_dict_returns_one():
    assert _category_multiplier("0xtrader", "Crypto", ["Crypto"], None) == 1.0


def test_trader_with_no_weights_returns_one():
    assert _category_multiplier("0xunknown", "Crypto", ["Crypto"], _weights()) == 1.0


def test_default_mode_uses_single_category(monkeypatch):
    """Gate off: category-only lookup, tags ignored."""
    monkeypatch.delenv("POLYSCOPE_MULTI_TAG_WEIGHTING", raising=False)
    weights = _weights(crypto=2.0, politics=0.5)
    # category = "Crypto" → uses crypto weight even though tags include politics
    assert _category_multiplier("0xtrader", "Crypto", ["Crypto", "Politics"], weights) == 2.0


def test_default_mode_unknown_category_defaults_to_one(monkeypatch):
    monkeypatch.delenv("POLYSCOPE_MULTI_TAG_WEIGHTING", raising=False)
    weights = _weights(crypto=2.0, politics=0.5)
    assert _category_multiplier("0xtrader", "Weather", ["Weather"], weights) == 1.0


def test_multi_tag_mode_takes_max_across_tags(monkeypatch):
    """Gate on: a trader strong in politics gets the politics weight even if
    category=Crypto — because the market is tagged both."""
    monkeypatch.setenv("POLYSCOPE_MULTI_TAG_WEIGHTING", "true")
    weights = _weights(crypto=0.5, politics=2.0)
    # tags include both — max(0.5, 2.0) = 2.0
    assert _category_multiplier("0xtrader", "Crypto", ["Crypto", "Politics"], weights) == 2.0


def test_multi_tag_mode_single_tag_matches_default(monkeypatch):
    """Single tag with the same value across modes — no divergence."""
    monkeypatch.setenv("POLYSCOPE_MULTI_TAG_WEIGHTING", "true")
    weights = _weights(crypto=1.5, politics=2.0)
    assert _category_multiplier("0xtrader", "Crypto", ["Crypto"], weights) == 1.5


def test_multi_tag_mode_falls_back_when_tags_empty(monkeypatch):
    """Gate on but no tags → behave like default (single-category lookup)."""
    monkeypatch.setenv("POLYSCOPE_MULTI_TAG_WEIGHTING", "true")
    weights = _weights(crypto=1.5, politics=2.0)
    assert _category_multiplier("0xtrader", "Crypto", [], weights) == 1.5
    assert _category_multiplier("0xtrader", "Crypto", None, weights) == 1.5


def test_multi_tag_mode_unknown_tags_default_to_one(monkeypatch):
    """When the trader has no weight for ANY of the tags, the max is 1.0 (the
    default for each lookup miss)."""
    monkeypatch.setenv("POLYSCOPE_MULTI_TAG_WEIGHTING", "true")
    weights = _weights(crypto=2.0, politics=0.5)
    assert _category_multiplier("0xtrader", "Weather", ["Weather", "Climate"], weights) == 1.0


def test_multi_tag_mode_pick_max_even_when_category_blank(monkeypatch):
    """If category is "" but tags has values, multi-tag mode still works."""
    monkeypatch.setenv("POLYSCOPE_MULTI_TAG_WEIGHTING", "true")
    weights = _weights(crypto=0.5, politics=2.0)
    assert _category_multiplier("0xtrader", "", ["Crypto", "Politics"], weights) == 2.0
