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
      setError("paste a valid 0x… address");
      return;
    }
    const result = await linkWallet(input);
    if (!result.ok) {
      setError(result.error || "link failed");
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
          className="flex items-center gap-1.5 h-8 px-2.5 text-eyebrow font-mono uppercase tracking-wider text-scope-400 border border-scope-500/30 bg-scope-500/8 rounded-md hover:bg-scope-500/14 hover:border-scope-500/50 transition-colors duration-120"
          title={walletAddress}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-scope-500 animate-pulse-subtle" />
          <span className="num">{shortAddress(walletAddress)}</span>
        </button>
        {open && (
          <div className="absolute right-0 mt-2 w-64 surface-elevated rounded-md shadow-elevated p-4 z-50">
            <div className="eyebrow mb-2">linked wallet</div>
            <p className="text-body-sm font-mono text-ink-100 break-all mb-3 num">
              {walletAddress}
            </p>
            <p className="text-micro text-ink-400 mb-4 leading-relaxed">
              Your watchlist and portfolio history is tied to this wallet.
              Log in from another device with the same wallet and it&apos;ll
              follow you.
            </p>
            <button
              onClick={() => {
                trackEvent("wallet_unlinked", {});
                unlinkWallet();
                setOpen(false);
              }}
              className="btn-secondary w-full"
            >
              unlink
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
        className="btn-secondary"
      >
        link wallet
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 surface-elevated rounded-md shadow-elevated p-4 z-50">
          <div className="eyebrow mb-2">link wallet</div>
          <p className="text-micro text-ink-400 mb-3 leading-relaxed">
            Paste your Polymarket wallet address to carry your watchlist
            and portfolio across devices. Read-only identity — we never
            sign or send transactions.
          </p>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            className="w-full h-8 px-2.5 text-body-sm font-mono num bg-background border border-ink-700 text-ink-100 rounded-md focus:outline-none focus:border-scope-500/60 placeholder:text-ink-500 mb-2"
            autoFocus
          />
          {error && (
            <p className="text-micro text-alert-500 mb-2 font-mono">{error}</p>
          )}
          <button
            onClick={submit}
            disabled={linking || !input}
            className="btn-primary w-full"
          >
            {linking ? "linking…" : "link"}
          </button>
          <p className="text-micro text-ink-500 mt-3 font-mono">
            privy wallet connect · next release
          </p>
        </div>
      )}
    </div>
  );
}
