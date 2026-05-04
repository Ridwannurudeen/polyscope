"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { getClientId } from "@/lib/client-id";
import { useIdentity } from "@/lib/identity";

interface FollowItem {
  trader_address: string;
}

interface FollowListResponse {
  items: FollowItem[];
  count: number;
}

interface FollowCacheEntry {
  addresses?: Set<string>;
  promise?: Promise<Set<string>>;
}

const followCache = new Map<string, FollowCacheEntry>();

function cacheKey(clientId: string, walletAddress: string | null): string {
  return `${clientId}|${walletAddress ?? ""}`;
}

function updateFollowCache(
  clientId: string,
  walletAddress: string | null,
  update: (addresses: Set<string>) => Set<string>,
) {
  const key = cacheKey(clientId, walletAddress);
  const entry = followCache.get(key) ?? {};
  entry.addresses = update(new Set(entry.addresses ?? []));
  entry.promise = undefined;
  followCache.set(key, entry);
}

async function loadFollowedTraders(
  clientId: string,
  walletAddress: string | null,
): Promise<Set<string>> {
  const key = cacheKey(clientId, walletAddress);
  const cached = followCache.get(key);
  if (cached?.addresses) return cached.addresses;
  if (cached?.promise) return cached.promise;

  const qs = new URLSearchParams({ client_id: clientId });
  if (walletAddress) qs.set("wallet_address", walletAddress);
  const promise = fetch(`/api/follow/list?${qs.toString()}`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<FollowListResponse>;
    })
    .then((d) => {
      const addresses = new Set(
        (d.items ?? []).map((item) => item.trader_address.toLowerCase()),
      );
      followCache.set(key, { addresses });
      return addresses;
    });
  followCache.set(key, { promise });
  return promise;
}

export function FollowButton({
  traderAddress,
  size = "md",
}: {
  traderAddress: string;
  size?: "sm" | "md";
}) {
  const { walletAddress } = useIdentity();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const normalizedTrader = traderAddress.toLowerCase();

  useEffect(() => {
    const cid = getClientId();
    if (!cid) return;
    let cancelled = false;
    loadFollowedTraders(cid, walletAddress)
      .then((addresses) => {
        if (!cancelled) setFollowing(addresses.has(normalizedTrader));
      })
      .catch(() => {
        if (!cancelled) setFollowing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [normalizedTrader, walletAddress]);

  const sizeClass = size === "sm" ? "h-7 px-2 text-eyebrow" : "h-8 px-3 text-eyebrow";

  const toggle = async () => {
    const cid = getClientId();
    setLoading(true);
    try {
      if (following) {
        const qs = new URLSearchParams({ client_id: cid });
        if (walletAddress) qs.set("wallet_address", walletAddress);
        const r = await fetch(
          `/api/follow/trader/${traderAddress}?${qs.toString()}`,
          { method: "DELETE" },
        );
        if (r.ok) {
          updateFollowCache(cid, walletAddress, (addresses) => {
            addresses.delete(normalizedTrader);
            return addresses;
          });
          setFollowing(false);
          trackEvent("trader_unfollowed", { trader_address: traderAddress });
        }
      } else {
        const r = await fetch("/api/follow/trader", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: cid,
            trader_address: traderAddress,
            ...(walletAddress ? { wallet_address: walletAddress } : {}),
          }),
        });
        if (r.ok) {
          updateFollowCache(cid, walletAddress, (addresses) => {
            addresses.add(normalizedTrader);
            return addresses;
          });
          setFollowing(true);
          trackEvent("trader_followed", { trader_address: traderAddress });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  if (following === null) {
    return (
      <button
        disabled
        className={`${sizeClass} font-mono uppercase tracking-wider inline-flex items-center justify-center bg-ink-800/40 text-ink-600 border border-ink-800 rounded-md`}
      >
        ...
      </button>
    );
  }

  if (following) {
    return (
      <button
        onClick={toggle}
        disabled={loading}
        className={`${sizeClass} font-mono uppercase tracking-wider inline-flex items-center justify-center bg-scope-500/14 text-scope-300 border border-scope-500/40 rounded-md hover:bg-scope-500/20 disabled:opacity-40 transition-colors duration-120`}
      >
        {loading ? "..." : "following"}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`${sizeClass} font-mono uppercase tracking-wider inline-flex items-center justify-center bg-transparent text-ink-300 border border-ink-700 rounded-md hover:text-ink-100 hover:border-ink-600 disabled:opacity-40 transition-colors duration-120`}
    >
      {loading ? "..." : "follow"}
    </button>
  );
}
