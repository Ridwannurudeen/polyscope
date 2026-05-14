// Direct on-chain reads of the DepositWallet's Polymarket approvals.
//
// The CLOB's /balance-allowance endpoint is the documented way to check
// this, but clob-client-v2@1.0.0 types its response with a *scalar*
// `allowance`, while CLOB V2 actually returns an `allowances` map keyed by
// spender. So `resp.allowance` reads `undefined`, `safeBigInt` coerces that
// to 0n, and every order is blocked with "allowance too low" no matter how
// many times the user approves. The relayer is no help either: its
// `.wait()` only confirms the meta-transaction was mined, not that the
// inner approve calls executed. Reading the chain directly sidesteps both
// problems and is the authoritative source anyway.

import { maxUint256, type Address, type PublicClient } from "viem";
import { getContractConfig } from "@polymarket/clob-client-v2";

const ERC20_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ERC1155_IS_APPROVED_ABI = [
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/**
 * The exchange/adapter contracts a given order must have approved. A
 * neg-risk market settles through the neg-risk exchange *and* its adapter;
 * a standard market through the V2 exchange. `buildApprovalCalls` approves
 * all three in one batch, so this is only the subset to *verify* for a
 * specific order.
 */
export function spendersForOrder(chainId: number, negRisk: boolean): Address[] {
  const c = getContractConfig(chainId);
  return negRisk
    ? [c.negRiskExchangeV2 as Address, c.negRiskAdapter as Address]
    : [c.exchangeV2 as Address];
}

export interface AllowanceQuery {
  chainId: number;
  side: "BUY" | "SELL";
  negRisk: boolean;
  /** The DepositWallet that holds the funds and grants the approval. */
  owner: Address;
}

/**
 * Read the DepositWallet's effective Polymarket allowance on chain.
 *
 * BUY  → minimum collateral (pUSD) `allowance(owner, spender)` across the
 *        relevant spenders, in 6-decimal base units. The minimum is the
 *        binding constraint when more than one spender is involved.
 * SELL → `maxUint256` if the wallet has `setApprovalForAll` on every
 *        relevant operator, else `0n`. Outcome shares need a blanket
 *        operator approval — there is no per-amount notion — so callers
 *        can compare the result against the order size uniformly.
 */
export async function readTradeAllowance(
  publicClient: PublicClient,
  q: AllowanceQuery,
): Promise<bigint> {
  const c = getContractConfig(q.chainId);
  const spenders = spendersForOrder(q.chainId, q.negRisk);

  if (q.side === "BUY") {
    const allowances = await Promise.all(
      spenders.map((spender) =>
        publicClient.readContract({
          address: c.collateral as Address,
          abi: ERC20_ALLOWANCE_ABI,
          functionName: "allowance",
          args: [q.owner, spender],
        }),
      ),
    );
    return allowances.reduce((min, a) => (a < min ? a : min));
  }

  const approvals = await Promise.all(
    spenders.map((spender) =>
      publicClient.readContract({
        address: c.conditionalTokens as Address,
        abi: ERC1155_IS_APPROVED_ABI,
        functionName: "isApprovedForAll",
        args: [q.owner, spender],
      }),
    ),
  );
  return approvals.every(Boolean) ? maxUint256 : BigInt(0);
}
