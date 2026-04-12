"use client";

import { useState } from "react";
import { getClientId } from "@/lib/client-id";

export function LogTrade({
  marketId,
  defaultDirection,
  defaultPrice,
}: {
  marketId: string;
  defaultDirection?: string;
  defaultPrice?: number;
}) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<string>(defaultDirection || "YES");
  const [size, setSize] = useState<string>("100");
  const [price, setPrice] = useState<string>(
    defaultPrice ? defaultPrice.toFixed(2) : "0.50"
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
        setError("Size must be positive");
        return;
      }
      if (!Number.isFinite(priceNum) || priceNum <= 0 || priceNum >= 1) {
        setError("Price must be between 0 and 1");
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
        }),
      });
      if (!r.ok) {
        setError("Failed to save");
        return;
      }
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
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-2.5 py-1 bg-gray-800 text-gray-300 border border-gray-700 rounded-md hover:bg-gray-700"
      >
        Log trade
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 bg-gray-950 border border-gray-700 rounded-md px-2 py-1">
      <select
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
        className="bg-transparent text-xs text-white border border-gray-700 rounded px-1 py-0.5"
      >
        <option value="YES">YES</option>
        <option value="NO">NO</option>
      </select>
      <input
        type="number"
        value={size}
        onChange={(e) => setSize(e.target.value)}
        placeholder="size"
        step="10"
        min="0"
        className="w-16 bg-transparent text-xs text-white border border-gray-700 rounded px-1 py-0.5"
      />
      <span className="text-xs text-gray-500">@</span>
      <input
        type="number"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="price"
        step="0.01"
        min="0.01"
        max="0.99"
        className="w-14 bg-transparent text-xs text-white border border-gray-700 rounded px-1 py-0.5"
      />
      <button
        onClick={submit}
        disabled={submitting}
        className="text-xs px-2 py-0.5 bg-emerald-600 text-white rounded hover:bg-emerald-500 disabled:opacity-50"
      >
        {saved ? "✓" : submitting ? "…" : "Save"}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="text-xs px-1.5 py-0.5 text-gray-500 hover:text-gray-300"
      >
        ✕
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
