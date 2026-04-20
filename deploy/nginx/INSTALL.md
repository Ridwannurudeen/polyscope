# Nginx geoip2 + order-path geoblock — VPS install guide

One-time setup on `root@75.119.153.252`. Run after the main Phase C deploy
script succeeds, once you want to activate the US geoblock on order paths.
Safe to defer — trading works without the geoblock; you just inherit
Polymarket's compliance rather than adding a second layer.

## 1. Install the nginx geoip2 module + MaxMind DB

```bash
ssh root@75.119.153.252

apt update
apt install -y libnginx-mod-http-geoip2 mmdb-bin geoipupdate

# MaxMind auth — sign up at https://www.maxmind.com/en/geolite2/signup
# (free account) and generate a license key. Then:
cat > /etc/GeoIP.conf <<EOF
AccountID YOUR_ACCOUNT_ID
LicenseKey YOUR_LICENSE_KEY
EditionIDs GeoLite2-Country
DatabaseDirectory /var/lib/GeoIP
EOF

mkdir -p /var/lib/GeoIP
geoipupdate

ls /var/lib/GeoIP/GeoLite2-Country.mmdb  # should exist
```

A `geoipupdate` cron (weekly) ships by default with the `geoipupdate`
package — no extra cron to add.

## 2. Register the module + lookup in nginx.conf

```bash
# Check that ngx_http_geoip2_module loaded
nginx -T 2>&1 | grep geoip2 | head -3
```

If not loaded, add at the top of `/etc/nginx/nginx.conf`:

```
load_module modules/ngx_http_geoip2_module.so;
```

Then inside the `http { ... }` block:

```
geoip2 /var/lib/GeoIP/GeoLite2-Country.mmdb {
    $geoip2_country_code country iso_code;
}
```

## 3. Update the polyscope site config

Edit `/etc/nginx/sites-available/polyscope`. Inside the `server { listen 443 ... }` block:

- Add once, near the top of the block:
  ```
  include /opt/polyscope/deploy/nginx/geoblock.conf;
  ```
- Replace the single `location /api/ { ... }` block with three specific
  blocks for order paths (before the generic `/api/` proxy) that 451 on US:

```
    # Order paths — US geoblock
    location = /api/orders/place {
        if ($polyscope_is_us) { return 451; }
        proxy_pass http://127.0.0.1:8021;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location = /api/orders/recent {
        if ($polyscope_is_us) { return 451; }
        proxy_pass http://127.0.0.1:8021;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location = /api/orders/config {
        if ($polyscope_is_us) { return 451; }
        proxy_pass http://127.0.0.1:8021;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Keep the generic catchall last
    location /api/ {
        proxy_pass http://127.0.0.1:8021;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

Research surface (`/`, `/markets`, `/methodology`, `/builder`, trader
leaderboards) remains globally accessible. Only order-path endpoints are
blocked for US IPs.

## 4. Reload + verify

```bash
nginx -t             # test config
systemctl reload nginx

# From the box itself (not US, should succeed):
curl -s -o /dev/null -w "%{http_code}\n" https://polyscope.gudman.xyz/api/orders/config
# -> 200

# Simulated US test with a forced country header (if you set up a test endpoint)
# or actually test via a US VPN:
# -> 451
```

## 5. Rollback

If anything goes wrong, remove the `include .../geoblock.conf` line and
the three `location =` blocks, `nginx -t && systemctl reload nginx`. You
are back to pre-geoblock state; trading paths work but without a US block.
