"""Tests for the Builder Relayer foundation.

``py_builder_relayer_client`` and ``py_builder_signing_sdk`` are mocked
wholesale — these tests never touch the network. They cover env
validation and the lazy-init + fingerprint-cache behavior.
"""

from __future__ import annotations

import sys
import types

import pytest


VALID_PK = "0x" + "a" * 64
VALID_API_KEY = "019e1672-e0ae-7ee6-9341-1db932d6e6ea"
VALID_API_SECRET = "secret-" + "x" * 32
VALID_PASSPHRASE = "pass-" + "y" * 16


@pytest.fixture
def good_env(monkeypatch):
    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", VALID_API_KEY)
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", VALID_API_SECRET)
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", VALID_PASSPHRASE)
    monkeypatch.delenv("POLYMARKET_RELAYER_URL", raising=False)
    monkeypatch.delenv("POLYMARKET_PRIVATE_KEY", raising=False)
    from api import polymarket_relayer

    polymarket_relayer.reset_relay_client_cache()
    yield
    polymarket_relayer.reset_relay_client_cache()


@pytest.fixture
def fake_sdk(monkeypatch):
    """Install fake relayer + signing SDK modules in sys.modules."""
    relayer_pkg = types.ModuleType("py_builder_relayer_client")
    client_mod = types.ModuleType("py_builder_relayer_client.client")
    signing_pkg = types.ModuleType("py_builder_signing_sdk")
    signing_config_mod = types.ModuleType("py_builder_signing_sdk.config")

    constructed: list[dict] = []

    class _RelayClient:
        def __init__(self, **kw):
            self.kwargs = kw
            constructed.append(kw)

    class _BuilderApiKeyCreds:
        def __init__(self, key, secret, passphrase):
            self.key, self.secret, self.passphrase = key, secret, passphrase

    class _BuilderConfig:
        def __init__(self, local_builder_creds):
            self.local_builder_creds = local_builder_creds

    client_mod.RelayClient = _RelayClient
    signing_config_mod.BuilderApiKeyCreds = _BuilderApiKeyCreds
    signing_config_mod.BuilderConfig = _BuilderConfig

    monkeypatch.setitem(sys.modules, "py_builder_relayer_client", relayer_pkg)
    monkeypatch.setitem(sys.modules, "py_builder_relayer_client.client", client_mod)
    monkeypatch.setitem(sys.modules, "py_builder_signing_sdk", signing_pkg)
    monkeypatch.setitem(sys.modules, "py_builder_signing_sdk.config", signing_config_mod)
    return constructed


# ── config validation ─────────────────────────────────────


def test_is_relayer_configured_true_when_env_set(good_env):
    from api.polymarket_relayer import is_relayer_configured

    assert is_relayer_configured() is True


def test_is_relayer_configured_false_when_api_key_missing(monkeypatch):
    monkeypatch.delenv("POLYMARKET_BUILDER_API_KEY", raising=False)
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", VALID_API_SECRET)
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", VALID_PASSPHRASE)
    from api.polymarket_relayer import is_relayer_configured

    assert is_relayer_configured() is False


def test_is_relayer_configured_false_when_secret_missing(monkeypatch):
    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", VALID_API_KEY)
    monkeypatch.delenv("POLYMARKET_BUILDER_API_SECRET", raising=False)
    monkeypatch.setenv("POLYMARKET_BUILDER_PASSPHRASE", VALID_PASSPHRASE)
    from api.polymarket_relayer import is_relayer_configured

    assert is_relayer_configured() is False


def test_is_relayer_configured_false_when_passphrase_missing(monkeypatch):
    monkeypatch.setenv("POLYMARKET_BUILDER_API_KEY", VALID_API_KEY)
    monkeypatch.setenv("POLYMARKET_BUILDER_API_SECRET", VALID_API_SECRET)
    monkeypatch.delenv("POLYMARKET_BUILDER_PASSPHRASE", raising=False)
    from api.polymarket_relayer import is_relayer_configured

    assert is_relayer_configured() is False


def test_is_relayer_configured_false_on_malformed_private_key(good_env, monkeypatch):
    monkeypatch.setenv("POLYMARKET_PRIVATE_KEY", "0xNOTHEX")
    from api.polymarket_relayer import is_relayer_configured

    assert is_relayer_configured() is False


def test_is_relayer_configured_accepts_missing_private_key(good_env):
    """Private key is optional — read-only ops do not need it."""
    from api.polymarket_relayer import is_relayer_configured

    assert is_relayer_configured() is True


# ── client cache ─────────────────────────────────────────


def test_get_relay_client_raises_when_unconfigured(monkeypatch):
    monkeypatch.delenv("POLYMARKET_BUILDER_API_KEY", raising=False)
    from api.polymarket_relayer import RelayerConfigError, get_relay_client

    with pytest.raises(RelayerConfigError):
        get_relay_client()


def test_get_relay_client_constructs_with_correct_config(good_env, fake_sdk):
    from api.polymarket_relayer import get_relay_client

    get_relay_client()
    assert len(fake_sdk) == 1
    kw = fake_sdk[0]
    assert kw["relayer_url"] == "https://relayer-v2.polymarket.com/"
    assert kw["chain_id"] == 137
    assert kw["private_key"] is None
    # Builder creds are passed via BuilderConfig
    assert kw["builder_config"].local_builder_creds.key == VALID_API_KEY
    assert kw["builder_config"].local_builder_creds.secret == VALID_API_SECRET
    assert kw["builder_config"].local_builder_creds.passphrase == VALID_PASSPHRASE


def test_get_relay_client_respects_url_override(good_env, fake_sdk, monkeypatch):
    monkeypatch.setenv("POLYMARKET_RELAYER_URL", "https://relayer-v2-staging.polymarket.dev/")
    from api import polymarket_relayer

    polymarket_relayer.reset_relay_client_cache()
    polymarket_relayer.get_relay_client()
    assert fake_sdk[0]["relayer_url"] == "https://relayer-v2-staging.polymarket.dev/"


def test_get_relay_client_includes_private_key_when_set(good_env, fake_sdk, monkeypatch):
    monkeypatch.setenv("POLYMARKET_PRIVATE_KEY", VALID_PK)
    from api import polymarket_relayer

    polymarket_relayer.reset_relay_client_cache()
    polymarket_relayer.get_relay_client()
    assert fake_sdk[0]["private_key"] == VALID_PK


def test_get_relay_client_is_cached(good_env, fake_sdk):
    from api.polymarket_relayer import get_relay_client

    a = get_relay_client()
    b = get_relay_client()
    assert a is b
    assert len(fake_sdk) == 1  # constructed once


def test_get_relay_client_cache_invalidated_on_env_change(good_env, fake_sdk, monkeypatch):
    from api import polymarket_relayer

    polymarket_relayer.get_relay_client()
    monkeypatch.setenv("POLYMARKET_RELAYER_URL", "https://relayer-v2-staging.polymarket.dev/")
    polymarket_relayer.get_relay_client()
    assert len(fake_sdk) == 2


def test_reset_relay_client_cache(good_env, fake_sdk):
    from api import polymarket_relayer

    polymarket_relayer.get_relay_client()
    polymarket_relayer.reset_relay_client_cache()
    polymarket_relayer.get_relay_client()
    assert len(fake_sdk) == 2
