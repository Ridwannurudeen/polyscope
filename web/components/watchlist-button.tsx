"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { getClientId } from "@/lib/client-id";
import { useIdentity, useIdentityVersion } from "@/lib/identity";

interface WatchlistItem {
  id: number;
  market_id: string;
}

interface WatchlistResponse {
  items: WatchlistItem[];
  count: number;
}

interface WatchlistCacheEntry {
  items?: WatchlistItem[];
  promise?: Promise<WatchlistItem[]>;
}

const watchlistCache = new Map<string, WatchlistCacheEntry>();

function cacheKey(
  clientId: string,
  walletAddress: string | null,
  identityVersion: number,
): string {
  return `${identityVersion}|${clientId}|${walletAddress ?? ""}`;
}

function updateWatchlistCache(
  clientId: string,
  walletAddress: string | null,
  identityVersion: number,
  update: (items: WatchlistItem[]) => WatchlistItem[],
) {
  const key = cacheKey(clientId, walletAddress, identityVersion);
  const entry = watchlistCache.get(key) ?? {};
  entry.items = update(entry.items ?? []);
  entry.promise = undefined;
  watchlistCache.set(key, entry);
}

async function loadWatchlist(
  clientId: string,
  walletAddress: string | null,
  identityVersion: number,
): Promise<WatchlistItem[]> {
  const key = cacheKey(clientId, walletAddress, identityVersion);
  const cached = watchlistCache.get(key);
  if (cached?.items) return cached.items;
  if (cached?.promise) return cached.promise;

  const qs = new URLSearchParams({ client_id: clientId });
  if (walletAddress) qs.set("wallet_address", walletAddress);
  const promise = fetch(`/api/watchlist?${qs.toString()}`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<WatchlistResponse>;
    })
    .then((d) => {
      const items = d.items ?? [];
      watchlistCache.set(key, { items });
      return items;
    });
  watchlistCache.set(key, { promise });
  return promise;
}

export function WatchlistButton({ marketId }: { marketId: string }) {
  const { walletAddress } = useIdentity();
  const identityVersion = useIdentityVersion();
  const [watchedId, setWatchedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const clientId = getClientId();
    if (!clientId) return;
    let cancelled = false;
    loadWatchlist(clientId, walletAddress, identityVersion)
      .then((items) => {
        if (cancelled) return;
        const hit = items.find((x) => x.market_id === marketId);
        setWatchedId(hit?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setWatchedId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, walletAddress, identityVersion]);

  const add = async () => {
    const clientId = getClientId();
    setLoading(true);
    try {
      const r = await fetch("/api/watchlist/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          market_id: marketId,
          ...(walletAddress ? { wallet_address: walletAddress } : {}),
        }),
      });
      if (r.ok) {
        const d: WatchlistItem = await r.json();
        updateWatchlistCache(
          clientId,
          walletAddress,
          identityVersion,
          (items) => [
            d,
            ...items.filter((x) => x.market_id !== marketId),
          ],
        );
        setWatchedId(d.id);
        trackEvent("watchlist_added", { market_id: marketId });
      }
    } finally {
      setLoading(false);
    }
  };

  const remove = async () => {
    if (!watchedId) return;
    const clientId = getClientId();
    const qs = new URLSearchParams({ client_id: clientId });
    if (walletAddress) qs.set("wallet_address", walletAddress);
    setLoading(true);
    try {
      const r = await fetch(
        `/api/watchlist/${watchedId}?${qs.toString()}`,
        { method: "DELETE" },
      );
      if (r.ok) {
        updateWatchlistCache(
          clientId,
          walletAddress,
          identityVersion,
          (items) => items.filter((x) => x.id !== watchedId),
        );
        setWatchedId(null);
        trackEvent("watchlist_removed", { market_id: marketId });
      }
    } finally {
      setLoading(false);
    }
  };

  if (watchedId) {
    return (
      <button
        onClick={remove}
        disabled={loading}
        className="btn bg-scope-500/12 border border-scope-500/40 text-scope-300 hover:bg-scope-500/20 disabled:opacity-40"
      >
        {loading ? "..." : "watching"}
      </button>
    );
  }

  return (
    <button onClick={add} disabled={loading} className="btn-secondary">
      {loading ? "..." : "watch"}
    </button>
  );
}
