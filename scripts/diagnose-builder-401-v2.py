"""Deeper probe: are the L2 creds rejected ONLY on /builder/trades or
globally? Test a vanilla L2 endpoint with the same creds.

If vanilla L2 works → the creds are fine; the problem is specifically
that this wallet isn't registered as owner of the builder_code on
Polymarket's side.

If vanilla L2 also 401s → the L2 key is globally invalid (rotated,
revoked, or this key was never associated with this wallet).
"""

import os, sys, traceback


def main():
    pk = os.getenv("POLYMARKET_PRIVATE_KEY")
    code = os.getenv("POLYMARKET_BUILDER_CODE")
    funder = os.getenv("POLYMARKET_FUNDER_ADDRESS")
    sig_type = int(os.getenv("POLYMARKET_SIGNATURE_TYPE", "2"))

    from py_clob_client_v2 import ClobClient
    from py_clob_client_v2.clob_types import BuilderTradeParams

    host = os.getenv("POLYMARKET_CLOB_HOST", "https://clob.polymarket.com")

    # Derive creds (we know this works from v1 probe)
    l1 = ClobClient(host=host, chain_id=137, key=pk)
    creds = l1.derive_api_key()
    print(f"derived_key = {(creds.api_key or '')[:14]}…")

    client = ClobClient(
        host=host, chain_id=137, key=pk,
        creds=creds, signature_type=sig_type, funder=funder,
    )

    def probe(label, fn):
        try:
            r = fn()
            print(f"  {label}: OK")
            if isinstance(r, dict):
                keys = list(r.keys())[:4]
                print(f"        keys={keys}")
            elif isinstance(r, list):
                print(f"        list, len={len(r)}")
            else:
                print(f"        type={type(r).__name__}")
        except Exception as e:
            msg = str(e)[:180]
            print(f"  {label}: FAIL {type(e).__name__}: {msg}")

    print("\n=== L2 vanilla endpoints (should work with any valid L2 key) ===")
    probe("get_ok",                   client.get_ok)
    probe("get_trades (own orders)",  client.get_trades)
    probe("get_trade_notifications",  lambda: client.get_trade_notifications())

    print("\n=== L2 builder-specific endpoint ===")
    probe("get_builder_trades",       lambda: client.get_builder_trades(BuilderTradeParams(builder_code=code)))


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except Exception:
        traceback.print_exc()
        sys.exit(2)
