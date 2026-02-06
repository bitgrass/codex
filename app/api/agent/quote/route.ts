import { base } from "viem/chains";
import { parseUnits } from "viem";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

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

  let amountInWei: string;
  try {
    amountInWei = parseUnits(parsed.data.amount, 18).toString();
  } catch {
    return Response.json({ error: "Invalid amount format." }, { status: 400 });
  }

  const rpcUrl = `https://api.developer.coinbase.com/rpc/v1/${base.name
    .replace(" ", "-")
    .toLowerCase()}/${apiKey}`;

  const body = {
    id: 1,
    jsonrpc: "2.0",
    method: "cdp_getSwapQuote",
    params: [
      {
        from: "ETH",
        to: USDC_ADDRESS,
        amount: amountInWei,
        amountReference: "from",
        slippagePercentage: "0.5",
        v2Enabled: true,
      },
    ],
  };

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) {
    return Response.json(
      {
        error: data?.error?.message || "Swap quote request failed.",
        details: data?.error ?? null,
      },
      { status: 500 },
    );
  }

  return Response.json(data.result ?? data);
}
