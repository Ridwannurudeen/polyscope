"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Disclaimer } from "@/components/disclaimer";
import { LastUpdated } from "@/components/last-updated";
import { SkeletonRow } from "@/components/skeleton";
import { useViewMode, ViewToggle } from "@/components/view-toggle";
import { usePollingFetch } from "@/lib/hooks";
import type { Market } from "@/lib/api";

interface MarketsResponse {
  markets: Market[];
  total: number;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Politics: ["trump", "biden", "president", "election", "congress", "senate", "governor", "democrat", "republican", "vote", "party", "political", "iran", "tariff", "nato", "war", "regime", "sanction", "cabinet", "impeach", "poll"],
  Crypto: ["bitcoin", "btc", "ethereum", "eth", "crypto", "solana", "sol", "token", "defi", "nft", "blockchain", "binance", "coinbase", "altcoin", "memecoin"],
  Sports: ["nba", "nfl", "mlb", "nhl", "soccer", "football", "basketball", "baseball", "hockey", "ufc", "fight", "match", "championship", "playoff", "world cup", "fifa", "premier league", "champion", "medal", "olympics", "grand prix", "f1", "tennis", "golf", "win the", "beat the"],
  Finance: ["stock", "s&p", "nasdaq", "fed", "interest rate", "gdp", "inflation", "recession", "dow", "treasury", "bond", "market cap", "ipo"],
  Tech: ["ai", "openai", "google", "apple", "meta", "microsoft", "spacex", "tesla", "tiktok", "app store", "chatgpt", "artificial intelligence"],
  Entertainment: ["oscar", "grammy", "emmy", "movie", "album", "spotify", "netflix", "kardashian", "celebrity", "music", "film"],
};

function autoCategory(question: string): string {
  const q = question.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => q.includes(kw))) return cat;
  }
  return "Other";
}

export default function MarketsPage() {
  const [category, setCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const { mode: viewMode, setMode: setViewMode } = useViewMode("markets", "list");

  const { data, loading, error, lastUpdated, retry } =
    usePollingFetch<MarketsResponse>(
      `/api/markets?limit=200&offset=0`,
      300_000,
    );

  const markets = data?.markets || [];
  const total = data?.total || 0;

  const categorized = useMemo(
    () => markets.map((m) => ({ ...m, _cat: autoCategory(m.question) })),
    [markets],
  );

  const categories = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of categorized) {
      counts[m._cat] = (counts[m._cat] || 0) + 1;
    }
    return [
      "",
      ...Object.keys(counts).sort((a, b) => (counts[b] || 0) - (counts[a] || 0)),
    ];
  }, [categorized]);

  const filtered = useMemo(() => {
    let list = categorized;
    if (category) list = list.filter((m) => m._cat === category);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((m) => m.question.toLowerCase().includes(q));
    }
    return list;
  }, [categorized, category, searchQuery]);

  return (
    <div>
      <section className="mb-8 pb-8 border-b border-ink-800">
        <div className="flex items-start justify-between gap-6 mb-3">
          <div>
            <div className="eyebrow mb-3">browse · all active</div>
            <h1 className="text-h1 text-ink-100 tracking-tighter leading-tight">
              markets
            </h1>
            <p className="text-body-lg text-ink-300 mt-3 max-w-2xl">
              <span className="num text-ink-100">{total}</span> active
              prediction markets.
              {category && (
                <>
                  {" "}showing <span className="num text-ink-100">{filtered.length}</span> in{" "}
                  <span className="text-ink-200">{category}</span>.
                </>
              )}
            </p>
          </div>
          <LastUpdated lastUpdated={lastUpdated} error={error} retry={retry} />
        </div>
      </section>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`btn ${
              category === cat
                ? "bg-scope-500/15 border border-scope-500/45 text-scope-300"
                : "border border-ink-700 text-ink-400 hover:text-ink-100 hover:border-ink-600"
            }`}
          >
            {cat || "all"}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          placeholder="search markets…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          spellCheck={false}
          className="flex-1 px-4 h-10 bg-surface border border-ink-700 rounded-md text-ink-100 placeholder:text-ink-500 font-mono text-body-sm focus:outline-none focus:border-scope-500/50"
        />
        <ViewToggle mode={viewMode} onChange={setViewMode} />
      </div>

      {searchQuery && (
        <p className="text-caption text-ink-400 font-mono mb-3">
          <span className="num text-ink-200">{filtered.length}</span> of{" "}
          <span className="num text-ink-200">{markets.length}</span> matching
          “{searchQuery}”
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
          <p className="text-alert-500 font-mono text-body-sm mb-4">
            failed to load markets
          </p>
          <button onClick={retry} className="btn-secondary">
            retry
          </button>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((m) => (
            <Link
              key={m.condition_id}
              href={`/market/${m.condition_id}`}
              className="surface rounded-lg p-4 flex flex-col justify-between min-h-[140px] hover:border-ink-600 transition-colors"
            >
              <p className="text-body text-ink-100 font-medium leading-snug line-clamp-3">
                {m.question}
              </p>
              <div className="flex items-end justify-between mt-4 pt-3 border-t border-ink-800">
                <div className="text-caption font-mono text-ink-500 space-y-0.5 min-w-0">
                  {m.category && (
                    <div className="text-ink-400 truncate">{m.category}</div>
                  )}
                  <div>
                    vol{" "}
                    <span className="num text-ink-300">
                      $
                      {m.volume_24h.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div className="num text-h3 text-ink-100 tracking-tight leading-none">
                    {(m.price_yes * 100).toFixed(0)}%
                  </div>
                  <div className="text-micro text-ink-500 font-mono uppercase tracking-wider mt-1">
                    yes
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="surface rounded-lg overflow-hidden divide-y divide-ink-800">
          {filtered.map((m) => (
            <Link
              key={m.condition_id}
              href={`/market/${m.condition_id}`}
              className="flex items-center justify-between px-5 py-4 row-hover-reveal"
            >
              <div className="flex-1 min-w-0 pr-6">
                <p className="text-body text-ink-100 truncate font-medium">
                  {m.question}
                </p>
                <div className="flex gap-4 mt-1.5 text-caption font-mono text-ink-500">
                  {m.category && <span>{m.category}</span>}
                  <span>
                    vol 24h ·{" "}
                    <span className="num text-ink-300">
                      ${m.volume_24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </span>
                  <span>
                    oi ·{" "}
                    <span className="num text-ink-300">
                      ${m.open_interest.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </span>
                </div>
              </div>
              <div className="text-right pr-6">
                <p className="num text-h4 text-ink-100 tracking-tight">
                  {(m.price_yes * 100).toFixed(0)}%
                </p>
                <p className="text-micro text-ink-500 font-mono uppercase tracking-wider">
                  yes
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Disclaimer />
    </div>
  );
}
