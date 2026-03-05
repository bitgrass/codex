import { ethers } from "ethers";
import { z } from "zod";
import { BASE_CHAIN_ID, fetchTotalEarned, isValidAddress } from "../../staking/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  walletAddress: z.string().min(42).max(42),
  chainId: z.literal(8453).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Invalid body. Expected { walletAddress, chainId?: 8453 }." },
        { status: 400 },
      );
    }

    const walletAddress = parsed.data.walletAddress as `0x${string}`;
    if (!isValidAddress(walletAddress)) {
      return Response.json({ ok: false, error: "Invalid walletAddress." }, { status: 400 });
    }

    const totals = await fetchTotalEarned(walletAddress);
    return Response.json({
      ok: true,
      chainId: BASE_CHAIN_ID,
      walletAddress,
      total: {
        rewardsWei: totals.totalWei.toString(),
        rewardsReadable: ethers.formatUnits(totals.totalWei, 18),
      },
      pools: {
        legendary: {
          rewardsWei: totals.legendaryWei.toString(),
          rewardsReadable: ethers.formatUnits(totals.legendaryWei, 18),
        },
        premium: {
          rewardsWei: totals.premiumWei.toString(),
          rewardsReadable: ethers.formatUnits(totals.premiumWei, 18),
        },
        standard: {
          rewardsWei: totals.standardWei.toString(),
          rewardsReadable: ethers.formatUnits(totals.standardWei, 18),
        },
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Failed to fetch total earned rewards.",
      },
      { status: 500 },
    );
  }
}
