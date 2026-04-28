# PolyScope

**Counter-consensus intelligence for Polymarket.**

PolyScope tracks divergence between prediction market prices and the positions of top-ranked traders, then scores which individual traders have actually been predictive and which have been systematically wrong. It turns a P&L-ranked leaderboard into an accuracy-ranked one.

Live: [polyscope.gudman.xyz](https://polyscope.gudman.xyz)

---

## What it does

- **Scans 500+ Polymarket markets every 5 minutes** for divergence between crowd consensus and top-100 trader positions
- **Captures per-signal, per-trader attribution** — who positioned which way, at what size, at what rank
- **Scores individual predictive accuracy** against resolved market outcomes
- **Publishes two leaderboards**: genuinely predictive traders, and traders worth fading
- **Surfaces full evidence trail** behind every divergence signal — contributors, hit rates, source, freshness

The core insight driving the product: Polymarket's built-in leaderboard ranks by profit, not by prediction accuracy. Those aren't the same thing. A trader can be profitable on a few big wins while being anti-predictive on diverse positions. PolyScope measures the latter.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Polymarket APIs                                            │
│  ├─ Gamma (markets, resolution)                             │
│  ├─ Data API (positions, trades, leaderboard)               │
│  └─ CLOB (future: order routing)                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
         ┌────────────────▼─────────────────┐
         │  FastAPI + APScheduler           │
         │  (api/ — Python)                 │
         │                                  │
         │  Jobs (every 5-60 min):          │
         │  • fetch_markets                 │
         │  • fetch_leaderboard             │
         │  • compute_divergences           │
         │  • detect_whale_trades           │
         │  • track_outcomes                │
         │  • rebuild_trader_accuracy       │
         └────────────────┬─────────────────┘
                          │
                          ▼
                 ┌────────────────┐
                 │  SQLite (WAL)  │
                 │  data/         │
                 └────────┬───────┘
                          │
            ┌─────────────┼─────────────┐
            │             │             │
            ▼             ▼             ▼
   ┌───────────────┐ ┌─────────┐ ┌──────────────┐
   │  Next.js 14   │ │ Telegram│ │  REST API    │
   │  (web/)       │ │  Bot    │ │  /api/*      │
   │  Dashboard    │ │ Alerts  │ │              │
   └───────────────┘ └─────────┘ └──────────────┘
```

### Service components

| Component | Stack | Port | Role |
|-----------|-------|------|------|
| `api` | FastAPI + SQLite + APScheduler | 8020→8021 | Signal generation, data capture, REST API |
| `web` | Next.js 14 + Tailwind + Recharts | 3020 | Dashboard UI |
| `bot` | python-telegram-bot | — | Whale-flow alerts |

All services run as Docker containers behind nginx with TLS.

---

## The signal engine

### Divergence detection (`src/polyscope/divergence.py`)

For every market with sufficient liquidity (≥$50K OI, ≥$10K 24h volume), PolyScope fetches positions from top-100 leaderboard traders and computes a weighted consensus:

```
weight(trader, position) = (1 / rank)
                         × (1 + alpha_ratio × 100)
                         × (1 + log10(max(size, 1)))
                         × category_skill_multiplier
```

A signal fires when `|market_price - sm_consensus| ≥ 10%` AND the composite score crosses the threshold. Source can be positions or recent trades (trade-weighted uses a 24h exponential half-life decay).

### Contrarian direction

Empirically validated on 139K+ resolved signals: SM consensus at the aggregate level is **anti-predictive** when it diverges from market price. The signal direction is explicitly the opposite of SM consensus. See [/methodology](https://polyscope.gudman.xyz/methodology) for the honest breakdown with market-skew caveats.

### Per-trader accuracy (live since Apr 12, 2026)

Every signal persists the individual traders who contributed to it (`signal_trader_positions` table). Once markets resolve, each trader's direction is scored against the outcome. This produces `trader_accuracy` — the actual predictive hit rate per address, stratified by market skew band and category.

The `/traders` page exposes this as two leaderboards: predictive (real smart money) and anti-predictive (systematic fade candidates).

---

## API

Selected public endpoints:

| Endpoint | Returns |
|----------|---------|
| `GET /api/divergences` | Current active divergence signals |
| `GET /api/divergences/history` | Resolved signals with outcome scoring |
| `GET /api/signals/evidence/{market_id}` | Full evidence trail for latest signal |
| `GET /api/traders/leaderboard?order=predictive\|anti-predictive` | Per-trader accuracy ranking |
| `GET /api/traders/{address}` | Individual trader profile with skew/category breakdown |
| `GET /api/smart-money/leaderboard` | Raw Polymarket P&L leaderboard (for comparison) |
| `GET /api/calibration` | Brier scores and calibration by category |
| `GET /api/whale-flow` | Recent large-size smart money trades |

Full OpenAPI spec at `/api/docs`.

---

## Local development

Requires: Python 3.12+, Node 20+, Docker.

```bash
# Backend
cd polyscope
pip install -e .
python -m uvicorn api.main:app --reload --port 8020

# Frontend
cd web
npm install
npm run dev  # http://localhost:3000

# Run tests
python -m pytest tests -q
```

### Docker (matches production)

```bash
docker compose up -d
```

Exposes api:8021, web:3020. Edit `docker-compose.yml` for local ports.

### Environment

Copy `.env.example` to `.env` — see the bot container env for Telegram alert configuration.

---

## Status

- **Signals tracked**: 340K+ divergence signals, 28+ days of capture
- **Markets watched**: 500 active per scan cycle
- **Resolved outcomes**: 10K+ markets scored, 139K+ resolved signals
- **Tests**: 196 passing
- **Stack**: containerized, deployed on dedicated VPS, TLS via Let's Encrypt webroot

---

## Roadmap

PolyScope has converted from read-only analytics into an **execution-native intelligence terminal** for Polymarket's Builder Program. Status:

- **Evidence Layer** ✓ — per-signal attribution with contributor accuracy
- **Methodology Page** ✓ — honest public documentation of findings, dynamic stats
- **Decision Cards** ✓ — workflow-grade signal display with thesis, invalidators, confidence tier
- **Portfolio Layer** ✓ — anonymous client_id watchlist + trade log, PnL estimate, outcome scoring
- **Builder Integration** ✓ — Builder Code attribution live, CLOB order routing via browser wallet-connect (POLY_GNOSIS_SAFE + EOA paths), on-chain Safe-owner verification, Gamma token cross-validation, attributed-trade sync job
- **Predictive-contributor filter** ✓ — Wilson-95% gated trader leaderboard surfaces signals backed by genuinely predictive addresses

Next: per-trader data continues accumulating — qualifying-trader pool grows over time, backtest reruns hourly.

---

## License

Code is not currently open-source licensed. Contact for commercial use.
