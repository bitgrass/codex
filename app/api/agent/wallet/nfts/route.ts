import { z } from "zod";
import { BASE_CHAIN_ID, fetchWalletNfts, isValidAddress } from "../../staking/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  walletAddress: z.string().min(42).max(42),
  chainId: z.literal(8453).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Invalid body. Expected { walletAddress, chainId?: 8453, limit?: 1..200 }." },
        { status: 400 },
      );
    }

    const walletAddress = parsed.data.walletAddress as `0x${string}`;
    const limit = parsed.data.limit ?? 80;
    if (!isValidAddress(walletAddress)) {
      return Response.json({ ok: false, error: "Invalid walletAddress." }, { status: 400 });
    }

    const items = await fetchWalletNfts(walletAddress);
    const limited = items.slice(0, limit);

    return Response.json({
      ok: true,
      chainId: BASE_CHAIN_ID,
      walletAddress,
      count: items.length,
      truncated: items.length > limited.length,
      items: limited,
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to fetch wallet NFTs.",
      },
      { status: 500 },
    );
  }
}
