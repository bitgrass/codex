import { getSwapQuote } from "@coinbase/onchainkit/api";
import { setOnchainKitConfig } from "@coinbase/onchainkit";
import type { Token } from "@coinbase/onchainkit/token";
import { base } from "viem/chains";
import { z } from "zod";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const ETH_TOKEN: Token = {
  name: "ETH",
  address: "",
  symbol: "ETH",
  decimals: 18,
  image: null,
  chainId: base.id,
};

const USDC_TOKEN: Token = {
  name: "USDC",
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  symbol: "USDC",
  decimals: 6,
  image: null,
  chainId: base.id,
};

const RequestSchema = z.object({
  amount: z.string().min(1).max(64),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body. Expected { amount: string }" },
      { status: 400 },
    );
  }

  const apiKey = process.env.NEXT_PUBLIC_CDP_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "NEXT_PUBLIC_CDP_API_KEY is not set" },
      { status: 500 },
    );
  }

  // Allow OnchainKit API utilities outside of React context.
  setOnchainKitConfig({ apiKey, chain: base });

  const quote = await getSwapQuote({
    amount: parsed.data.amount,
    amountReference: "from",
    from: ETH_TOKEN,
    to: USDC_TOKEN,
    maxSlippage: "3",
    useAggregator: false,
  });

  return Response.json(quote);
}
