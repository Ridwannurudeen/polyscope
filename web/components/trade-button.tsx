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

interface MarketTradeResp {
  market: {
    price_yes: number;
  };
  tokens: {
    YES: string;
    NO: string;
  };
  tick_size: "0.001" | "0.01" | "0.1";
  neg_risk: boolean;
  accepting_orders: boolean;
}

export function TradeButton({
  marketId,
  question,
  direction,
  marketPrice,
}: TradeButtonProps) {
  const [open, setOpen] = useState(false);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [tickSize, setTickSize] = useState<"0.001" | "0.01" | "0.1">("0.01");
  const [negRisk, setNegRisk] = useState<boolean>(false);
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
      // No pre-flight geoblock check — Polymarket removed that endpoint; the CLOB enforces geo at order placement.
      const res = await fetch(
        `${API_BASE}/api/market/${encodeURIComponent(marketId)}/trade`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `PolyScope API ${res.status}`);
      }

      const data: MarketTradeResp = await res.json();
      if (!data.accepting_orders) {
        throw new Error("Polymarket is not accepting orders on this market right now");
      }

      const tickFloor = Number(data.tick_size);
      const tickCeil = 1 - tickFloor;
      const clamp = (p: number) => Math.max(tickFloor, Math.min(tickCeil, p));

      if (direction === "YES") {
        setTokenId(data.tokens.YES);
        setSuggestedPrice(clamp(data.market.price_yes));
      } else {
        setTokenId(data.tokens.NO);
        setSuggestedPrice(clamp(1 - data.market.price_yes));
      }
      setTickSize(data.tick_size);
      setNegRisk(data.neg_risk);
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
        {loading ? "Loading..." : `Trade ${direction}`}
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
          tickSize={tickSize}
          negRisk={negRisk}
        />
      )}
    </>
  );
}
