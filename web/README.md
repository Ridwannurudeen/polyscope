# PolyScope Web

Next.js 15 frontend for PolyScope. See the [project README](../README.md) for architecture and context.

## Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- Recharts (price history)
- wagmi + viem for wallet connect, wallet-link signatures, and browser-signed CLOB orders
- Client-side polling via `usePollingFetch` hook (`lib/hooks.ts`)

## Structure

```
app/
├── layout.tsx          # root layout + nav
├── page.tsx            # dashboard
├── markets/            # all markets list
├── market/[id]/        # single market deep dive
├── smart-money/        # divergences + leaderboard + resolved signals
├── traders/            # accuracy-ranked leaderboard
├── traders/[address]/  # individual trader profile
├── calibration/        # Brier scores, calibration curves
components/             # shared UI (score-badge, stat-card, signal-evidence, etc.)
lib/
├── api.ts              # typed API response shapes
└── hooks.ts            # usePollingFetch
```

## Development

```bash
npm install
npm run dev      # http://localhost:3000
```

The dev server rewrites `/api/*` to the backend. Make sure FastAPI is running on port 8020, or set `POLYSCOPE_API_URL` before starting Next.js.

Browser trading also needs the public builder code at build time:

```bash
NEXT_PUBLIC_POLYMARKET_BUILDER_CODE=0x... npm run build
```

## Production build

Containerized via `Dockerfile` at the web directory root. Built and deployed through the project-level `docker-compose.yml`:

```bash
docker compose build web
docker compose up -d web
```

The project-level compose file sets `POLYSCOPE_API_URL=http://api:8020` for
the web container so direct Docker access to `http://localhost:3020/api/*`
rewrites to the API service.

## Conventions

- Client components only (no server components yet — all data is live-polled).
- Polling interval defaults to 60s. Adjust per page via the second arg to `usePollingFetch`.
- API types live in `lib/api.ts`. When adding an endpoint, add the response shape there first.
- Prefer Tailwind utility classes. No CSS modules.
