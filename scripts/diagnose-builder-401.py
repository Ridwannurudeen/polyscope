"""One-shot diagnostic for the 401 on get_builder_trades.

Run inside the api container:
    docker compose exec -T api python /app/scripts/diagnose-builder-401.py

It walks the auth chain in isolation so we can tell which rung failed:
  1. signer address
  2. derive_api_key     (current behavior — returns what Polymarket has on record)
  3. create_api_key     (force fresh — may invalidate the old key)
  4. get_builder_trades with each of the above
"""

import os
import sys
import time
import traceback


def main():
    pk = os.getenv("POLYMARKET_PRIVATE_KEY")
    code = os.getenv("POLYMARKET_BUILDER_CODE")
    funder = os.getenv("POLYMARKET_FUNDER_ADDRESS")
    sig_type = int(os.getenv("POLYMARKET_SIGNATURE_TYPE", "2"))

    if not pk:
        print("NO_KEY")
        return 1

    from eth_account import Account
    signer = Account.from_key(pk).address
    print(f"signer_eoa       = {signer}")
    print(f"funder_safe      = {funder}")
    print(f"signature_type   = {sig_type}")
    print(f"builder_code     = {code[:10]}…{code[-6:]}")
    print(f"system_utc_ts    = {int(time.time())}")

    from py_clob_client_v2 import ClobClient
    from py_clob_client_v2.clob_types import BuilderTradeParams

    host = os.getenv("POLYMARKET_CLOB_HOST", "https://clob.polymarket.com")

    def try_call(label, client):
        print(f"\n── {label} ──")
        try:
            r = client.get_builder_trades(BuilderTradeParams(builder_code=code))
            total = len((r or {}).get("trades") or []) if isinstance(r, dict) else "?"
            print(f"  OK, trades={total}")
            return True
        except Exception as e:
            msg = str(e)[:220]
            print(f"  FAIL {type(e).__name__}: {msg}")
            return False

    # -- attempt 1: derive_api_key (the existing path)
    l1 = ClobClient(host=host, chain_id=137, key=pk)
    try:
        creds_derived = l1.derive_api_key()
        print(f"\nderive_api_key   = key={(creds_derived.api_key or '')[:12]}…")
    except Exception as e:
        print(f"\nderive_api_key FAILED: {type(e).__name__}: {str(e)[:200]}")
        creds_derived = None

    if creds_derived:
        client_d = ClobClient(
            host=host, chain_id=137, key=pk,
            creds=creds_derived, signature_type=sig_type, funder=funder,
        )
        try_call("call with DERIVED creds", client_d)

    # -- attempt 2: create_api_key (force fresh)
    l1b = ClobClient(host=host, chain_id=137, key=pk)
    try:
        creds_created = l1b.create_api_key()
        print(f"\ncreate_api_key   = key={(creds_created.api_key or '')[:12]}…")
    except Exception as e:
        print(f"\ncreate_api_key FAILED: {type(e).__name__}: {str(e)[:200]}")
        creds_created = None

    if creds_created:
        client_c = ClobClient(
            host=host, chain_id=137, key=pk,
            creds=creds_created, signature_type=sig_type, funder=funder,
        )
        try_call("call with CREATED creds", client_c)

    # -- attempt 3: test unauth /builder public endpoints
    print("\n── unauth probe — no L2 needed ──")
    try:
        import httpx
        r = httpx.get(f"{host}/builder", timeout=8.0)
        print(f"  GET /builder     http={r.status_code} body_head={r.text[:120]!r}")
    except Exception as e:
        print(f"  FAIL: {e}")


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except Exception:
        traceback.print_exc()
        sys.exit(2)
