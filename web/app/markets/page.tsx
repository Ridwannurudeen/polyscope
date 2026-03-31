"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Disclaimer } from "@/components/disclaimer";
import { LastUpdated } from "@/components/last-updated";
import { SkeletonRow } from "@/components/skeleton";
import { usePollingFetch } from "@/lib/hooks";
import type { Market } from "@/lib/api";

interface MarketsResponse {
  markets: Market[];
  total: number;
}

export default function MarketsPage() {
  const [category, setCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const params = new URLSearchParams({ limit: "200", offset: "0" });
  if (category) params.set("category", category);

  const { data, loading, error, lastUpdated, retry } =
    usePollingFetch<MarketsResponse>(`/api/markets?${params}`, 300_000);

  const markets = data?.markets || [];
  const total = data?.total || 0;

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return markets;
    const q = searchQuery.toLowerCase();
    return markets.filter((m) => m.question.toLowerCase().includes(q));
  }, [markets, searchQuery]);

  const categories = [
    "",
    "politics",
    "crypto",
    "sports",
    "science",
    "entertainment",
  ];

  return (
    <div>
      <div className="flex items-start justify-between mb-2">
        <h1 className="text-3xl font-bold text-white">Markets</h1>
        <LastUpdated lastUpdated={lastUpdated} error={error} retry={retry} />
      </div>
      <p className="text-gray-400 mb-6">
        Browse {total} active prediction markets.
      </p>

      <div className="flex gap-2 mb-4 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              category === cat
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-700"
            }`}
          >
            {cat || "All"}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="Search markets..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full px-4 py-2.5 mb-4 bg-gray-900 border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600"
      />

      {searchQuery && (
        <p className="text-sm text-gray-500 mb-3">
          {filtered.length} of {markets.length} markets matching &ldquo;{searchQuery}&rdquo;
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : error && !data ? (
        <div className="text-center py-12">
          <p className="text-red-400 mb-3">Failed to load markets.</p>
          <button
            onClick={retry}
            className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <Link
              key={m.condition_id}
              href={`/market/${m.condition_id}`}
              className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
            >
              <div className="flex-1 min-w-0 mr-4">
                <p className="text-white font-medium truncate">{m.question}</p>
                <div className="flex gap-3 mt-1 text-xs text-gray-500">
                  {m.category && <span>{m.category}</span>}
                  <span>Vol 24h: ${m.volume_24h.toLocaleString()}</span>
                  <span>OI: ${m.open_interest.toLocaleString()}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-white">
                  {(m.price_yes * 100).toFixed(0)}%
                </p>
                <p className="text-xs text-gray-500">YES</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Disclaimer />
    </div>
  );
}
