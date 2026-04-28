import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "API — PolyScope",
  description:
    "Public REST endpoints for PolyScope's divergence signals, predictive trader leaderboard, and resolved-signal ledger.",
};

interface Endpoint {
  method: "GET";
  path: string;
  desc: string;
  params?: { name: string; type: string; default?: string; desc: string }[];
}

const ENDPOINTS: { group: string; items: Endpoint[] }[] = [
  {
    group: "signals",
    items: [
      {
        method: "GET",
        path: "/api/divergences",
        desc: "Currently active counter-consensus signals. Each signal includes the contributors, the predictive-backed flag, market price, and SM-weighted consensus.",
      },
      {
        method: "GET",
        path: "/api/divergences/history",
        desc: "Resolved signals with outcome scoring. Used by the on-chain track-record tile.",
        params: [
          { name: "limit", type: "int", default: "50", desc: "max rows, ≤ 200" },
        ],
      },
      {
        method: "GET",
        path: "/api/signals/evidence/{market_id}",
        desc: "Full evidence trail for the latest signal on a market — per-trader contributions with their accuracy, skew-band hit rate, category hit rate.",
      },
    ],
  },
  {
    group: "traders",
    items: [
      {
        method: "GET",
        path: "/api/traders/leaderboard",
        desc: "Per-trader accuracy ranking. The flagship endpoint — what /traders renders.",
        params: [
          {
            name: "order",
            type: "string",
            default: "predictive",
            desc: "predictive | anti-predictive",
          },
          {
            name: "min_signals",
            type: "int",
            default: "10",
            desc: "minimum resolved-signal count for inclusion",
          },
          { name: "limit", type: "int", default: "100", desc: "max rows, ≤ 500" },
        ],
      },
      {
        method: "GET",
        path: "/api/traders/{address}",
        desc: "Trader profile — overall accuracy + breakdowns by skew band and category, plus Wilson 95% CI.",
      },
      {
        method: "GET",
        path: "/api/smart-money/leaderboard",
        desc: "Polymarket's native P&L leaderboard, surfaced for comparison. Not what we rank by.",
      },
    ],
  },
  {
    group: "markets · activity",
    items: [
      {
        method: "GET",
        path: "/api/markets",
        desc: "Active markets with prices, volume, open interest. Optional category filter.",
        params: [
          { name: "limit", type: "int", default: "50", desc: "max rows, ≤ 200" },
          { name: "offset", type: "int", default: "0", desc: "pagination offset" },
          { name: "category", type: "string", desc: "filter by category substring" },
        ],
      },
      {
        method: "GET",
        path: "/api/market/{condition_id}",
        desc: "Single market detail + active divergence (if any) + price history + signal history.",
      },
      {
        method: "GET",
        path: "/api/whale-flow",
        desc: "Recent large-size smart-money trades. Empty until whales transact.",
      },
    ],
  },
  {
    group: "validation",
    items: [
      {
        method: "GET",
        path: "/api/calibration",
        desc: "Brier scores and calibration breakdown by category. Used by /calibration.",
      },
      {
        method: "GET",
        path: "/api/methodology/stats",
        desc: "Live dataset stats: signal counts, skew breakdown, predictive-filter performance vs unfiltered baseline. Cached 10 min.",
      },
    ],
  },
  {
    group: "builder · attribution",
    items: [
      {
        method: "GET",
        path: "/api/builder/identity",
        desc: "Public Builder Code (bytes32) used for Polymarket order attribution.",
      },
      {
        method: "GET",
        path: "/api/orders/config",
        desc: "Whether the deployment has trading wired (builder code + max order cap).",
      },
      {
        method: "GET",
        path: "/api/builder/trades/public",
        desc: "On-chain settled trades attributed to PolyScope's Builder Code. Empty until users route orders through the trade UI.",
      },
    ],
  },
];

function Method({ value }: { value: "GET" }) {
  return (
    <span className="inline-block px-1.5 py-0.5 text-eyebrow font-mono uppercase tracking-wider border border-scope-500/35 bg-scope-500/8 text-scope-300 rounded-sm">
      {value}
    </span>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="max-w-4xl">
      <section className="mb-10 pb-6 border-b border-ink-800">
        <h1 className="text-h1 text-ink-100 tracking-tightest leading-tight">
          api
        </h1>
        <p className="text-body-lg text-ink-300 mt-3 max-w-2xl leading-relaxed text-pretty">
          Public REST endpoints. JSON only. No auth required for read access.
          Base URL{" "}
          <code className="text-ink-100 font-mono">
            https://polyscope.gudman.xyz
          </code>
          .
        </p>
      </section>

      <div className="space-y-10">
        {ENDPOINTS.map((g) => (
          <section key={g.group}>
            <div className="eyebrow mb-4">{g.group}</div>
            <div className="space-y-3">
              {g.items.map((e) => (
                <article
                  key={e.path}
                  className="surface rounded-md p-4 hover:border-ink-600 transition-colors"
                >
                  <div className="flex items-start gap-3 mb-2">
                    <Method value={e.method} />
                    <code className="text-body font-mono text-ink-100 break-all">
                      {e.path}
                    </code>
                  </div>
                  <p className="text-body-sm text-ink-400 leading-relaxed text-pretty">
                    {e.desc}
                  </p>
                  {e.params && e.params.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-ink-800">
                      <div className="eyebrow mb-2">params</div>
                      <ul className="space-y-1">
                        {e.params.map((p) => (
                          <li
                            key={p.name}
                            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-caption font-mono"
                          >
                            <code className="text-ink-200">{p.name}</code>
                            <span className="text-ink-500">{p.type}</span>
                            {p.default !== undefined && (
                              <span className="text-ink-500">
                                = <span className="text-ink-300">{p.default}</span>
                              </span>
                            )}
                            <span className="text-ink-400">— {p.desc}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-t border-ink-800 flex flex-wrap items-center gap-3">
                    <a
                      href={`https://polyscope.gudman.xyz${e.path.replace(/\{[^}]+\}/g, "...")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-caption font-mono text-scope-400 hover:text-scope-300 transition-colors"
                    >
                      try it →
                    </a>
                    {e.path.includes("{") && (
                      <span className="text-caption font-mono text-ink-500">
                        replace <code className="text-ink-300">{"{...}"}</code>{" "}
                        with a real id
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-12 pt-6 border-t border-ink-800">
        <div className="eyebrow mb-3">notes</div>
        <ul className="space-y-2 text-body-sm text-ink-400 leading-relaxed list-disc list-inside marker:text-ink-600">
          <li>
            All amounts in USD. Prices are 0-1 (probability). Percent fields
            named <code className="text-ink-300 font-mono">_pct</code> are
            already × 100.
          </li>
          <li>
            Wilson 95% CI bounds (when present) are returned as percentages,
            not 0-1 fractions.
          </li>
          <li>
            Lists are stable-ordered by the metric the endpoint advertises
            (rank, accuracy, divergence). Pagination via{" "}
            <code className="text-ink-300 font-mono">limit</code> /{" "}
            <code className="text-ink-300 font-mono">offset</code> where
            applicable.
          </li>
          <li>
            Rate limits are not enforced today; soft limit on caching is 60s
            for divergences, 300s for stats. Clients should respect that.
          </li>
        </ul>
      </section>

      <section className="mt-10">
        <p className="text-caption font-mono text-ink-500">
          Need an endpoint that isn&apos;t listed?{" "}
          <Link
            href="/methodology"
            className="text-ink-300 hover:text-ink-100 underline underline-offset-2"
          >
            methodology →
          </Link>
        </p>
      </section>
    </div>
  );
}
