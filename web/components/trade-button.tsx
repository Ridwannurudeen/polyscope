"use client";

import { useState } from "react";
import { TradeModal } from "@/components/trade-modal";
import { trackEvent } from "@/lib/analytics";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const GAMMA_HOST =
  process.env.NEXT_PUBLIC_POLYMARKET_GAMMA_HOST ||
  "https://gamma-api.polymarket.com";

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

interface GammaMarket {
  conditionId?: string;
  clobTokenIds?: string;
  orderPriceMinTickSize?: number;
  negRisk?: boolean;
  acceptingOrders?: boolean;
  enableOrderBook?: boolean;
  closed?: boolean;
}

function tickSizeFromGamma(min: number | undefined): "0.001" | "0.01" | "0.1" {
  if (min === undefined) return "0.01";
  if (min <= 0.001) return "0.001";
  if (min <= 0.01) return "0.01";
  return "0.1";
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

  // Markets inside ±1% of certainty can't be traded meaningfully — no
  // counterparty will sell YES at 0.99 when the market is at ~1.00, and
  // the inputs would be clamped to 0.99 anyway. Hide the button rather
  // than render a dead UI element on resolved/near-resolved markets.
  if (marketPrice >= 0.99 || marketPrice <= 0.01) {
    return null;
  }

  const handleClick = async () => {
    setError(null);
    setLoading(true);
    trackEvent("trade_button_clicked", {
      market_id: marketId,
      direction,
    });
    try {
      // Parallel fetch: PolyScope's market detail (for question) and
      // Polymarket Gamma (for token IDs, tick size, neg-risk). We
      // cross-validate the token IDs from both sources before signing.
      // Without Gamma cross-validation the wallet popup would show a
      // 77-digit token ID with no way for the user to know whether the
      // backend is returning the *correct* token for the question they
      // see — classic blind-signing attack surface.
      const [psRes, gammaRes] = await Promise.all([
        fetch(`${API_BASE}/api/market/${marketId}`),
        fetch(
          `${GAMMA_HOST}/markets?condition_ids=${encodeURIComponent(marketId)}&limit=1`,
        ),
      ]);
      if (!psRes.ok) throw new Error(`PolyScope API ${psRes.status}`);
      if (!gammaRes.ok) throw new Error(`Polymarket API ${gammaRes.status}`);

      const psData: MarketDetailResp = await psRes.json();
      const gammaArr: GammaMarket[] = await gammaRes.json();
      const gamma = Array.isArray(gammaArr) ? gammaArr[0] : null;

      if (!gamma || gamma.conditionId?.toLowerCase() !== marketId.toLowerCase()) {
        throw new Error("Market not found on Polymarket");
      }
      if (gamma.closed) throw new Error("Market is closed");
      if (gamma.enableOrderBook === false || gamma.acceptingOrders === false) {
        throw new Error("Polymarket isn't accepting orders on this market right now");
      }

      // Parse Gamma's clobTokenIds — it's a JSON-stringified array
      // ["<yesId>", "<noId>"]. Position 0 is YES; position 1 is NO.
      let gammaYesToken: string | undefined;
      let gammaNoToken: string | undefined;
      try {
        const parsed = JSON.parse(gamma.clobTokenIds || "[]") as string[];
        gammaYesToken = parsed[0];
        gammaNoToken = parsed[1];
      } catch {
        throw new Error("Polymarket returned malformed token IDs");
      }
      if (!gammaYesToken || !gammaNoToken) {
        throw new Error("Polymarket has no CLOB tokens for this market");
      }

      const psYesToken = psData.market?.token_id_yes;
      const psNoToken = psData.market?.token_id_no;
      // If PolyScope's cache disagrees with Polymarket itself, do not
      // sign — refuse the trade. Either our cache is stale or
      // something is wrong; we'd rather block than let the user sign
      // a different token than expected.
      if (psYesToken && psYesToken !== gammaYesToken) {
        throw new Error("Token ID mismatch — refresh and retry");
      }
      if (psNoToken && psNoToken !== gammaNoToken) {
        throw new Error("Token ID mismatch — refresh and retry");
      }

      const tick = tickSizeFromGamma(gamma.orderPriceMinTickSize);
      const tickFloor = Number(tick); // smallest valid price on this market
      const tickCeil = 1 - tickFloor;
      const clamp = (p: number) =>
        Math.max(tickFloor, Math.min(tickCeil, p));

      if (direction === "YES") {
        setTokenId(gammaYesToken);
        setSuggestedPrice(clamp(marketPrice));
      } else {
        setTokenId(gammaNoToken);
        setSuggestedPrice(clamp(1 - marketPrice));
      }
      setTickSize(tick);
      setNegRisk(Boolean(gamma.negRisk));
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
          tickSize={tickSize}
          negRisk={negRisk}
        />
      )}
    </>
  );
}
