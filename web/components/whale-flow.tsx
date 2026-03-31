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
    60_000
  );

  if (!data || !data.alerts || data.alerts.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold text-white mb-4">
        Whale Flow (24h)
      </h2>
      <div className="space-y-3">
        {data.alerts.slice(0, 10).map((a) => (
          <div
            key={a.id}
            className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between gap-4"
          >
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm truncate">
                {a.question}
              </p>
              <div className="flex items-center gap-3 mt-1.5 text-sm">
                <span className="text-gray-500">
                  Trader #{a.trader_rank}
                </span>
                <span
                  className={
                    a.side === "YES" ? "text-emerald-400" : "text-red-400"
                  }
                >
                  {a.side}
                </span>
                <span className="text-gray-400">
                  {(a.price * 100).toFixed(0)}%
                </span>
                <span className="text-gray-500 text-xs">
                  {timeAgo(a.detected_at)}
                </span>
              </div>
            </div>
            <span className="text-lg font-bold text-white whitespace-nowrap">
              ${a.size.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
