"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { getClientId } from "@/lib/client-id";
import { useIdentity } from "@/lib/identity";

export function LogTrade({
  marketId,
  defaultDirection,
  defaultPrice,
}: {
  marketId: string;
  defaultDirection?: string;
  defaultPrice?: number;
}) {
  const { walletAddress } = useIdentity();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<string>(defaultDirection || "YES");
  const [size, setSize] = useState<string>("100");
  const [price, setPrice] = useState<string>(
    defaultPrice ? defaultPrice.toFixed(2) : "0.50",
  );
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const sizeNum = parseFloat(size);
      const priceNum = parseFloat(price);
      if (!Number.isFinite(sizeNum) || sizeNum <= 0) {
        setError("size > 0");
        return;
      }
      if (!Number.isFinite(priceNum) || priceNum <= 0 || priceNum >= 1) {
        setError("price 0–1");
        return;
      }
      const r = await fetch("/api/portfolio/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: getClientId(),
          market_id: marketId,
          action_direction: direction,
          size: sizeNum,
          price: priceNum,
          ...(walletAddress ? { wallet_address: walletAddress } : {}),
        }),
      });
      if (!r.ok) {
        setError("failed");
        return;
      }
      trackEvent("trade_logged", {
        market_id: marketId,
        direction,
        size: sizeNum,
        price: priceNum,
      });
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        setOpen(false);
      }, 1200);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary">
        log trade
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 surface-elevated border-ink-700 rounded-md px-2 py-1">
      <select
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
        className="bg-transparent text-body-sm font-mono text-ink-100 border border-ink-700 rounded px-1.5 py-0.5 focus:outline-none focus:border-scope-500/50"
      >
        <option value="YES">yes</option>
        <option value="NO">no</option>
      </select>
      <input
        type="number"
        value={size}
        onChange={(e) => setSize(e.target.value)}
        placeholder="size"
        step="10"
        min="0"
        className="w-16 bg-transparent text-body-sm font-mono num text-ink-100 border border-ink-700 rounded px-1.5 py-0.5 focus:outline-none focus:border-scope-500/50"
      />
      <span className="text-micro text-ink-500 font-mono">@</span>
      <input
        type="number"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="price"
        step="0.01"
        min="0.01"
        max="0.99"
        className="w-14 bg-transparent text-body-sm font-mono num text-ink-100 border border-ink-700 rounded px-1.5 py-0.5 focus:outline-none focus:border-scope-500/50"
      />
      <button
        onClick={submit}
        disabled={submitting}
        className="btn-primary h-7 px-2"
      >
        {saved ? "saved" : submitting ? "…" : "save"}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="text-eyebrow font-mono px-1.5 py-0.5 text-ink-500 hover:text-ink-300 uppercase tracking-wider"
      >
        cancel
      </button>
      {error && (
        <span className="text-eyebrow font-mono text-alert-500 uppercase tracking-wider">
          {error}
        </span>
      )}
    </div>
  );
}
