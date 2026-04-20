"""Tests for Polymarket builder-attribution signing."""

import base64
import hashlib
import hmac

import pytest

from api.polymarket_signing import (
    get_builder_code,
    is_builder_code_configured,
    is_configured,
    sign_request,
)


def test_stub_mode_when_unconfigured(monkeypatch):
    monkeypatch.delenv("POLYMARKET_BUILDER_API_KEY", raising=False)
    monkeypatch.delenv("POLYMARKET_BUILDER_API_SECRET", raising=False)
    monkeypatch.delenv("POLYMARKET_BUILDER_PASSPHRASE", raising=False)

    signed = sign_request("POST", "/order", '{"foo":"bar"}')
    assert signed.mode == "stub"
    assert signed.api_key == "stub"
    assert signed.signature == "stub"
    assert is_configured() is False


def test_live_signature_is_deterministic(monkeypatch):
    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", "ak_test")
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", "secret_xyz")
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", "pass_abc")

    # Fixed timestamp — same inputs must always produce same signature
    s1 = sign_request("POST", "/order", '{"x":1}', timestamp="1700000000")
    s2 = sign_request("POST", "/order", '{"x":1}', timestamp="1700000000")
    assert s1.mode == "live"
    assert s1.signature == s2.signature
    assert s1.api_key == "ak_test"
    assert s1.passphrase == "pass_abc"
    assert s1.timestamp == "1700000000"


def test_signature_matches_reference_hmac(monkeypatch):
    """The signature must be url-safe base64 HMAC-SHA256(secret, ts+METHOD+path+body)."""
    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", "ak")
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", "sekret")
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", "pp")

    ts = "1700000000"
    method = "POST"
    path = "/order"
    body = '{"side":"BUY"}'
    message = f"{ts}{method}{path}{body}"

    expected = base64.urlsafe_b64encode(
        hmac.new(b"sekret", message.encode(), hashlib.sha256).digest()
    ).decode()

    signed = sign_request(method, path, body, timestamp=ts)
    assert signed.signature == expected


def test_headers_contain_all_four(monkeypatch):
    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", "k")
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", "s")
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", "p")

    signed = sign_request("POST", "/order", "", timestamp="1")
    headers = signed.to_headers()
    assert set(headers.keys()) == {
        "POLY_BUILDER_API_KEY",
        "POLY_BUILDER_TIMESTAMP",
        "POLY_BUILDER_PASSPHRASE",
        "POLY_BUILDER_SIGNATURE",
    }


def test_method_is_uppercased(monkeypatch):
    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", "k")
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", "s")
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", "p")

    lower = sign_request("post", "/x", "", timestamp="1")
    upper = sign_request("POST", "/x", "", timestamp="1")
    assert lower.signature == upper.signature


def test_changing_body_changes_signature(monkeypatch):
    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", "k")
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", "s")
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", "p")

    a = sign_request("POST", "/x", '{"a":1}', timestamp="1")
    b = sign_request("POST", "/x", '{"a":2}', timestamp="1")
    assert a.signature != b.signature


# ── Builder Code ───────────────────────────────────────────


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


def test_builder_code_independent_of_hmac_creds(monkeypatch):
    """Builder Code (public attribution) is separate from HMAC auth."""
    monkeypatch.delenv("POLYMARKET_BUILDER_API_KEY", raising=False)
    monkeypatch.delenv("POLYMARKET_BUILDER_API_SECRET", raising=False)
    monkeypatch.delenv("POLYMARKET_BUILDER_PASSPHRASE", raising=False)
    monkeypatch.setenv("POLYMARKET_BUILDER_CODE", "0x" + "1" * 64)

    assert is_configured() is False
    assert is_builder_code_configured() is True
