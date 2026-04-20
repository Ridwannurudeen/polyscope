"use client";

import { useEffect, useMemo, useState } from "react";
import { usePolymarketTrade, type TradeSide } from "@/lib/use-polymarket-trade";
import { trackEvent } from "@/lib/analytics";

interface TradeModalProps {
  open: boolean;
  onClose: () => void;
  tokenId: string;
  marketId?: string;
  marketQuestion: string;
  suggestedSide: TradeSide;
  suggestedPrice: number;
  tickSize?: "0.001" | "0.01" | "0.1";
  negRisk?: boolean;
}

export function TradeModal(props: TradeModalProps) {
  const {
    open,
    onClose,
    tokenId,
    marketId,
    marketQuestion,
    suggestedSide,
    suggestedPrice,
    tickSize = "0.01",
    negRisk = false,
  } = props;

  const {
    address,
    isConnected,
    status,
    connect,
    switchToPolygon,
    onWrongChain,
    connectError,
    connectStatus,
    submitOrder,
    isSubmitting,
    submitError,
    lastResult,
    builderCodeConfigured,
  } = usePolymarketTrade();

  const [side, setSide] = useState<TradeSide>(suggestedSide);
  const [price, setPrice] = useState<string>(suggestedPrice.toFixed(2));
  const [size, setSize] = useState<string>("10");

  useEffect(() => {
    if (open) {
      setSide(suggestedSide);
      setPrice(suggestedPrice.toFixed(2));
    }
  }, [open, suggestedPrice, suggestedSide]);

  const priceNum = Number.parseFloat(price) || 0;
  const sizeNum = Number.parseFloat(size) || 0;
  const notional = priceNum * sizeNum;

  const canSubmit =
    isConnected &&
    !onWrongChain &&
    !isSubmitting &&
    priceNum > 0 &&
    priceNum < 1 &&
    sizeNum > 0 &&
    builderCodeConfigured;

  const handleSubmit = async () => {
    trackEvent("trade_submit_clicked", { side, price: priceNum, size: sizeNum });
    try {
      const res = await submitOrder({
        tokenId,
        side,
        price: priceNum,
        size: sizeNum,
        orderType: "GTC",
        tickSize,
        negRisk,
      });
      trackEvent("trade_submit_result", {
        success: res.success,
        status: res.status,
        market_id: marketId ?? null,
      });
    } catch {
      // error already captured in hook state; UI shows it
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-gray-950 border border-gray-800 rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Trade on Polymarket</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-400 mb-5 line-clamp-3">
          {marketQuestion}
        </p>

        {/* Side toggle */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setSide("BUY")}
            className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
              side === "BUY"
                ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                : "bg-gray-900 border-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            Buy YES
          </button>
          <button
            onClick={() => setSide("SELL")}
            className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
              side === "SELL"
                ? "bg-red-500/20 border-red-500/50 text-red-300"
                : "bg-gray-900 border-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            Sell YES
          </button>
        </div>

        {/* Price + size */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">
              Price
            </label>
            <input
              type="number"
              step={tickSize}
              min="0.01"
              max="0.99"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-800 text-white rounded-lg focus:outline-none focus:border-emerald-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">
              Shares
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-800 text-white rounded-lg focus:outline-none focus:border-emerald-500/50"
            />
          </div>
        </div>

        {/* Notional preview */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 mb-5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Total cost</span>
            <span className="text-white font-semibold">
              ${notional.toFixed(2)}
            </span>
          </div>
          <p className="text-xs text-gray-600 mt-1">
            Limit order, good-til-canceled. Resting orders may or may not fill.
          </p>
        </div>

        {/* Status / actions */}
        {!builderCodeConfigured ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
            Trading is disabled: builder code not set on this deployment.
          </div>
        ) : !isConnected ? (
          <button
            onClick={connect}
            disabled={connectStatus === "pending"}
            className="w-full py-2.5 bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 rounded-lg font-medium hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {connectStatus === "pending" ? "Connecting…" : "Connect wallet"}
          </button>
        ) : onWrongChain ? (
          <button
            onClick={switchToPolygon}
            className="w-full py-2.5 bg-amber-500/20 border border-amber-500/50 text-amber-300 rounded-lg font-medium hover:bg-amber-500/30"
          >
            Switch to Polygon
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full py-2.5 bg-emerald-500/30 border border-emerald-500/60 text-emerald-200 rounded-lg font-medium hover:bg-emerald-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? "Signing + submitting…"
              : `${side === "BUY" ? "Buy" : "Sell"} for $${notional.toFixed(2)}`}
          </button>
        )}

        {/* Connect error */}
        {connectError && (
          <p className="mt-3 text-xs text-red-400">{connectError}</p>
        )}

        {/* Submit error */}
        {submitError && (
          <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-300 break-words">
            {submitError}
          </div>
        )}

        {/* Success */}
        {lastResult?.success && (
          <div className="mt-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-xs text-emerald-200">
            Order submitted. Status: {lastResult.status}. Order ID:{" "}
            <span className="font-mono break-all">{lastResult.orderID}</span>
          </div>
        )}

        {/* Wallet + compliance footer */}
        <div className="mt-4 text-[10px] text-gray-600 text-center leading-relaxed">
          {isConnected && address && (
            <p>
              Connected: <span className="font-mono">{address.slice(0, 6)}…{address.slice(-4)}</span>
            </p>
          )}
          <p className="mt-1">
            Non-custodial: your wallet signs the order directly. PolyScope never
            handles your private key. Attribution via our builder code is the
            only way we benefit.
          </p>
        </div>
      </div>
    </div>
  );
}
