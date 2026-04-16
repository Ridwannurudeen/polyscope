"use client";

import { useEffect, useRef, useState } from "react";
import { isValidEvmAddress, shortAddress, useIdentity } from "@/lib/identity";
import { trackEvent } from "@/lib/analytics";

export function ConnectWallet() {
  const { walletAddress, linkWallet, unlinkWallet, linking } = useIdentity();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function submit() {
    setError(null);
    if (!isValidEvmAddress(input)) {
      setError("Paste a valid 0x… address");
      return;
    }
    const result = await linkWallet(input);
    if (!result.ok) {
      setError(result.error || "Link failed");
      return;
    }
    trackEvent("wallet_linked", { method: "paste" });
    setInput("");
    setOpen(false);
  }

  if (walletAddress) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-lg hover:bg-emerald-500/20 transition-colors"
          title={walletAddress}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          {shortAddress(walletAddress)}
        </button>
        {open && (
          <div className="absolute right-0 mt-2 w-64 bg-gray-900 border border-gray-800 rounded-lg shadow-xl p-3 z-50">
            <p className="text-xs text-gray-500 mb-1">Linked wallet</p>
            <p className="text-xs font-mono text-white break-all mb-3">
              {walletAddress}
            </p>
            <p className="text-[11px] text-gray-500 mb-3">
              Your watchlist &amp; portfolio history is now tied to this
              wallet. Log in from another device with the same wallet and
              it&apos;ll follow you.
            </p>
            <button
              onClick={() => {
                trackEvent("wallet_unlinked", {});
                unlinkWallet();
                setOpen(false);
              }}
              className="w-full px-3 py-1.5 text-xs bg-gray-800 text-gray-300 rounded-md hover:bg-gray-700"
            >
              Unlink wallet
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1.5 text-xs font-medium bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded-lg hover:bg-emerald-500/20 transition-colors"
      >
        Link wallet
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-gray-900 border border-gray-800 rounded-lg shadow-xl p-3 z-50">
          <p className="text-sm text-white font-medium mb-1">
            Link your wallet
          </p>
          <p className="text-[11px] text-gray-500 mb-3">
            Paste your Polymarket wallet address to carry your watchlist
            + portfolio across devices. We never sign or send transactions
            — read-only identity only.
          </p>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="0x…"
            className="w-full px-2.5 py-1.5 text-xs font-mono bg-gray-950 border border-gray-800 text-white rounded-md focus:outline-none focus:border-emerald-500/50 mb-2"
            autoFocus
          />
          {error && (
            <p className="text-[11px] text-red-400 mb-2">{error}</p>
          )}
          <button
            onClick={submit}
            disabled={linking || !input}
            className="w-full px-3 py-1.5 text-xs font-medium bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded-md hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {linking ? "Linking…" : "Link"}
          </button>
          <p className="text-[10px] text-gray-600 mt-2">
            One-click Privy wallet connect ships next.
          </p>
        </div>
      )}
    </div>
  );
}
