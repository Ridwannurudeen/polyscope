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

  const sizeClass =
    size === "sm"
      ? "text-xs px-2.5 py-1"
      : "text-sm px-3 py-1.5";

  const toggle = async () => {
    setLoading(true);
    try {
      if (following) {
        const qs = new URLSearchParams({ client_id: getClientId() });
        if (walletAddress) qs.set("wallet_address", walletAddress);
        const r = await fetch(
          `/api/follow/trader/${traderAddress}?${qs.toString()}`,
          { method: "DELETE" }
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
        className={`${sizeClass} bg-gray-800/50 text-gray-600 border border-gray-800 rounded-md`}
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
        className={`${sizeClass} bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-md hover:bg-emerald-500/30 disabled:opacity-50 font-medium`}
      >
        {loading ? "…" : "✓ Following"}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`${sizeClass} bg-gray-800 text-gray-200 border border-gray-700 rounded-md hover:bg-gray-700 hover:border-emerald-500/40 disabled:opacity-50 font-medium`}
    >
      {loading ? "…" : "+ Follow"}
    </button>
  );
}
