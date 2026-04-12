# PolyScope Web

Next.js 14 frontend for PolyScope. See the [project README](../README.md) for architecture and context.

## Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Recharts (price history)
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

The dev server proxies `/api/*` to the backend — make sure the FastAPI server is running on port 8020 or update the proxy target in `next.config.mjs`.

## Production build

Containerized via `Dockerfile` at the web directory root. Built and deployed through the project-level `docker-compose.yml`:

```bash
docker compose build web
docker compose up -d web
```

## Conventions

- Client components only (no server components yet — all data is live-polled).
- Polling interval defaults to 60s. Adjust per page via the second arg to `usePollingFetch`.
- API types live in `lib/api.ts`. When adding an endpoint, add the response shape there first.
- Prefer Tailwind utility classes. No CSS modules.
