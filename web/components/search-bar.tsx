"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";

interface MarketHit {
  market_id: string;
  question: string;
  category: string | null;
  sm_direction: string | null;
  market_price: number | null;
  divergence_pct: number | null;
}
interface TraderHit {
  trader_address: string;
  accuracy_pct: number | null;
  total_divergent_signals: number;
  correct_predictions: number;
}
interface SearchResponse {
  markets: MarketHit[];
  traders: TraderHit[];
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function SearchBar() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (!q || q.length < 2) {
      setResults(null);
      return;
    }
    const handle = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d: SearchResponse) => {
          setResults(d);
          trackEvent("search_query", {
            query_len: q.length,
            market_hits: d.markets?.length || 0,
            trader_hits: d.traders?.length || 0,
          });
        })
        .catch(() => setResults(null))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQ("");
    setResults(null);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xs">
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search markets or traders…"
        className="w-full bg-gray-900 border border-gray-800 text-white text-sm rounded-md px-3 py-1.5 focus:outline-none focus:border-gray-600 placeholder-gray-600"
      />

      {open && q.length >= 2 && (
        <div className="absolute right-0 top-full mt-2 w-[420px] max-w-[90vw] bg-gray-950 border border-gray-800 rounded-xl shadow-2xl overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
          {loading && !results ? (
            <p className="p-4 text-sm text-gray-500">Searching…</p>
          ) : results &&
            results.markets.length === 0 &&
            results.traders.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No matches.</p>
          ) : (
            <>
              {results && results.markets.length > 0 && (
                <div className="border-b border-gray-800">
                  <p className="px-3 pt-3 pb-1 text-xs text-gray-500 uppercase">
                    Markets
                  </p>
                  {results.markets.map((m) => (
                    <Link
                      key={m.market_id}
                      href={`/market/${m.market_id}`}
                      onClick={close}
                      className="block px-3 py-2 hover:bg-gray-900"
                    >
                      <p className="text-sm text-white truncate">
                        {m.question}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {m.category || "uncategorized"}
                        {m.divergence_pct !== null && (
                          <span className="ml-2 text-amber-400">
                            {(m.divergence_pct * 100).toFixed(0)}% divergence
                          </span>
                        )}
                        {m.sm_direction && (
                          <span
                            className={`ml-2 ${m.sm_direction === "YES" ? "text-emerald-400" : "text-red-400"}`}
                          >
                            PolyScope: {m.sm_direction}
                          </span>
                        )}
                      </p>
                    </Link>
                  ))}
                </div>
              )}

              {results && results.traders.length > 0 && (
                <div>
                  <p className="px-3 pt-3 pb-1 text-xs text-gray-500 uppercase">
                    Traders
                  </p>
                  {results.traders.map((t) => (
                    <Link
                      key={t.trader_address}
                      href={`/traders/${t.trader_address}`}
                      onClick={close}
                      className="flex items-center justify-between px-3 py-2 hover:bg-gray-900"
                    >
                      <span className="text-sm text-white font-mono">
                        {shortAddr(t.trader_address)}
                      </span>
                      <span className="text-xs text-gray-400">
                        {t.accuracy_pct !== null
                          ? `${t.accuracy_pct.toFixed(0)}% acc · ${t.correct_predictions}/${t.total_divergent_signals}`
                          : "no scored signals"}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
