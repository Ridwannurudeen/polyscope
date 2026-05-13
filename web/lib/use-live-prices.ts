"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Hook polling /api/wss/live-prices every POLL_MS while the page is open.
 *
 * Returns a market_id → current_price map (the Polymarket display-rule
 * price the backend computes from best_bid/best_ask + spread + last_trade).
 * When WSS is disabled or the stream isn't yet connected, the map is
 * empty and `enabled` reflects the backend state — callers should hide
 * any live indicator in that case.
 *
 * The hook is intentionally read-only and side-effect-free beyond the
 * fetch + setState. Components consuming it can render a "LIVE" pill
 * by comparing the live price to whatever cached price they hold.
 */
const POLL_MS = 5000;

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface LivePriceEntry {
  best_bid?: number;
  best_ask?: number;
  last_trade?: number;
  current_price?: number | null;
  market_id?: string | null;
  ts?: number;
}

interface WssLivePricesPayload {
  enabled: boolean;
  connected: boolean;
  subscribed: number;
  prices: Record<string, LivePriceEntry>;
}

export interface UseLivePricesResult {
  enabled: boolean;
  connected: boolean;
  subscribed: number;
  /** market_id (condition_id) → current_price */
  byMarket: Record<string, number>;
}

const EMPTY: UseLivePricesResult = {
  enabled: false,
  connected: false,
  subscribed: 0,
  byMarket: {},
};

export function useLivePrices(): UseLivePricesResult {
  const [state, setState] = useState<UseLivePricesResult>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      try {
        const res = await fetch(`${API_BASE}/api/wss/live-prices`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data: WssLivePricesPayload = await res.json();
        if (cancelled) return;
        const byMarket: Record<string, number> = {};
        for (const entry of Object.values(data.prices ?? {})) {
          const mid = entry.market_id;
          const price = entry.current_price;
          if (
            typeof mid === "string" &&
            typeof price === "number" &&
            price > 0
          ) {
            byMarket[mid] = price;
          }
        }
        setState({
          enabled: Boolean(data.enabled),
          connected: Boolean(data.connected),
          subscribed: data.subscribed ?? 0,
          byMarket,
        });
      } catch {
        // Network/parse errors are silent — UI just won't update this tick.
        // Next poll retries.
      }
    }

    fetchOnce();
    const id = setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return state;
}

/**
 * Convenience: read the live price for a single market_id, or null if
 * the stream is disabled / hasn't subscribed to this market / has no
 * snapshot yet. Memoized so React doesn't re-render on unrelated
 * cache shape changes.
 */
export function useLivePriceForMarket(
  marketId: string | undefined | null,
): number | null {
  const live = useLivePrices();
  return useMemo(() => {
    if (!marketId || !live.enabled) return null;
    const p = live.byMarket[marketId];
    return typeof p === "number" && p > 0 ? p : null;
  }, [live, marketId]);
}
