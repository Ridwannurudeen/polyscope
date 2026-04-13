"use client";

import { useEffect, useState } from "react";

interface EventCount {
  event_type: string;
  n: number;
}
interface PageCount {
  path: string;
  n: number;
}
interface DailyRow {
  day: string;
  events: number;
  clients: number;
}

interface MetricsResponse {
  window_days: number;
  actives: {
    dau: number;
    wau: number;
    mau: number;
    all_time: number;
    total_events: number;
  };
  top_events: EventCount[];
  top_pages: PageCount[];
  daily: DailyRow[];
  portfolio: {
    watchlist_total: number;
    watchlist_clients: number;
    actions_total: number;
    actions_clients: number;
  };
}

const TOKEN_KEY = "polyscope_admin_token";

export default function AdminMetricsPage() {
  const [token, setToken] = useState<string>("");
  const [tokenInput, setTokenInput] = useState<string>("");
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  // Load saved token
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(TOKEN_KEY);
    if (saved) {
      setToken(saved);
      setTokenInput(saved);
    }
  }, []);

  // Fetch when token or days changes
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    fetch(
      `/api/admin/metrics?token=${encodeURIComponent(token)}&days=${days}`
    )
      .then(async (r) => {
        if (r.status === 401) {
          setError("Invalid token");
          setData(null);
          return;
        }
        if (!r.ok) {
          setError(`HTTP ${r.status}`);
          setData(null);
          return;
        }
        const d: MetricsResponse = await r.json();
        setData(d);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [token, days]);

  const saveToken = () => {
    if (!tokenInput || tokenInput.length < 8) {
      setError("Token too short");
      return;
    }
    window.localStorage.setItem(TOKEN_KEY, tokenInput);
    setToken(tokenInput);
    setError(null);
  };

  const clearToken = () => {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setTokenInput("");
    setData(null);
  };

  if (!token) {
    return (
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Admin Metrics</h1>
        <p className="text-gray-400 mb-6">
          Enter the admin token to view product metrics.
        </p>
        <div className="space-y-3">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="POLYSCOPE_ADMIN_TOKEN"
            className="w-full bg-gray-900 border border-gray-800 text-white px-3 py-2 rounded-lg focus:outline-none focus:border-gray-600"
            onKeyDown={(e) => {
              if (e.key === "Enter") saveToken();
            }}
          />
          <button
            onClick={saveToken}
            className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
          >
            Load metrics
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Metrics</h1>
          <p className="text-gray-400 text-sm">
            Live product engagement — self-hosted, no third-party tracking
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="bg-gray-900 border border-gray-800 text-white text-sm rounded px-2 py-1"
          >
            <option value={1}>1d</option>
            <option value={7}>7d</option>
            <option value={30}>30d</option>
            <option value={90}>90d</option>
          </select>
          <button
            onClick={clearToken}
            className="text-xs text-gray-500 hover:text-red-400"
          >
            Clear token
          </button>
        </div>
      </div>

      {loading && !data && (
        <p className="text-gray-500">Loading…</p>
      )}
      {error && (
        <p className="text-red-400 mb-4">Error: {error}</p>
      )}

      {data && (
        <>
          {/* Active counts */}
          <section className="mb-8">
            <h2 className="text-sm text-gray-500 uppercase tracking-wide mb-3">
              Active Users
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">DAU</p>
                <p className="text-2xl font-semibold text-white">
                  {data.actives.dau.toLocaleString()}
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">WAU</p>
                <p className="text-2xl font-semibold text-white">
                  {data.actives.wau.toLocaleString()}
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">MAU</p>
                <p className="text-2xl font-semibold text-white">
                  {data.actives.mau.toLocaleString()}
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Total clients</p>
                <p className="text-2xl font-semibold text-white">
                  {data.actives.all_time.toLocaleString()}
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Total events</p>
                <p className="text-2xl font-semibold text-white">
                  {data.actives.total_events.toLocaleString()}
                </p>
              </div>
            </div>
          </section>

          {/* Portfolio funnel */}
          <section className="mb-8">
            <h2 className="text-sm text-gray-500 uppercase tracking-wide mb-3">
              Portfolio Funnel
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Watchlist rows</p>
                <p className="text-2xl font-semibold text-white">
                  {data.portfolio.watchlist_total.toLocaleString()}
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Watchers (unique)</p>
                <p className="text-2xl font-semibold text-white">
                  {data.portfolio.watchlist_clients.toLocaleString()}
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Trades logged</p>
                <p className="text-2xl font-semibold text-white">
                  {data.portfolio.actions_total.toLocaleString()}
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Traders (unique)</p>
                <p className="text-2xl font-semibold text-white">
                  {data.portfolio.actions_clients.toLocaleString()}
                </p>
              </div>
            </div>
          </section>

          {/* Daily breakdown */}
          {data.daily.length > 0 && (
            <section className="mb-8">
              <h2 className="text-sm text-gray-500 uppercase tracking-wide mb-3">
                Daily ({data.window_days}d)
              </h2>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase">
                      <th className="text-left p-3">Day</th>
                      <th className="text-right p-3">Events</th>
                      <th className="text-right p-3">Unique clients</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.map((d) => (
                      <tr
                        key={d.day}
                        className="border-b border-gray-800/50"
                      >
                        <td className="p-3 text-sm text-gray-300">{d.day}</td>
                        <td className="p-3 text-right text-white">
                          {d.events.toLocaleString()}
                        </td>
                        <td className="p-3 text-right text-emerald-400">
                          {d.clients.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Top events */}
            <section>
              <h2 className="text-sm text-gray-500 uppercase tracking-wide mb-3">
                Top Events ({data.window_days}d)
              </h2>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
                {data.top_events.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500">No events yet.</p>
                ) : (
                  <table className="w-full">
                    <tbody>
                      {data.top_events.map((e) => (
                        <tr
                          key={e.event_type}
                          className="border-b border-gray-800/50 last:border-0"
                        >
                          <td className="p-3 text-sm text-white font-mono">
                            {e.event_type}
                          </td>
                          <td className="p-3 text-right text-sm text-emerald-400">
                            {e.n.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* Top pages */}
            <section>
              <h2 className="text-sm text-gray-500 uppercase tracking-wide mb-3">
                Top Pages ({data.window_days}d)
              </h2>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
                {data.top_pages.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500">No page views yet.</p>
                ) : (
                  <table className="w-full">
                    <tbody>
                      {data.top_pages.map((p) => (
                        <tr
                          key={p.path}
                          className="border-b border-gray-800/50 last:border-0"
                        >
                          <td className="p-3 text-sm text-white font-mono truncate max-w-[200px]">
                            {p.path}
                          </td>
                          <td className="p-3 text-right text-sm text-emerald-400">
                            {p.n.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
