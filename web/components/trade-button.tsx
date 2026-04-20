"use client";

import { useState } from "react";
import { TradeModal } from "@/components/trade-modal";
import { trackEvent } from "@/lib/analytics";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface TradeButtonProps {
  marketId: string;
  question: string;
  direction: "YES" | "NO" | string;
  marketPrice: number; // price_yes
}

interface MarketDetailResp {
  market?: {
    token_id_yes?: string;
    token_id_no?: string;
  };
}

export function TradeButton({
  marketId,
  question,
  direction,
  marketPrice,
}: TradeButtonProps) {
  const [open, setOpen] = useState(false);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [suggestedPrice, setSuggestedPrice] = useState<number>(marketPrice);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setError(null);
    setLoading(true);
    trackEvent("trade_button_clicked", {
      market_id: marketId,
      direction,
    });
    try {
      const res = await fetch(`${API_BASE}/api/market/${marketId}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data: MarketDetailResp = await res.json();
      const yesToken = data.market?.token_id_yes;
      const noToken = data.market?.token_id_no;
      if (direction === "YES") {
        if (!yesToken) throw new Error("Market has no YES token id");
        setTokenId(yesToken);
        setSuggestedPrice(marketPrice);
      } else {
        if (!noToken) throw new Error("Market has no NO token id");
        setTokenId(noToken);
        setSuggestedPrice(Math.max(0.01, Math.min(0.99, 1 - marketPrice)));
      }
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load market");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={loading}
        className="px-3 py-1.5 text-xs font-medium bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 rounded-lg hover:bg-emerald-500/25 disabled:opacity-60 transition-colors"
        title="Route an attributed order through PolyScope"
      >
        {loading ? "Loading…" : `Trade ${direction}`}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
      {open && tokenId && (
        <TradeModal
          open={open}
          onClose={() => setOpen(false)}
          tokenId={tokenId}
          marketId={marketId}
          marketQuestion={question}
          suggestedSide="BUY"
          suggestedPrice={suggestedPrice}
        />
      )}
    </>
  );
}
