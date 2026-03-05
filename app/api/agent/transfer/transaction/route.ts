import { z } from "zod";
import {
  BASE_CHAIN_ID,
  buildTransferTransaction,
  isValidAddress,
} from "../../staking/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  symbol: z.enum(["ETH", "USDC"]),
  amount: z.string().min(1).max(64),
  toAddress: z.string().min(42).max(42),
  chainId: z.literal(8453).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        {
          ok: false,
          error:
            "Invalid body. Expected { symbol: 'ETH'|'USDC', amount: string, toAddress: 0x..., chainId?: 8453 }.",
        },
        { status: 400 },
      );
    }

    const toAddress = parsed.data.toAddress as `0x${string}`;
    if (!isValidAddress(toAddress)) {
      return Response.json({ ok: false, error: "Invalid toAddress." }, { status: 400 });
    }

    const tx = buildTransferTransaction({
      symbol: parsed.data.symbol,
      toAddress,
      amount: parsed.data.amount,
    });

    return Response.json({
      ok: true,
      chainId: BASE_CHAIN_ID,
      symbol: parsed.data.symbol,
      amount: parsed.data.amount,
      toAddress,
      transaction: {
        to: tx.to,
        data: tx.data,
        value: tx.value,
      },
      metadata: {
        amountRaw: tx.amountRaw,
        decimals: tx.decimals,
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to build transfer transaction.",
      },
      { status: 500 },
    );
  }
}
