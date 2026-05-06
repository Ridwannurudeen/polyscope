/**
 * User identity hook.
 *
 * Combines the anonymous client_id (localStorage UUID) with an optional
 * linked wallet address. Wallet links require a fresh EVM signature before
 * POST /api/wallet/link migrates prior watchlist/portfolio history.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { getClientId } from "@/lib/client-id";

const WALLET_KEY = "polyscope_wallet_address";
const IDENTITY_VERSION_EVENT = "polyscope_identity_version";

const _EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
let identityVersion = 0;

function bumpIdentityVersion() {
  identityVersion += 1;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(IDENTITY_VERSION_EVENT));
  }
}

export function isValidEvmAddress(addr: string): boolean {
  return _EVM_ADDR.test(addr.trim());
}

function storedWallet(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WALLET_KEY);
    if (raw && isValidEvmAddress(raw)) return raw.toLowerCase();
  } catch {
    return null;
  }
  return null;
}

export interface WalletLinkProof {
  domain: string;
  issuedAt: number;
  signature: string;
}

export interface Identity {
  clientId: string;
  walletAddress: string | null;
  linkWallet: (
    address: string,
    proof: WalletLinkProof,
  ) => Promise<{ ok: boolean; error?: string }>;
  unlinkWallet: () => void;
  linking: boolean;
}

export function buildWalletLinkMessage(
  clientId: string,
  address: string,
  domain: string,
  issuedAt: number,
): string {
  return [
    "PolyScope wallet link",
    `Domain: ${domain}`,
    `Client ID: ${clientId}`,
    `Wallet: ${address.toLowerCase()}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export function useIdentityVersion(): number {
  const [version, setVersion] = useState(identityVersion);

  useEffect(() => {
    const onVersion = () => setVersion(identityVersion);
    window.addEventListener(IDENTITY_VERSION_EVENT, onVersion);
    return () => window.removeEventListener(IDENTITY_VERSION_EVENT, onVersion);
  }, []);

  return version;
}

export function useIdentity(): Identity {
  const [clientId, setClientId] = useState("");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const { address: wagmiAddress, isConnected } = useAccount();

  useEffect(() => {
    setClientId(getClientId());
    setWalletAddress(storedWallet());
  }, []);

  // Reconcile localStorage with wagmi state. Failure modes this prevents:
  //   1. User disconnects in MetaMask → wagmi reports !isConnected, but
  //      localStorage still has the address → every API write would send
  //      a wallet_address that's no longer signing. Clear localStorage.
  //   2. User switches accounts in MetaMask → wagmi address ≠ stored
  //      address → submitOrder would sign with B against A's funder
  //      cache. Clear so the user must re-link.
  useEffect(() => {
    if (!clientId) return;
    const stored = storedWallet();
    if (!isConnected) {
      if (stored !== null) {
        try {
          window.localStorage.removeItem(WALLET_KEY);
        } catch {
          // localStorage unavailable; in-memory clear still applies.
        }
        setWalletAddress(null);
        bumpIdentityVersion();
      }
      return;
    }
    if (wagmiAddress) {
      const lower = wagmiAddress.toLowerCase();
      if (stored !== null && stored !== lower) {
        try {
          window.localStorage.removeItem(WALLET_KEY);
        } catch {
          // ignore
        }
        setWalletAddress(null);
        bumpIdentityVersion();
      }
    }
  }, [clientId, isConnected, wagmiAddress]);

  const linkWallet = useCallback(
    async (
      address: string,
      proof: WalletLinkProof,
    ): Promise<{ ok: boolean; error?: string }> => {
      const trimmed = address.trim().toLowerCase();
      if (!isValidEvmAddress(trimmed)) {
        return { ok: false, error: "Not a valid EVM address" };
      }
      const cid = clientId || getClientId();
      setLinking(true);
      try {
        const res = await fetch("/api/wallet/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: cid,
            wallet_address: trimmed,
            domain: proof.domain,
            issued_at: proof.issuedAt,
            signature: proof.signature,
          }),
        });
        if (!res.ok) {
          const data: { detail?: string } | null = await res
            .json()
            .catch(() => null);
          return { ok: false, error: data?.detail || `HTTP ${res.status}` };
        }
        window.localStorage.setItem(WALLET_KEY, trimmed);
        setWalletAddress(trimmed);
        bumpIdentityVersion();
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "Network error",
        };
      } finally {
        setLinking(false);
      }
    },
    [clientId],
  );

  const unlinkWallet = useCallback(() => {
    try {
      window.localStorage.removeItem(WALLET_KEY);
    } catch {
      // localStorage can be unavailable; in-memory state still unlinks.
    }
    setWalletAddress(null);
    bumpIdentityVersion();
  }, []);

  return { clientId, walletAddress, linkWallet, unlinkWallet, linking };
}

export function shortAddress(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
