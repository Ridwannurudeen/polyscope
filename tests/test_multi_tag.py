"""Tests for multi-tag taxonomy — _parse_tags + Market integration."""

from __future__ import annotations

import pytest

from polyscope.polymarket import PolymarketClient


# ── _parse_tags shape handling ────────────────────────────


@pytest.mark.parametrize(
    "raw,expected",
    [
        ([], []),
        (None, []),
        ("crypto", ["crypto"]),
        (["politics", "election"], ["politics", "election"]),
        (
            [{"label": "Crypto"}, {"label": "Bitcoin"}],
            ["Crypto", "Bitcoin"],
        ),
        # Mixed shapes (string + dict)
        (["politics", {"label": "Trump"}], ["politics", "Trump"]),
        # Dict missing label — falls back to slug, then id
        ([{"slug": "macro"}], ["macro"]),
        ([{"id": "abc-123"}], ["abc-123"]),
        # Empty/null entries are skipped
        (["", None, "valid"], ["valid"]),
        ([{"label": ""}], []),
    ],
)
def test_parse_tags_handles_heterogeneous_shapes(raw, expected):
    assert PolymarketClient._parse_tags(raw) == expected


# ── Market integration ────────────────────────────────────


def test_parse_market_captures_all_tags():
    raw = {
        "conditionId": "0xabc",
        "question": "Will Trump win Iowa?",
        "slug": "iowa",
        "tags": [
            {"label": "Politics"},
            {"label": "Elections"},
            {"label": "Trump"},
        ],
        "clobTokenIds": ["tok-y", "tok-n"],
        "outcomePrices": ["0.6", "0.4"],
    }
    market = PolymarketClient._parse_market(raw)
    assert market.tags == ["Politics", "Elections", "Trump"]
    # Backward compat: category stays as tags[0]
    assert market.category == "Politics"


def test_parse_market_no_tags_uses_groupItemTitle_fallback():
    raw = {
        "conditionId": "0xdef",
        "question": "Q",
        "slug": "q",
        "groupItemTitle": "Custom Category",
        "clobTokenIds": ["a", "b"],
        "outcomePrices": ["0.5", "0.5"],
    }
    market = PolymarketClient._parse_market(raw)
    assert market.tags == []
    # Existing fallback path still works when tags are absent
    assert market.category == "Custom Category"


def test_parse_market_empty_tags_list_uses_fallback():
    raw = {
        "conditionId": "0xghi",
        "question": "Q",
        "slug": "q",
        "tags": [],
        "groupItemTitle": "Weather",
        "clobTokenIds": ["a", "b"],
        "outcomePrices": ["0.5", "0.5"],
    }
    market = PolymarketClient._parse_market(raw)
    assert market.tags == []
    assert market.category == "Weather"


def test_parse_market_string_tags_treated_as_single_tag():
    """Some legacy endpoints return tags as a single comma string."""
    raw = {
        "conditionId": "0xjkl",
        "question": "Q",
        "slug": "q",
        "tags": "Crypto",
        "clobTokenIds": ["a", "b"],
        "outcomePrices": ["0.5", "0.5"],
    }
    market = PolymarketClient._parse_market(raw)
    assert market.tags == ["Crypto"]
    assert market.category == "Crypto"
