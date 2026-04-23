"""Revoke the previously-minted Builder API key (which leaked to logs)
and mint a fresh one, writing the three creds directly to /opt/polyscope/.env
without echoing to stdout.

Run inside the api container:
    docker compose exec -T api python < rotate-and-write-env.py

Stdout prints only an OK marker and key-length summaries — never the
secret values. The fresh creds are appended to /app/.env.builder-fragment
which the caller scps out and merges into /opt/polyscope/.env on the host.
"""
import os, sys, traceback, json


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

    # Revoke existing (best-effort — may fail if list is empty or SDK
    # signature requires params).
    try:
        client.revoke_builder_api_key()
        print("revoke: OK")
    except Exception as e:
        print(f"revoke: skipped ({type(e).__name__})")

    # Mint fresh
    out = client.create_builder_api_key()
    key = out.get("key") or out.get("apiKey")
    secret = out.get("secret") or out.get("apiSecret")
    passphrase = out.get("passphrase") or out.get("apiPassphrase")
    if not (key and secret and passphrase):
        print(f"MINT_FAIL: unexpected response shape: {list(out.keys())}")
        return 1

    # Write ONLY the fragment — caller will merge into /opt/polyscope/.env
    frag = (
        "# --- Builder API creds (auto-minted, do not commit) ---\n"
        f"POLYMARKET_BUILDER_API_KEY={key}\n"
        f"POLYMARKET_BUILDER_API_SECRET={secret}\n"
        f"POLYMARKET_BUILDER_PASSPHRASE={passphrase}\n"
    )
    with open("/app/data/.builder-fragment", "w") as f:
        f.write(frag)
    # Stdout summary with lengths only
    print(f"mint: OK  key_len={len(key)}  secret_len={len(secret)}  passphrase_len={len(passphrase)}")
    print("fragment written to /app/data/.builder-fragment")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
