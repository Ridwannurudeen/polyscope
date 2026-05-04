#!/usr/bin/env bash
# PolyScope Phase C deploy - run on the VPS after V2 cutover.
#
# Usage:   ssh root@75.119.153.252 "bash -s" < deploy/deploy-phase-c.sh
# Or:      scp deploy/deploy-phase-c.sh root@VPS:/opt/polyscope/ && ssh root@VPS "cd /opt/polyscope && ./deploy-phase-c.sh"
#
# Idempotent: safe to re-run. Each step checks whether it already ran.

set -euo pipefail

REPO=/opt/polyscope
DOMAIN=polyscope.gudman.xyz

cd "$REPO"

echo "[1/8] Preflight: repo + env + docker"
test -f .env || { echo "No .env at $REPO"; exit 1; }
grep -q '^POLYMARKET_BUILDER_CODE=' .env || {
  echo ".env missing POLYMARKET_BUILDER_CODE"
  exit 1
}
docker compose version >/dev/null
command -v python3 >/dev/null

echo "[2/8] git pull"
git fetch origin main
git reset --hard origin/main

echo "[3/8] Rebuild web container (build args from .env via docker-compose)"
docker compose build web

echo "[4/8] Rebuild api container"
docker compose build api

echo "[5/8] Rebuild bot container"
docker compose build bot

echo "[6/8] Restart services"
docker compose up -d
sleep 10
docker compose ps

echo "[7/8] Post-deploy smoke tests"
ADMIN_TOKEN=$(grep '^POLYSCOPE_ADMIN_TOKEN=' .env | cut -d= -f2- || true)
SMOKE_ARGS=(--base-url "https://$DOMAIN")
if [[ -n "$ADMIN_TOKEN" ]]; then
  SMOKE_ARGS+=(--admin-token "$ADMIN_TOKEN")
fi
python3 scripts/production_smoke.py "${SMOKE_ARGS[@]}"

echo "[8/8] Deploy complete."
echo
echo "Next-day checklist:"
echo "  - Link a wallet in the UI and confirm a fresh signature is required"
echo "  - Open a live signal and confirm /api/market/{id}/trade returns token metadata"
echo "  - Place a \$1-2 attributed test order via the UI (/smart-money -> Trade YES)"
echo "  - Verify it appears on /builder within 3 minutes (sync_attributed_trades_job)"
echo "  - Verify PolygonScan tx link opens correctly"
echo "  - If geoblock is configured, curl from a US VPN and expect 451 on /api/orders/*"
