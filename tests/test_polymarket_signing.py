"""Tests for Polymarket Builder Code attribution."""

from api.polymarket_signing import (
    get_builder_code,
    is_builder_code_configured,
)


def test_builder_code_unset(monkeypatch):
    monkeypatch.delenv("POLYMARKET_BUILDER_CODE", raising=False)
    assert get_builder_code() is None
    assert is_builder_code_configured() is False


def test_builder_code_valid_bytes32(monkeypatch):
    code = "0x" + "a" * 64
    monkeypatch.setenv("POLYMARKET_BUILDER_CODE", code)
    assert get_builder_code() == code
    assert is_builder_code_configured() is True


def test_builder_code_normalizes_case_and_whitespace(monkeypatch):
    mixed = "  0x" + "A" * 32 + "b" * 32 + "\n"
    monkeypatch.setenv("POLYMARKET_BUILDER_CODE", mixed)
    assert get_builder_code() == "0x" + "a" * 32 + "b" * 32


def test_builder_code_rejects_bad_format(monkeypatch):
    for bad in ("0xabc", "not-hex", "6bf238" * 11, "0x" + "z" * 64, ""):
        monkeypatch.setenv("POLYMARKET_BUILDER_CODE", bad)
        assert get_builder_code() is None
        assert is_builder_code_configured() is False


def test_builder_code_independent_of_builder_api_creds(monkeypatch):
    """Builder Code is public attribution, not Builder API auth."""
    monkeypatch.delenv("POLYMARKET_BUILDER_API_KEY", raising=False)
    monkeypatch.delenv("POLYMARKET_BUILDER_API_SECRET", raising=False)
    monkeypatch.delenv("POLYMARKET_BUILDER_PASSPHRASE", raising=False)
    monkeypatch.setenv("POLYMARKET_BUILDER_CODE", "0x" + "1" * 64)

    assert is_builder_code_configured() is True
