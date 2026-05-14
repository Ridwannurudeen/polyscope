"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig } from "wagmi";
import { polygon } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { fallback, http } from "viem";

const wagmiConfig = createConfig({
  chains: [polygon],
  connectors: [injected({ target: "metaMask" })],
  transports: {
    // wagmi's default Polygon transport (polygon-rpc.com) returns
    // 403 "tenant disabled" — Safe getOwners checks fail with
    // "Couldn't verify Safe ownership — network issue". Pin to two
    // healthy public RPCs with viem fallback so a single outage
    // doesn't break trade-modal Safe verification.
    [polygon.id]: fallback([
      http("https://polygon-bor-rpc.publicnode.com"),
      http("https://polygon.drpc.org"),
    ]),
  },
  ssr: true,
});

export function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
