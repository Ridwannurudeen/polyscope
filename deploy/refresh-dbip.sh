#!/bin/bash
# Monthly DB-IP Country Lite refresh.
#
# DB-IP publishes a fresh GeoLite2-equivalent .mmdb on the 1st of each
# month under https://download.db-ip.com/free/dbip-country-lite-YYYY-MM.mmdb.gz
# (CC-BY 4.0; no API key required). Run on the 5th to give DB-IP a few
# days to publish.
#
# nginx auto_reload picks up the new file within 5 minutes (see
# deploy/geoip2.conf), no nginx restart needed.
#
# Install: cron entry on VPS:
#   0 4 5 * * /usr/local/bin/refresh-dbip.sh >> /var/log/dbip-refresh.log 2>&1
set -euo pipefail
YEAR_MONTH=$(date -u '+%Y-%m')
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
curl -sSL --fail -o "$TMP" \
  "https://download.db-ip.com/free/dbip-country-lite-$YEAR_MONTH.mmdb.gz"
gunzip -c "$TMP" > /etc/nginx/geoip/dbip-country-lite.mmdb.new
mv /etc/nginx/geoip/dbip-country-lite.mmdb.new /etc/nginx/geoip/dbip-country-lite.mmdb
echo "Refreshed dbip-country-lite to $YEAR_MONTH"
