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
  if (s === "filled") return "text-emerald-400";
  if (s === "live" || s === "submitted") return "text-sky-400";
  if (s === "canceled" || s === "expired") return "text-gray-500";
  if (s === "rejected" || s === "failed") return "text-red-400";
  return "text-amber-400";
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
  const { data: config, loading: configLoading } =
    usePollingFetch<OrderConfig>("/api/orders/config", 60_000);
  const { data: orders, loading } = usePollingFetch<PublicOrdersResponse>(
    "/api/orders/public?limit=50",
    30_000
  );
  const { data: trades, loading: tradesLoading } =
    usePollingFetch<AttributedTradesResponse>(
      "/api/builder/trades/public?limit=50",
      60_000
    );

  const ordersList = orders?.orders ?? [];
  const stats = orders?.stats;
  const tradesList = trades?.trades ?? [];
  const tradeStats = trades?.stats;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">Builder</h1>
      <p className="text-gray-400 mb-8">
        Public transparency page for PolyScope&apos;s Polymarket builder
        registration and any orders routed through the platform.
      </p>

      {/* Identity — tri-state so the SSR/cold-hydration render doesn't
          claim "not configured" when the endpoint actually returns true.
          Previously the ternary skipped straight to the fallback on any
          undefined, which rendered the wrong message on first paint. */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white mb-3">Identity</h2>
        {identityLoading && !identity ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="h-3 w-40 bg-gray-800 rounded animate-pulse mb-3" />
            <div className="h-3 w-full max-w-md bg-gray-800 rounded animate-pulse" />
          </div>
        ) : identity?.configured && identity.code ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-2">
              Builder Code (bytes32)
            </p>
            <p className="font-mono text-sm text-emerald-400 break-all mb-3">
              {identity.code}
            </p>
            <p className="text-sm text-gray-400">
              This code is attached to every CLOB order routed through
              PolyScope. It credits volume to our builder profile on
              Polymarket&apos;s{" "}
              <a
                href="https://builders.polymarket.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 hover:underline"
              >
                builder leaderboard
              </a>
              .
            </p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm text-gray-400">
            Builder code not configured on this deployment.
          </div>
        )}
      </section>

      {/* Trading status */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white mb-3">
          Trading status
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-1">
              Trading wired up
            </p>
            {configLoading && !config ? (
              <div className="h-6 w-10 bg-gray-800 rounded animate-pulse" />
            ) : (
              <p
                className={`text-xl font-semibold ${
                  config?.trading_configured
                    ? "text-emerald-400"
                    : "text-gray-500"
                }`}
              >
                {config?.trading_configured ? "Yes" : "No"}
              </p>
            )}
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-1">
              Per-order cap
            </p>
            <p className="text-xl font-semibold text-white">
              {config ? `$${config.max_order_usdc.toFixed(2)}` : "—"}
              <span className="text-xs text-gray-500 font-normal">
                {" "}USDC
              </span>
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase mb-1">
              Attributed volume
            </p>
            <p className="text-xl font-semibold text-white">
              {tradeStats
                ? `$${tradeStats.total_notional_usdc.toFixed(2)}`
                : stats
                ? `$${stats.total_notional_usdc.toFixed(2)}`
                : "—"}
            </p>
            {tradeStats && (
              <p className="text-[11px] text-gray-500 mt-1">
                {tradeStats.total_trades} trades, {tradeStats.unique_owners}{" "}
                unique users
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Attributed trades */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white mb-3">
          Attributed trades (on-chain settled)
        </h2>
        <p className="text-gray-400 text-sm mb-4">
          Pulled from Polymarket&apos;s builder trades endpoint every 3
          minutes. Each trade was matched on-chain with our builder code
          in its <code className="text-xs bg-gray-800 px-1 rounded">builder</code>{" "}
          field.
        </p>

        {tradesLoading ? (
          <TableSkeleton rows={5} />
        ) : tradesList.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">
            No attributed trades yet. The first trade routed through
            PolyScope will appear here once it settles on Polymarket.
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                  <th className="text-left p-3">When</th>
                  <th className="text-left p-3">Owner</th>
                  <th className="text-left p-3">Side</th>
                  <th className="text-right p-3">Price</th>
                  <th className="text-right p-3">Size</th>
                  <th className="text-right p-3">Notional</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Tx</th>
                </tr>
              </thead>
              <tbody>
                {tradesList.map((t) => (
                  <tr key={t.trade_id} className="border-b border-gray-800/50">
                    <td className="p-3 text-gray-300 whitespace-nowrap">
                      {t.match_time ? fmtDate(t.match_time) : "—"}
                    </td>
                    <td className="p-3 text-gray-400 font-mono text-xs">
                      {t.owner_short}
                    </td>
                    <td className="p-3 text-white">{t.side ?? "—"}</td>
                    <td className="p-3 text-right text-gray-300">
                      {t.price != null ? t.price.toFixed(3) : "—"}
                    </td>
                    <td className="p-3 text-right text-gray-300">
                      {t.size != null ? t.size.toFixed(2) : "—"}
                    </td>
                    <td className="p-3 text-right text-gray-300">
                      {t.notional_usdc != null
                        ? `$${t.notional_usdc.toFixed(2)}`
                        : "—"}
                    </td>
                    <td className={`p-3 font-medium ${statusClass(t.status ?? "")}`}>
                      {t.status ?? "—"}
                    </td>
                    <td className="p-3">
                      {t.transaction_hash ? (
                        <a
                          href={`https://polygonscan.com/tx/${t.transaction_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-400 hover:underline text-xs"
                        >
                          view
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Orders */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white mb-3">
          Recent attributed orders
        </h2>
        <p className="text-gray-400 text-sm mb-4">
          Every order carries our builder code on-chain. Status is polled
          from Polymarket&apos;s CLOB every 60 seconds.
        </p>

        {loading ? (
          <TableSkeleton rows={5} />
        ) : ordersList.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">
            No attributed orders yet. The first order will appear here as
            soon as PolyScope routes one through Polymarket.
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                  <th className="text-left p-3">When</th>
                  <th className="text-left p-3">Side</th>
                  <th className="text-right p-3">Price</th>
                  <th className="text-right p-3">Size</th>
                  <th className="text-right p-3">Notional</th>
                  <th className="text-left p-3">Type</th>
                  <th className="text-left p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {ordersList.map((o) => (
                  <tr key={o.id} className="border-b border-gray-800/50">
                    <td className="p-3 text-gray-300 whitespace-nowrap">
                      {fmtDate(o.updated_at || o.created_at)}
                    </td>
                    <td className="p-3 text-white">{o.side}</td>
                    <td className="p-3 text-right text-gray-300">
                      {o.price.toFixed(3)}
                    </td>
                    <td className="p-3 text-right text-gray-300">
                      {o.size.toFixed(2)}
                    </td>
                    <td className="p-3 text-right text-gray-300">
                      ${o.notional_usdc.toFixed(2)}
                    </td>
                    <td className="p-3 text-gray-400">{o.order_type}</td>
                    <td
                      className={`p-3 font-medium ${statusClass(o.status)}`}
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

      <div className="text-sm text-gray-400 mb-10">
        <Link
          href="/methodology"
          className="text-emerald-400 hover:underline"
        >
          Back to methodology
        </Link>
      </div>

      <Disclaimer />
    </div>
  );
}
