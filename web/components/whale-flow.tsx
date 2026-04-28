"use client";

import { usePollingFetch } from "@/lib/hooks";
import type { WhaleAlert } from "@/lib/api";

interface WhaleFlowResponse {
  alerts: WhaleAlert[];
  count: number;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function WhaleFlow() {
  const { data } = usePollingFetch<WhaleFlowResponse>(
    "/api/whale-flow?hours=24",
    60_000,
  );

  if (!data || !data.alerts || data.alerts.length === 0) return null;

  return (
    <div>
      <div className="flex items-end justify-between mb-5 pb-2 border-b border-ink-800">
        <div className="min-w-0">
          <h2 className="text-h3 text-ink-100 tracking-tight">whale flow</h2>
          <p className="text-caption text-ink-500 mt-1">
            Top-trader entries ≥ $10K in the last 24h.
          </p>
        </div>
        <span className="num text-micro font-mono text-ink-500 shrink-0 ml-4">
          {data.alerts.length}
        </span>
      </div>
      <div className="surface rounded-lg overflow-hidden divide-y divide-ink-800">
        {data.alerts.slice(0, 10).map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between px-5 py-4 row-hover"
          >
            <div className="flex-1 min-w-0 pr-6">
              <p className="text-body text-ink-100 truncate font-medium">
                {a.question}
              </p>
              <div className="flex items-center gap-5 mt-1.5 text-caption font-mono">
                <span className="text-ink-500">
                  trader <span className="num text-ink-300">#{a.trader_rank}</span>
                </span>
                <span
                  className={`num ${
                    a.side === "YES" ? "text-scope-400" : "text-alert-500"
                  }`}
                >
                  {a.side}
                </span>
                <span className="text-ink-400 num">
                  @ {(a.price * 100).toFixed(0)}%
                </span>
                <span className="text-ink-500">{timeAgo(a.detected_at)}</span>
              </div>
            </div>
            <span className="num text-h4 text-ink-100 whitespace-nowrap tracking-tight">
              ${a.size.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
