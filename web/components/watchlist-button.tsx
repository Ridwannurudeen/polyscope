"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { getClientId } from "@/lib/client-id";
import { useIdentity } from "@/lib/identity";

interface WatchlistItem {
  id: number;
  market_id: string;
}

interface WatchlistResponse {
  items: WatchlistItem[];
  count: number;
}

export function WatchlistButton({ marketId }: { marketId: string }) {
  const { walletAddress } = useIdentity();
  const [watchedId, setWatchedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const clientId = getClientId();
    if (!clientId) return;
    const qs = new URLSearchParams({ client_id: clientId });
    if (walletAddress) qs.set("wallet_address", walletAddress);
    fetch(`/api/watchlist?${qs.toString()}`)
      .then((r) => r.json())
      .then((d: WatchlistResponse) => {
        const hit = d.items?.find((x) => x.market_id === marketId);
        setWatchedId(hit?.id ?? null);
      })
      .catch(() => {});
  }, [marketId, walletAddress]);

  const add = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/watchlist/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: getClientId(),
          market_id: marketId,
          ...(walletAddress ? { wallet_address: walletAddress } : {}),
        }),
      });
      if (r.ok) {
        const d = await r.json();
        setWatchedId(d.id);
        trackEvent("watchlist_added", { market_id: marketId });
      }
    } finally {
      setLoading(false);
    }
  };

  const remove = async () => {
    if (!watchedId) return;
    setLoading(true);
    try {
      const r = await fetch(
        `/api/watchlist/${watchedId}?client_id=${encodeURIComponent(getClientId())}`,
        { method: "DELETE" },
      );
      if (r.ok) {
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
        {loading ? "…" : "watching"}
      </button>
    );
  }

  return (
    <button onClick={add} disabled={loading} className="btn-secondary">
      {loading ? "…" : "watch"}
    </button>
  );
}
