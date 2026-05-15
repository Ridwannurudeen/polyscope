import { describe, expect, it } from "vitest";
import {
  ClobClient,
  type ClobClientOptions,
  Side,
  SignatureTypeV2,
} from "@polymarket/clob-client-v2";
import { polygon } from "wagmi/chains";

const EOA = "0x1111111111111111111111111111111111111111";
const DEPOSIT_WALLET = "0x2222222222222222222222222222222222222222";
const TEST_SIGNATURE = `0x${"11".repeat(65)}`;

describe("@polymarket/clob-client-v2 POLY_1271 orders", () => {
  it("builds DepositWallet orders with the wallet as both maker and signer", async () => {
    let signedValue: Record<string, unknown> | null = null;
    const signer: NonNullable<ClobClientOptions["signer"]> = {
      getAddress: async () => EOA,
      _signTypedData: async (_domain, _types, value) => {
        signedValue = value;
        return TEST_SIGNATURE;
      },
    };
    const client = new ClobClient({
      host: "https://clob.polymarket.com",
      chain: polygon.id,
      signer,
      signatureType: SignatureTypeV2.POLY_1271,
      funderAddress: DEPOSIT_WALLET,
    });

    Object.defineProperty(client, "cachedVersion", { value: 2 });
    client.tickSizes["123"] = "0.01";

    const order = await client.createOrder(
      {
        tokenID: "123",
        price: 0.5,
        size: 10,
        side: Side.BUY,
      },
      { tickSize: "0.01", negRisk: false },
    );

    expect(order.maker).toBe(DEPOSIT_WALLET);
    expect(order.signer).toBe(DEPOSIT_WALLET);
    expect(order.signatureType).toBe(SignatureTypeV2.POLY_1271);
    expect(order.signature.length).toBeGreaterThan(TEST_SIGNATURE.length);
    expect(signedValue).toMatchObject({
      name: "DepositWallet",
      version: "1",
      verifyingContract: DEPOSIT_WALLET,
    });
  });
});
