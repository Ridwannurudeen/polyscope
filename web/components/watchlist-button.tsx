"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { getClientId } from "@/lib/client-id";

interface WatchlistItem {
  id: number;
  market_id: string;
}

interface WatchlistResponse {
  items: WatchlistItem[];
  count: number;
}

export function WatchlistButton({ marketId }: { marketId: string }) {
  const [watchedId, setWatchedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Initial check: is this market already on the watchlist?
  useEffect(() => {
    const clientId = getClientId();
    if (!clientId) return;
    fetch(`/api/watchlist?client_id=${encodeURIComponent(clientId)}`)
      .then((r) => r.json())
      .then((d: WatchlistResponse) => {
        const hit = d.items?.find((x) => x.market_id === marketId);
        setWatchedId(hit?.id ?? null);
      })
      .catch(() => {});
  }, [marketId]);

  const add = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/watchlist/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: getClientId(), market_id: marketId }),
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
        { method: "DELETE" }
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
        className="text-xs px-2.5 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-md hover:bg-emerald-500/30 disabled:opacity-50"
      >
        {loading ? "…" : "★ Watching"}
      </button>
    );
  }

  return (
    <button
      onClick={add}
      disabled={loading}
      className="text-xs px-2.5 py-1 bg-gray-800 text-gray-300 border border-gray-700 rounded-md hover:bg-gray-700 disabled:opacity-50"
    >
      {loading ? "…" : "☆ Watch"}
    </button>
  );
}
