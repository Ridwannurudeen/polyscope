"use client";

import Link from "next/link";
import { Disclaimer } from "@/components/disclaimer";
import { TableSkeleton } from "@/components/skeleton";
import { usePollingFetch } from "@/lib/hooks";

interface BuilderIdentity {
  configured: boolean;
  code: string | null;
}

interface OrderConfig {
  trading_configured: boolean;
  max_order_usdc: number;
  builder_code: string | null;
}

interface PublicOrder {
  id: number;
  market_id: string | null;
  token_id: string;
  side: string;
  price: number;
  size: number;
  notional_usdc: number;
  order_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface PublicOrdersResponse {
  orders: PublicOrder[];
  stats: {
    total: number;
    by_status: Record<string, number>;
    total_notional_usdc: number;
  };
}

interface AttributedTrade {
  trade_id: string;
  market_id: string | null;
  side: string | null;
  size: number | null;
  price: number | null;
  notional_usdc: number | null;
  status: string | null;
  outcome: string | null;
  owner_short: string;
  transaction_hash: string | null;
  match_time: string | null;
}

interface AttributedTradesResponse {
  trades: AttributedTrade[];
  stats: {
    total_trades: number;
    total_notional_usdc: number;
    total_fees_usdc: number;
    unique_owners: number;
  };
}

function statusClass(status: string) {
  const s = status.toLowerCase();
  if (s === "filled") return "text-scope-400";
  if (s === "live" || s === "submitted") return "text-ink-200";
  if (s === "canceled" || s === "expired") return "text-ink-500";
  if (s === "rejected" || s === "failed") return "text-alert-500";
  return "text-fade-500";
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function BuilderPage() {
  const { data: identity, loading: identityLoading } =
    usePollingFetch<BuilderIdentity>("/api/builder/identity", 300_000);
  const { data: config, loading: configLoading } = usePollingFetch<OrderConfig>(
    "/api/orders/config",
    60_000,
  );
  const { data: orders, loading } = usePollingFetch<PublicOrdersResponse>(
    "/api/orders/public?limit=50",
    30_000,
  );
  const { data: trades, loading: tradesLoading } =
    usePollingFetch<AttributedTradesResponse>(
      "/api/builder/trades/public?limit=50",
      60_000,
    );

  const ordersList = orders?.orders ?? [];
  const stats = orders?.stats;
  const tradesList = trades?.trades ?? [];
  const tradeStats = trades?.stats;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Hero */}
      <section className="mb-10 pb-10 border-b border-ink-800">
        <div className="eyebrow mb-3">on-chain · transparency</div>
        <h1 className="text-h1 text-ink-100 tracking-tighter leading-tight mb-3">
          builder
        </h1>
        <p className="text-body-lg text-ink-300 leading-relaxed max-w-2xl">
          Public transparency page for PolyScope&apos;s Polymarket builder
          registration and any orders routed through the platform.
        </p>
      </section>

      {/* Identity */}
      <section className="mb-12">
        <div className="flex items-end justify-between mb-5 pb-3 border-b border-ink-800">
          <div>
            <div className="eyebrow mb-2">§1 · identity</div>
            <h2 className="text-h3 text-ink-100 tracking-tight">
              builder code
            </h2>
          </div>
        </div>
        {identityLoading && !identity ? (
          <div className="surface rounded-md p-4 animate-pulse-subtle">
            <div className="h-3 w-40 bg-ink-800 rounded-sm mb-3" />
            <div className="h-3 w-full max-w-md bg-ink-800 rounded-sm" />
          </div>
        ) : identity?.configured && identity.code ? (
          <div className="surface rounded-md p-4">
            <div className="eyebrow mb-2">bytes32</div>
            <p className="font-mono text-body-sm text-scope-400 break-all num mb-4">
              {identity.code}
            </p>
            <p className="text-body-sm text-ink-300 leading-relaxed">
              This code is attached to every CLOB order routed through
              PolyScope. It credits volume to our builder profile on
              Polymarket&apos;s{" "}
              <a
                href="https://builders.polymarket.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-scope-500 hover:text-scope-400 underline underline-offset-2"
              >
                builder leaderboard
              </a>
              .
            </p>
          </div>
        ) : (
          <div className="surface rounded-md p-4 text-body-sm text-ink-400 font-mono">
            builder code not configured on this deployment
          </div>
        )}
      </section>

      {/* Trading status */}
      <section className="mb-12">
        <div className="flex items-end justify-between mb-5 pb-3 border-b border-ink-800">
          <div>
            <div className="eyebrow mb-2">§2 · live state</div>
            <h2 className="text-h3 text-ink-100 tracking-tight">
              trading status
            </h2>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="surface rounded-md p-4">
            <div className="eyebrow mb-2">trading wired up</div>
            {configLoading && !config ? (
              <div className="h-7 w-12 bg-ink-800 rounded-sm animate-pulse-subtle" />
            ) : (
              <p
                className={`num text-h3 tracking-tight ${
                  config?.trading_configured
                    ? "text-scope-400"
                    : "text-ink-500"
                }`}
              >
                {config?.trading_configured ? "yes" : "no"}
              </p>
            )}
          </div>
          <div className="surface rounded-md p-4">
            <div className="eyebrow mb-2">per-order cap</div>
            <p className="num text-h3 text-ink-100 tracking-tight">
              {config ? `$${config.max_order_usdc.toFixed(2)}` : "—"}
              <span className="text-caption text-ink-500 font-mono font-normal ml-1.5">
                usdc
              </span>
            </p>
          </div>
          <div className="surface rounded-md p-4">
            <div className="eyebrow mb-2">attributed volume</div>
            <p className="num text-h3 text-ink-100 tracking-tight">
              {tradeStats
                ? `$${tradeStats.total_notional_usdc.toFixed(2)}`
                : stats
                  ? `$${stats.total_notional_usdc.toFixed(2)}`
                  : "—"}
            </p>
            {tradeStats && (
              <p className="text-micro text-ink-500 font-mono mt-1.5">
                <span className="num">{tradeStats.total_trades}</span> trades ·{" "}
                <span className="num">{tradeStats.unique_owners}</span> users
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Attributed trades */}
      <section className="mb-12">
        <div className="flex items-end justify-between mb-5 pb-3 border-b border-ink-800">
          <div>
            <div className="eyebrow mb-2">§3 · settled · on-chain</div>
            <h2 className="text-h3 text-ink-100 tracking-tight">
              attributed trades
            </h2>
            <p className="text-caption text-ink-400 mt-1 max-w-2xl">
              Polled from Polymarket&apos;s builder trades endpoint every 3
              minutes. Each trade was matched on-chain with our builder code in
              its{" "}
              <code className="text-micro bg-surface border border-ink-800 px-1.5 py-0.5 rounded-sm font-mono text-ink-100">
                builder
              </code>{" "}
              field.
            </p>
          </div>
        </div>

        {tradesLoading ? (
          <TableSkeleton rows={5} />
        ) : tradesList.length === 0 ? (
          <div className="surface rounded-md p-6 text-center text-body-sm text-ink-400 font-mono">
            no attributed trades yet · the first trade routed through polyscope
            will appear here once it settles
          </div>
        ) : (
          <div className="surface rounded-md overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-ink-800">
                  <th className="eyebrow text-left px-3 py-3">when</th>
                  <th className="eyebrow text-left px-3 py-3">owner</th>
                  <th className="eyebrow text-left px-3 py-3">side</th>
                  <th className="eyebrow text-right px-3 py-3">price</th>
                  <th className="eyebrow text-right px-3 py-3">size</th>
                  <th className="eyebrow text-right px-3 py-3">notional</th>
                  <th className="eyebrow text-left px-3 py-3">status</th>
                  <th className="eyebrow text-left px-3 py-3">tx</th>
                </tr>
              </thead>
              <tbody>
                {tradesList.map((t) => (
                  <tr
                    key={t.trade_id}
                    className="border-b border-ink-800/60 last:border-0 row-hover"
                  >
                    <td className="px-3 py-3 text-ink-300 font-mono num whitespace-nowrap">
                      {t.match_time ? fmtDate(t.match_time) : "—"}
                    </td>
                    <td className="px-3 py-3 text-ink-400 font-mono num">
                      {t.owner_short}
                    </td>
                    <td
                      className={`px-3 py-3 font-mono num ${
                        t.side === "BUY" ? "text-scope-400" : "text-alert-500"
                      }`}
                    >
                      {t.side ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-right text-ink-300 font-mono num">
                      {t.price != null ? t.price.toFixed(3) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right text-ink-300 font-mono num">
                      {t.size != null ? t.size.toFixed(2) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right text-ink-100 font-mono num">
                      {t.notional_usdc != null
                        ? `$${t.notional_usdc.toFixed(2)}`
                        : "—"}
                    </td>
                    <td
                      className={`px-3 py-3 font-mono uppercase tracking-wider text-eyebrow ${statusClass(
                        t.status ?? "",
                      )}`}
                    >
                      {t.status ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      {t.transaction_hash ? (
                        <a
                          href={`https://polygonscan.com/tx/${t.transaction_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-scope-500 hover:text-scope-400 underline underline-offset-2 font-mono text-caption"
                        >
                          view
                        </a>
                      ) : (
                        <span className="text-ink-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent orders */}
      <section className="mb-12">
        <div className="flex items-end justify-between mb-5 pb-3 border-b border-ink-800">
          <div>
            <div className="eyebrow mb-2">§4 · clob · pending + filled</div>
            <h2 className="text-h3 text-ink-100 tracking-tight">
              recent attributed orders
            </h2>
            <p className="text-caption text-ink-400 mt-1 max-w-2xl">
              Every order carries our builder code on-chain. Status is polled
              from Polymarket&apos;s CLOB every 60 seconds.
            </p>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={5} />
        ) : ordersList.length === 0 ? (
          <div className="surface rounded-md p-6 text-center text-body-sm text-ink-400 font-mono">
            no attributed orders yet
          </div>
        ) : (
          <div className="surface rounded-md overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-ink-800">
                  <th className="eyebrow text-left px-3 py-3">when</th>
                  <th className="eyebrow text-left px-3 py-3">side</th>
                  <th className="eyebrow text-right px-3 py-3">price</th>
                  <th className="eyebrow text-right px-3 py-3">size</th>
                  <th className="eyebrow text-right px-3 py-3">notional</th>
                  <th className="eyebrow text-left px-3 py-3">type</th>
                  <th className="eyebrow text-left px-3 py-3">status</th>
                </tr>
              </thead>
              <tbody>
                {ordersList.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-ink-800/60 last:border-0 row-hover"
                  >
                    <td className="px-3 py-3 text-ink-300 font-mono num whitespace-nowrap">
                      {fmtDate(o.updated_at || o.created_at)}
                    </td>
                    <td
                      className={`px-3 py-3 font-mono num ${
                        o.side === "BUY" ? "text-scope-400" : "text-alert-500"
                      }`}
                    >
                      {o.side}
                    </td>
                    <td className="px-3 py-3 text-right text-ink-300 font-mono num">
                      {o.price.toFixed(3)}
                    </td>
                    <td className="px-3 py-3 text-right text-ink-300 font-mono num">
                      {o.size.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-right text-ink-100 font-mono num">
                      ${o.notional_usdc.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-ink-400 font-mono">
                      {o.order_type}
                    </td>
                    <td
                      className={`px-3 py-3 font-mono uppercase tracking-wider text-eyebrow ${statusClass(o.status)}`}
                    >
                      {o.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="text-body-sm text-ink-400 mb-10 font-mono">
        <Link
          href="/methodology"
          className="text-scope-500 hover:text-scope-400 underline underline-offset-2"
        >
          ← back to methodology
        </Link>
      </div>

      <Disclaimer />
    </div>
  );
}
