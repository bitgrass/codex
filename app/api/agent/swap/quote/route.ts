import { z } from "zod";
import { BASE_CHAIN_ID, USDC_ADDRESS } from "../../staking/_lib";
import { parseUnits } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  amount: z.string().min(1).max(64),
  fromSymbol: z.enum(["ETH", "USDC"]),
  toSymbol: z.enum(["ETH", "USDC"]),
  chainId: z.literal(8453).optional(),
});

function toAsset(symbol: "ETH" | "USDC") {
  return symbol === "USDC" ? USDC_ADDRESS : "ETH";
}

function toDecimals(symbol: "ETH" | "USDC") {
  return symbol === "USDC" ? 6 : 18;
}

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Invalid body. Expected { amount, fromSymbol, toSymbol, chainId?: 8453 }." },
        { status: 400 },
      );
    }

    if (parsed.data.fromSymbol === parsed.data.toSymbol) {
      return Response.json({ ok: false, error: "fromSymbol and toSymbol must be different." }, { status: 400 });
    }

    const apiKey = process.env.NEXT_PUBLIC_CDP_API_KEY;
    if (!apiKey) {
      return Response.json({ ok: false, error: "NEXT_PUBLIC_CDP_API_KEY is not set" }, { status: 500 });
    }

    let amountRaw: string;
    try {
      amountRaw = parseUnits(parsed.data.amount, toDecimals(parsed.data.fromSymbol)).toString();
    } catch {
      return Response.json({ ok: false, error: "Invalid amount format." }, { status: 400 });
    }

    const rpcUrl = `https://api.developer.coinbase.com/rpc/v1/base/${apiKey}`;
    const body = {
      id: 1,
      jsonrpc: "2.0",
      method: "cdp_getSwapQuote",
      params: [
        {
          from: toAsset(parsed.data.fromSymbol),
          to: toAsset(parsed.data.toSymbol),
          amount: amountRaw,
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
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.error) {
      return Response.json(
        {
          ok: false,
          error: data?.error?.message || "Swap quote request failed.",
          details: data?.error ?? null,
        },
        { status: 500 },
      );
    }

    return Response.json({
      ok: true,
      chainId: BASE_CHAIN_ID,
      fromSymbol: parsed.data.fromSymbol,
      toSymbol: parsed.data.toSymbol,
      amount: parsed.data.amount,
      amountRaw,
      quote: data.result ?? data,
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to fetch swap quote.",
      },
      { status: 500 },
    );
  }
}
