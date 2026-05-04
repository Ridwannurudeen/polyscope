"""Production smoke tests for PolyScope.

Checks the live web/API boundary after deploy without requiring a browser
wallet. Wallet signing and actual order placement remain manual because they
require user interaction and must not be automated from CI.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_BASE_URL = "https://polyscope.gudman.xyz"


class SmokeFailure(RuntimeError):
    pass


def _url(base_url: str, path: str) -> str:
    return urllib.parse.urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))


def request_json(
    base_url: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    expected_status: int = 200,
) -> dict:
    req = urllib.request.Request(_url(base_url, path), headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            status = resp.status
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = e.code
        body = e.read().decode("utf-8", errors="replace")
    except (TimeoutError, urllib.error.URLError) as e:
        raise SmokeFailure(f"{path}: request failed: {e}") from e

    if status != expected_status:
        raise SmokeFailure(f"{path}: expected HTTP {expected_status}, got {status}: {body[:300]}")
    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        raise SmokeFailure(f"{path}: invalid JSON: {body[:300]}") from e
    if not isinstance(data, dict):
        raise SmokeFailure(f"{path}: expected JSON object")
    return data


def request_text(base_url: str, path: str, *, expected_status: int = 200) -> str:
    try:
        with urllib.request.urlopen(_url(base_url, path), timeout=20) as resp:
            status = resp.status
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = e.code
        body = e.read().decode("utf-8", errors="replace")
    except (TimeoutError, urllib.error.URLError) as e:
        raise SmokeFailure(f"{path}: request failed: {e}") from e
    if status != expected_status:
        raise SmokeFailure(f"{path}: expected HTTP {expected_status}, got {status}: {body[:300]}")
    return body


def ok(message: str) -> None:
    print(f"ok - {message}")


def check_web_pages(base_url: str) -> None:
    for path in ("/", "/builder", "/methodology", "/terms"):
        body = request_text(base_url, path)
        if "PolyScope" not in body and "polyscope" not in body.lower():
            raise SmokeFailure(f"{path}: page did not contain PolyScope marker")
        ok(f"GET {path}")


def check_builder(base_url: str, require_builder: bool) -> str | None:
    status = request_json(base_url, "/api/builder/status")
    identity = request_json(base_url, "/api/builder/identity")
    if status.get("configured") != identity.get("configured"):
        raise SmokeFailure("/api/builder/status disagrees with /api/builder/identity")
    code = identity.get("code")
    if require_builder:
        if status.get("configured") is not True:
            raise SmokeFailure("builder code is not configured")
        if not isinstance(code, str) or not code.startswith("0x") or len(code) != 66:
            raise SmokeFailure(f"builder code has invalid shape: {code!r}")
    ok("/api/builder/status and /api/builder/identity")
    return code if isinstance(code, str) else None


def check_orders_config(
    base_url: str,
    builder_code: str | None,
    require_server_trading: bool,
) -> None:
    config = request_json(base_url, "/api/orders/config")
    if builder_code and config.get("builder_code") != builder_code:
        raise SmokeFailure("/api/orders/config builder_code does not match /api/builder/identity")
    if require_server_trading and config.get("trading_configured") is not True:
        raise SmokeFailure("/api/orders/config trading_configured is false")
    ok("/api/orders/config")


def check_public_builder_trades(base_url: str) -> None:
    data = request_json(base_url, "/api/builder/trades/public?limit=5")
    if not isinstance(data.get("stats"), dict):
        raise SmokeFailure("/api/builder/trades/public missing stats")
    ok("/api/builder/trades/public")


def check_admin_metrics(base_url: str, admin_token: str | None) -> None:
    if not admin_token:
        print("skip - admin metrics (no --admin-token)")
        return
    quoted = urllib.parse.quote(admin_token)
    request_json(base_url, f"/api/admin/metrics?token={quoted}", expected_status=401)
    data = request_json(
        base_url,
        "/api/admin/metrics?days=1",
        headers={"X-Admin-Token": admin_token},
    )
    if not data:
        raise SmokeFailure("/api/admin/metrics returned an empty object")
    ok("/api/admin/metrics header auth")


def load_market_ids(base_url: str, explicit_market_id: str | None) -> list[str]:
    if explicit_market_id:
        return [explicit_market_id]
    data = request_json(base_url, "/api/markets?limit=20")
    markets = data.get("markets")
    if not isinstance(markets, list) or not markets:
        raise SmokeFailure("/api/markets returned no markets")

    ids: list[str] = []
    fallback: list[str] = []
    for market in markets:
        if not isinstance(market, dict) or not isinstance(market.get("condition_id"), str):
            continue
        fallback.append(market["condition_id"])
        price = market.get("price_yes")
        if isinstance(price, (int, float)) and 0.01 < float(price) < 0.99:
            ids.append(market["condition_id"])
    return ids or fallback


def check_trade_metadata(base_url: str, market_id: str | None) -> None:
    last_error = ""
    for condition_id in load_market_ids(base_url, market_id)[:10]:
        path = f"/api/market/{urllib.parse.quote(condition_id)}/trade"
        try:
            data = request_json(base_url, path)
        except SmokeFailure as e:
            last_error = str(e)
            continue
        tokens = data.get("tokens")
        if not isinstance(tokens, dict) or not tokens.get("YES") or not tokens.get("NO"):
            raise SmokeFailure(f"{path}: missing YES/NO token metadata")
        if data.get("tick_size") not in {"0.001", "0.01", "0.1"}:
            raise SmokeFailure(f"{path}: invalid tick_size")
        ok(path)
        return
    raise SmokeFailure(f"no candidate market returned trade metadata: {last_error}")


def check_polymarket_geoblock() -> None:
    try:
        with urllib.request.urlopen("https://polymarket.com/api/geoblock", timeout=20) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except (TimeoutError, urllib.error.URLError) as e:
        raise SmokeFailure(f"polymarket geoblock check failed: {e}") from e
    data = json.loads(body)
    if "blocked" not in data:
        raise SmokeFailure("polymarket geoblock response missing blocked")
    ok("polymarket.com/api/geoblock")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run PolyScope production smoke tests.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--admin-token", default=None)
    parser.add_argument("--market-id", default=None)
    parser.add_argument("--allow-unconfigured-builder", action="store_true")
    parser.add_argument("--require-server-trading", action="store_true")
    parser.add_argument("--skip-admin", action="store_true")
    parser.add_argument("--skip-trade", action="store_true")
    parser.add_argument("--skip-geoblock", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    base_url = args.base_url.rstrip("/")
    try:
        check_web_pages(base_url)
        builder_code = check_builder(base_url, not args.allow_unconfigured_builder)
        check_orders_config(base_url, builder_code, args.require_server_trading)
        check_public_builder_trades(base_url)
        if args.skip_admin:
            print("skip - admin metrics (--skip-admin)")
        else:
            check_admin_metrics(base_url, args.admin_token)
        if args.skip_trade:
            print("skip - trade metadata (--skip-trade)")
        else:
            check_trade_metadata(base_url, args.market_id)
        if args.skip_geoblock:
            print("skip - polymarket geoblock (--skip-geoblock)")
        else:
            check_polymarket_geoblock()
    except SmokeFailure as e:
        print(f"fail - {e}", file=sys.stderr)
        return 1
    print("production smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
