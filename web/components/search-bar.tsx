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

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
    <div ref={containerRef} className="relative w-56">
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500 font-mono text-eyebrow"
        >
          /
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="search markets · traders"
          spellCheck={false}
          className="w-full h-8 pl-6 pr-2.5 text-body-sm font-mono bg-surface border border-ink-700 text-ink-100 rounded-md focus:outline-none focus:border-scope-500/50 placeholder:text-ink-500"
        />
      </div>

      {open && q.length >= 2 && (
        <div className="absolute right-0 top-full mt-2 w-[440px] max-w-[90vw] surface-elevated rounded-md shadow-elevated overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
          {loading && !results ? (
            <p className="p-4 text-body-sm text-ink-400 font-mono">searching…</p>
          ) : results && results.markets.length === 0 && results.traders.length === 0 ? (
            <p className="p-4 text-body-sm text-ink-400 font-mono">no matches</p>
          ) : (
            <>
              {results && results.markets.length > 0 && (
                <div className="border-b border-ink-800">
                  <p className="eyebrow px-3.5 pt-3 pb-2">markets</p>
                  {results.markets.map((m) => (
                    <Link
                      key={m.market_id}
                      href={`/market/${m.market_id}`}
                      onClick={close}
                      className="block px-3.5 py-2.5 row-hover"
                    >
                      <p className="text-body-sm text-ink-100 truncate">
                        {m.question}
                      </p>
                      <p className="text-micro text-ink-500 mt-1 font-mono flex items-center gap-3 flex-wrap">
                        <span>{m.category || "uncategorized"}</span>
                        {m.divergence_pct !== null && (
                          <span className="text-fade-500 num">
                            {(m.divergence_pct * 100).toFixed(0)}% div
                          </span>
                        )}
                        {m.sm_direction && (
                          <span
                            className={`num ${
                              m.sm_direction === "YES"
                                ? "text-scope-400"
                                : "text-alert-500"
                            }`}
                          >
                            sm · {m.sm_direction}
                          </span>
                        )}
                      </p>
                    </Link>
                  ))}
                </div>
              )}

              {results && results.traders.length > 0 && (
                <div>
                  <p className="eyebrow px-3.5 pt-3 pb-2">traders</p>
                  {results.traders.map((t) => (
                    <Link
                      key={t.trader_address}
                      href={`/traders/${t.trader_address}`}
                      onClick={close}
                      className="flex items-center justify-between px-3.5 py-2.5 row-hover"
                    >
                      <span className="text-body-sm text-ink-100 font-mono num">
                        {shortAddr(t.trader_address)}
                      </span>
                      <span className="text-micro text-ink-400 font-mono">
                        {t.accuracy_pct !== null ? (
                          <>
                            <span className="num text-ink-200">
                              {t.accuracy_pct.toFixed(0)}%
                            </span>{" "}
                            ·{" "}
                            <span className="num">
                              {t.correct_predictions}/{t.total_divergent_signals}
                            </span>
                          </>
                        ) : (
                          "no scored signals"
                        )}
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
