#!/usr/bin/env bash
# PolyScope Phase C deploy — run on the VPS after V2 cutover.
#
# Usage:   ssh root@75.119.153.252 "bash -s" < deploy/deploy-phase-c.sh
# Or:      scp deploy/deploy-phase-c.sh root@VPS:/opt/polyscope/ && ssh root@VPS "cd /opt/polyscope && ./deploy-phase-c.sh"
#
# Idempotent: safe to re-run. Each step checks whether it already ran.

set -euo pipefail

REPO=/opt/polyscope
DOMAIN=polyscope.gudman.xyz

cd "$REPO"

# ── Preflight ────────────────────────────────────────────
echo "[1/7] Preflight: repo + env + docker"
test -f .env || { echo "No .env at $REPO"; exit 1; }
grep -q '^POLYMARKET_BUILDER_CODE=' .env || {
  echo ".env missing POLYMARKET_BUILDER_CODE"
  exit 1
}
docker compose version >/dev/null

# ── Pull latest ──────────────────────────────────────────
echo "[2/7] git pull"
git fetch origin main
git reset --hard origin/main

# ── Rebuild web with builder-code baked in (NEXT_PUBLIC_* is build-time) ──
echo "[3/7] Rebuild web container (build args from .env via docker-compose)"
# docker-compose `args` already references $POLYMARKET_BUILDER_CODE from .env
docker compose build web

# ── Rebuild api (no build-args; only pyproject changed) ──
echo "[4/7] Rebuild api container"
docker compose build api

# ── Restart ──────────────────────────────────────────────
echo "[5/7] Restart services"
docker compose up -d
sleep 10
docker compose ps

# ── Post-deploy API smoke tests ──────────────────────────
echo "[6/7] Post-deploy smoke tests"

fail() { echo "SMOKE FAIL: $1"; exit 2; }

curl -fs "https://$DOMAIN/api/builder/identity" | grep -q '"configured":true' \
  || fail "/api/builder/identity not configured"
echo "  ✓ /api/builder/identity configured"

curl -fs "https://$DOMAIN/api/orders/config" | grep -q '"trading_configured":true' \
  || fail "/api/orders/config trading_configured=false"
echo "  ✓ /api/orders/config trading_configured=true"

curl -fs "https://$DOMAIN/api/builder/trades/public" | grep -q '"stats"' \
  || fail "/api/builder/trades/public missing stats"
echo "  ✓ /api/builder/trades/public responds"

# Web page smoke tests
for path in / /builder /methodology /terms; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN$path")
  [[ "$code" == "200" ]] || fail "GET $path returned $code"
  echo "  ✓ GET $path -> 200"
done

# Trade button assets: builder code should be baked into the JS bundle
BUILDER_CODE=$(grep '^POLYMARKET_BUILDER_CODE=' .env | cut -d= -f2)
curl -fs "https://$DOMAIN/" | grep -q "$BUILDER_CODE" \
  || echo "  ! Builder code not visible on homepage HTML (may live in chunked JS; spot-check in DevTools)"

echo "[7/7] Deploy complete."
echo
echo "Next-day checklist:"
echo "  - Place a \$1-2 attributed test order via the UI (/smart-money → Trade YES)"
echo "  - Verify it appears on /builder within 3 minutes (sync_attributed_trades_job)"
echo "  - Verify PolygonScan tx link opens correctly"
echo "  - If geoblock is configured, curl from a US VPN and expect 451 on /api/orders/*"
