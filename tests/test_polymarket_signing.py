"""Tests for Polymarket Builder Code attribution + Builder API signing."""

from api.polymarket_signing import (
    get_builder_code,
    get_builder_signer,
    is_builder_api_configured,
    is_builder_code_configured,
    reset_builder_signer_cache,
)


VALID_API_KEY = "019e1672-e0ae-7ee6-9341-1db932d6e6ea"
# Builder API secrets are URL-safe base64 (the SDK decodes them as the HMAC
# key). Length must be a multiple of 4 and use only [A-Za-z0-9_-=] chars.
VALID_API_SECRET = "a" * 44
VALID_PASSPHRASE = "pass-" + "y" * 20


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


# ── Builder API HMAC signing ───────────────────────────────


def _set_builder_api_env(monkeypatch):
    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", VALID_API_KEY)
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", VALID_API_SECRET)
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", VALID_PASSPHRASE)
    reset_builder_signer_cache()


def test_is_builder_api_configured_true_when_all_three_set(monkeypatch):
    _set_builder_api_env(monkeypatch)
    assert is_builder_api_configured() is True


def test_is_builder_api_configured_false_when_key_missing(monkeypatch):
    monkeypatch.delenv("POLYMARKET_BUILDER_API_KEY", raising=False)
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", VALID_API_SECRET)
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", VALID_PASSPHRASE)
    assert is_builder_api_configured() is False


def test_is_builder_api_configured_false_when_secret_missing(monkeypatch):
    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", VALID_API_KEY)
    monkeypatch.delenv("POLYMARKET_BUILDER_API_SECRET", raising=False)
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", VALID_PASSPHRASE)
    assert is_builder_api_configured() is False


def test_is_builder_api_configured_false_when_passphrase_missing(monkeypatch):
    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", VALID_API_KEY)
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", VALID_API_SECRET)
    monkeypatch.delenv("POLYMARKET_BUILDER_PASSPHRASE", raising=False)
    assert is_builder_api_configured() is False


def test_get_builder_signer_returns_none_when_unconfigured(monkeypatch):
    monkeypatch.delenv("POLYMARKET_BUILDER_API_KEY", raising=False)
    reset_builder_signer_cache()
    assert get_builder_signer() is None


def test_get_builder_signer_returns_signer_when_configured(monkeypatch):
    _set_builder_api_env(monkeypatch)
    signer = get_builder_signer()
    assert signer is not None
    payload = signer.create_builder_header_payload(
        method="POST",
        path="/test",
        body='{"ping":1}',
    )
    assert payload.POLY_BUILDER_API_KEY == VALID_API_KEY
    assert payload.POLY_BUILDER_PASSPHRASE == VALID_PASSPHRASE
    # signature is a non-empty string; timestamp is a numeric string
    assert isinstance(payload.POLY_BUILDER_SIGNATURE, str)
    assert len(payload.POLY_BUILDER_SIGNATURE) > 16
    assert payload.POLY_BUILDER_TIMESTAMP.isdigit()


def test_get_builder_signer_is_cached(monkeypatch):
    _set_builder_api_env(monkeypatch)
    a = get_builder_signer()
    b = get_builder_signer()
    assert a is b


def test_get_builder_signer_cache_invalidates_on_secret_change(monkeypatch):
    _set_builder_api_env(monkeypatch)
    a = get_builder_signer()
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", "b" * 44)
    b = get_builder_signer()
    assert a is not b


def test_signature_is_deterministic_for_same_inputs(monkeypatch):
    """HMAC must reproduce identical signatures given identical timestamp."""
    _set_builder_api_env(monkeypatch)
    signer = get_builder_signer()
    p1 = signer.create_builder_header_payload(
        method="POST", path="/foo", body='{"x":1}', timestamp=1700000000
    )
    p2 = signer.create_builder_header_payload(
        method="POST", path="/foo", body='{"x":1}', timestamp=1700000000
    )
    assert p1.POLY_BUILDER_SIGNATURE == p2.POLY_BUILDER_SIGNATURE


def test_signature_differs_when_body_changes(monkeypatch):
    _set_builder_api_env(monkeypatch)
    signer = get_builder_signer()
    p1 = signer.create_builder_header_payload(
        method="POST", path="/foo", body='{"x":1}', timestamp=1700000000
    )
    p2 = signer.create_builder_header_payload(
        method="POST", path="/foo", body='{"x":2}', timestamp=1700000000
    )
    assert p1.POLY_BUILDER_SIGNATURE != p2.POLY_BUILDER_SIGNATURE


def test_signer_cache_invalidates_on_secrets_sharing_suffix(monkeypatch):
    """Previously the fingerprint was last 8 chars only, so two secrets
    sharing the same 8-char suffix would reuse the cached signer despite
    being different. The sha256 fingerprint closes that gap."""
    # 44 chars total, identical last 8, different elsewhere
    secret_a = ("a" * 36) + ("z" * 8)
    secret_b = ("b" * 36) + ("z" * 8)
    assert secret_a[-8:] == secret_b[-8:]
    assert secret_a != secret_b

    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", VALID_API_KEY)
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", secret_a)
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", VALID_PASSPHRASE)
    reset_builder_signer_cache()
    a = get_builder_signer()
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", secret_b)
    b = get_builder_signer()
    assert a is not b
