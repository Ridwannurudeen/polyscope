"""Probe /auth/builder-api-key to see if our wallet already has (or can
mint) a Builder API key. If yes, those are the three creds we need.
"""
import os, sys, traceback


def main():
    pk = os.getenv("POLYMARKET_PRIVATE_KEY")
    funder = os.getenv("POLYMARKET_FUNDER_ADDRESS")
    sig_type = int(os.getenv("POLYMARKET_SIGNATURE_TYPE", "2"))

    from py_clob_client_v2 import ClobClient

    host = os.getenv("POLYMARKET_CLOB_HOST", "https://clob.polymarket.com")
    l1 = ClobClient(host=host, chain_id=137, key=pk)
    creds = l1.derive_api_key()
    client = ClobClient(
        host=host, chain_id=137, key=pk,
        creds=creds, signature_type=sig_type, funder=funder,
    )

    print("=== get_builder_api_keys (existing) ===")
    try:
        r = client.get_builder_api_keys()
        print(f"OK: type={type(r).__name__}")
        print(f"value: {r}")
    except Exception as e:
        print(f"FAIL {type(e).__name__}: {str(e)[:240]}")

    print("\n=== create_builder_api_key (mint new) ===")
    try:
        r = client.create_builder_api_key()
        print(f"OK: type={type(r).__name__}")
        print(f"value: {r}")
    except Exception as e:
        print(f"FAIL {type(e).__name__}: {str(e)[:240]}")


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except Exception:
        traceback.print_exc()
        sys.exit(2)
