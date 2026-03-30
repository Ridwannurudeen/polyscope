"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Disclaimer } from "@/components/disclaimer";
import type { Market } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("");

  useEffect(() => {
    const params = new URLSearchParams({ limit: "50", offset: "0" });
    if (category) params.set("category", category);

    fetch(`${API_BASE}/api/markets?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setMarkets(data.markets || []);
        setTotal(data.total || 0);
      })
      .catch(() => setMarkets([]))
      .finally(() => setLoading(false));
  }, [category]);

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
      <h1 className="text-3xl font-bold text-white mb-2">Markets</h1>
      <p className="text-gray-400 mb-6">
        Browse {total} active prediction markets.
      </p>

      <div className="flex gap-2 mb-6 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => {
              setCategory(cat);
              setLoading(true);
            }}
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

      {loading ? (
        <div className="animate-pulse text-gray-400 text-center py-12">
          Loading markets...
        </div>
      ) : (
        <div className="space-y-2">
          {markets.map((m) => (
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
