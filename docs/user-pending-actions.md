# User-pending actions (2026-05-13 handoff)

Items 5 and 6 from the deploy plan require physical actions only the
user can take. This file documents the exact steps so they can be
executed without re-deriving context.

---

## Item 5 — First real attributed trade

**Why it's pending**: requires a non-geoblocked IP, a funded
Polymarket wallet, and live browser signing — none reachable from a
Claude session.

**Working geos** (verified Apr 2026): CH, BR, MX, AE, JP. **Not**: US,
GB, NL, DE, FR, SG (close-only), AU. Full list:
https://docs.polymarket.com/api-reference/geoblock

**Playbook:**

1. Connect to a CH/BR/MX/AE VPN endpoint. Confirm via
   https://polymarket.com/api/geoblock → `blocked: false`.
2. Open https://polyscope.gudman.xyz/ in a clean browser session
   (no MetaMask state mixed with other VPN sessions).
3. Connect the user wallet (must have a Polymarket account already
   set up at polymarket.com — first-time wallets get
   "Could not create API key" since there's no DepositWallet yet).
4. Pick a high-volume signal from the front page. Click **Trade**.
5. Modal flow: deploy DepositWallet (one-time, gasless) → approve
   pUSD/outcome-token allowance (one-time, gasless) → submit order.
6. Verify attribution within 3 min: the order should appear in
   `GET /api/builder/trades/public`. Internal check:
   `ssh root@<vps> 'docker exec polyscope-api-1 sqlite3
   /app/data/polyscope.db "SELECT COUNT(*) FROM builder_trades;"'`
   should increase.

**If the trade flow shows "insufficient balance" when you know the
wallet has pUSD**: the `safeBigInt` parse-fail path (PR `fded16e`)
should now let the order through. If it still blocks, check the
browser console for `safeBigInt: could not parse` warnings.

---

## Item 6 — Builder API key rotation (URGENT)

**Why it's pending**: `py_clob_client_v2.revoke_builder_api_key()`
signs with L2 trading auth where the endpoint requires Builder auth
(SDK bug). Polymarket's support channel is the only working path.

**EXTRA-URGENT 2026-05-13**: the current
`POLYMARKET_BUILDER_API_SECRET` and `_PASSPHRASE` were leaked to chat
during the WSS deploy by running `tail -5 .env` (which included those
two lines). The leaked values are now in:
- The Claude session transcript
- The Claude API logs
- Any saved conversation export

**Blast radius is limited** per the audit done earlier in the session:
the leaked HMAC creds let an attacker sign relayer requests as this
builder identity but can't move user funds (those still need user
EIP-712 sigs) and can't forge trade attribution (that's the public
bytes32 builder code). But it's still hygiene to rotate.

**Keys to revoke** (per builder-account state at deploy time, builder
code is the one returned by `GET /api/builder/identity`):

1. `019db75e-…` — old, Apr 2026
2. `019db75f-…` — old, Apr 2026
3. `019e0e5f-…` — secret leaked May 9 in chat history (memory note)
4. `019e1672-e0ae-7ee6-9341-1db932d6e6ea` — **currently in use**,
   leaked May 13 by tail-of-.env

**Support ticket draft** (paste into Polymarket support form):

> Subject: Revoke leaked Builder API keys + rotate to a fresh set
>
> Hi Polymarket team,
>
> I'm the operator of the builder code visible at
> https://polyscope.gudman.xyz/api/builder/identity (configured for
> this account). I need to revoke 4 Builder API keys and mint one
> fresh:
>
> 1. `019db75e-…` — old
> 2. `019db75f-…` — old
> 3. `019e0e5f-…` — secret leaked in chat history on 2026-05-09
> 4. `019e1672-e0ae-7ee6-9341-1db932d6e6ea` — secret leaked
>    accidentally on 2026-05-13 during a server config inspection
>
> Tried `py_clob_client_v2.revoke_builder_api_key()` but the SDK
> signs with L2 (trading) headers and the endpoint requires Builder
> auth — it 401s. Could you revoke server-side?
>
> Also please mint a fresh key + secret + passphrase to replace
> 019e1672 so I can update env without breaking the live sign-proxy.
>
> Thanks.

**After rotation**:

1. SSH to `/opt/polyscope`, edit `.env` (use `vim` not `tail -5`):
   set `POLYMARKET_BUILDER_API_KEY` / `_SECRET` / `_PASSPHRASE` to
   the new triple.
2. `docker compose up -d api` to pick up the new creds. The sign
   proxy will start issuing headers signed with the new secret.
3. Verify: `curl -X POST https://polyscope.gudman.xyz/api/polymarket/builder/sign
   -H 'content-type: application/json' -d '{"method":"GET","path":"/test","body":""}'`
   returns 4 headers; `POLY_BUILDER_API_KEY` matches the new key.
4. Confirm relayer ops still work end-to-end via one DepositWallet
   deploy from the frontend (item 5's flow).
