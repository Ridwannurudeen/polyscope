# PolyScope Production Runbook

Use this after any deploy that touches wallet identity, Builder Code trading,
admin metrics, API rewrites, or Docker/nginx routing.

## Deploy

Run on the VPS from `/opt/polyscope`:

```bash
./deploy/deploy-phase-c.sh
```

The script pulls `origin/main`, rebuilds `web`, `api`, and `bot`, restarts
Docker services, and runs `scripts/production_smoke.py` against the public
domain.

## Automated Smoke

```bash
python scripts/production_smoke.py \
  --base-url https://polyscope.gudman.xyz \
  --admin-token "$POLYSCOPE_ADMIN_TOKEN"
```

For local smoke tests that should not kick off Polymarket polling jobs:

```bash
POLYSCOPE_DISABLE_SCHEDULER=1 python -m uvicorn api.main:app --port 8020
```

What it verifies:

- Web routes: `/`, `/builder`, `/methodology`, `/terms`
- Builder Code identity: `/api/builder/status`, `/api/builder/identity`
- Public order config: `/api/orders/config`
- Public builder transparency: `/api/builder/trades/public`
- Admin metrics header auth: rejects query token, accepts `X-Admin-Token`
- Trade metadata: `/api/market/{condition_id}/trade` for a live market
- Polymarket geoblock endpoint returns a `blocked` field

## Manual Wallet Checks

These require a browser wallet and must stay manual.

1. Link wallet from the header.
2. Confirm the wallet popup signs a plain message containing:
   - `PolyScope wallet link`
   - current domain
   - client ID
   - lowercased wallet address
   - issued-at timestamp
3. Reload the page and confirm the wallet-linked watchlist/follow state loads.
4. Remove a wallet-linked watchlist item from `/portfolio`.
5. Follow and unfollow a trader from `/traders`.

## Manual Trading Checks

1. Open a live, non-resolved signal.
2. Click `Trade YES` or `Trade NO`.
3. Confirm the UI first checks `https://polymarket.com/api/geoblock`.
4. Confirm `/api/market/{condition_id}/trade` returns YES/NO CLOB tokens.
5. Place a small attributed order only when explicitly approved by the operator.
6. Confirm `/builder` shows the attributed trade after the scheduler sync runs.

## Demo Path

For judges or grant review, lead with the implemented trust boundary:

1. `/methodology` - honest track record and skew caveats.
2. `/traders` - predictive vs anti-predictive ranking.
3. `/smart-money` - decision cards with evidence and contributor accuracy.
4. `/market/{id}` - signal history and evidence.
5. Header wallet link - signed read-only identity.
6. Trade modal - browser-signed CLOB order construction and Builder Code attribution.
7. `/builder` - public attributed-order transparency.

## Security Posture

- Wallet links require a fresh EIP-191 signature and expire after 300 seconds.
- Wallet-scoped watchlist, portfolio, follow, and alert endpoints reject unlinked wallet/client pairs.
- The public `/api/sign` signing oracle is removed.
- Admin metrics use `X-Admin-Token`; the token is not sent in the URL.
- Bot logs redact Telegram Bot API URLs/tokens by default; rotate
  `TELEGRAM_BOT_TOKEN` immediately if historical logs contain `/bot<token>/`.
- Browser CLOB credentials are held in memory, not sessionStorage/localStorage.
- Server-side private-key trading is optional and admin-gated; browser trading does not require server custody.
- Nginx sets frame, content-type, referrer, and permissions-policy headers.

## Known Limits

- The smoke script cannot automate wallet signatures or submit real orders.
- Low-severity npm audit findings remain through Polymarket/ethers/browser crypto dependencies; there is no clean non-breaking upgrade path in the current dependency tree.
- Builder trade sync needs `POLYMARKET_BUILDER_API_KEY`, `POLYMARKET_BUILDER_API_SECRET`, and `POLYMARKET_BUILDER_PASSPHRASE`.
