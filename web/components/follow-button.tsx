"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { getClientId } from "@/lib/client-id";
import { useIdentity } from "@/lib/identity";

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

  useEffect(() => {
    const cid = getClientId();
    if (!cid) return;
    const qs = new URLSearchParams({ client_id: cid });
    if (walletAddress) qs.set("wallet_address", walletAddress);
    fetch(`/api/follow/is-following/${traderAddress}?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : { following: false }))
      .then((d) => setFollowing(!!d.following))
      .catch(() => setFollowing(false));
  }, [traderAddress, walletAddress]);

  const sizeClass = size === "sm" ? "h-7 px-2 text-eyebrow" : "h-8 px-3 text-eyebrow";

  const toggle = async () => {
    setLoading(true);
    try {
      if (following) {
        const qs = new URLSearchParams({ client_id: getClientId() });
        if (walletAddress) qs.set("wallet_address", walletAddress);
        const r = await fetch(
          `/api/follow/trader/${traderAddress}?${qs.toString()}`,
          { method: "DELETE" },
        );
        if (r.ok) {
          setFollowing(false);
          trackEvent("trader_unfollowed", { trader_address: traderAddress });
        }
      } else {
        const r = await fetch("/api/follow/trader", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: getClientId(),
            trader_address: traderAddress,
            ...(walletAddress ? { wallet_address: walletAddress } : {}),
          }),
        });
        if (r.ok) {
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
        …
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
        {loading ? "…" : "following"}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`${sizeClass} font-mono uppercase tracking-wider inline-flex items-center justify-center bg-transparent text-ink-300 border border-ink-700 rounded-md hover:text-ink-100 hover:border-ink-600 disabled:opacity-40 transition-colors duration-120`}
    >
      {loading ? "…" : "follow"}
    </button>
  );
}
