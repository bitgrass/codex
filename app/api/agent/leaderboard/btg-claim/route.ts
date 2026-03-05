import { z } from "zod";
import { BASE_CHAIN_ID, fetchLeaderboardRow, isValidAddress } from "../../staking/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  walletAddress: z.string().min(42).max(42),
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Invalid body. Expected { walletAddress }." },
        { status: 400 },
      );
    }

    const walletAddress = parsed.data.walletAddress as `0x${string}`;
    if (!isValidAddress(walletAddress)) {
      return Response.json({ ok: false, error: "Invalid walletAddress." }, { status: 400 });
    }

    const result = await fetchLeaderboardRow(walletAddress);
    return Response.json({
      ok: true,
      chainId: BASE_CHAIN_ID,
      walletAddress,
      found: result.found,
      btgClaim: result.row?.btgClaim ?? 0,
      rank: result.rank,
      total: result.total,
      row: result.row,
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to fetch BTG claim amount.",
      },
      { status: 500 },
    );
  }
}
